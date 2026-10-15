import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
const [rootArg, outputArg] = process.argv.slice(2);
const root = resolve(rootArg), output = resolve(outputArg);
await mkdir(output, { recursive: true });
const build = join(root, 'build-lsp');
const entries = JSON.parse(await readFile(join(build, 'compile_commands.json'), 'utf8'));
const entry = entries.find(x => x.file.endsWith('/launcher/main.cpp'));
const quote = x => "'" + x.replaceAll("'", "'\\''") + "'";
const object = join(output, 'protocol.o');
const binary = join(output, 'protocol');
const compile = entry.command.replace(entry.file, quote(join(root, 'test/public/index-database-protocol.cpp')))
  .replace(/-o\s+\S+/, '-o ' + quote(object));
const nativeLink = await readFile(join(build, 'src/CMakeFiles/LSPServer.dir/link.txt'), 'utf8');
const link = nativeLink.replace('CMakeFiles/LSPServer.dir/launcher/main.cpp.o', quote(object))
  .replace(/-o\s+\S+/, '-o ' + quote(binary));
for (const [name, command] of [['compile', compile], ['link', link]]) {
  await writeFile(join(output, name + '.command'), command);
  const result = spawnSync('bash', ['-c', command], { cwd: entry.directory, encoding: 'utf8' });
  await writeFile(join(output, name + '.log'), (result.stdout ?? '') + (result.stderr ?? ''));
  await writeFile(join(output, name + '.rc'), String(result.status));
  console.log(JSON.stringify({ name, rc: result.status, signal: result.signal }));
  if (result.status !== 0) process.exit(result.status ?? 2);
}
