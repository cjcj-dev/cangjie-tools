import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

const script=process.env.CJPM_TEST_BUILD_SCRIPT || new URL('./build.py',import.meta.url).pathname;
const evidence=process.env.CJPM_TEST_ROOT || os.tmpdir();
fs.mkdirSync(evidence,{recursive:true});
const budget=os.availableParallelism();
function fixture({real=false}={}) {
  const root=fs.mkdtempSync(path.join(evidence,'cjpm-jobs-'));
  const cjpm=path.join(root,'cjpm'), bin=path.join(root,'commands');
  for(const dir of ['build','cpp/third_party/libuv','config','src'])fs.mkdirSync(path.join(cjpm,dir),{recursive:true});
  fs.mkdirSync(bin);fs.copyFileSync(script,path.join(cjpm,'build/build.py'));
  fs.writeFileSync(path.join(cjpm,'config/cangjie-repo.toml'),'# fixture\n');
  const names=['toml','util','config','implement','command'];
  for(const [i,name]of names.entries()) {
    const dir=path.join(cjpm,'src',name);fs.mkdirSync(dir);
    const prior=i ? names[i-1] : null;
    fs.writeFileSync(path.join(dir,'value.cj'),`package cjpm.${name}\n${prior?'import cjpm.'+prior+'.*\n':''}public func value${i}(): Int64 { return ${prior?'value'+(i-1)+'()':'42'} }\n`);
  }
  fs.writeFileSync(path.join(cjpm,'src/main.cj'),'package cjpm\nimport cjpm.command.*\nmain(): Int64 { println(value4()); return 0 }\n');
  fs.writeFileSync(path.join(cjpm,'cpp/CMakeLists.txt'),'cmake_minimum_required(VERSION 3.16)\nproject(jobs_fixture C)\nset(CMAKE_ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/lib")\nadd_library(fswatcher STATIC fs.c)\nadd_library(uv STATIC uv.c)\n');
  fs.writeFileSync(path.join(cjpm,'cpp/fs.c'),'int fixture_fs(void) { return 1; }\n');
  fs.writeFileSync(path.join(cjpm,'cpp/uv.c'),'int fixture_uv(void) { return 2; }\n');
  const wrapper=`#!${process.execPath}\nimport fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const kind=path.basename(process.argv[1]),args=process.argv.slice(2),root=process.env.JOBS_FIXTURE_ROOT;
fs.appendFileSync(root+'/commands.jsonl',JSON.stringify({kind,args,pid:process.pid,at:new Date().toISOString()})+'\\n');
if(process.env.JOBS_FAIL_KIND===kind && (!process.env.JOBS_FAIL_PACKAGE || args.some(a=>a.endsWith('/'+process.env.JOBS_FAIL_PACKAGE))))process.exit(37);
if(process.env.JOBS_REAL==='1') {const exe=kind==='cjc'?process.env.CJPM_TEST_SDK+'/bin/cjc':'/usr/bin/'+kind;const r=spawnSync(exe,args,{stdio:'inherit'});if(r.signal)process.kill(process.pid,r.signal);process.exit(r.status??1);}
if(kind==='make'){fs.mkdirSync('lib',{recursive:true});for(const n of ['fswatcher','uv'])fs.writeFileSync('lib/lib'+n+'.a','controlled command fixture');}
if(kind==='cjc'){const out=args[args.indexOf('--output-dir')+1];fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,args[args.indexOf('-o')+1]),'controlled command fixture');}
`;
  for(const name of ['cmake','make','cjc'])fs.writeFileSync(path.join(bin,name),wrapper,{mode:0o755});
  const env={...process.env,PATH:bin+path.delimiter+process.env.PATH,CANGJIE_HOME:process.env.CJPM_TEST_SDK||root,CANGJIE_STDX_PATH:process.env.CJPM_TEST_STDX||root,JOBS_FIXTURE_ROOT:root,JOBS_REAL:real?'1':'0'};
  delete env.CANGJIE_BUILD_JOBS;
  return {root,cjpm,env};
}
function invoke(f,args=[],overlay={}) {
  const argv=['build.py','build','-t','release',...args];
  const r=spawnSync('python3',argv,{cwd:path.join(f.cjpm,'build'),env:{...f.env,...overlay},encoding:'utf8',timeout:240000,maxBuffer:4*1024*1024});
  fs.appendFileSync(path.join(f.root,'results.jsonl'),JSON.stringify({exe:'python3',argv,rc:r.status,signal:r.signal,error:r.error?.message,stdout:r.stdout,stderr:r.stderr})+'\n');
  const file=path.join(f.root,'commands.jsonl');
  const calls=fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse):[];
  return {...r,calls};
}
function consumed(r,n) {
  assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
  assert.deepEqual(r.calls.filter(c=>c.kind==='make').map(c=>c.args),[['-j'+n]],'native Make consumed allocated jobs');
  const cjc=r.calls.filter(c=>c.kind==='cjc');assert.equal(cjc.length,6,'all five packages and final link reached');
  for(const c of cjc)assert.equal(c.args.filter(a=>/^-j\d+$/.test(a)).join(','),'-j'+n,'CJC_JOB_BUDGET_CONSUMED');
}
test('native public CLI propagates explicit jobs to Make and every C2 invocation',()=>{
  consumed(invoke(fixture(),['--jobs','4']),Math.min(4,budget));
});
test('native public CLI defaults, environment, single-core and affinity truncation',()=>{
  for(const [args,env,n]of [[[],{},budget],[[],{CANGJIE_BUILD_JOBS:'2'},Math.min(2,budget)],[['-j','1'],{CANGJIE_BUILD_JOBS:'invalid'},1],[['--jobs','999999'],{},budget]])consumed(invoke(fixture(),args,env),n);
});
test('native public CLI rejects invalid jobs before any producer',()=>{
  for(const value of ['0','-1','bad','1.5'])for(const fromEnv of [false,true]) {
    const r=invoke(fixture(),fromEnv?[]:['--jobs',value],fromEnv?{CANGJIE_BUILD_JOBS:value}:{});
    assert.equal(r.status,2);assert.match(r.stderr,/jobs must be a positive integer/);assert.equal(r.calls.length,0);
  }
});
test('native public CLI returns native and C2 failure without starting dependents',()=>{
  for(const [kind,pkg]of [['make',''],['cjc','config']]) {
    const f=fixture(),r=invoke(f,['--jobs','2'],{JOBS_FAIL_KIND:kind,JOBS_FAIL_PACKAGE:pkg});
    assert.equal(r.status,37,r.stdout+'\n'+r.stderr);
    assert.equal(r.calls.filter(c=>c.kind==='cjc').length,kind==='make'?0:3);
    assert(!fs.existsSync(path.join(f.cjpm,'dist/cjpm')));
  }
});
test('native-only control consumes jobs and skips C2',()=>{
  const r=invoke(fixture(),['--jobs','1','--native-only']);assert.equal(r.status,0,r.stderr);
  assert.deepEqual(r.calls.map(c=>c.kind),['cmake','make']);assert.deepEqual(r.calls[1].args,['-j1']);
});
test('independent legacy native-only control reaches native producer',()=>{
  const r=invoke(fixture(),['--native-only']);assert.equal(r.status,0,r.stderr);
  assert.deepEqual(r.calls.map(c=>c.kind),['cmake','make']);assert.match(r.calls[1].args[0],/^-j[1-9]\d*$/);
});
test('real C2 through native public entry builds installs and runs dependent packages', {skip:!process.env.CJPM_TEST_SDK},()=>{
  const f=fixture({real:true}),r=invoke(f,['--jobs','4']);consumed(r,Math.min(4,budget));
  const dest=path.join(f.root,'install');
  const install=spawnSync('python3',['build.py','install','--prefix',dest],{cwd:path.join(f.cjpm,'build'),env:f.env,encoding:'utf8'});
  fs.writeFileSync(path.join(f.root,'install-result.json'),JSON.stringify({rc:install.status,stdout:install.stdout,stderr:install.stderr}));
  assert.equal(install.status,0,install.stderr);
  const run=spawnSync(path.join(dest,'cjpm'),[],{env:f.env,encoding:'utf8'});
  fs.writeFileSync(path.join(f.root,'consume-result.json'),JSON.stringify({rc:run.status,stdout:run.stdout,stderr:run.stderr}));
  assert.equal(run.status,0,run.stderr);assert.equal(run.stdout.trim(),'42');
});
