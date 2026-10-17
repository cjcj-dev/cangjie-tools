#!/usr/bin/env zx
// Run with an installed cjpm and a fresh, private work directory.
import { $ } from 'zx';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const [cjpm, work, fixtures] = process.argv.slice(2);
assert.ok(path.isAbsolute(cjpm) && path.isAbsolute(work));
await fs.mkdir(work, { recursive: false });
process.env.GIT_TRACE2_EVENT = path.join(work, 'git-trace.jsonl');
const records = [];
let sequence = 0;
async function command(cwd, args) {
  const result = await $({ cwd, quiet: true, nothrow: true })`${args}`;
  const name = `${String(++sequence).padStart(3, '0')}-${path.basename(args[0])}`;
  await fs.writeFile(path.join(work, `${name}.log`), result.stdout + result.stderr);
  records.push({ cwd, args, rc: result.exitCode, log: `${name}.log` });
  await fs.writeFile(path.join(work, 'commands.json'), JSON.stringify(records, null, 2));
  assert.equal(result.exitCode, 0, `command failed: ${args.join(' ')}; see ${name}.log`);
  return result.stdout.trim();
}
async function write(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}
const outcomes = [];
for (const organization of ['', 'org']) {
  const label = organization ? 'organization' : 'ordinary';
  const fullName = organization ? 'org::dep' : 'dep';
  const safeName = organization ? 'dep@org' : 'dep';
  const repo = path.join(fixtures ?? work, label, 'remote');
  const project = path.join(work, label, 'project');
  const cache = path.join(work, label, 'cache');
  if (!fixtures) {
  await fs.mkdir(repo, { recursive: true });
  await command(repo, ['git', 'init', '-b', 'first']);
  await command(repo, ['git', 'config', 'user.name', 'Zxilly']);
  await command(repo, ['git', 'config', 'user.email', 'zxilly@outlook.com']);
  await write(path.join(repo, 'cjpm.toml'), `[package]\nname = "dep"\norganization = "${organization}"\nversion = "1.0.0"\ncjc-version = "1.0.0"\noutput-type = "static"\n`);
  await write(path.join(repo, 'src/lib.cj'), `package ${fullName}\npublic func value(): Int64 { 11 }\n`);
  await command(repo, ['git', 'add', '.']);
  await command(repo, ['git', 'commit', '-m', 'First harmless dependency']);
  await command(repo, ['git', 'tag', 'v1']);
  await command(repo, ['git', 'switch', '-c', 'second']);
  await write(path.join(repo, 'src/lib.cj'), `package ${fullName}\npublic func value(): Int64 { 22 }\n`);
  await command(repo, ['git', 'add', '.']);
  await command(repo, ['git', 'commit', '-m', 'Second harmless dependency']);
  await command(repo, ['git', 'switch', 'first']);
  }
  // Every comparison arm reuses these exact remote objects and immutable refs.
  const first = await command(repo, ['git', 'rev-parse', 'first']);
  const second = await command(repo, ['git', 'rev-parse', 'second']);
  await write(path.join(project, 'src/main.cj'), `package consumer\nimport ${fullName}.*\nmain(): Int64 { println(value()); return 0 }\n`);
  // Exercise the public repository configuration, without changing HOME or Git globals.
  await write(path.join(project, 'cangjie-repo.toml'), `[repository.cache]\npath = "../cache"\n`);
  async function config(selector) {
    await write(path.join(project, 'cjpm.toml'), `[package]\nname = "consumer"\nversion = "1.0.0"\ncjc-version = "1.0.0"\noutput-type = "executable"\n[dependencies]\n"${fullName}" = { git = "${repo}"${selector ? ', ' + selector : ''} }\n`);
  }
  async function build(phase, hash, value) {
    await command(project, [cjpm, 'build', '-V', '-j', '32']);
    const output = await command(project, [path.join(project, 'target/release/bin/main')]);
    assert.equal(output, String(value), `${label}/${phase}: dependency was consumed`);
    const expected = path.join(cache, 'git', safeName, hash);
    const actual = path.join(cache, 'git', fullName, hash);
    const present = await fs.stat(expected).then(s => s.isDirectory(), () => false);
    const head = await command(project, ['git', '-C', present ? expected : actual, 'rev-parse', 'HEAD']);
    assert.equal(head, hash);
    const result = { label, phase, expected, actual, hash, output, canonicalCache: present };
    outcomes.push(result);
    await fs.writeFile(path.join(work, 'outcomes.json'), JSON.stringify(outcomes, null, 2));
    // Keep gathering the ordinary control and semantic evidence before reporting cache failures.
  }
  await config('');
  await build('default-HEAD-first', first, 11);
  const initialCache = path.join(cache, 'git', await fs.stat(path.join(cache, 'git', safeName)).then(() => safeName, () => fullName), first);
  const initialIndex = await fs.stat(path.join(initialCache, '.git/index'));
  // Force a fresh compilation while retaining the lock and Git cache.
  await fs.rm(path.join(project, 'target'), { recursive: true });
  await build('same-cache-lock-recovery', first, 11);
  const recoveredIndex = await fs.stat(path.join(initialCache, '.git/index'));
  assert.equal(recoveredIndex.ino, initialIndex.ino, 'cache recovery must reuse the checkout');
  assert.equal(recoveredIndex.mtimeMs, initialIndex.mtimeMs, 'cache recovery must not check out again');
  await config('branch = "second"');
  await command(project, [cjpm, 'update']);
  await build('branch-switch', second, 22);
  await build('branch-cache-recovery', second, 22);
  await config('tag = "v1"');
  await command(project, [cjpm, 'update']);
  await build('tag-first-cache-recovery', first, 11);
  await config(`commitId = "${second}"`);
  await command(project, [cjpm, 'update']);
  await build('explicit-commit-cache-recovery', second, 22);
}
const failures = outcomes.filter(x => !x.canonicalCache);
await fs.writeFile(path.join(work, 'assertions.json'), JSON.stringify({ executed: true, samples: outcomes.length, failures }, null, 2));
assert.deepEqual(failures, [], 'Git dependencies must use canonical cache names after real build/run');
console.log(`PASS: ${outcomes.length} public build/run/cache checks`);
