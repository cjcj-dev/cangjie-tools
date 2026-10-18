import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

const script=process.env.LSP_TEST_BUILD_SCRIPT || new URL('./build.py',import.meta.url).pathname;
const evidence=process.env.LSP_TEST_ROOT || os.tmpdir();
fs.mkdirSync(evidence,{recursive:true});
// Run the public Python entry unchanged. Only downloaded inputs and external
// git/CMake/flatc are controlled; these tests do not qualify a native platform.
function fixture(t,system='Linux',state='first') {
 const root=fs.mkdtempSync(path.join(evidence,'lsp-jobs-')),lsp=root+'/lsp',bin=root+'/commands';
 if(!process.env.LSP_TEST_ROOT)t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const put=(name,body='',mode)=>{fs.mkdirSync(path.dirname(name),{recursive:true});fs.writeFileSync(name,body,mode?{mode}:{});};
 put(lsp+'/build/build.py',fs.readFileSync(script));put(lsp+'/generate/index.fbs','controlled schema');
 put(root+'/sdk/include/header.h');
 for(const rel of ['tools/lib/libcangjie-lsp.so','tools/lib/libcangjie-lsp.dylib','tools/lib/libcangjie-lsp.dll.a','tools/bin/libcangjie-lsp.dll'])put(root+'/sdk/'+rel);
 const external=`#!${process.execPath}
const fs=require('fs'),path=require('path'),kind=path.basename(process.argv[1]),args=process.argv.slice(2);
const root=process.env.LSP_FIXTURE_ROOT;
fs.appendFileSync(root+'/calls.jsonl',JSON.stringify({kind,args,cwd:process.cwd(),parallel:process.env.CMAKE_BUILD_PARALLEL_LEVEL})+'\\n');
function put(p,s='fixture'){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);}
if(kind==='git'&&args[0]==='clone'){
 if(args.includes('flatbuffers'))fs.mkdirSync('flatbuffers/include',{recursive:true});
 else if(args.includes('sqlite3'))for(const f of ['src/shell.c','src/sqlite3.c','include/sqlite3.h','include/sqlite3ext.h'])put('sqlite3/'+f);
 else fs.mkdirSync('json-v3.11.3',{recursive:true});
}
if(kind==='cmake'&&args[0]==='--build'){
 if(args[1].includes('/flatbuffers/')){
  if(process.env.LSP_FAIL_FLAT==='1')process.exit(37);
  for(const n of ['flatc','flatc.exe']){put(n,'#!${process.execPath}\\nrequire("fs").writeFileSync("index_generated.h","generated fixture");\\n');fs.chmodSync(n,0o755);}
 }else put(root+'/lsp/output/bin/LSPServer');
}
`;
 for(const n of ['git','cmake'])put(bin+'/'+n,external,0o755);
 if(state!=='first'){
  for(const name of ['json-v3.11.3','flatbuffers/include'])fs.mkdirSync(lsp+'/third_party/'+name,{recursive:true});
  for(const rel of ['src/shell.c','src/sqlite3.c','include/sqlite3.h','include/sqlite3ext.h'])put(lsp+'/third_party/sqlite3/'+rel);
  if(state==='complete') {put(lsp+'/third_party/flatbuffers/include/index_generated.h');put(lsp+'/third_party/sqlite3/amalgamation/sqlite3.c');}
 }
 return {root,lsp,system,env:{...process.env,PATH:bin+':'+process.env.PATH,CANGJIE_HOME:root+'/sdk',LSP_FIXTURE_ROOT:root,CMAKE_BUILD_PARALLEL_LEVEL:'2'}};
}
function invoke(f,args=[],extra={}) {
 const argv=f.system==='Linux'?['build.py','build',...args]:['-c',
  `import platform,runpy,sys; platform.system=lambda:${JSON.stringify(f.system)}; sys.argv=['build.py','build']+sys.argv[1:]; runpy.run_path('build.py',run_name='__main__')`,...args];
 const r=spawnSync('python3',argv,{cwd:f.lsp+'/build',env:{...f.env,...extra},encoding:'utf8',timeout:20000});
 fs.appendFileSync(f.root+'/results.jsonl',JSON.stringify({argv,rc:r.status,signal:r.signal,error:r.error?.message,stdout:r.stdout,stderr:r.stderr})+'\n');
 const calls=fs.existsSync(f.root+'/calls.jsonl')?fs.readFileSync(f.root+'/calls.jsonl','utf8').trim().split('\n').map(JSON.parse):[];
 return {...r,calls};
}
function builds(r){return r.calls.filter(c=>c.kind==='cmake'&&c.args[0]==='--build');}
function check(r,jobs,predecessor=true){
 assert.equal(r.status,0,r.stderr);
 const b=builds(r);assert.equal(b.length,predecessor?2:1,'flatbuffers and final LSP build reached');
 for(const row of b)assert.deepEqual(row.args.slice(2),jobs?['-j',String(jobs)]:[],'LSP_PREDECESSOR_BUDGET_CONSUMED');
}
for(const system of ['Linux','Darwin','Windows'])test(`LSP ${system} public first and incomplete preparation consume explicit jobs`,t=>{
 for(const state of ['first','incomplete'])for(const jobs of [1,4]){
  const f=fixture(t,system,state),r=invoke(f,['--jobs',String(jobs)]);check(r,jobs);
  assert(fs.existsSync(f.lsp+'/third_party/flatbuffers/include/index_generated.h'));
  assert(fs.existsSync(f.lsp+'/third_party/sqlite3/amalgamation/sqlite3.c'));
  assert.equal(r.calls.filter(c=>c.kind==='git'&&c.args[0]==='clone').length,state==='first'?3:0);
 }
});
test('LSP default budget inherits CMake environment for predecessor and final build',t=>{
 const r=invoke(fixture(t,'Darwin'));check(r,0);
 for(const row of builds(r))assert.equal(row.parallel,'2');
});
test('LSP complete dependency control does not rebuild or download predecessors',t=>{
 const r=invoke(fixture(t,'Darwin','complete'),['--jobs','1']);check(r,1,false);
 assert.equal(r.calls.filter(c=>c.kind==='git').length,0);
});
test('LSP failed predecessor returns failure and prevents final build',t=>{
 const f=fixture(t,'Darwin','incomplete'),r=invoke(f,['--jobs','1'],{LSP_FAIL_FLAT:'1'});
 assert.equal(r.status,1);assert.match(r.stderr,/non-zero exit status 37/);
 assert.equal(builds(r).length,1);assert(!fs.existsSync(f.lsp+'/output/bin/LSPServer'));
});
