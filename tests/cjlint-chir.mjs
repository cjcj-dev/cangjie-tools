#!/usr/bin/env zx
// Compile the real lint consumers against the selected installed SDK. No mock IR.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
fs.mkdirSync(c.work,{recursive:true});
const manifest=fs.readFileSync(c.ninja,'utf8');
const blocks=[...manifest.matchAll(/^build .*\.cpp\.o: CXX_COMPILER[^\n]*\n(?:  .*\n)+/gm)];
const units=blocks.map(([s])=>{
 const original=s.split('\n')[0].split(' ||')[0].split(' ').at(-1);
 const relative=original.split('/cjlint/')[1];
 const args=key=>s.match(new RegExp('^  '+key+' = (.*)$','m'))[1].split(' ').filter(Boolean).map(a=>a.replaceAll('\\"','"'));
 return {relative,args:[...args('DEFINES'),...args('FLAGS'),...args('INCLUDES').map(a=>a.replace(c.original,c.source))]};
}).filter(u=>u.relative==='src/common/CommonFunc.cpp'||u.relative==='src/checker/Checker.cpp'||u.relative.startsWith('src/rules/dataflow_rule_analysis/'));
assert(units.some(u=>u.relative.includes('G_SER_03')),'shared CommonFunc consumer missing');
for(const rule of ['P_02','G_VAR_01','G_OTH_01','G_CHK_01','G_CHK_03','G_FIO_01'])assert(units.some(u=>u.relative.includes(rule)),rule);
fs.writeFileSync(path.join(c.work,'surface.json'),JSON.stringify(units,null,2));
const records=[];
function compile(unit,label){
 const argv=[...unit.args,'-fsyntax-only','-ferror-limit=0',path.join(c.source,unit.relative)];
 const p=spawnSync(c.cxx,argv,{encoding:'utf8',maxBuffer:8*1024*1024});
 const name=label+'-'+path.basename(unit.relative);
 fs.writeFileSync(path.join(c.work,name+'.stdout'),p.stdout||'');fs.writeFileSync(path.join(c.work,name+'.stderr'),p.stderr||'');
 records.push({label,source:unit.relative,argv:[c.cxx,...argv],rc:p.status,signal:p.signal,error:p.error?.message});
 fs.writeFileSync(path.join(c.work,'commands.json'),JSON.stringify(records,null,2));
 console.log(name+' rc='+p.status);return p;
}
function green(unit,label){assert.equal(compile(unit,label).status,0,unit.relative);}
for(const unit of units)green(unit,'candidate');
const common=units.find(u=>u.relative==='src/common/CommonFunc.cpp'),checker=units.find(u=>u.relative==='src/checker/Checker.cpp');
function cut(relative,from,to,target,control,diagnostic,label){
 const f=path.join(c.source,relative),before=fs.readFileSync(f,'utf8');assert(before.includes(from));
 const after=before.replace(from,to);fs.writeFileSync(path.join(c.work,label+'.cut.json'),JSON.stringify({file:relative,from,to},null,2));
 try{fs.writeFileSync(f,after);const p=compile(target,label+'-cut');assert.equal(p.status,1);assert.match(p.stderr,diagnostic);green(control,label+'-control');}
 finally{fs.writeFileSync(f,before);assert.equal(fs.readFileSync(f,'utf8'),before);}
 green(target,label+'-restored');
}
cut('src/common/CommonFunc.cpp','getElementRef->GetBase()->GetType()','getElementRef->GetLocation()->GetType()',common,checker,/no member named 'GetLocation'.*GetElementRef/,'base');
cut('src/rules/dataflow_rule_analysis/dataflow_rule_G_FIO_01/DataflowRuleGFIO01Check.h','const Cangjie::CHIR::Expression* terminator','const Cangjie::CHIR::Terminator* terminator',checker,common,/no type named 'Terminator'/,'analysis');
fs.writeFileSync(path.join(c.work,'result.json'),JSON.stringify({units:units.length,commands:records.length,candidate:units.length,red:2,controls:2,restored:2,scope:'syntax-only; no link/install/rule execution'},null,2));
