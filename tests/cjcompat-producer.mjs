#!/usr/bin/env zx
// Planned native Linux integration gate. Execute only after qualified inputs/resource admission.
// config: {sdk, jobs, work, control: [installed-independent-tool, ...business-args], consumeOnly?}
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const entry=process.argv.findIndex((v,i)=>i>0&&path.resolve(v)===fileURLToPath(import.meta.url));
const cfg=JSON.parse(fs.readFileSync(process.argv[entry+1],'utf8'));
assert.equal(process.platform,'linux');
assert.ok(path.isAbsolute(cfg.sdk)&&path.isAbsolute(cfg.work));
assert.ok(Number.isInteger(cfg.jobs)&&cfg.jobs>0);
assert.ok(Array.isArray(cfg.control)&&cfg.control.length>0);
const work=cfg.work,sdk=cfg.sdk,tool=path.join(root,'cjcompat');
fs.mkdirSync(work,{recursive:true});
const env={...process.env,CANGJIE_HOME:sdk,
  LD_LIBRARY_PATH:[path.join(sdk,'tools/lib'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')};
const commands=[],checks=[];
function run(name,argv,cwd=root,expected=0){
  const p=spawnSync(argv[0],argv.slice(1),{cwd,env,encoding:'utf8',maxBuffer:32*1024*1024});
  fs.writeFileSync(path.join(work,name+'.log'),(p.stdout||'')+(p.stderr||''));
  commands.push({name,argv,cwd,rc:p.status,signal:p.signal,error:p.error?.message});
  fs.writeFileSync(path.join(work,'commands.json'),JSON.stringify(commands,null,2));
  if(expected!==null)assert.equal(p.status,expected,`${name}: see raw log`);return p;
}
function check(name,pass){
  checks.push({name,pass});
  fs.writeFileSync(path.join(work,'assertions.json'),JSON.stringify({executed:true,checks},null,2));
  assert.ok(pass,name);
}
const prefix=path.join(work,'install');
if(!cfg.consumeOnly){
  for(const [i,type] of ['release','debug','release'].entries()){
    run(`build-${i}-${type}`,['python3',path.join(tool,'build/build.py'),'build','-t',type,'--jobs',String(cfg.jobs),'--sdk',sdk]);
    const cache=fs.readFileSync(path.join(tool,'build/build/CMakeCache.txt'),'utf8');
    check(`effective ${type}`,cache.includes(`CMAKE_BUILD_TYPE:STRING=${type==='release'?'Release':'Debug'}`));
    run(`install-${i}-${type}`,['python3',path.join(tool,'build/build.py'),'install','--prefix',prefix]);
    check(`installed ${type}`,fs.statSync(path.join(prefix,'bin/cjcompat')).size>0);
  }
  // Fresh component archive and unpack; SDK qualification remains the SDK writer's separate gate.
  run('package',['tar','-czf',path.join(work,'cjcompat-component.tar.gz'),'-C',prefix,'.']);
  fs.mkdirSync(path.join(work,'unpack'),{recursive:true});
  run('unpack',['tar','-xzf',path.join(work,'cjcompat-component.tar.gz'),'-C',path.join(work,'unpack')]);
}
// The selected SDK compiler, not hand-authored CJO bytes, creates all business inputs.
for(const [name,body] of Object.entries({old:'public func retained(): Int64 { 1 }\npublic func removed(): Int64 { 2 }\n',same:'public func retained(): Int64 { 1 }\npublic func removed(): Int64 { 2 }\n',deleted:'public func retained(): Int64 { 1 }\n'})){
  const dir=path.join(work,name);fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'lib.cj'),'package compat_fixture\n'+body);
  run(`cjo-${name}`,[path.join(sdk,'bin/cjc'),'lib.cj','--output-type=staticlib','-o','libcompat_fixture.a'],dir);
  check(`compiler produced ${name} CJO`,fs.existsSync(path.join(dir,'compat_fixture.cjo')));
}
const executable=path.join(work,cfg.consumeOnly?'install':'unpack','bin/cjcompat');
run('independent-control',cfg.control);
for(const mode of [[],['--api'],['--abi']]){
  const tag=mode[0]?.slice(2)||'default';
  const old=path.join(work,'old/compat_fixture.cjo');
  const same=run(`same-${tag}`,[executable,'--old',old,'--new',path.join(work,'same/compat_fixture.cjo'),...mode],root,null);
  check(`same ${tag} reaches compatibility decision`,same.status===0&&/^Compatible!\s*$/m.test(same.stdout));
  const deleted=run(`deleted-${tag}`,[executable,'--old',old,'--new',path.join(work,'deleted/compat_fixture.cjo'),...mode],root,null);
  check(`deleted ${tag} reaches positive incompatibility control`,deleted.status===0&&/^Incompatible!$/m.test(deleted.stdout)&&deleted.stdout.includes('Function declaration visible outside the module deleted or made private.'));
}
console.log('CJCOMPAT_PRODUCER_GATE_COMPLETE');
