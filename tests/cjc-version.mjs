#!/usr/bin/env zx
// Finite native version-path gate; not a complete lint/compat producer build.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const entry=process.argv.findIndex((v,i)=>i>0&&path.resolve(v)===fileURLToPath(import.meta.url));
if(process.argv[entry+1]==='--assert-output'){
 const spec=JSON.parse(fs.readFileSync(process.argv[entry+2],'utf8'));
 const actual=fs.readFileSync(spec.actual,'utf8'),pass=actual===spec.expected;
 fs.writeFileSync(spec.result,JSON.stringify({name:'complete selected version',executed:true,pass}));
 assert.equal(actual,spec.expected,'complete selected version');
 process.exit(0);
}
const config=JSON.parse(fs.readFileSync(process.argv[entry+1],'utf8'));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {work,sdk,jobs}=config;
assert.equal(process.platform,'linux','this gate covers Linux Ninja/Makefiles');
assert.ok(path.isAbsolute(work)&&path.isAbsolute(sdk));
assert.equal(jobs,2,'run in the admitted two CPU slot');
assert.ok(!fs.existsSync(work),'use a fresh work directory');
fs.mkdirSync(work,{recursive:true});
const records=[],checks=[];
const env={...process.env,CANGJIE_HOME:sdk,CANGJIE_BUILD_JOBS:String(jobs)};
function run(name,argv,expected=0,extraEnv={}){
 const p=spawnSync(argv[0],argv.slice(1),{cwd:work,env:{...env,...extraEnv},encoding:'utf8',maxBuffer:4*1024*1024});
 fs.writeFileSync(path.join(work,name+'.stdout'),p.stdout||'');
 fs.writeFileSync(path.join(work,name+'.stderr'),p.stderr||'');
 records.push({name,argv,cwd:work,rc:p.status,signal:p.signal,error:p.error?.message});
 fs.writeFileSync(path.join(work,'commands.json'),JSON.stringify(records,null,2));
 if(expected===null)assert.notEqual(p.status,0,name+' must fail');
 else assert.equal(p.status,expected,name+': see raw output');
 return p;
}
function check(name,value){
 checks.push({name,executed:true,pass:!!value});
 fs.writeFileSync(path.join(work,'assertions.json'),JSON.stringify(checks,null,2));
 assert.ok(value,name);
}
const cjc=path.join(sdk,'bin/cjc');
const real=run('real-selected-cjc',[cjc,'-v']);
const normalized=text=>text.replace(/\r\n?/g,'\n').replace(/\n+$/,'');
const realVersion=normalized(real.stdout);
check('real selected cjc has complete multiline version',realVersion.includes('\nTarget:'));
fs.writeFileSync(path.join(work,'real-input.json'),JSON.stringify({sdk,cjc,resolvedCjc:fs.realpathSync(cjc),
 sha256:crypto.createHash('sha256').update(fs.readFileSync(cjc)).digest('hex'),stdout:real.stdout,stderr:real.stderr,rc:real.status},null,2));
