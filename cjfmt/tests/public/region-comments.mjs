#!/usr/bin/env zx
import { $ } from 'zx';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const [fmt,cjc,work]=process.argv.slice(2);
await fs.mkdir(work,{recursive:true});
const commands=[],checks=[];
async function run(label,args){const p=await $({cwd:work,quiet:true,nothrow:true})`${args}`;await fs.writeFile(path.join(work,label+'.log'),p.stdout+p.stderr);commands.push({label,args,rc:p.exitCode});await fs.writeFile(path.join(work,'commands.json'),JSON.stringify(commands,null,2));assert.equal(p.exitCode,0,label);return p.stdout;}
async function check(label,fn){try{fn();checks.push({label,pass:true});}catch(e){checks.push({label,pass:false,error:e.message});}await fs.writeFile(work+'/assertions.json',JSON.stringify({executed:true,checks},null,2));}
const comment='    /*repeat\n*body\n*/';
const cases=[
 {name:'selected-only',text:'main() {\n'+comment+'\n    println(7)\n'+comment+'\n}\n',region:'6:8',expected:'main() {\n'+comment+'\n    println(7)\n    /* repeat\n     * body\n     */\n}\n'},
 {name:'nested-region',text:'main() {\n    if (true) {\n        /*nested\n*body\n*/\n        println(7)\n    }\n}\n',region:'3:5',expected:'main() {\n    if (true) {\n        /* nested\n         * body\n         */\n        println(7)\n    }\n}\n'},
 {name:'ordinary',text:'// header\nmain(){\n    /*ordinary\n*body\n*/\nlet x=7 // inline\nprintln(x)\n}\n',expected:null}
];
for(const item of cases){
 const src=work+'/'+item.name+'.cj',first=work+'/'+item.name+'-first.cj',second=work+'/'+item.name+'-second.cj';
 await fs.writeFile(src,item.text);const region=item.region?['-l',item.region]:[];
 await run(item.name+'-format',[fmt,'-f',src,'-o',first,...region]);
 const out=await fs.readFile(first,'utf8');
 await check(item.name+'-content',()=>{if(item.expected)assert.equal(out,item.expected);else {assert.match(out,/\/\/ header/);assert.match(out,/\/\/ inline/);assert.match(out,/\/\* ordinary\n\s+\* body\n\s+\*\//);}});
 await run(item.name+'-reparse',[cjc,first,'-o',work+'/'+item.name+'-program']);
 const output=await run(item.name+'-run',[work+'/'+item.name+'-program']);
 await check(item.name+'-semantics',()=>assert.equal(output.trim(),'7'));
 await run(item.name+'-second-format',[fmt,'-f',first,'-o',second,...region]);
 const twice=await fs.readFile(second,'utf8');
 await check(item.name+'-idempotent',()=>assert.equal(twice,out));
}
assert.ok(checks.every(c=>c.pass),'formatter content/semantic/idempotence assertions failed');
