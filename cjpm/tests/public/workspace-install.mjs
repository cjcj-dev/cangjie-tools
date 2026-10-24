#!/usr/bin/env zx
// Exercise installed cjpm through the public install/list/uninstall commands.
// Reuse fixtureArg with the same exe path to check recovery with identical argv.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const [exeArg,outArg,fixtureArg]=process.argv.slice(2);
assert(exeArg&&outArg);
const exe=path.resolve(exeArg),out=path.resolve(outArg),fixtures=path.resolve(fixtureArg||path.join(out,'fixtures'));
assert(!fs.existsSync(out)||fs.readdirSync(out).length===0,'use empty evidence directory');
fs.mkdirSync(out,{recursive:true});
const commands=[],checks=[],completed=[];
const save=()=>fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({commands,checks,completed},null,2));
function check(name,fn){try{fn();checks.push({name,pass:true});}catch(e){checks.push({name,pass:false,error:e.message});}save();}
function run(label,cwd,argv){const p=spawnSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',maxBuffer:4*1024*1024});fs.writeFileSync(path.join(out,label+'.stdout'),p.stdout||'');fs.writeFileSync(path.join(out,label+'.stderr'),p.stderr||'');commands.push({label,argv,cwd,rc:p.status,signal:p.signal,error:p.error?.message??null});save();return p;}
function exit(p){assert.equal(p.error,undefined);assert.equal(p.signal,null);assert.equal(p.status,0);}
function write(file,text){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);}
const cases=[
 {id:'org-workspace',workspace:true,members:[['app','cjcj','0.1.0']],member:'app'},
 {id:'plain-workspace',workspace:true,members:[['app','','0.2.0']],member:'app'},
 {id:'org-single',members:[['app','cjcj','0.3.0']]},
 {id:'plain-single',members:[['app','','0.4.0']]},
 {id:'org-single-multi',subpackage:true,members:[['app','cjcj','0.5.0']]},
 {id:'org-workspace-debug-target',workspace:true,debug:true,members:[['app','cjcj','0.6.0']],member:'app'},
 {id:'distinct-orgs',workspace:true,members:[['first','firstorg','1.2.3'],['second','secondorg','4.5.6']]}
];
for(const c of cases){
 const project=path.join(fixtures,c.id),root=project+'-install';
 const expected=c.members.map(([dir,org,version])=>({dir,org,version,name:(org?org+'::':'')+'app',installed:(c.workspace||c.subpackage)?(org?org+'::':'')+'app':'app'}));
 if(!fs.existsSync(project)){
  if(c.workspace)write(project+'/cjpm.toml','[workspace]\nmembers = ['+c.members.map(([d])=>JSON.stringify('packages/'+d)).join(', ')+']\n');
  for(const m of expected){const p=c.workspace?project+'/packages/'+m.dir:project;write(p+'/cjpm.toml','[package]\nname = "app"\norganization = '+JSON.stringify(m.org)+'\nversion = '+JSON.stringify(m.version)+'\ncjc-version = "1.0.0"\noutput-type = "executable"\nsrc-dir = "src"\n'+(c.subpackage?'[package.package-configuration."'+m.name+'.sub"]\noutput-type = "executable"\n':''));write(p+'/src/main.cj','package '+m.name+'\nmain(): Int64 { println("'+m.name+'@'+m.version+'"); return 0 }\n');}
 }
 if(c.subpackage){const m=expected[0];const file=project+'/src/sub/main.cj';if(!fs.existsSync(file))write(file,'package '+m.name+'.sub\nmain(): Int64 { println("'+m.name+'.sub@'+m.version+'"); return 0 }\n');expected.push({...m,dir:'sub',name:m.name+'.sub',installed:m.name+'.sub'});}
 const args=['install','--path',project,'--root',root,...(c.member?['-m','packages/'+c.member]:[]),'-j','2','-V',...(c.debug?['-g','--target-dir',project+'-target']:[])];
 const first=run(c.id+'-install',project,[exe,...args]);
 function registry(label,installRoot,members){check(label,()=>{
  const reg=fs.readFileSync(installRoot+'/.packages.toml','utf8');fs.writeFileSync(out+'/'+label+'.toml',reg);
  const lines=reg.split('\n').map(s=>s.trim()).filter(s=>s&&s!=='[install]');
  assert.equal(lines.length,members.length);
  for(const m of members){const key=m.installed.includes('::')?JSON.stringify(m.installed):m.installed;assert(lines.includes(key+' = {version = '+JSON.stringify(m.version)+', path = '+JSON.stringify(fs.realpathSync(project))+'}'));assert(fs.statSync(installRoot+'/bin/'+m.installed).isFile());}
 });}
 // Always reach the registry assertion, even when install returns failure.
 registry(c.id+'-registration',root,expected);
 check(c.id+'-install-exit',()=>exit(first));
 for(const [phase,extra] of [['cached',[]],['skip',['--skip-build']]]){
  const p=run(c.id+'-'+phase,project,[exe,...args,...extra]);check(c.id+'-'+phase+'-exit',()=>exit(p));
  registry(c.id+'-'+phase+'-registration',root,expected);
 }
 const listed=run(c.id+'-list',project,[exe,'install','--root',root,'--list']);
 check(c.id+'-list-values',()=>{exit(listed);for(const m of expected)assert(listed.stdout.includes(m.installed+': v'+m.version+' from local project ('+project+')'));});
 for(const m of expected){const p=run(c.id+'-consume-'+m.dir,project,[root+'/bin/'+m.installed]);check(c.id+'-consume-'+m.dir,()=>{exit(p);assert.equal(p.stdout.trim(),m.name+'@'+m.version);});}
 const explicitName=(c.workspace||c.subpackage)?expected[0].name:'main',explicitRoot=root+'-explicit';
 const explicitArgs=[...args.map(a=>a===root?explicitRoot:a),'--name',explicitName];
 for(const [phase,extra] of [['explicit',[]],['explicit-skip',['--skip-build']]]){
  const p=run(c.id+'-'+phase,project,[exe,...explicitArgs,...extra]);check(c.id+'-'+phase+'-exit',()=>exit(p));
  registry(c.id+'-'+phase+'-registration',explicitRoot,[{...expected[0],installed:explicitName}]);
 }
 const explicitList=run(c.id+'-explicit-list',project,[exe,'install','--root',explicitRoot,'--list']);
 check(c.id+'-explicit-version',()=>{exit(explicitList);assert(explicitList.stdout.includes(explicitName+': v'+expected[0].version+' from local project ('+project+')'));});
 const explicitRun=run(c.id+'-explicit-consume',project,[explicitRoot+'/bin/'+explicitName]);
 check(c.id+'-explicit-consume',()=>{exit(explicitRun);assert.equal(explicitRun.stdout.trim(),expected[0].name+'@'+expected[0].version);});
 const explicitRemove=run(c.id+'-explicit-uninstall',project,[exe,'uninstall',explicitName,'--root',explicitRoot]);check(c.id+'-explicit-uninstall',()=>exit(explicitRemove));
 registry(c.id+'-explicit-registry-empty',explicitRoot,[]);
 const removed=run(c.id+'-uninstall',project,[exe,'uninstall',...expected.map(m=>m.installed),'--root',root]);
 check(c.id+'-uninstall',()=>{exit(removed);for(const m of expected)assert(!fs.existsSync(root+'/bin/'+m.installed));});
 registry(c.id+'-registry-empty',root,[]);
 const empty=run(c.id+'-list-empty',project,[exe,'install','--root',root,'--list']);check(c.id+'-list-empty',()=>{exit(empty);assert.equal(empty.stdout.trim(),'');});
 completed.push(c.id);save();
}
check('all-cases-completed',()=>assert.deepEqual(completed,cases.map(c=>c.id)));
process.exit(checks.some(c=>!c.pass)?1:0);
