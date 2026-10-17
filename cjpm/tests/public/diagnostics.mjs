#!/usr/bin/env zx
import { $ } from 'zx';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const [cjpm,baseline,work]=process.argv.slice(2);await fs.mkdir(work,{recursive:true});
const base='[package]\nname = "consumer"\nversion = "1.0.0"\ncjc-version = "1.0.0"\noutput-type = "executable"\n';
const commands=[],checks=[];
async function write(file,data){await fs.mkdir(file.substring(0,file.lastIndexOf('/')),{recursive:true});await fs.writeFile(file,data);}
async function run(label,entry,cwd,success=false){const args=[entry,'build','-j','16'],p=await $({cwd,quiet:true,nothrow:true})`${args}`;await fs.writeFile(work+'/'+label+'.log',p.stdout+p.stderr);commands.push({label,args,cwd,rc:p.exitCode});await fs.writeFile(work+'/commands.json',JSON.stringify(commands,null,2));if(success)assert.equal(p.exitCode,0,label);else assert.notEqual(p.exitCode,0,label);return (p.stdout+p.stderr).replaceAll('\r','');}
async function check(label,fn){try{fn();checks.push({label,pass:true});}catch(e){checks.push({label,pass:false,error:e.message});await fs.writeFile(work+'/assertions.json',JSON.stringify({executed:true,checks},null,2));throw e;}await fs.writeFile(work+'/assertions.json',JSON.stringify({executed:true,checks},null,2));}
const errors=[];
for(const bom of [false,true]){
 const dir=work+'/'+(bom?'error-bom':'error-plain');await write(dir+'/cjpm.toml',(bom?'\uFEFF':'')+base+'[metadata]\nprobe = @\n');await write(dir+'/src/main.cj','package consumer\nmain(): Int64 { 0 }\n');
 const old=await run((bom?'bom':'plain')+'-baseline',baseline,dir),current=await run((bom?'bom':'plain')+'-candidate',cjpm,dir);
 const expected="toml: line 7 (last key metadata.probe): expected '.' or '=', but got @ instead\nError: parse the './cjpm.toml' file failed\nError: cjpm build failed\n";
 await check((bom?'bom':'plain')+'-public-error',()=>assert.equal(current,expected));
 await check((bom?'bom':'plain')+'-baseline-compatibility',()=>assert.equal(current,old));errors.push(current);
}
await check('bom-public-error-consistency',()=>assert.equal(errors[0],errors[1]));
const lock=work+'/comment-lock';await write(lock+'/cjpm.toml',base);await write(lock+'/src/main.cj','package consumer\nmain(): Int64 { 0 }\n');
for(const [name,entry] of [['baseline',baseline],['candidate',cjpm]]){await write(lock+'/cjpm.lock','version = 0 # keep lock version\n[requires] # dependencies\n');await run('comment-lock-'+name,entry,lock,true);await check('comment-lock-'+name+'-accepted',()=>assert.ok(true));}
// The public multi-importer entry and normal dependency control are covered by importers.mjs.
