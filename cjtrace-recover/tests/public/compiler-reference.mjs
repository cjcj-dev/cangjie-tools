#!/usr/bin/env zx
import { $ } from 'zx';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const [trace,cjfilt,object,elf,work]=process.argv.slice(2);await fs.mkdir(work,{recursive:true});const records=[];
async function run(label,args){const p=await $({cwd:work,quiet:true,nothrow:true})`${args}`;await fs.writeFile(work+'/'+label+'.log',p.stdout+p.stderr);records.push({label,args,rc:p.exitCode});await fs.writeFile(work+'/commands.json',JSON.stringify(records,null,2));assert.equal(p.exitCode,0,label);return p.stdout;}
const generated=await run('compiler-object-symbols',['nm',object]);
const reference=generated.split('\n').map(s=>s.trim()).find(s=>/^U _CNcr/.test(s));assert.ok(reference,'compiler object must emit a compressed cr reference');const name=reference.split(/\s+/).at(-1);
const linked=await run('linked-definitions',['nm','--defined-only',elf]);assert.ok(linked.split('\n').some(s=>s.trim().split(/\s+/).at(-1)===name),'official H supplies the exact referenced definition');
const filter=await run('cjfilt',[cjfilt,'-l',name]);
await fs.writeFile(work+'/map',name+' target source.cj\n_CN7default15ordinaryControlHv control source.cj\n');await fs.writeFile(work+'/trace','    at target(SOURCE:1)\n    at control(SOURCE:2)\n');
const recovered=await run('cjtrace',[trace,'-m',work+'/map','-f',work+'/trace']);
const result={executed:true,name,compilerEmittedReference:true,linkedDefinition:true,cjfilt:filter.includes('std.concurrent.'),cjtrace:recovered.includes('std.concurrent.'),control:recovered.split('\n').includes('    at default.ordinaryControl()(source.cj:2)')};
await fs.writeFile(work+'/assertions.json',JSON.stringify(result,null,2));assert.ok(result.cjfilt && result.cjtrace && result.control);
