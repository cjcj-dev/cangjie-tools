#!/usr/bin/env zx
// Run the installed public HLE entry, then compile its unmodified CJ output.
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { values } = parseArgs({ options: {
  hle: { type: 'string' }, cjc: { type: 'string' }, out: { type: 'string' },
  'install-dir': { type: 'string' }, analysis: { type: 'string' },
  typescript: { type: 'string' }, 'import-path': { type: 'string', multiple: true },
  explicit: { type: 'boolean', default: false }, directory: { type: 'boolean', default: false },
  'generation-only': { type: 'boolean', default: false },
  'collect-red': { type: 'boolean', default: false }
}});
for (const key of ['hle', 'cjc', 'out', 'install-dir']) assert.ok(values[key], `missing --${key}`);
if (values.explicit) for (const key of ['analysis', 'typescript']) assert.ok(values[key], `missing --${key}`);
const fixtures = dirname(fileURLToPath(import.meta.url));
const out = resolve(values.out);
await mkdir(out, { recursive: true });
const results = [];
async function command(name, args) {
  const child = await $({ cwd: resolve(values['install-dir']), quiet: true, nothrow: true })`${args}`;
  const result = { name, args, rc: child.exitCode, signal: child.signal };
  results.push(result);
  await writeFile(join(out, `${name}.log`), child.stdout + child.stderr);
  await writeFile(join(out, 'commands.json'), JSON.stringify(results, null, 2) + '\n');
  return result.rc;
}
async function files(dir, suffix) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await files(path, suffix));
    else if (entry.name.endsWith(suffix)) found.push(path);
  }
  return found.sort();
}
// Track lexical comment boundaries, including nested CJ block comments. The real
// compiler below independently checks syntax and types; this checks the invariant
// that inert note text never becomes code or a string outside its source comment.
function commentMap(source) {
  const mask = new Uint8Array(source.length);
  let depth = 0, line = false, quote = '';
  for (let i = 0; i < source.length; i++) {
    const pair = source.slice(i, i + 2), c = source[i];
    if (line) { mask[i] = 1; if (c === '\n') line = false; continue; }
    if (depth) {
      mask[i] = 1;
      if (pair === '/*') { depth++; mask[++i] = 1; }
      else if (pair === '*/') { depth--; mask[++i] = 1; }
      continue;
    }
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (pair === '//') { line = true; mask[i] = mask[++i] = 1; }
    else if (pair === '/*') { depth = 1; mask[i] = mask[++i] = 1; }
    else if (c === '"' || c === "'") quote = c;
  }
  return mask;
}
async function check(output, inputs) {
  const sources = await Promise.all((await files(output, '.cj')).map(async path => ({ path, text: await readFile(path, 'utf8') })));
  assert.ok(sources.length > 0, 'CJ_GENERATION_REACHED');
  const inputText = (await Promise.all(inputs.map(path => readFile(path, 'utf8')))).join('\n');
  const markers = [...new Set(inputText.match(/HLE_(?:NOTE|CONTROL)_\w+/g) ?? [])];
  const assertions = [];
  for (const marker of markers) {
    let count = 0;
    for (const source of sources) {
      const mask = commentMap(source.text);
      for (const match of source.text.matchAll(new RegExp(marker, 'g'))) {
        count++;
        assertions.push({ assertion: 'NOTE_REMAINS_COMMENT', marker, file: source.path,
          offset: match.index, pass: Boolean(mask[match.index]) });
      }
    }
    assertions.push({ assertion: 'INPUT_MARKER_REACHED_CJ', marker, count, pass: count > 0 });
  }
  const code = sources.map(source => {
    const mask = commentMap(source.text);
    return [...source.text].map((c, index) => mask[index] ? ' ' : c).join('');
  }).join('\n');
  const required = inputText.includes('HLE_CONTROL_DOC') ? ['Plain', 'ORDINARY', 'echo', 'PlainObject', 'PlainEnum'] :
    inputText.includes('COMMENTED_VALUE') ? ['COMMENTED_VALUE', 'CommentedType', 'DOCUMENTED_VALUE'] : [];
  for (const name of required) assertions.push({ assertion: 'ORDINARY_DECLARATION_PRESERVED', name,
    pass: new RegExp(`\\b${name}\\b`).test(code) });
  if (inputText.includes('COMMENTED_EMPTY')) assertions.push({ assertion: 'NO_INITIALIZER_REMAINS_COMMENTED',
    pass: !code.includes('COMMENTED_EMPTY') });
  await writeFile(join(output, 'assertions.json'), JSON.stringify(assertions, null, 2) + '\n');
  console.log(`TARGET_ASSERTIONS_EXECUTED=${assertions.length} files=${sources.length}`);
  assert.ok(assertions.every(result => result.pass), 'NOTE_REMAINS_COMMENT / INPUT_MARKER_REACHED_CJ');
}
// Always finish the ordinary control first. The explicit finite profile leaves
// generated-CJ compilation NOT_RUN; the default still requires the real cjc.
let targetFailures = 0;
const groups = values.directory ? [['control'], ['const', 'type', 'method', 'object']] :
  [['control'], ['const'], ['type'], ['method'], ['object']];
for (const group of groups) {
  const name = group.join('-'), output = join(out, name);
  await mkdir(output, { recursive: true });
  const inputPaths = group.map(name => join(fixtures, `${name}.d.ts`));
  const args = [resolve(values.hle), '-o', output, '--lib', '--module-name=hle_comments'];
  if (values.directory && group[0] !== 'control') {
    // A private input directory preserves the exact frozen fixture bytes.
    const inputDir = join(out, 'directory-input');
    await mkdir(inputDir);
    for (const input of inputPaths) await writeFile(join(inputDir, input.split('/').at(-1)), await readFile(input));
    args.push('-d', inputDir);
  } else args.push('-i', inputPaths[0]);
  if (values.explicit) args.push('-j', resolve(values.analysis), '-r', resolve(values.typescript));
  assert.equal(await command(`${name}-hle`, args), 0, 'PUBLIC_HLE_RC');
  assert.ok((await files(output, '.json')).length > 0, 'JS_JSON_PRODUCER_REACHED');
  try {
    await check(output, inputPaths);
  } catch (error) {
    if (!values['collect-red'] || group[0] === 'control' ||
      !(error instanceof assert.AssertionError) ||
      error.message !== 'NOTE_REMAINS_COMMENT / INPUT_MARKER_REACHED_CJ') throw error;
    targetFailures++;
    console.log(`EXPECTED_TARGET_RED=${name}`);
  }
  if (values['generation-only']) {
    console.log(`GENERATED_CJ_COMPILE=NOT_RUN group=${name}`);
    continue;
  }
  const build = join(out, `${name}-compiled`);
  await mkdir(build);
  const imports = (values['import-path'] ?? []).flatMap(path => ['--import-path', resolve(path)]);
  assert.equal(await command(`${name}-cjc`, [resolve(values.cjc), '-p', output, '--output-type=staticlib',
    '--output-dir', build, '-o', 'libhle_comments.a', ...imports]), 0, 'GENERATED_CJ_COMPILER_RC');
}
if (targetFailures) {
  console.log(`TARGET_FAILURE_GROUPS=${targetFailures}`);
  process.exitCode = 1;
} else console.log(values['generation-only'] ? 'PUBLIC_HLE_GENERATION_SEMANTICS_PASS COMPILE=NOT_RUN' :
  'PUBLIC_HLE_GENERATION_AND_REAL_CJ_COMPILE_PASS');
