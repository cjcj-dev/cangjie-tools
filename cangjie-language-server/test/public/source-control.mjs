#!/usr/bin/env node
// Independently exercise ordinary source through the installed public LSP protocol.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [sdkArg, workspaceArg, evidenceArg, mode = 'default', storage = 'memory', logging = 'off'] = process.argv.slice(2);
if (!sdkArg || !workspaceArg || !evidenceArg) throw new Error('usage: source-control.mjs SDK WORKSPACE EVIDENCE [default|explicit] [memory|database]');
const sdk = resolve(sdkArg), workspace = resolve(workspaceArg), evidence = resolve(evidenceArg);
await mkdir(evidence, { recursive: true });
const env = {
  PATH: '/usr/bin:/bin', HOME: join(evidence, 'home'),
  XDG_CONFIG_HOME: join(evidence, 'home/config'), XDG_CACHE_HOME: join(evidence, 'home/cache'),
  CANGJIE_HOME: sdk,
  LD_LIBRARY_PATH: [join(sdk, 'runtime/lib/linux_x86_64_cjnative'), join(sdk, 'tools/lib'), join(sdk, 'lib/linux_x86_64_cjnative')].join(':'),
};
await mkdir(env.HOME, { recursive: true });
const args = storage === 'database' ? [`--cache-path=${workspace}`] : [];
if (logging === 'log') args.push('--enable-log=true', `--log-path=${evidence}`);
const child = spawn(join(sdk, 'tools/bin/LSPServer'), args, { cwd: workspace, env });
const messages = [], pending = new Map();
let input = Buffer.alloc(0), stderr = '', nextId = 1, protocolError;
const exited = new Promise(resolveExit => child.once('exit', (code, signal) => resolveExit({ code, signal })));
child.once('error', error => { protocolError = error; });
child.stderr.on('data', data => { stderr += data; });
const send = message => {
  const body = Buffer.from(JSON.stringify(message));
  child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
};
child.stdout.on('data', data => {
  input = Buffer.concat([input, data]);
  for (;;) {
    const end = input.indexOf('\r\n\r\n');
    if (end < 0) return;
    const match = /Content-Length:\s*(\d+)/i.exec(input.subarray(0, end).toString());
    if (!match) { protocolError = new Error('missing Content-Length'); return; }
    const size = Number(match[1]);
    if (input.length < end + 4 + size) return;
    const message = JSON.parse(input.subarray(end + 4, end + 4 + size).toString());
    input = input.subarray(end + 4 + size);
    messages.push(message);
    if (message.method && message.id !== undefined) {
      send({ jsonrpc: '2.0', id: message.id, result: null });
    } else if (message.id !== undefined && pending.has(message.id)) {
      const reply = pending.get(message.id); pending.delete(message.id); reply(message);
    }
  }
});
const request = async (method, params) => {
  if (protocolError) throw protocolError;
  const id = nextId++;
  const response = new Promise(done => pending.set(id, done));
  send({ jsonrpc: '2.0', id, method, params });
  let timer;
  try {
    const reply = await Promise.race([response, exited.then(status => { throw new Error(`process exited before ${method}: ${JSON.stringify(status)}`); }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 120000); })]);
    if (reply.error) throw new Error(`${method}: ${JSON.stringify(reply.error)}`);
    return reply.result;
  } finally { clearTimeout(timer); }
};
const result = { sdk, workspace, mode, storage, executable: join(sdk, 'tools/bin/LSPServer'), args, env, assertionExecuted: false };
let harnessRc = 2;
try {
  const options = mode === 'explicit' ? { modulesHomeOption: sdk } : {};
  options.multiModuleOption = { [pathToFileURL(workspace).href]: { name: 'probe' } };
  result.initialize = await request('initialize', { processId: process.pid, rootUri: pathToFileURL(workspace).href, capabilities: { textDocument: {} }, initializationOptions: options });
  await writeFile(join(evidence, 'process.maps'), await readFile(`/proc/${child.pid}/maps`));
  send({ jsonrpc: '2.0', method: 'initialized', params: {} });
  const sourceFile = join(workspace, 'src/main.cj');
  const uri = pathToFileURL(sourceFile).href;
  const contents = await readFile(sourceFile, 'utf8');
  send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
    textDocument: { uri, languageId: 'Cangjie', version: 1, text: contents },
  } });
  result.symbols = await request('textDocument/documentSymbol', { textDocument: { uri } });
  result.assertionExecuted = true;
  // This control consumes the ordinary source AST, independently of CJO/FTS queries.
  result.controlPass = Array.isArray(result.symbols) && result.symbols.some(item =>
    item.name === 'PlainControl' && item.kind === 5);
  harnessRc = result.controlPass ? 0 : 1;
  await request('shutdown', null);
  send({ jsonrpc: '2.0', method: 'exit', params: null });
  child.stdin.end();
} catch (error) {
  result.error = String(error.stack || error);
  child.stdin.end();
} finally {
  let timer;
  result.process = await Promise.race([exited, new Promise(done => { timer = setTimeout(() => { child.kill('SIGTERM'); done({ code: null, signal: 'HARNESS_TIMEOUT' }); }, 10000); })]);
  clearTimeout(timer);
  result.harnessRc = harnessRc;
  await writeFile(join(evidence, 'protocol.json'), JSON.stringify(messages, null, 2));
  await writeFile(join(evidence, 'stderr.log'), stderr);
  await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ assertionExecuted: result.assertionExecuted, targetPass: result.targetPass, controlPass: result.controlPass, process: result.process, harnessRc }));
}
process.exitCode = harnessRc;
