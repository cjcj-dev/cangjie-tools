#!/usr/bin/env zx
// Public CLI regressions: skipped builds must not certify inputs, and failed
// compiler calls must not succeed using old artifacts. Run on Linux with cjc.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const [exeArg, outArg, phase = 'candidate'] = process.argv.slice(2);
assert(exeArg && outArg);
const exe=path.resolve(exeArg),out=path.resolve(outArg);
assert(!fs.existsSync(out)||fs.readdirSync(out).length===0,'use a new empty output directory');
fs.mkdirSync(out, {recursive:true});
const commands=[], checks=[], failures=[],completed=[];
const knownCases=['skip-build','preserved-mtime','compiler-launch','dummy-failure','empty-runner-failure','scan-import','scan-production-test','scan-test-inputs','scan-source-set','legacy-scan-cache','dummy-generation','scan-test-macro'];
const selected=process.env.CJPM_REGRESSION_CASES?.split(',')??knownCases;
assert(selected.length>0&&selected.every(name=>knownCases.includes(name)),'unknown or empty regression filter');
const assertExit=(p,rc)=>{assert.equal(p.error,undefined);assert.equal(p.signal,null);assert(Number.isInteger(p.status));assert.equal(p.status,rc);};
const save=()=>{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({phase,commands,checks,failures,completed},null,2));};
function check(name, body) {
 try {body();checks.push({name,pass:true});}
 catch(e){checks.push({name,pass:false,error:e.message});throw e;}
 finally{save();}
}
function run(label,cwd,args,env=process.env) {
 const sentinel='NOT_EXECUTED:'+label;
 fs.writeFileSync(path.join(cwd,'observed'),sentinel);
 const p=spawnSync(exe,args,{cwd,env,encoding:'utf8',maxBuffer:2*1024*1024});
 fs.writeFileSync(path.join(out,label+'.stdout'),p.stdout||'');
 fs.writeFileSync(path.join(out,label+'.stderr'),p.stderr||'');
 commands.push({label,argv:[exe,...args],cwd,rc:p.status,signal:p.signal,error:p.error?.message});save();
 return p;
}
function ok(label,cwd,args,env) {const p=run(label,cwd,args,env);check(label+'-rc',()=>assertExit(p,0));return p;}
function project(name, files) {
 const dir=path.join(out,name);fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'cjpm.toml'),'[package]\nname = "cachecase"\nversion = "1.0.0"\ncjc-version = "1.0.0"\noutput-type = "static"\nsrc-dir = "src"\ntarget-dir = "target"\n');
 for(const [file,body] of Object.entries(files)){const p=path.join(dir,'src',file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,body);}
 return dir;
}
const testArgs=['test','-i','-V','-j','2','--show-all-output'];
const production='package cachecase\npublic func value(): Int64 { 7 }\n';
const control='package cachecase.control\npublic func controlValue(): Int64 { 31 }\n';
const controlTest='package cachecase.control\nimport std.unittest.*\nimport std.unittest.testmacro.*\n@Test\nfunc controlTest(): Unit { @Expect(controlValue(), 31) }\n';
function body(word){return 'package cachecase\nimport std.fs.*\nimport std.unittest.*\nimport std.unittest.testmacro.*\n@Test\nfunc changedTest(): Unit { @Expect(value(), 7); File.writeTo("observed", "'+word+'".toArray()) }\n';}
function snapshot(p){return {bytes:fs.readFileSync(p),mtime:fs.statSync(p,{bigint:true}).mtimeNs.toString()};}
function testcase(name,body){if(!selected.includes(name))return;try{body();completed.push(name);}catch(e){failures.push({name,error:e.message});}finally{save();}}

