#!/usr/bin/env zx
// Linux integration gate: run the public build.py CLI and observe real execs.
// No replacement compiler/make; traces include each consumer's actual argv.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const [sourceArg, outputArg, arm='green'] = process.argv.slice(2);
assert(sourceArg && outputArg, 'usage: build-jobs.mjs <cjpm-source> <evidence> [arm]');
const source=path.resolve(sourceArg),output=path.resolve(outputArg);
fs.mkdirSync(output,{recursive:true});
const records=[],checks=[];
function check(name,condition,detail){checks.push({name,passed:Boolean(condition),detail});console.log(`${condition?'PASS':'FAIL'} ${name}`);}
function run(name,args,extra={}){
 const trace=output+'/'+name+'.execve',stdout=output+'/'+name+'.stdout',stderr=output+'/'+name+'.stderr';
 const env={...process.env,...extra};
 for(const k of Object.keys(env))if(env[k]===undefined)delete env[k];
 const argv=['strace','-f','-s','65536','-e','trace=execve','-o',trace,'python3',source+'/build/build.py',...args];
 const o=fs.openSync(stdout,'w'),e=fs.openSync(stderr,'w'),start=new Date().toISOString();
 const p=spawnSync(argv[0],argv.slice(1),{cwd:source,env,stdio:['ignore',o,e]});fs.closeSync(o);fs.closeSync(e);
 const text=fs.readFileSync(trace,'utf8');
 const execs=text.split('\n').filter(l=>/= 0$/.test(l));
 const make=execs.filter(l=>/execve\("[^"\n]*\/make",/.test(l));
 const cjc=execs.filter(l=>/execve\("[^"\n]*\/cjc",/.test(l));
 const r={name,argv,cwd:source,start,end:new Date().toISOString(),rc:p.status,signal:p.signal,error:p.error?.message??null,trace,stdout,stderr,make,cjc};records.push(r);
 fs.writeFileSync(output+'/commands.json',JSON.stringify(records,null,2));
 return r;
}
function budget(name,args,jobs,extra={},nativeOnly=false){
 const r=run(name,['build','-t','release',...args],extra);
 check(name+':build-exit',r.rc===0,{rc:r.rc});
 check(name+':native-budget',r.make.length===1&&r.make.every(l=>l.includes('"-j'+jobs+'"')),r.make);
 check(name+':cj-budget',nativeOnly?r.cjc.length===0:r.cjc.length===6&&r.cjc.every(l=>l.includes('"-j'+jobs+'"')),r.cjc);
 return r;
}
try {
 budget('explicit',['--jobs','2'],2,{CANGJIE_BUILD_JOBS:'1',MAKEFLAGS:'-j1'});
 // These controls also run in the cut arm: parsing and native budget survive
 // a cut specifically disconnecting CJ's consumption of the public budget.
 for(const value of ['0','-1','word','1.5']){
  const r=run('invalid-'+value.replace(/[^a-z0-9]/g,'_'),['build','-t','release','--jobs',value]);
  check('invalid '+value+':argparse',r.rc===2&&/jobs must be a positive integer/.test(fs.readFileSync(r.stderr,'utf8')),{rc:r.rc});
  check('invalid '+value+':no-build',r.make.length===0&&r.cjc.length===0,{make:r.make,cjc:r.cjc});
 }
 if(arm!=='cut'){
  budget('env-default',['--native-only'],1,{CANGJIE_BUILD_JOBS:'1',MAKEFLAGS:undefined},true);
  // taskset/cpuset supplies the default on Linux; do not assume host CPU count.
  budget('affinity-default',['--native-only'],os.availableParallelism(),{CANGJIE_BUILD_JOBS:undefined,MAKEFLAGS:undefined},true);
  budget('explicit-precedence',['-j','2','--native-only'],2,{CANGJIE_BUILD_JOBS:'invalid',MAKEFLAGS:'-j1'},true);
  const envBad=run('invalid-env',['build','-t','release','--native-only'],{CANGJIE_BUILD_JOBS:'0'});
  check('invalid env:argparse',envBad.rc===2&&envBad.make.length===0&&envBad.cjc.length===0,{rc:envBad.rc});
  const missing=run('missing-sdk',['build','-t','release','--jobs','2'],{CANGJIE_HOME:undefined});
  check('missing SDK:exit propagates',missing.rc===1&&missing.make.length===0&&missing.cjc.length===0,{rc:missing.rc});
 }
}finally{
 fs.writeFileSync(output+'/results.json',JSON.stringify({arm,checks,passed:checks.filter(x=>x.passed).length,failed:checks.filter(x=>!x.passed).length,records},null,2));
}
process.exit(checks.every(x=>x.passed)?0:1);
