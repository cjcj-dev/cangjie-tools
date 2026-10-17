#!/usr/bin/env zx
import { $ } from 'zx';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const [cjpm,work]=process.argv.slice(2);await fs.mkdir(work,{recursive:true});const records=[],checks=[];
async function write(file,text){await fs.mkdir(file.substring(0,file.lastIndexOf('/')),{recursive:true});await fs.writeFile(file,text);}
async function run(label,args,cwd){const p=await $({cwd,quiet:true,nothrow:true})`${args}`;await fs.writeFile(work+'/'+label+'.log',p.stdout+p.stderr);records.push({label,args,cwd,rc:p.exitCode});await fs.writeFile(work+'/commands.json',JSON.stringify(records,null,2));return p;}
const base='[package]\nname = "consumer"\nversion = "1.0.0"\ncjc-version = "1.0.0"\noutput-type = "executable"\n[dependencies]\nabsent = { path = "../absent" }\n';
await write(work+'/absent/cjpm.toml','[package]\nname = "absent"\nversion = "1.0.0"\ncjc-version = "1.0.0"\noutput-type = "static"\n');
await write(work+'/absent/src/lib.cj','package absent\npublic func value(): Int64 { 7 }\n');
const control=work+'/control';await write(control+'/cjpm.toml',base);await write(control+'/src/main.cj','package consumer\nimport absent.*\nmain(): Int64 { println(value()); return 0 }\n');
const built=await run('normal-dependency-build',[cjpm,'build','-j','16'],control);assert.equal(built.exitCode,0,'normal declared dependency build');
const consumed=await run('normal-dependency-run',[control+'/target/release/bin/main'],control);assert.equal(consumed.exitCode,0);assert.equal(consumed.stdout.trim(),'7');checks.push({label:'normal-dependency-control',pass:true});
const missing=work+'/missing';await write(missing+'/cjpm.toml',base);await write(missing+'/src/main.cj','package consumer\nimport consumer.a.*\nimport consumer.z.*\nmain(): Int64 { 0 }\n');
for(const part of ['z','a'])await write(missing+'/src/'+part+'/lib.cj',`package consumer.${part}\nimport absent.shared.*\npublic func ${part}(): Int64 { 7 }\n`);
const p=await run('multiple-importers',[cjpm,'build','-j','16'],missing);assert.notEqual(p.exitCode,0);
const output=(p.stdout+p.stderr).replaceAll('\r','');
const expected='Error: can not find the following dependencies\n    absent.shared (imported by: consumer.a, consumer.z)\nError: cjpm build failed\n';
checks.push({label:'multiple-importers-sorted-at-product-target',pass:output===expected,actual:output,expected});await fs.writeFile(work+'/assertions.json',JSON.stringify({executed:true,checks},null,2));assert.equal(output,expected);
