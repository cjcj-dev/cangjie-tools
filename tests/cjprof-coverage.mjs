#!/usr/bin/env zx
// Resource-gated public producer gate. Use only in an admitted private checkout.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(process.argv.findIndex(x=>path.resolve(x)===fileURLToPath(import.meta.url))+1);
const config=JSON.parse(fs.readFileSync(args[0],'utf8'));
for(const key of ['sdk','dependencies','work'])assert.ok(path.isAbsolute(config[key]),key+' must be absolute');
assert.equal(process.platform,'linux','Linux finite gate only');
assert.ok(Number.isInteger(config.jobs)&&config.jobs>0);
assert.ok(Array.isArray(config.control)&&path.isAbsolute(config.control[0]),'independent installed cjlint business argv required');
const work=config.work,python=process.env.PYTHON||'python3';
const parent=path.join(root,'cjprof/build/build'),jni=path.join(root,'cjprof/bridge/jni/build');
const env={...process.env,CANGJIE_HOME:config.sdk,CANGJIE_BUILD_JOBS:String(config.jobs),
  CFLAGS:'-DCJPROF_ENV_C=1',CXXFLAGS:'-DCJPROF_ENV_CXX=1',LDFLAGS:'-Wl,--build-id=sha1',
  PATH:path.join(config.sdk,'bin')+path.delimiter+process.env.PATH};