testcase('skip-build',()=>{
 const p=project('skip',{ 'lib.cj':production,'lib_test.cj':body('OLD'),'control/lib.cj':control,'control/lib_test.cj':controlTest });
 ok('skip-prime',p,testArgs);
 check('skip-prime-body',()=>assert.equal(fs.readFileSync(p+'/observed','utf8'),'OLD'));
 const cache=p+'/target/release/unittest_bin/incremental-cache.json',before=fs.readFileSync(cache);
 const controlPath=p+'/target/release/unittest_bin/cachecase.control',controlBefore=snapshot(controlPath);
 fs.writeFileSync(p+'/src/lib_test.cj',body('NEW'));
 ok('skip-run',p,['test','--skip-build','-V','-j','2']);
 check('skip-runs-old-body-as-requested',()=>assert.equal(fs.readFileSync(p+'/observed','utf8'),'OLD'));
 fs.copyFileSync(cache,out+'/skip-after-cache.json');fs.writeFileSync(out+'/skip-before-cache.json',before);
 ok('skip-next-normal',p,testArgs);
 check('skip-independent-control',()=>assert.deepEqual(snapshot(controlPath),controlBefore));
 check('skip-normal-observes-new-body',()=>assert.equal(fs.readFileSync(p+'/observed','utf8'),'NEW'));
 check('skip-did-not-rewrite-cache',()=>assert.deepEqual(fs.readFileSync(out+'/skip-after-cache.json'),before));
 ok('skip-no-run',p,['test','-i','--no-run','-j','2']);
 ok('skip-restored',p,['test','--skip-build','-j','2']);
 check('skip-restored-body',()=>assert.equal(fs.readFileSync(p+'/observed','utf8'),'NEW'));
});

testcase('preserved-mtime',()=>{
 const pure='package cachecase.pure\nimport cachecase.*\nimport std.fs.*\nimport std.unittest.*\nimport std.unittest.testmacro.*\n@Test\nfunc useValue(): Unit { @Expect(value() > 0, true); File.writeTo("observed", value().toString().toArray()) }\n';
 const p=project('mtime',{'lib.cj':production,'pure/lib_test.cj':pure,'control/lib.cj':control,'control/lib_test.cj':controlTest});
 ok('mtime-prime',p,testArgs);
 const controlPath=p+'/target/release/unittest_bin/cachecase.control',before=snapshot(controlPath);
 const src=p+'/src/lib.cj',stamp=fs.statSync(src,{bigint:true});
 fs.writeFileSync(src,production.replace('{ 7 }','{ 8 }'));
 const restore=spawnSync('python3',['-I','-c','import os,sys;os.utime(sys.argv[1],ns=(int(sys.argv[2]),int(sys.argv[3])))',src,stamp.atimeNs.toString(),stamp.mtimeNs.toString()],{encoding:'utf8'});
 commands.push({label:'restore-source-nanoseconds',rc:restore.status,signal:restore.signal});save();
 check('mtime-preserved-exactly',()=>{assert.equal(restore.status,0);assert.equal(fs.statSync(src,{bigint:true}).mtimeNs,stamp.mtimeNs);});
 ok('mtime-edited',p,testArgs);
 check('mtime-independent-control',()=>assert.deepEqual(snapshot(controlPath),before));
 check('mtime-new-production-body-consumed',()=>assert.equal(fs.readFileSync(p+'/observed','utf8'),'8'));
 fs.writeFileSync(src,production);ok('mtime-restored',p,testArgs);
 check('mtime-restored-value',()=>assert.equal(fs.readFileSync(p+'/observed','utf8'),'7'));
});

// A private PATH entry delegates every ordinary compiler call. The launch arm
// changes only its own interpreter after a successful dependency scan, so the
// next compiler process cannot start (not an invented compiler exit code).
function shim(p,mode) {
 const dir=p+'/compiler-entry';fs.mkdirSync(dir);
 const file=dir+'/cjc',log=dir+'/calls.jsonl',real=path.join(process.env.CANGJIE_HOME,'bin','cjc');
 const text='#!'+process.execPath+'\n'+
 'const fs=require("node:fs"),{spawnSync}=require("node:child_process");\n'+
 'const args=process.argv.slice(2),log='+JSON.stringify(log)+';\n'+
 'fs.appendFileSync(log,JSON.stringify({args,event:"invoke"})+"\\n");\n'+
 (mode==='dummy'?'if(args.some(a=>a.includes("._cachecase_test.cj"))){fs.appendFileSync(log,JSON.stringify({event:"dummy-failed",rc:73})+"\\n");process.exit(73);}\n':'')+
 (mode==='runner'?'if(args.some(a=>a.endsWith("/testrunner.cj"))){fs.appendFileSync(log,JSON.stringify({event:"runner-failed",rc:73})+"\\n");process.exit(73);}\n':'')+
 'const p=spawnSync('+JSON.stringify(real)+',args,{stdio:"inherit",env:{...process.env,PATH:'+JSON.stringify(process.env.PATH)+'}});\n'+
 'fs.appendFileSync(log,JSON.stringify({event:"delegate",args,rc:p.status,signal:p.signal})+"\\n");\n'+
 (mode==='launch'?'if(args.includes("--scan-dependency")&&p.status===0){fs.writeFileSync(__filename,"#!/nonexistent-cjpm-regression-interpreter\\n");fs.appendFileSync(log,JSON.stringify({event:"launch-disabled-after-scan"})+"\\n");}\n':'')+
 'process.exit(p.status??1);\n';
 fs.writeFileSync(file,text,{mode:0o755});
 const fallbackPath=process.env.PATH.split(path.delimiter).filter(entry=>path.resolve(entry)!==path.dirname(real)).join(path.delimiter);
 return {env:{...process.env,PATH:dir+path.delimiter+fallbackPath},log};
}

