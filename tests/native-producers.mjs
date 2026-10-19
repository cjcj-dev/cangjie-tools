#!/usr/bin/env zx
// Resource-gated integration test: real build.py/CMake/dependencies/JNI/install.
// Run only in an isolated source checkout with an explicitly admitted SDK.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {spawnSync} from 'node:child_process';
const entry=process.argv.findIndex((v,i)=>i>0&&path.resolve(v)===fileURLToPath(import.meta.url));
const {values:v}=parseArgs({args:process.argv.slice(entry+1),options:{
  sdk:{type:'string'},dependencies:{type:'string'},work:{type:'string'},jobs:{type:'string'},
}});
for(const name of ['sdk','dependencies','work','jobs'])assert.ok(v[name],`--${name} required`);
assert.match(v.jobs,/^[1-9][0-9]*$/);
assert.equal(process.platform,'linux','this finite gate currently covers Linux');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),work=path.resolve(v.work);
fs.mkdirSync(work,{recursive:true});
const env={...process.env,CANGJIE_HOME:path.resolve(v.sdk),CANGJIE_BUILD_JOBS:v.jobs,
  PATH:[path.join(path.resolve(v.sdk),'bin'),process.env.PATH].join(path.delimiter)};
const commands=[],checks=[];
function run(name,argv,expected=0){
  const p=spawnSync(argv[0],argv.slice(1),{cwd:root,env,encoding:'utf8',maxBuffer:64*1024*1024});
  fs.writeFileSync(path.join(work,name+'.log'),(p.stdout||'')+(p.stderr||''));
  commands.push({name,argv,cwd:root,rc:p.status,signal:p.signal,error:p.error?.message});
  fs.writeFileSync(path.join(work,'commands.json'),JSON.stringify(commands,null,2));
  assert.equal(p.status,expected,`${name}: see raw log`);return p;
}
function check(name,pass){checks.push({name,pass});fs.writeFileSync(path.join(work,'assertions.json'),JSON.stringify({executed:true,checks},null,2));assert.ok(pass,name);}
const inputs=JSON.parse(fs.readFileSync(v.dependencies,'utf8')),local={};
// Normal fixed Git materialization on the public build path, not parser mocks.
for(const name of ['json','runtime','bounds','httplib']){
  assert.match(inputs[name].commit,/^[0-9a-f]{40}$/);
  local[name]={repo:path.resolve(inputs[name].path),commit:inputs[name].commit,path:path.join(work,'dependencies',name)};
  assert.ok(!fs.existsSync(local[name].path),'first-build fixture must be fresh');
}
const manifest=path.join(work,'selected-dependencies.json');fs.writeFileSync(manifest,JSON.stringify(local));
const python=process.env.PYTHON||'python3';
function build(tool,type){return run(`${tool}-${type}-${commands.length}`,[python,path.join(root,tool,'build/build.py'),'build','-t',type,'--jobs',v.jobs,'--dependencies',manifest]);}
function install(tool,rc=0){return run(`${tool}-install-${commands.length}`,[python,path.join(root,tool,'build/build.py'),'install','--prefix',path.join(work,'install',tool)],rc);}
const jni=path.join(root,'cjprof/bridge/jni'),lib=path.join(jni,'build/libcjprof-jni.so');
const cache=()=>fs.readFileSync(path.join(jni,'build/CMakeCache.txt'),'utf8');
build('cjlint','release');install('cjlint'); // First dependency materialization.
build('cjprof','release');install('cjprof'); // Same selected JSON, warm path.
check('JNI Release matches parent',cache().includes('CMAKE_BUILD_TYPE:STRING=Release'));
for(const file of ['bin/cjprof','lib/libcjprof.so','lib/libcjprof-jni.so','config/static'])check(file,fs.existsSync(path.join(work,'install/cjprof',file)));
for(const file of ['bin/cjlint','lib/libcjlint.so','config'])check(file,fs.existsSync(path.join(work,'install/cjlint',file)));
const original=fs.readFileSync(lib);fs.unlinkSync(lib);
try{
  const failure=install('cjprof',1);
  check('missing JNI reaches install diagnostic',failure.stderr.includes('install never builds implicitly'));
  check('missing JNI is not implicitly rebuilt',!fs.existsSync(lib));
  install('cjlint'); // Independent normal control during JNI rejection.
}finally{fs.writeFileSync(lib,original);}
install('cjprof');
build('cjprof','debug');install('cjprof');
check('warm JNI switches to Debug',cache().includes('CMAKE_BUILD_TYPE:STRING=Debug'));
build('cjprof','release');install('cjprof');
check('warm JNI restores Release',cache().includes('CMAKE_BUILD_TYPE:STRING=Release'));
// Cut the real JNI configure subprocess, preserving the parent/public entry.
const source=path.join(jni,'build.py'),before=fs.readFileSync(source,'utf8');
const anchor='subprocess.run(cmake_args, cwd=BUILD_DIR, check=True)';
assert.equal(before.split(anchor).length,2);
fs.writeFileSync(source,before.replace(anchor,'subprocess.run([sys.executable, "-c", "import sys; sys.exit(37)"], cwd=BUILD_DIR, check=True)'));
const diff=spawnSync('git',['diff','--','cjprof/bridge/jni/build.py'],{cwd:root,encoding:'utf8'});
fs.writeFileSync(path.join(work,'cut.diff'),diff.stdout);
try{
  run('JNI-child-37-reaches-parent',[python,path.join(root,'cjprof/build/build.py'),'build','-t','release','--jobs',v.jobs,'--dependencies',manifest],37);
  check('failed JNI leaves no installable old library',!fs.existsSync(lib));
  install('cjlint');
}finally{fs.writeFileSync(source,before);}
build('cjprof','release');install('cjprof');
check('source restored exactly',fs.readFileSync(source,'utf8')===before);
// Selection mismatch must be rejected even when all dependency dirs exist.
const wrong={...local,json:{...local.json,commit:'0'.repeat(40)}},bad=path.join(work,'wrong-dependency.json');
fs.writeFileSync(bad,JSON.stringify(wrong));
const rejected=run('warm-wrong-json',[python,path.join(root,'cjlint/build/build.py'),'build','-t','release','--jobs',v.jobs,'--dependencies',bad],1);
check('warm wrong input rejected before build',rejected.stdout.includes('preserve mismatched/modified checkout'));
install('cjprof');
console.log('NATIVE_PRODUCER_GATE_COMPLETE');
