#!/usr/bin/env zx
import { $ } from 'zx';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const [fmt,cjc,config,work]=process.argv.slice(2);await fs.mkdir(work,{recursive:true});
const custom=(await fs.readFile(config,'utf8')).replace('indentWidth = 4','indentWidth = 2');await fs.writeFile(work+'/format.toml',custom);
await fs.writeFile(work+'/input.cj','main(){\n/*comment\n*body\n*/\nprintln(7)\n}\n');
const records=[];
async function run(label,args){const p=await $({cwd:work,quiet:true,nothrow:true})`${args}`;await fs.writeFile(work+'/'+label+'.log',p.stdout+p.stderr);records.push({label,args,rc:p.exitCode});await fs.writeFile(work+'/commands.json',JSON.stringify(records,null,2));assert.equal(p.exitCode,0,label);return p.stdout;}
await run('format',[fmt,'-f',work+'/input.cj','-o',work+'/first.cj','-c',work+'/format.toml']);
const text=await fs.readFile(work+'/first.cj','utf8');
const expected='main() {\n  /* comment\n   * body\n   */\n  println(7)\n}\n';
await fs.writeFile(work+'/assertions.json',JSON.stringify({executed:true,expected,text,content:text===expected},null,2));assert.equal(text,expected);
await run('reparse',[cjc,work+'/first.cj','-o',work+'/program']);assert.equal((await run('run',[work+'/program'])).trim(),'7');
await run('second-format',[fmt,'-f',work+'/first.cj','-o',work+'/second.cj','-c',work+'/format.toml']);assert.equal(await fs.readFile(work+'/second.cj','utf8'),text);
