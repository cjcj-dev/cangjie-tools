#!/usr/bin/env zx
import { $ } from 'zx';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const [install,H,work]=process.argv.slice(2);
await fs.mkdir(work,{recursive:true});
const records=[],checks=[];
async function write(file,data){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,data);}
async function run(label,args,cwd=work){const p=await $({cwd,quiet:true,nothrow:true})`${args}`;await write(work+'/'+label+'.log',p.stdout+p.stderr);records.push({label,args,cwd,rc:p.exitCode});await write(work+'/commands.json',JSON.stringify(records,null,2));assert.equal(p.exitCode,0,label);return p.stdout;}
async function check(label,value){checks.push({label,pass:value});await write(work+'/assertions.json',JSON.stringify({executed:true,checks},null,2));}
const project=work+'/project',temps=work+'/temps';await fs.mkdir(temps,{recursive:true});
const source='package consumer\nimport std.concurrent.*\nfunc ordinaryControl(): Int64 { 7 }\nmain(): Int64 {\n    /*cross\n*component\n*/\n    threadScope<Int64, Unit> { group =>\n        group.launch { ordinaryControl() }\n        for (value in group) { println(value) }\n    }\n    return 0\n}\n';
await write(work+'/raw.cj',source);
await fs.mkdir(project+'/src',{recursive:true});
await run('format',[install+'/bin/cjfmt','-f',work+'/raw.cj','-o',project+'/src/main.cj']);
const formatted=await fs.readFile(project+'/src/main.cj','utf8');
await check('formatter-comment-consumed',formatted.includes('/* cross\n     * component\n     */'));
await run('format-again',[install+'/bin/cjfmt','-f',project+'/src/main.cj','-o',work+'/twice.cj']);
await check('formatter-idempotent',await fs.readFile(work+'/twice.cj','utf8')===formatted);
await write(project+'/cjpm.toml','\uFEFF[package]\nname = "consumer"\nversion = "1.0.0"\ncjc-version = "1.0.0"\noutput-type = "executable"\ncompile-option = "--save-temps '+temps+'"\n');
await write(project+'/cjpm.lock','version = 0 # existing legal lock\n[requires] # dependencies\n');
await run('cjpm-first-build',[install+'/bin/cjpm','build','-V','-j','16'],project);
const elf=project+'/target/release/bin/main';
await check('cjpm-compiled-formatter-output',(await run('program',[elf],project)).trim()==='7');
await run('cjpm-cache-build',[install+'/bin/cjpm','build','-j','16'],project);
const files=[];async function walk(dir){for(const n of await fs.readdir(dir,{withFileTypes:true})){const f=dir+'/'+n.name;if(n.isDirectory())await walk(f);else files.push(f);}}await walk(temps);
await write(work+'/compiler-intermediates.json',JSON.stringify(files,null,2));
let ref;
for(const file of files.filter(f=>f.endsWith('.o'))){const symbols=await run('object-'+records.length,['nm',file]);const found=symbols.split('\n').map(s=>s.trim()).find(s=>/^U _CNcr/.test(s));if(found){ref={file,name:found.split(/\s+/).at(-1)};break;}}
assert.ok(ref,'public cjpm/compiler must emit a compressed cr reference');
const linked=await run('linked-symbols',['nm','--defined-only',elf]);const names=linked.split('\n').map(s=>s.trim().split(/\s+/).at(-1));assert.ok(names.includes(ref.name),'exact emitted reference must resolve in linked output');
const ordinary=names.find(s=>s?.startsWith('_CN') && !s.includes('$') && s.includes('ordinaryControl'));assert.ok(ordinary);
await write(work+'/selected-symbols.json',JSON.stringify({ref,ordinary,elf},null,2));
const filtered=await run('cjfilt',[install+'/bin/cjfilt','-l',ref.name,ordinary]);
await check('cjfilt-cr',filtered.includes('std.concurrent.'));
await write(work+'/symbols.map',ref.name+' target source.cj\n'+ordinary+' control source.cj\n');
await write(work+'/trace.txt','    at target(SOURCE:1)\n    at control(SOURCE:2)\n');
const recovered=await run('cjtrace',[install+'/bin/cjtrace-recover','-m',work+'/symbols.map','-f',work+'/trace.txt']);
await check('cjtrace-cr',recovered.includes('std.concurrent.'));
await check('ordinary-control',recovered.split('\n').includes('    at consumer.ordinaryControl()(source.cj:2)'));
assert.ok(checks.every(c=>c.pass),'combined formatter→cjpm/compiler→demangler/cjtrace assertions');