testcase('compiler-launch',()=>{
 const p=project('launch',{'lib.cj':production});
 ok('launch-prime',p,['build','-i','-V','-j','2']);
 const source=p+'/src/lib.cj',stamp=fs.statSync(source);
 fs.writeFileSync(source,production.replace('package cachecase\n','package cachecase\nimport std.math.*\n').replace('{ 7 }','{ 8 }'));
 fs.utimesSync(source,stamp.atime,new Date(stamp.mtimeMs+2000));
 const cache=p+'/target/release/incremental-cache.json',before=fs.readFileSync(cache);
 const injected=shim(p,'launch');
 const failure=run('launch-failure',p,['build','-i','-V','-j','2'],injected.env);
 const calls=fs.readFileSync(injected.log,'utf8').trim().split('\n').map(JSON.parse);
 check('launch-reached-successful-scan',()=>assert(calls.some(x=>x.event==='launch-disabled-after-scan')));
 check('launch-no-compiler-after-disabled',()=>assert.equal(calls.at(-1).event,'launch-disabled-after-scan'));
 check('launch-reached-compiler-exception',()=>assert((failure.stderr||'').includes('failed to compile package `cachecase` with exception occurred')));
 const after=fs.readFileSync(cache);fs.writeFileSync(out+'/launch-before-cache.json',before);fs.writeFileSync(out+'/launch-after-cache.json',after);
 check('launch-failure-propagated',()=>assertExit(failure,1));
 const recovered=ok('launch-restored',p,['build','-i','-V','-j','2']);
 check('launch-recovery-actually-compiles',()=>assert((recovered.stdout||'').includes('Compiling package `cachecase`')));
});

