#!/usr/bin/env zx
import { $ } from 'zx';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const [cjpm,work]=process.argv.slice(2);
await fs.mkdir(work,{recursive:true});const records=[],checks=[];
const base='[package]\nname = "consumer"\nversion = "1.0.0"\ncjc-version = "1.0.0"\noutput-type = "executable"\n';
async function write(file,text){await fs.mkdir(file.substring(0,file.lastIndexOf('/')),{recursive:true});await fs.writeFile(file,text);}
async function run(label,args,cwd,expected=0){const p=await $({cwd,quiet:true,nothrow:true})`${args}`;await fs.writeFile(work+'/'+label+'.log',p.stdout+p.stderr);records.push({label,args,cwd,rc:p.exitCode});await fs.writeFile(work+'/commands.json',JSON.stringify(records,null,2));if(expected===0)assert.equal(p.exitCode,0,label);else assert.notEqual(p.exitCode,0,label);return p;}
async function check(label,fn){try{fn();checks.push({label,pass:true});}catch(e){checks.push({label,pass:false,error:e.message});await fs.writeFile(work+'/assertions.json',JSON.stringify({executed:true,checks},null,2));throw e;}await fs.writeFile(work+'/assertions.json',JSON.stringify({executed:true,checks},null,2));}
for(const name of ['normal','large','bom']){
 const dir=work+'/'+name;const metadata=name==='large'?'[metadata]\n'+Array.from({length:12000},(_,i)=>`item${i} = "text${i}"\n`).join(''):'';
 await write(dir+'/cjpm.toml',(name==='bom'?'\uFEFF':'')+base+metadata);await write(dir+'/src/main.cj','package consumer\nmain(): Int64 { println(7); return 0 }\n');
 await run(name+'-first-build',[cjpm,'build','-j','16'],dir);const p=await run(name+'-program',[dir+'/target/release/bin/main'],dir);await check(name+'-consumed',()=>assert.equal(p.stdout.trim(),'7'));
 await run(name+'-cache-build',[cjpm,'build','-j','16'],dir);
}
const dir=work+'/normal';
const lockCases={canonical:'version = 0\n[requires]\n',versionComment:'version = 0 # keep lock version\n[requires]\n',tableComment:'version = 0\n[requires] # dependencies\n',quotedKeys:'"version" = 0\n["requires"]\n',inlineRequires:'version = 0\nrequires = {}\n'};
for(const [label,lock] of Object.entries(lockCases)){await write(dir+'/cjpm.lock',lock);await fs.writeFile(work+'/'+label+'.lock',lock);await run('lock-'+label,[cjpm,'build','-j','16'],dir);await check('lock-'+label+'-accepted',()=>assert.ok(true));}
for(const [label,lock] of Object.entries({badVersion:'version = 1\n[requires]\n',duplicateVersion:'version = 0\nversion = 0\n[requires]\n',duplicateTable:'version = 0\n[requires]\n[requires]\n'})){
 await write(dir+'/cjpm.lock',lock);await run('lock-'+label,[cjpm,'build','-j','16'],dir,1);await check('lock-'+label+'-rejected',()=>assert.ok(true));
}
// Public error compatibility and importer diagnostics are covered by diagnostics.mjs.
console.log('PASS public config/lock controls');
