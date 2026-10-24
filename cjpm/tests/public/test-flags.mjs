#!/usr/bin/env zx
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const [cjpm,work,mode='incremental']=process.argv.slice(2);
fs.mkdirSync(work,{recursive:true});
const records=[],checks=[];
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);}
function check(label,fn){try{fn();checks.push({label,pass:true});}catch(e){checks.push({label,pass:false,error:e.message});throw e;}finally{write(work+'/assertions.json',JSON.stringify({executed:true,checks},null,2));}}
function run(label,argv,cwd){const start=new Date().toISOString(),p=spawnSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',maxBuffer:8*1024*1024});write(work+'/'+label+'.stdout',p.stdout||'');write(work+'/'+label+'.stderr',p.stderr||'');records.push({label,argv,cwd,start,end:new Date().toISOString(),rc:p.status,signal:p.signal,error:p.error?.message});write(work+'/commands.json',JSON.stringify(records,null,2));assert.equal(p.status,0,label);return (p.stdout||'')+(p.stderr||'');}
const project=work+'/project';
assert(!fs.existsSync(project),'use a fresh fixture directory; never clear an existing cache');
write(project+'/cjpm.toml',`[package]\nname = "flagcase"\nversion = "1.0.0"\ncjc-version = "1.0.0"\noutput-type = "static"\nlink-option = "-z noexecstack"\n`);
write(project+'/src/lib.cj',`package flagcase\npublic func productionValue(): Int64 { 41 }\n@When[test]\npublic func testModeMarker(): Int64 { 99 }\n`);
write(project+'/src/lib_test.cj',`package flagcase\nimport std.unittest.*\nimport std.unittest.testmacro.*\n@Test\nfunc cacheFlagsRoundTrip(): Unit {\n    @Expect(testModeMarker(), 99)\n    @Expect(productionValue(), 41)\n    println("TESTFLAGS_CASE_EXECUTED")\n}\n`);
if(mode==='pipeline'){fs.appendFileSync(project+'/cjpm.toml','\n[profile]\nexperimental = true\n[profile.build]\nincremental = true\ncompile-pipeline-parallel = true\n');fs.writeFileSync(project+'/cjpm.toml',fs.readFileSync(project+'/cjpm.toml','utf8').replace('output-type = \"static\"','output-type = \"dynamic\"'));}
if(mode==='profile')fs.appendFileSync(project+'/cjpm.toml','\n[profile.build]\nincremental = true\n');
const explicit=mode==='incremental';
const build=[cjpm,'build','-V','-j','2',...(explicit?['-i']:[])];
const test=[cjpm,'test','-V','-j','2','--show-all-output',...(explicit?['-i']:[])];
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
function snapshot(label){
 const files=walk(project+'/target'),archive=files.find(f=>f.endsWith(mode==='pipeline'?'/libflagcase.so':'/libflagcase.a'));assert(archive,'real production archive');
 const bytes=fs.readFileSync(archive),symbols=run(label+'-symbols',['nm','--extern-only','--defined-only',archive],project);
 const caches=files.filter(f=>f.endsWith('incremental-cache.json')).map(f=>{const relative=path.relative(project,f);write(work+'/'+label+'-'+path.basename(f),fs.readFileSync(f));return {file:relative,bytes:fs.statSync(f).size};});
 const result={archive,sha256:createHash('sha256').update(bytes).digest('hex'),mtimeNs:fs.statSync(archive,{bigint:true}).mtimeNs.toString(),testExport:symbols.includes('testModeMarker'),caches};write(work+'/'+label+'-artifacts.json',JSON.stringify(result,null,2));return result;
}
const ordinary=run('build-first',build,project),normal=snapshot('build-first');
check('ordinary-command',()=>{assert.match(ordinary,/--no-sub-pkg/);assert(!ordinary.includes('--export-for-test'));if(mode!=='pipeline')assert(!ordinary.includes('--link-options'));});
check('ordinary-hides-test-export',()=>assert.equal(normal.testExport,false));
const cached=run('build-repeat',build,project),same=snapshot('build-repeat');
if(mode!=='default')check('same-build-reuses-cache',()=>{assert(!cached.includes('Compiling package `flagcase`:'));assert.equal(same.mtimeNs,normal.mtimeNs);assert.equal(same.sha256,normal.sha256);});
const tested=run('test-first',test,project),exported=snapshot('test-first');
check('test-rebuilds-with-real-options',()=>{assert.match(tested,/Compiling package `flagcase`:/);assert.match(tested,/--export-for-test/);assert.match(tested,/--link-options/);assert(!tested.split('\n').filter(l=>l.startsWith('Compiling package `flagcase`:')).some(l=>l.includes('--no-sub-pkg')));});
check('test-export-present',()=>assert.equal(exported.testExport,true));
check('test-actually-runs',()=>assert.match(tested,/TESTFLAGS_CASE_EXECUTED/));
const testCached=run('test-repeat',test,project),testSame=snapshot('test-repeat');
if(mode!=='default')check('same-test-production-reuses-cache',()=>{assert(!testCached.includes('Compiling package `flagcase`:'));assert.equal(testSame.mtimeNs,exported.mtimeNs);assert.equal(testSame.sha256,exported.sha256);});
check('cached-test-still-runs',()=>assert.match(testCached,/TESTFLAGS_CASE_EXECUTED/));
const restored=run('build-return',build,project),final=snapshot('build-return');
check('return-build-rebuilds-ordinary-command',()=>{assert.match(restored,/Compiling package `flagcase`:/);assert.match(restored,/--no-sub-pkg/);assert(!restored.includes('--export-for-test'));if(mode!=='pipeline')assert(!restored.includes('--link-options'));});
check('return-build-removes-test-export',()=>assert.equal(final.testExport,false));
const finalCached=run('build-return-repeat',build,project),finalSame=snapshot('build-return-repeat');
if(mode!=='default')check('return-build-cache-restored',()=>{assert(!finalCached.includes('Compiling package `flagcase`:'));assert.equal(finalSame.mtimeNs,final.mtimeNs);assert.equal(finalSame.sha256,final.sha256);});

if(mode==='pipeline')check('split-invocations-have-independent-option-inputs',()=>{const raw=fs.readFileSync(work+'/build-first-incremental-cache.json','utf8'),data=JSON.parse(raw),keys=Object.keys(data);const compile=keys.find(k=>k.startsWith('options~compile~')),link=keys.find(k=>k.startsWith('options~link~'));assert(compile&&link);assert.notEqual(data[compile].value,data[link].value);assert.match(ordinary,/--output-type=obj/);assert.match(ordinary,/--output-type=dylib/);});

console.log('PASS public '+mode+' build-test-build cache/options/export');
