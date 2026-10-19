#!/usr/bin/env zx
// The historical bulk checker, using the same public cjcompat entry for each CJO pair.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const entry=process.argv.findIndex((v,i)=>i>0&&path.resolve(v)===fileURLToPath(import.meta.url));
const [base,current,arch]=process.argv.slice(entry+1);
if(!base||!current||!arch)throw Error('usage: cjcompat_check_libs.mjs <base-sdk> <current-sdk> <arch>');
function modules(sdk){
  for(const backend of ['cjnative','llvm']){
    const dir=path.resolve(sdk,'modules',`linux_${arch}_${backend}`);
    if(fs.existsSync(dir)&&fs.statSync(dir).isDirectory())return dir;
  }
  throw Error(`no ${arch} CJO module directory in ${sdk}`);
}
function list(dir,rel=''){
  return fs.readdirSync(path.join(dir,rel),{withFileTypes:true}).flatMap(e=>{
    const name=path.join(rel,e.name);
    return e.isDirectory()?list(dir,name):e.isFile()&&name.endsWith('.cjo')?[name]:[];
  }).sort();
}
const oldModules=modules(base),newModules=modules(current);
const newNames=new Set(list(newModules));
const pairs=list(oldModules).filter(name=>newNames.has(name));
if(!pairs.length)throw Error('no common CJO pairs; no checks executed');
const log=fs.openSync('result_cjcompat_libs.log','w');
try{
  for(const name of pairs){
    fs.writeSync(log,`filename: ${name}\n`);
    const p=spawnSync('cjcompat',['--old',path.join(oldModules,name),'--new',path.join(newModules,name)],
      {stdio:['ignore',log,log]});
    if(p.error)throw p.error;
    if(p.status!==0)process.exitCode=p.status??1;
    if(p.status!==0)break;
  }
}finally{fs.closeSync(log);}
// Compatibility is reported by the public tool's text; keep its historical exit convention.
process.stdout.write(fs.readFileSync('result_cjcompat_libs.log'));