const commands=[],checks=[];
fs.mkdirSync(work,{recursive:true});
function run(name,argv,rc=0,envExtra={}){
  const p=spawnSync(argv[0],argv.slice(1),{cwd:root,env:{...env,...envExtra},encoding:'utf8',maxBuffer:32*1024*1024});
  fs.writeFileSync(path.join(work,name+'.log'),(p.stdout||'')+(p.stderr||''));
  commands.push({name,argv,cwd:root,envExtra,rc:p.status,signal:p.signal,error:p.error?.message});
  fs.writeFileSync(path.join(work,'commands.json'),JSON.stringify(commands,null,2));
  assert.equal(p.status,rc,name+': see raw log');return p;
}
function check(name,value){
  checks.push({name,executed:true,pass:!!value});
  fs.writeFileSync(path.join(work,'assertions.json'),JSON.stringify(checks,null,2));
  assert.ok(value,name);
}
function cache(dir){
  const text=fs.readFileSync(path.join(dir,'CMakeCache.txt'),'utf8');
  return Object.fromEntries(text.split(/\r?\n/).filter(x=>/^[^#/][^:]*:[^=]*=/.test(x))
    .map(x=>{const i=x.indexOf('=');return [x.slice(0,x.indexOf(':')),x.slice(i+1)];}));
}
function flagCommands(label){
  const p=run(label+'-native-commands',['ninja','-C',parent,'-t','commands']);
  const native=p.stdout.split('\n').filter(x=>x.includes('src/main.cpp')||x.includes('src/cjprof.cpp')||x.includes('libcjprof.so'));
  assert.ok(native.some(x=>x.includes('src/main.cpp')),'native main compile command present');
  const flags=fs.readFileSync(path.join(jni,'CMakeFiles/cjprof-jni.dir/flags.make'),'utf8');
  const link=fs.readFileSync(path.join(jni,'CMakeFiles/cjprof-jni.dir/link.txt'),'utf8');
  fs.writeFileSync(path.join(work,label+'-flags.json'),JSON.stringify({native,jni:{flags,link}},null,2));
  return {native:native.join('\n'),jni:flags+'\n'+link};
}
const coverage=/-fprofile-arcs|-ftest-coverage|-DCOVERAGE_BUILD/;
if(args[1]==='probe'){
  const f=flagCommands('probe');
  // This named assertion is the exact negative target for both baseline and cut.
  check('ordinary native compile flags contain no producer coverage',!coverage.test(f.native));
  check('ordinary JNI compile and link flags contain no producer coverage',!coverage.test(f.jni));
  process.exit(0);
}
assert.ok(!fs.existsSync(parent),'gate must start in a fresh isolated source checkout');
run('initial-clean-source',['git','diff','--exit-code','HEAD','--','cjprof']);
function build(label,extra=[]){
  return run(label,[python,path.join(root,'cjprof/build/build.py'),'build','-t','release',
    '--jobs',String(config.jobs),'--dependencies',config.dependencies,...extra]);
}
function control(label){run(label,config.control);}
function probe(label,expected=0){
  const dir=path.join(work,label);fs.mkdirSync(dir);
  const cfg=path.join(dir,'config.json');fs.writeFileSync(cfg,JSON.stringify({...config,work:dir}));
  run(label,[process.execPath,fileURLToPath(import.meta.url),cfg,'probe'],expected);
  if(expected!==0){
    const reached=JSON.parse(fs.readFileSync(path.join(dir,'assertions.json'),'utf8'));
    check(label+' reached exact target',reached.length===1&&reached[0].name==='ordinary native compile flags contain no producer coverage'&&reached[0].pass===false);
  }
}
function snapshot(label,on,expectedFlags){
  const f=flagCommands(label),p=cache(parent),j=cache(jni);
  for(const [name,flags]of Object.entries(f)){
    check(label+' '+name+' coverage flags',coverage.test(flags)===on);
    if(on)for(const token of ['-fprofile-arcs','-ftest-coverage','-DCOVERAGE_BUILD'])check(label+' '+name+' '+token,flags.includes(token));
  }
  for(const [key,value]of Object.entries(expectedFlags)){
    check(label+' parent user '+key,p[key]===value);
    check(label+' JNI user '+key,j[key]===value);
    if(key==='CMAKE_CXX_FLAGS'||key.includes('LINKER_FLAGS')||(!on&&key==='CMAKE_CXX_FLAGS_RELEASE'))
      for(const [name,actual]of Object.entries(f))check(label+' '+name+' effective '+key,actual.includes(value));
  }
  for(const c of [p,j]){
    check(label+' matching build type',c.CMAKE_BUILD_TYPE===(on?'Debug':'Release'));
    check(label+' matching coverage option',c.CJPROF_CODE_COVERAGE===(on?'ON':'OFF'));
  }
  const artifacts=[];
  for(const relative of ['cjprof/build/build/src/cjprof','cjprof/build/build/src/libcjprof.so','cjprof/bridge/jni/build/libcjprof-jni.so']){
    const file=path.join(root,relative),bytes=fs.readFileSync(file);
    const symbols=run(label+'-'+path.basename(file)+'-symbols',['readelf','--wide','--symbols',file]);
    // Coverage data/routines are an independent positive artifact control.
    const hasCoverage=/llvm_gcda|__gcov|\.gcda/.test(symbols.stdout)||bytes.includes(Buffer.from('.gcda'));
    check(label+' artifact coverage '+relative,hasCoverage===on);
    artifacts.push({file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),hasCoverage});
  }
  fs.writeFileSync(path.join(work,label+'-artifacts.json'),JSON.stringify(artifacts,null,2));
  fs.copyFileSync(path.join(parent,'CMakeCache.txt'),path.join(work,label+'-parent-cache.txt'));
  fs.copyFileSync(path.join(jni,'CMakeCache.txt'),path.join(work,label+'-JNI-cache.txt'));
  const prefix=path.join(work,label+'-install');
  run(label+'-install',[python,path.join(root,'cjprof/build/build.py'),'install','--prefix',prefix]);
  for(const file of ['bin/cjprof','lib/libcjprof.so','lib/libcjprof-jni.so','config/static'])check(label+' installed '+file,fs.existsSync(path.join(prefix,file)));
  // Loading the installed entry is finite producer/install coverage, not a
  // heap profiling business qualification or full SDK acceptance.
  const installedArtifacts=[];
  for(const file of ['bin/cjprof','lib/libcjprof.so','lib/libcjprof-jni.so']){
    const full=path.join(prefix,file),bytes=fs.readFileSync(full);
    installedArtifacts.push({file:full,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
  }
  fs.writeFileSync(path.join(work,label+'-installed-artifacts.json'),JSON.stringify(installedArtifacts,null,2));
  const loaded=run(label+'-installed-entry',[path.join(prefix,'bin/cjprof'),'--help'],0,
    {LD_LIBRARY_PATH:[path.join(prefix,'lib'),path.join(config.sdk,'tools/lib'),env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter)});
  check(label+' installed entry reaches help',loaded.stdout.includes('Usage: cjprof'));
  control(label+'-independent-cjlint');
}
// Reproduce the frozen source finding through the actual old public entry,
// then migrate that same build directory with the candidate. No fake cache.
const baseline='ec1ab36140ca20d8c181a6d52241ad124db8e8ff';
const files=['cjprof/build/build.py','cjprof/CMakeLists.txt','cjprof/bridge/jni/build.py','cjprof/bridge/jni/CMakeLists.txt'];
const saved=new Map(files.map(x=>[x,fs.readFileSync(path.join(root,x))]));
try{
  for(const file of files){const p=run('baseline-'+path.basename(file)+'-'+files.indexOf(file),['git','show',baseline+':'+file]);fs.writeFileSync(path.join(root,file),p.stdout);}
  build('baseline-coverage',['--code-coverage']);
  const f=flagCommands('baseline-coverage');check('baseline coverage positive',coverage.test(f.native));
  build('baseline-ordinary-release');control('baseline-independent-cjlint');probe('baseline-target-red',1);
}finally{for(const [file,bytes]of saved)fs.writeFileSync(path.join(root,file),bytes);}
build('migrate-ordinary-release');probe('migrate-target');
snapshot('migrate',false,{CMAKE_C_FLAGS:env.CFLAGS,CMAKE_CXX_FLAGS:env.CXXFLAGS});
const flags={CMAKE_C_FLAGS:'-DCJPROF_USER_C=1',CMAKE_CXX_FLAGS:'-DCJPROF_USER_CXX=1',
  CMAKE_CXX_FLAGS_RELEASE:'-O1 -DNDEBUG -DCJPROF_USER_RELEASE=1',
  CMAKE_EXE_LINKER_FLAGS:'-Wl,--build-id=sha1',CMAKE_SHARED_LINKER_FLAGS:'-Wl,--build-id=sha1'};
build('candidate-coverage',['--code-coverage','--',...Object.entries(flags).map(([k,v])=>'-D'+k+':STRING='+v)]);
snapshot('coverage',true,flags);
build('candidate-warm-release');probe('ordinary-target');snapshot('ordinary',false,flags);
// Sever the real option transition at the public producer. All assertions and
// independent control are unchanged. This is a new candidate bearing point.
const source=path.join(root,'cjprof/build/build.py'),before=fs.readFileSync(source,'utf8');
const anchor='coverage_defs = ["-DCJPROF_CODE_COVERAGE=" + bool_to_opt(args.code_coverage)]';
assert.equal(before.split(anchor).length,2);
try{
  fs.writeFileSync(source,before.replace(anchor,'coverage_defs = ["-DCJPROF_CODE_COVERAGE=" + bool_to_opt(True)]'));
  const diff=run('capture-cut',['git','diff','--','cjprof/build/build.py']);
  fs.writeFileSync(path.join(work,'cut.diff'),diff.stdout);
  build('cut-ordinary-release');control('cut-independent-cjlint');probe('cut-target-red',1);
}finally{fs.writeFileSync(source,before);}
build('restored-ordinary-release');probe('restored-target');snapshot('restored',false,flags);
run('final-restored-source',['git','diff','--exit-code','HEAD','--','cjprof']);
check('source restored exactly',fs.readFileSync(source,'utf8')===before);
console.log('CJPROF_COVERAGE_GATE_COMPLETE');