testcase('dummy-failure',()=>{
 const source='package cachecase\nimport std.fs.*\nimport std.unittest.*\nimport std.unittest.testmacro.*\n@Test\nfunc prodTest(): Unit { @Expect(7, 7); File.writeTo("observed", "PROD_TEST".toArray()) }\n';
 const p=project('dummy',{'lib.cj':source,'control/lib.cj':control,'control/lib_test.cj':controlTest});
 ok('dummy-prime',p,['test','--no-run','-V','-j','2']);
 const cache=p+'/target/release/unittest_bin/incremental-cache.json',before=fs.readFileSync(cache);
 const injected=shim(p,'dummy');
 const failure=run('dummy-failure',p,['test','--no-run','-V','-j','2'],injected.env);
 const calls=fs.readFileSync(injected.log,'utf8').trim().split('\n').map(JSON.parse);
 check('dummy-exact-compiler-failure-reached',()=>assert(calls.some(x=>x.event==='dummy-failed'&&x.rc===73)));
 check('dummy-independent-control-compiles',()=>assert(calls.some(x=>x.event==='delegate'&&x.rc===0&&x.args.includes('--test-only')&&x.args.includes(p+'/src/control'))));
 fs.copyFileSync(cache,out+'/dummy-after-cache.json');fs.writeFileSync(out+'/dummy-before-cache.json',before);
 ok('dummy-restored',p,['test','-V','-j','2']);
 check('dummy-restored-body',()=>assert.equal(fs.readFileSync(p+'/observed','utf8'),'PROD_TEST'));
 check('dummy-failure-propagated',()=>assertExit(failure,1));
 check('dummy-failure-does-not-save-test-cache',()=>assert.deepEqual(fs.readFileSync(out+'/dummy-after-cache.json'),before));
});
testcase('empty-runner-failure',()=>{
 const p=project('empty-runner',{'lib.cj':production});
 fs.mkdirSync(p+'/src/unselected');
 const args=['test','--no-run','-V','-j','2','src/unselected'];
 ok('empty-runner-prime',p,args);
 const injected=shim(p,'runner');
 const failure=run('empty-runner-failure',p,args,injected.env);
 const calls=fs.readFileSync(injected.log,'utf8').trim().split('\n').map(JSON.parse);
 check('empty-runner-target-reached',()=>assert(calls.some(x=>x.event==='runner-failed'&&x.rc===73)));
 check('empty-runner-failure-propagated',()=>assertExit(failure,1));
 ok('empty-runner-restored',p,args);
 const before=fs.readFileSync(p+'/target/release/unittest_bin/incremental-cache.json');
 ok('empty-runner-skip',p,['test','--skip-build','-V','-j','2','src/unselected']);
 check('empty-runner-skip-cache-unchanged',()=>assert.deepEqual(fs.readFileSync(p+'/target/release/unittest_bin/incremental-cache.json'),before));
});
function replacePreservingTime(file, text) {
 const stamp=fs.statSync(file,{bigint:true});
 fs.writeFileSync(file,text);
 const restored=spawnSync('python3',['-I','-c','import os,sys;os.utime(sys.argv[1],ns=(int(sys.argv[2]),int(sys.argv[3])))',file,stamp.atimeNs.toString(),stamp.mtimeNs.toString()],{encoding:'utf8'});
 check(path.basename(path.dirname(file))+'-source-time-preserved',()=>{assert.equal(restored.status,0);assert.equal(fs.statSync(file,{bigint:true}).mtimeNs,stamp.mtimeNs);});
}
testcase('scan-import',()=>{
 const rootTest='package cachecase\nimport std.fs.*\nimport std.unittest.*\nimport std.unittest.testmacro.*\n@Test\nfunc importedValue(): Unit { File.writeTo("observed", value().toString().toArray()); @Expect(value() > 0, true) }\n';
 const p=project('scan-import',{'lib.cj':production,'lib_test.cj':rootTest,'leaf/lib.cj':'package cachecase.leaf\npublic func leafValue(): Int64 { 19 }\n','control/lib.cj':control,'control/lib_test.cj':controlTest});
 ok('scan-import-prime',p,testArgs);
 const controlPath=p+'/target/release/unittest_bin/cachecase.control',before=snapshot(controlPath);
 const edited='package cachecase\nimport cachecase.leaf.*\npublic func value(): Int64 { leafValue() }\n';
 replacePreservingTime(p+'/src/lib.cj',edited);
 fs.writeFileSync(p+'/observed','WAITING');
 const changed=run('scan-import-added',p,testArgs);
 check('scan-import-independent-control',()=>assert.deepEqual(snapshot(controlPath),before));
 check('scan-import-new-edge-consumed',()=>{assertExit(changed,0);assert.equal(fs.readFileSync(p+'/observed','utf8'),'19');});
 replacePreservingTime(p+'/src/lib.cj',production);
 ok('scan-import-restored',p,testArgs);
 check('scan-import-restored-body',()=>assert.equal(fs.readFileSync(p+'/observed','utf8'),'7'));
});
testcase('scan-production-test',()=>{
 const p=project('scan-production-test',{'lib.cj':production,'control/lib.cj':control,'control/lib_test.cj':controlTest});
 ok('scan-test-prime',p,testArgs);
 const controlPath=p+'/target/release/unittest_bin/cachecase.control',before=snapshot(controlPath);
 const edited=production+'import std.fs.*\nimport std.unittest.*\nimport std.unittest.testmacro.*\n@Test\nfunc newlyAddedTest(): Unit { File.writeTo("observed", "ADDED_TEST".toArray()); @Expect(value(), 7) }\n';
 replacePreservingTime(p+'/src/lib.cj',edited.replace('public func value(): Int64 { 7 }\n','')+'public func value(): Int64 { 7 }\n');
 fs.writeFileSync(p+'/observed','WAITING');
 const changed=run('scan-test-added',p,testArgs);
 check('scan-test-independent-control',()=>assert.deepEqual(snapshot(controlPath),before));
 check('scan-test-new-production-test-executed',()=>{assertExit(changed,0);assert.equal(fs.readFileSync(p+'/observed','utf8'),'ADDED_TEST');});
 replacePreservingTime(p+'/src/lib.cj',production);
 fs.writeFileSync(p+'/observed','REMOVED_TEST');
 ok('scan-test-restored',p,testArgs);
 check('scan-test-removed-test-not-executed',()=>assert.equal(fs.readFileSync(p+'/observed','utf8'),'NOT_EXECUTED:scan-test-restored'));
});
testcase('scan-test-inputs',()=>{
 for(const mode of ['default','incremental','no-run']){
  const testSource=value=>'package cachecase.pure\nimport std.fs.*\nimport std.unittest.*\nimport std.unittest.testmacro.*\n'+(value==='leafValue()'?'import cachecase.leaf.*\n':'')+'@Test\nfunc readLeaf(): Unit { File.writeTo("observed", ('+value+').toString().toArray()) }\n';
  const p=project('test-inputs-'+mode,{'lib.cj':production,'pure/lib_test.cj':testSource('7'),'leaf/lib.cj':'package cachecase.leaf\npublic func leafValue(): Int64 { 29 }\n','control/lib.cj':control,'control/lib_test.cj':controlTest});
  const args=['test','-V','-j','2',...(mode==='default'?[]:['-i']),...(mode==='no-run'?['--no-run']:[])];
  ok(mode+'-test-inputs-prime',p,args);
  const controlPath=p+'/target/release/cachecase/libcachecase.control.a',before=snapshot(controlPath);
  replacePreservingTime(p+'/src/pure/lib_test.cj',testSource('leafValue()'));
  ok(mode+'-test-inputs-skip',p,['test','--skip-build','-j','2']);
  check(mode+'-skip-old-test-inputs',()=>assert.equal(fs.readFileSync(p+'/observed','utf8'),'7'));
  ok(mode+'-test-inputs-added',p,args);
  if(mode==='no-run'){
   check('no-run-does-not-execute-new-inputs',()=>assert.equal(fs.readFileSync(p+'/observed','utf8'),'NOT_EXECUTED:no-run-test-inputs-added'));
   ok('no-run-test-inputs-execute',p,['test','--skip-build','-j','2']);
  }
  check(mode+'-test-new-import-consumed',()=>assert.equal(fs.readFileSync(p+'/observed','utf8'),'29'));
  check(mode+'-test-inputs-production-control',()=>assert.deepEqual(snapshot(controlPath),before));
  replacePreservingTime(p+'/src/pure/lib_test.cj',testSource('7'));
  ok(mode+'-test-inputs-restored',p,['test','-i','-j','2']);
  check(mode+'-test-inputs-restored-body',()=>assert.equal(fs.readFileSync(p+'/observed','utf8'),'7'));
 }
});
testcase('scan-source-set',()=>{
 const p=project('source-set',{'lib.cj':production,'control/lib.cj':control,'control/lib_test.cj':controlTest});
 const anchor=p+'/src/lib.cj',future=new Date(Date.now()+60000);
 fs.utimesSync(anchor,future,future);
 ok('source-set-prime',p,testArgs);
 const before=snapshot(p+'/target/release/unittest_bin/cachecase.control');
 const maxTime=()=>fs.readdirSync(p+'/src').filter(f=>f.endsWith('.cj')).map(f=>fs.statSync(p+'/src/'+f,{bigint:true}).mtimeNs).reduce((a,b)=>a>b?a:b);
 const stamp=maxTime();
 const added=p+'/src/added.cj',test=p+'/src/added_test.cj';
 fs.writeFileSync(added,'package cachecase\nimport cachecase.control.*\npublic func addedValue(): Int64 { controlValue() }\n');
 fs.writeFileSync(test,'package cachecase\nimport std.fs.*\nimport std.unittest.*\nimport std.unittest.testmacro.*\n@Test\nfunc addedTest(): Unit { @Expect(addedValue(),31); File.writeTo("observed","SET_ADDED".toArray()) }\n');
 check('source-set-add-max-time-unchanged',()=>assert.equal(maxTime(),stamp));
 ok('source-set-added',p,testArgs);
 check('source-set-new-import-and-macro-executed',()=>assert.equal(fs.readFileSync(p+'/observed','utf8'),'SET_ADDED'));
 check('source-set-control-reused',()=>assert.deepEqual(snapshot(p+'/target/release/unittest_bin/cachecase.control'),before));
 fs.unlinkSync(added);fs.unlinkSync(test);
 check('source-set-delete-max-time-unchanged',()=>assert.equal(maxTime(),stamp));
 ok('source-set-removed',p,testArgs);
 check('source-set-removed-test-not-executed',()=>assert.equal(fs.readFileSync(p+'/observed','utf8'),'NOT_EXECUTED:source-set-removed'));
});
testcase('legacy-scan-cache',()=>{
 const old=process.env.CJPM_BASELINE_EXE;
 assert(old&&path.isAbsolute(old),'legacy test requires CJPM_BASELINE_EXE');
 const p=project('legacy-scan',{'lib.cj':production,'control/lib.cj':control,'control/lib_test.cj':controlTest});
 fs.writeFileSync(p+'/observed','NOT_EXECUTED:legacy-prime');
 const prime=spawnSync(old,testArgs,{cwd:p,env:process.env,encoding:'utf8',maxBuffer:2*1024*1024});
 fs.writeFileSync(out+'/legacy-prime.stdout',prime.stdout||'');fs.writeFileSync(out+'/legacy-prime.stderr',prime.stderr||'');
 commands.push({label:'legacy-prime',argv:[old,...testArgs],cwd:p,rc:prime.status,signal:prime.signal,error:prime.error?.message});
 check('legacy-prime-rc',()=>assertExit(prime,0));
 const updated='package cachecase\nimport std.fs.*\nimport std.unittest.*\nimport std.unittest.testmacro.*\n@Test\nfunc newlyAddedTest(): Unit { File.writeTo("observed","LEGACY_UPGRADED".toArray()) }\n';
 replacePreservingTime(p+'/src/lib.cj',updated);
 ok('legacy-upgraded',p,testArgs);
 check('legacy-content-rescanned-without-clearing',()=>assert.equal(fs.readFileSync(p+'/observed','utf8'),'LEGACY_UPGRADED'));
 const stable=snapshot(p+'/target/release/unittest_bin/cachecase');
 ok('legacy-repeat',p,testArgs);
 check('legacy-upgraded-cache-reused',()=>assert.deepEqual(snapshot(p+'/target/release/unittest_bin/cachecase'),stable));
 check('legacy-repeat-actually-executed',()=>assert.equal(fs.readFileSync(p+'/observed','utf8'),'LEGACY_UPGRADED'));
});
testcase('scan-test-macro',()=>{
 const plain=body('PLAIN');
 const p=project('test-macro',{'lib.cj':production,'lib_test.cj':plain,'macros/lib.cj':'macro package cachecase.macros\nimport std.ast.*\npublic macro Pass(input: Tokens): Tokens { input }\n','control/lib.cj':control,'control/lib_test.cj':controlTest});
 ok('macro-prime',p,testArgs);
 const before=snapshot(p+'/target/release/unittest_bin/cachecase.control');
 const edited=body('MACRO').replace('import std.fs.*','import cachecase.macros.*\nimport std.fs.*').replace('@Test\nfunc','@Pass\n@Test\nfunc');
 replacePreservingTime(p+'/src/lib_test.cj',edited);
 ok('macro-added',p,testArgs);
 check('new-test-macro-import-executed',()=>assert.equal(fs.readFileSync(p+'/observed','utf8'),'MACRO'));
 check('macro-control-reused',()=>assert.deepEqual(snapshot(p+'/target/release/unittest_bin/cachecase.control'),before));
 replacePreservingTime(p+'/src/lib_test.cj',plain);
 ok('macro-restored',p,testArgs);
 check('macro-removed-body',()=>assert.equal(fs.readFileSync(p+'/observed','utf8'),'PLAIN'));
});
testcase('dummy-generation',()=>{
 const source='package cachecase\nimport std.fs.*\nimport std.unittest.*\nimport std.unittest.testmacro.*\n@Test\nfunc generatedTest(): Unit { File.writeTo("observed","GENERATED".toArray()) }\n';
 const p=project('dummy-generation',{'lib.cj':source,'control/lib.cj':control,'control/lib_test.cj':controlTest});
 const args=['test','--no-run','-V','-j','2'];
 ok('generation-prime',p,args);
 const file=p+'/target/release/unittest_bin/._cachecase_test.cj',original=fs.readFileSync(file);
 fs.unlinkSync(file);fs.mkdirSync(file);
 const failed=run('generation-failure',p,args);
 check('generation-failure-propagated',()=>assertExit(failed,1));
 check('generation-error-includes-package-path-and-cause',()=>{assert((failed.stderr||'').includes('failed to compile tests for `cachecase`'));assert((failed.stderr||'').includes(p+'/src'));assert((failed.stderr||'').includes('._cachecase_test.cj'));});
 fs.rmdirSync(file);fs.writeFileSync(file,original);
 ok('generation-restored',p,['test','-V','-j','2']);
 check('generation-restored-body',()=>assert.equal(fs.readFileSync(p+'/observed','utf8'),'GENERATED'));
});
check('selected-cases-completed',()=>{assert(completed.length>0);assert.deepEqual([...completed].sort(),[...new Set(selected)].sort());});
save();
console.log(JSON.stringify({phase,failed:failures,checks:checks.length,completed}));
process.exit(failures.length?1:0);
