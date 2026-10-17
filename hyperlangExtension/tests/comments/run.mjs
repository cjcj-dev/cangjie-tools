#!/usr/bin/env zx
// Run the installed public HLE entry, then compile its unmodified CJ output.
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptIndex = process.argv.findIndex((argument, index) => index > 0 &&
  resolve(argument) === fileURLToPath(import.meta.url));
assert.ok(scriptIndex > 0, 'HARNESS_ARGUMENT_ENTRY');
const { values } = parseArgs({ args: process.argv.slice(scriptIndex + 1), options: {
  hle: { type: 'string' }, cjc: { type: 'string' }, out: { type: 'string' },
  'install-dir': { type: 'string' }, analysis: { type: 'string' },
  typescript: { type: 'string' }, 'import-path': { type: 'string', multiple: true },
  explicit: { type: 'boolean', default: false }, directory: { type: 'boolean', default: false },
  'generation-only': { type: 'boolean', default: false },
  group: { type: 'string', multiple: true },
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
// This fixed union has three intentional data/name occurrences as well as its
// brief. Match complete lexical tokens and their production positions; no other
// occurrence (including one in an arbitrary string) is exempted.
function unionOccurrences(source) {
  const marker = 'HLE_NOTE_UNION_RETURN';
  const identifier = 'LITERAL___HLE_NOTE_UNION_RETURN__';
  const literal = '"*/HLE_NOTE_UNION_RETURN/*"';
  const safeBrief = String.raw`@brief unionReturn(): "*\/HLE_NOTE_UNION_RETURN/\*" | number`;
  const mask = commentMap(source.text);
  const tokens = [];
  for (let i = 0; i < source.text.length;) {
    if (mask[i] || /\s/.test(source.text[i])) { i++; continue; }
    const start = i;
    let kind = 'punctuation';
    if (source.text[i] === '"' || source.text[i] === "'") {
      kind = 'string';
      const quote = source.text[i++];
      while (i < source.text.length) {
        if (source.text[i] === '\\') { i += 2; continue; }
        if (source.text[i++] === quote) break;
      }
    } else if (/[A-Za-z_]/.test(source.text[i])) {
      kind = 'identifier';
      while (i < source.text.length && /[A-Za-z_0-9]/.test(source.text[i])) i++;
    } else i++;
    tokens.push({ start, end: i, kind, text: source.text.slice(start, i) });
  }
  const sequence = (index, expected) => expected.every((text, n) => tokens[index + n]?.text === text);
  const enumName = 'AutoGenType0Inmethod';
  const declaration = tokens.findIndex((_, i) => sequence(i, ['public', 'enum', enumName, '{', '|', identifier, '|', 'NUMBER', '(', 'Float64', ')']));
  const method = tokens.findIndex((_, i) => sequence(i, ['public', 'func', 'toJSValue', '(', 'context', ':', 'JSContext', ')', ':', 'JSValue', '{', 'match', '(', 'this', ')', '{', 'case', identifier, '=', '>', 'context', '.', 'string', '(', literal, ')', '.', 'toJSValue', '(', ')']));
  const result = [];
  for (const match of source.text.matchAll(new RegExp(marker, 'g'))) {
    const offset = match.index;
    const tokenIndex = tokens.findIndex(t => t.start <= offset && offset < t.end);
    const token = tokens[tokenIndex];
    let role = 'unexpected', pass = false;
    const lineStart = source.text.lastIndexOf('\n', offset) + 1;
    const lineEnd = source.text.indexOf('\n', offset);
    const line = source.text.slice(lineStart, lineEnd);
    if (/^\s*\* @brief unionReturn\(\): /.test(line)) {
      role = 'comment';
      pass = Boolean(mask[offset]) && line.trim() === `* ${safeBrief}` &&
        /^\n\s*\*\/\s*public func unionReturn\(\): AutoGenType0Inmethod \{/.test(source.text.slice(lineEnd));
    } else if (token?.kind === 'identifier' && token.text === identifier) {
      if (declaration >= 0 && tokenIndex === declaration + 5) {
        role = 'enum-declaration'; pass = true;
      } else if (method >= 0 && tokenIndex === method + 17 && declaration >= 0 &&
        method === declaration + 11) {
        role = 'enum-case'; pass = true;
      }
    } else if (token?.kind === 'string' && token.text === literal && method >= 0 &&
      tokenIndex === method + 24 && declaration >= 0 && method === declaration + 11) {
      role = 'context-string'; pass = true;
    }
    result.push({ assertion: role === 'comment' ? 'UNION_COMMENT_SAFE' : 'UNION_LEGAL_POSITION',
      marker, file: source.path, offset, role, lexicalKind: mask[offset] ? 'comment' : token?.kind, pass });
  }
  return result;
}
async function check(output, inputs) {
  const sources = await Promise.all((await files(output, '.cj')).map(async path => ({ path, text: await readFile(path, 'utf8') })));
  assert.ok(sources.length > 0, 'CJ_GENERATION_REACHED');
  const inputText = (await Promise.all(inputs.map(path => readFile(path, 'utf8')))).join('\n');
  const markers = [...new Set(inputText.match(/HLE_(?:NOTE|CONTROL)_\w+/g) ?? [])];
  const assertions = [];
  for (const marker of markers) {
    if (marker === 'HLE_NOTE_UNION_RETURN') {
      const occurrences = sources.flatMap(unionOccurrences);
      assertions.push(...occurrences);
      for (const role of ['comment', 'enum-declaration', 'enum-case', 'context-string']) {
        const count = occurrences.filter(item => item.role === role).length;
        assertions.push({ assertion: 'UNION_EXACT_ROLE_COUNT', marker, role, count, pass: count === 1 });
      }
      assertions.push({ assertion: 'UNION_NO_EXTRA_OCCURRENCES', marker, count: occurrences.length,
        pass: occurrences.length === 4 && occurrences.every(item => item.role !== 'unexpected') });
      assertions.push({ assertion: 'INPUT_MARKER_REACHED_CJ', marker, count: occurrences.length,
        pass: occurrences.length > 0 });
      continue;
    }
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
  const propertyInputs = inputs.filter(path => path.endsWith('/property.d.ts'));
  if (propertyInputs.length) {
    const propertyText = (await Promise.all(propertyInputs.map(path => readFile(path, 'utf8')))).join('\n');
    const propertyMarkers = [...new Set(propertyText.match(/HLE_(?:NOTE|CONTROL)_\w+/g) ?? [])];
    for (const marker of propertyMarkers) {
      const count = sources.reduce((n, source) => n + [...source.text.matchAll(new RegExp(marker, 'g'))].length, 0);
      assertions.push({ assertion: 'PROPERTY_DOC_ONCE', marker, count, pass: count === 1 });
    }
    for (const pattern of [
      'public var required: String', 'public let immutable: Float64',
      'public var optional: Option<Bool> = None', 'public let documented: Option<String> protected',
      'documented!: Option<String> = None', 'this.documented = documented',
      'public mut prop local: String', 'public prop localOptional: ?Bool',
      'public static mut prop shared: String', 'public prop fixed: Float64',
      'public mut prop mutable: ?String', 'public mut prop documented: Bool',
      'class ChildFields <: PropertyFields', 'class ChildClass <: PropertyClass'
    ]) assertions.push({ assertion: 'PROPERTY_DECLARATION_PRESERVED', pattern,
      pass: code.replace(/\s+/g, '').includes(pattern.replace(/\s+/g, '')) });
  }
  if (inputs.some(path => path.endsWith('/generic.d.ts'))) {
    const jsonPaths = (await files(output, '.json')).filter(path => path.endsWith('/generic.json'));
    assert.equal(jsonPaths.length, 1, 'GENERIC_JSON_PRODUCER_REACHED');
    const parsed = JSON.parse(await readFile(jsonPaths[0], 'utf8'));
    const types = parsed.type.map(entry => entry.info);
    const expected = {
      Own: ['()', '(function ((T (StringLiteral "*/HLE_NOTE_OWN/*"))) (ref T) (parameter value (ref T)))', 'Own'],
      Alias: ['((T (StringLiteral "*/HLE_NOTE_ALIAS/*")))', '(function () (ref T) (parameter value (ref T)))', 'Alias<T>'],
      Both: ['((T (StringLiteral "*/HLE_NOTE_OUTER/*")))', '(function ((U (StringLiteral "*/HLE_NOTE_INNER/*"))) (ref U) (parameter outer (ref T)) (parameter inner (ref U)))', 'Both<T>'],
      Shadow: ['((T (StringLiteral "*/HLE_NOTE_SHADOW_OUTER/*")))', '(function ((T (StringLiteral "*/HLE_NOTE_SHADOW_INNER/*"))) (ref T) (parameter value (ref T)))', 'Shadow<T>'],
      Dependent: ['((T (StringLiteral "*/HLE_NOTE_DEPENDENT/*")))', '(function ((U (ref T))) (ref T) (parameter value (ref U)))', 'Dependent<T>'],
      Parenthesized: ['((T (StringLiteral "*/HLE_NOTE_PAREN_OUTER/*")))', '(function ((U (StringLiteral "*/HLE_NOTE_PAREN_INNER/*"))) (ref T) (parameter value (ref U)))', 'Parenthesized<T>'],
      Nested: ['()', '(function () (function ((T (StringLiteral "*/HLE_NOTE_NESTED/*"))) (ref T) (parameter value (ref T))))', 'Nested'],
      PlainFunction: ['()', '(function () (string) (parameter value (number)))', 'PlainFunction']
    };
    for (const [name, [alias, fn, declaration]] of Object.entries(expected)) {
      const info = types.find(info => info.name === name);
      assertions.push({ assertion: 'ALIAS_SCOPE_SERIALIZED', name, actual: info?.typeParameters, pass: info?.typeParameters === alias });
      assertions.push({ assertion: 'FUNCTION_SCOPE_SERIALIZED', name, actual: info?.typeNode, pass: info?.typeNode === fn });
      const match = code.match(new RegExp(`public\\s+type\\s+(${name}(?:\\s*<[^>]*>)?)\\s*=`));
      assertions.push({ assertion: 'ALIAS_SCOPE_CONSUMED', name, actual: match?.[1],
        pass: match?.[1].replace(/\s/g, '') === declaration });
    }
  }
  await writeFile(join(output, 'assertions.json'), JSON.stringify(assertions, null, 2) + '\n');
  console.log(`TARGET_ASSERTIONS_EXECUTED=${assertions.length} files=${sources.length}`);
  assert.ok(assertions.every(result => result.pass), 'NOTE_REMAINS_COMMENT / INPUT_MARKER_REACHED_CJ');
}
// Always finish the ordinary control first. The explicit finite profile leaves
// generated-CJ compilation NOT_RUN; the default still requires the real cjc.
let targetFailures = 0;
const selected = values.group ?? ['control', 'const', 'type', 'method', 'object', 'generic', 'property'];
assert.ok(selected.every(name => ['control', 'const', 'type', 'method', 'object', 'generic', 'property'].includes(name)), 'KNOWN_GROUP');
const groups = values.directory ? [selected.filter(name => name === 'control'), selected.filter(name => name !== 'control')].filter(group => group.length) :
  selected.map(name => [name]);
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
