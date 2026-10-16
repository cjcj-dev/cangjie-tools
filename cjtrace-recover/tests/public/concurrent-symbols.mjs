#!/usr/bin/env zx
import { $ } from 'zx';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const [trace,cjfilt,cjc,work]=process.argv.slice(2);
await fs.mkdir(work,{recursive:true});const records=[],checks=[];
async function run(label,args){const p=await $({cwd:work,quiet:true,nothrow:true})`${args}`;await fs.writeFile(work+'/'+label+'.log',p.stdout+p.stderr);records.push({label,args,rc:p.exitCode});await fs.writeFile(work+'/commands.json',JSON.stringify(records,null,2));assert.equal(p.exitCode,0,label);return p.stdout;}
// Compile an actual consumer of std.concurrent. Generic instantiation emits compressed std.concurrent symbols.
await fs.writeFile(work+'/consumer.cj','import std.concurrent.*\nfunc ordinaryControl(): Int64 { 7 }\nmain(): Int64 {\n    threadScope<Int64, Unit> { group =>\n        group.launch { ordinaryControl() }\n        for (value in group) { println(value) }\n    }\n    return 0\n}\n');
await run('producer-compile',[cjc,work+'/consumer.cj','-o',work+'/consumer']);
const output=await run('producer-run',[work+'/consumer']);assert.equal(output.trim(),'7');
const symbols=await run('producer-symbols',['nm','--defined-only',work+'/consumer']);
const names=symbols.split('\n').map(s=>s.trim().split(/\s+/).at(-1));
const concurrent=names.find(s=>s?.startsWith('_CNcr') && !s.includes('$')) ?? names.find(s=>s?.startsWith('_CNcr'));
assert.ok(concurrent,'compiler output must define a cr symbol');
// The ordinary control comes from the same compiler-produced ELF.
const ordinary=names.find(s=>s?.startsWith('_CN') && !s.startsWith('_CNcr') && !s.includes('$') && s.includes('ordinaryControl'));
assert.ok(ordinary,'ordinary compiler symbol control');
await fs.writeFile(work+'/selected-symbols.json',JSON.stringify({concurrent,ordinary},null,2));
const filterOutput=await run('cjfilt',[cjfilt,'-l',concurrent,ordinary]);
checks.push({label:'cjfilt-concurrent',pass:filterOutput.includes('std.concurrent.')});
await fs.writeFile(work+'/symbols.map',concurrent+' target source.cj\n'+ordinary+' control source.cj\n');
await fs.writeFile(work+'/trace.txt','Exception: probe\n    at target(SOURCE:1)\n    at control(SOURCE:2)\n');
const recovered=await run('trace-recover',[trace,'-m',work+'/symbols.map','-f',work+'/trace.txt']);
checks.push({label:'trace-concurrent',pass:recovered.includes('std.concurrent.')});
checks.push({label:'trace-ordinary',pass:recovered.split('\n').includes('    at default.ordinaryControl()(source.cj:2)')});
await fs.writeFile(work+'/assertions.json',JSON.stringify({executed:true,checks},null,2));
assert.ok(checks.every(c=>c.pass),'demangler/cjtrace consumer assertions failed');