// Keep the real product CMake call and PrintVersion body intact. Only the AST-
// dependent rest is omitted under this explicitly finite compilation contract.
const projects=path.join(work,'projects');fs.mkdirSync(projects);
const metadata={};
for(const [tool,file,signature,macro,ownMacro]of [
 ['cjlint','cjlint/src/Cjlint.cpp','void PrintVersion()','CJC_VERSION','CJLINT_VERSION'],
 ['cjcompat','cjcompat/src/Option/Option.cpp','static void PrintVersion()','CJCOMPAT_CANGJIE_VER','CJCOMPAT_VERSION']]){
 const cmake=fs.readFileSync(path.join(root,tool,'CMakeLists.txt'),'utf8');
 const start=cmake.indexOf('include(../cmake/CjcVersion.cmake)');
 const end=cmake.indexOf('\nif (BUILD_SHARED_LIBS)',start);
 assert.ok(start>=0&&end>start);
 const productBlock=cmake.slice(start,end);
 const block=productBlock.replace('include(../cmake/CjcVersion.cmake)',
   'include("'+path.join(root,'cmake/CjcVersion.cmake')+'")');
 const original=fs.readFileSync(path.join(root,file),'utf8');
 check(tool+' actual consumer includes generated header',original.includes('#include "CjcVersion.h"'));
 const a=original.indexOf(signature),b=original.indexOf('\n}',a)+2;
 assert.ok(a>=0&&b>a);
 const body=original.slice(a,b);
 const ownVersion=cmake.match(new RegExp('set\\('+ownMacro+'_STR "([^"]+)"\\)'))[1];
 const dir=path.join(projects,tool);fs.mkdirSync(dir);
 fs.writeFileSync(path.join(dir,'CMakeLists.txt'),`cmake_minimum_required(VERSION 3.14.1)
project(version_${tool} LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
${block}
add_executable(version-consumer Version.cpp)
target_compile_definitions(version-consumer PRIVATE ${ownMacro}="${ownVersion}")
`);
 fs.writeFileSync(path.join(dir,'Version.cpp'),`#include "CjcVersion.h"
#include <iostream>
#include <string>
void Println(const std::string& s) { std::cout << s << '\\n'; }
void Errorln(const std::string& s) { std::cerr << s << '\\n'; }
${body}
int main() { PrintVersion(); }
`);
 metadata[tool]={source:file,signature,productBlock,block,body,ownVersion,macro,dir,
  prefix:tool==='cjlint'?'Cangjie Lint: ':'Cangjie Compliance: '};
}
fs.writeFileSync(path.join(work,'actual-product-excerpts.json'),JSON.stringify(metadata,null,2));
const controlDir=path.join(projects,'control');fs.mkdirSync(controlDir);
fs.writeFileSync(path.join(controlDir,'CMakeLists.txt'),'cmake_minimum_required(VERSION 3.14.1)\nproject(control LANGUAGES CXX)\nadd_executable(control Control.cpp)\n');
fs.writeFileSync(path.join(controlDir,'Control.cpp'),'#include <iostream>\nint main(){std::cout << "independent-control\\n";}\n');
const controlBuild=path.join(work,'build-control');
run('control-configure',['cmake','-S',controlDir,'-B',controlBuild,'-G','Ninja']);
run('control-build',['cmake','--build',controlBuild,'--parallel',String(jobs)]);
function control(label){const p=run(label,[path.join(controlBuild,'control')]);check(label+' stdout',p.stdout==='independent-control\n');}
function consume(label,tool,selected,expected,generator='Ninja',targetRed=false){
 const row=metadata[tool],build=path.join(work,'build-'+label+'-'+tool);
 run(label+'-'+tool+'-configure',['cmake','-S',row.dir,'-B',build,'-G',generator,'-DCANGJIE_HOME='+selected]);
 run(label+'-'+tool+'-build',['cmake','--build',build,'--parallel',String(jobs)]);
 const p=run(label+'-'+tool+'-consumer',[path.join(build,'version-consumer')]);
 const spec={actual:path.join(work,label+'-'+tool+'-consumer.stdout'),
  expected:row.prefix+row.ownVersion+'\n'+expected+'\n',result:path.join(work,label+'-'+tool+'-assertion.json')};
 const specFile=path.join(work,label+'-'+tool+'-assertion-input.json');
 fs.writeFileSync(specFile,JSON.stringify(spec));
 run(label+'-'+tool+'-assertion',[process.execPath,fileURLToPath(import.meta.url),'--assert-output',specFile],targetRed?1:0);
 const reached=JSON.parse(fs.readFileSync(spec.result,'utf8'));
 check(label+' '+tool+' exact target reached',reached.executed&&reached.pass===!targetRed);
 const header=fs.readFileSync(path.join(build,'generated/CjcVersion.h'),'utf8');
 check(label+' '+tool+' version is not a build definition',!fs.readFileSync(path.join(build,generator==='Ninja'?'build.ninja':'CMakeFiles/version-consumer.dir/flags.make'),'utf8').includes('-D'+row.macro+'='));
 const binary=fs.readFileSync(path.join(build,'version-consumer'));
 fs.writeFileSync(path.join(work,label+'-'+tool+'-artifact.json'),JSON.stringify({header,sha256:crypto.createHash('sha256').update(binary).digest('hex')},null,2));
 return build;
}
for(const tool of Object.keys(metadata))consume('real',tool,sdk,realVersion);
control('real-independent');
// Boundary producer is an explicitly controlled executable, never the real cjc
// launcher. Normal-path qualification above always uses the selected SDK cjc.
const fixture=path.join(work,'fixture SDK $ space');fs.mkdirSync(path.join(fixture,'bin'),{recursive:true});
const executable=path.join(fixture,'bin/cjc');
const boundary='Cangjie "quoted" \\path; [$dollar] #hash %percent @CJC_VERSION_ESCAPED@ ${literal}\r\nTarget:\twith space\rbare CR\r\n';
function fixtureVersion(stdout,stderr='',rc=0){
 fs.writeFileSync(executable,'#!/usr/bin/env node\n'+
  'if(process.argv[2]!=="-v")process.exit(91);\n'+
  'process.stdout.write('+JSON.stringify(stdout)+');process.stderr.write('+JSON.stringify(stderr)+');process.exitCode='+rc+';\n',{mode:0o755});
}
fixtureVersion(boundary,'successful warning: diagnostic only\r\n');
for(const tool of Object.keys(metadata)){
 consume('boundary',tool,fixture,normalized(boundary));
 consume('makefiles',tool,fixture,normalized(boundary),'Unix Makefiles');
}
for(const [name,stdout,stderr,rc,diagnostic]of [
 ['nonzero',real.stdout,'',37,'failed (37)'],
 ['empty','','',0,'returned empty version output']]){
 fixtureVersion(stdout,stderr,rc);
 for(const tool of Object.keys(metadata)){
  const p=run(name+'-'+tool,['cmake','-S',metadata[tool].dir,'-B',path.join(work,'build-'+name+'-'+tool),'-G','Ninja','-DCANGJIE_HOME='+fixture],null);
  check(name+' '+tool+' exact rejection diagnostic',(p.stdout+p.stderr).includes(diagnostic));
 }
 control(name+'-independent');
}
fs.unlinkSync(executable);
for(const tool of Object.keys(metadata)){
 const p=run('missing-'+tool,['cmake','-S',metadata[tool].dir,'-B',path.join(work,'build-missing-'+tool),'-G','Ninja','-DCANGJIE_HOME='+fixture],null);
 check('missing '+tool+' cannot be numeric rc zero',(p.stdout+p.stderr).includes('Selected SDK cjc -v failed'));
}
// Sever the actual production header value, preserving configure/build and the
// consumer assertion. This candidate bearing point affects both version users.
const source=path.join(root,'cmake/CjcVersion.cmake'),before=fs.readFileSync(source,'utf8');
const anchor='    set(CJC_VERSION_MACRO "${macro}")';assert.equal(before.split(anchor).length,2);
const cut=before.replace(anchor,'    set(CJC_VERSION_ESCAPED "CUT_VERSION")\n'+anchor);
const i=before.split('\n').findIndex(x=>x===anchor);
fs.writeFileSync(path.join(work,'cut.diff'),['diff --git a/cmake/CjcVersion.cmake b/cmake/CjcVersion.cmake',
 '--- a/cmake/CjcVersion.cmake','+++ b/cmake/CjcVersion.cmake',`@@ -${i-2},7 +${i-2},8 @@`,
 ...before.split('\n').slice(i-3,i).map(x=>' '+x),'+    set(CJC_VERSION_ESCAPED "CUT_VERSION")',
 ...before.split('\n').slice(i,i+4).map(x=>' '+x),''].join('\n'));
try{
 fs.writeFileSync(source,cut);
 control('cut-independent');
 for(const tool of Object.keys(metadata))consume('cut',tool,sdk,realVersion,'Ninja',true);
}finally{fs.writeFileSync(source,before);}
for(const tool of Object.keys(metadata))consume('restored',tool,sdk,realVersion);
control('restored-independent');
check('product module restored byte for byte',fs.readFileSync(source,'utf8')===before);

console.log('CJC_VERSION_FINITE_GATE_COMPLETE');
