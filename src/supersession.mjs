import path from 'node:path';
import {readFile,open,mkdir,rename,rm,realpath,stat,lstat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {atomicJson,readJson,digest,withLock,projectGateFile} from './io.mjs';
import {bindingFile,validateBinding,projectIdentity} from './task-scope.mjs';
import {abortable} from './abort.mjs';

const names=['contract','report','review','context'];
const evidenceLimit=64*1024*1024;
const sameProject=(a,b)=>projectIdentity(a)===projectIdentity(b);
const assert=(condition,message)=>{if(!condition)throw new Error('Scar supersession: '+message);};
const receiptPath=(home,id)=>{
 assert(typeof id==='string'&&/^[a-f0-9]{64}$/.test(id),'invalid receipt identity.');
 return path.join(home,'supersessions',id);
};
const lockAll=(files,operation)=>files.length?withLock(files[0],()=>lockAll(files.slice(1),operation)):operation();

async function readEvidence(flow,project) {
 const files={},values={};let total=0;
 for(const name of names){
  const file=flow.files(project)[name],info=await stat(file);
  total+=info.size;assert(total<=evidenceLimit,'evidence exceeds the archive read budget.');
  const bytes=await readFile(file);
  assert(bytes.length===info.size,'evidence changed while reading.');
  files[name]=bytes;values[name]=JSON.parse(bytes.toString('utf8'));
 }
 return {files,values};
}
async function durableFile(file,bytes) {
 const handle=await open(file,'wx',0o600);
 try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
 assert(digest(await readFile(file))===digest(bytes),'archive write readback differs.');
}
async function writeArchive(home,manifest,evidence) {
 const id=digest(manifest),destination=receiptPath(home,id);
 const previous=await readJson(path.join(destination,'manifest.json'),null,{maxBytes:64*1024});
 if(previous){
  assert(digest(previous)===id,'existing archive manifest differs.');
  for(const [name,bytes]of Object.entries(evidence)){
   const file=path.join(destination,name),info=await lstat(file);
   assert(info.isFile()&&!info.isSymbolicLink()&&info.size===bytes.length,'existing archive evidence differs.');
   assert((await readFile(file)).equals(bytes),'existing archive evidence hash differs.');
  }
  return {receiptId:id,successorProject:manifest.successor.project,successorRunId:manifest.successor.runId};
 }
 assert(Object.values(evidence).reduce((sum,bytes)=>sum+bytes.length,0)<=evidenceLimit,'combined evidence exceeds the archive budget.');
 const parent=path.dirname(destination);await mkdir(parent,{recursive:true});
 const stage=path.join(parent,'.'+randomUUID()+'.pending');await mkdir(stage,{mode:0o700});
 try{
  for(const [name,bytes]of Object.entries(evidence))await durableFile(path.join(stage,name),bytes);
  await durableFile(path.join(stage,'manifest.json'),Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
  await rename(stage,destination);
 }finally{await rm(stage,{recursive:true,force:true});}
 return {receiptId:id,successorProject:manifest.successor.project,successorRunId:manifest.successor.runId};
}
export async function validateSupersession(home,reference,entry,binding,io={}) {
 assert(reference&&typeof reference==='object','missing archive reference.');
 const folder=receiptPath(home,reference.receiptId);
 const manifest=await readJson(path.join(folder,'manifest.json'),null,{...io,maxBytes:64*1024});
 assert(manifest?.schema===1&&digest(manifest)===reference.receiptId,'archive manifest is missing or changed.');
 assert(sameProject(manifest.source.project,entry.project)&&manifest.source.runId===entry.runId,'archive source generation differs.');
 assert(sameProject(manifest.successor.project,reference.successorProject)&&manifest.successor.runId===reference.successorRunId,'archive replacement differs.');
 assert(manifest.sessionId===binding.sessionId&&manifest.hostProject===binding.hostProject,'archive belongs to another scope.');
 assert(binding.projects.some(p=>sameProject(p.project,reference.successorProject)),'replacement is no longer bound to this chat.');
 const expected=names.flatMap(name=>['source-'+name+'.json','successor-'+name+'.json']).sort();
 assert(JSON.stringify(Object.keys(manifest.files??{}).sort())===JSON.stringify(expected),'archive evidence coverage differs.');
 let total=0;
 for(const name of expected){
  const record=manifest.files[name];total+=record?.bytes;
  assert(Number.isSafeInteger(record?.bytes)&&record.bytes>=0&&total<=evidenceLimit,'archive size budget is invalid.');
  const file=path.join(folder,name),info=await abortable(()=>lstat(file),io.signal);
  assert(info.isFile()&&!info.isSymbolicLink()&&info.size===record.bytes,'archive evidence is missing or resized.');
  const bytes=await abortable(()=>readFile(file,{signal:io.signal}),io.signal);
  assert(digest(bytes)===record.sha256,'archive evidence hash differs.');
 }
 return manifest;
}
export async function supersede(flow,project,options) {
 assert(flow.sessionId&&flow.hostProject,'explicit session and host scope are required.');
 assert(options&&typeof options.reason==='string'&&options.reason.trim().length>=20,'a substantive reason is required.');
 assert(typeof project==='string'&&path.isAbsolute(project)&&typeof options.successorProject==='string'&&path.isAbsolute(options.successorProject),'absolute projects are required.');
 const source=await realpath(project),successor=await realpath(options.successorProject);
 assert(!sameProject(source,successor),'replacement must be a different canonical project.');
 for(const name of ['expectedRunId','expectedBinding','expectedSuccessorRunId','expectedSuccessorBinding'])assert(typeof options[name]==='string'&&options[name].length>0,'expected generation and binding pins are required.');
 const file=bindingFile(flow.home,flow.hostProject,flow.sessionId);
 return await withLock(file+'.lock',async()=>{
  const binding=await readJson(file,null);assert(binding,'both projects must be bound in this scope.');
  validateBinding(binding,flow.hostProject,flow.sessionId);
  const old=binding.projects.find(p=>sameProject(p.project,source)),next=binding.projects.find(p=>sameProject(p.project,successor));
  assert(old&&next,'both projects must be bound in this scope.');
  assert(old.runId===options.expectedRunId&&next.runId===options.expectedSuccessorRunId,'bound generation differs.');
  const oldGateFile=projectGateFile(flow.home,source,flow.sessionId),nextGateFile=projectGateFile(flow.home,successor,flow.sessionId);
  const locks=[oldGateFile+'.lock',nextGateFile+'.lock',flow.files(source).lock,flow.files(successor).lock].sort();
  return await lockAll(locks,async()=>{
   const oldGate=await readJson(oldGateFile,null),nextGate=await readJson(nextGateFile,null);
   assert(oldGate?.schema===1&&oldGate.runId===old.runId&&typeof oldGate.active==='boolean','source gate generation differs.');
   assert(nextGate?.schema===1&&nextGate.active===true&&nextGate.runId===next.runId&&!next.supersession,'replacement must retain its active generation gate.');
   const result=await flow.status(successor);assert(result.status==='READY','replacement must be fresh READY.');
   assert(result.binding===options.expectedSuccessorBinding,'replacement binding differs.');
   const a=await readEvidence(flow,source),b=await readEvidence(flow,successor);
   assert(a.values.contract?.runId===old.runId&&b.values.contract?.runId===next.runId,'contract generation differs.');
   assert(a.values.contract.sessionId===flow.sessionId&&b.values.contract.sessionId===flow.sessionId,'contract scope differs.');
   assert(a.values.report?.binding===options.expectedBinding,'historical report binding differs.');
   assert(Array.isArray(a.values.report.checks)&&Array.isArray(a.values.report.classes)&&typeof a.values.review?.reason==='string','original report/review evidence is invalid.');
   const sourceBinding=await flow.binding(source),successorBinding=await flow.binding(successor);
   if(a.values.report.runId!==undefined||a.values.report.contractDigest!==undefined){
    assert(a.values.report.runId===old.runId&&a.values.report.contractDigest===digest(a.values.contract),'original report belongs to another contract generation.');
   }else assert(a.values.report.binding===sourceBinding.binding,'legacy report does not prove the current contract generation.');
   assert(a.values.review.binding===a.values.report.binding,'original learning review belongs to another report binding.');
   const originalChecks=a.values.contract.checks.map(c=>c.id);
   assert(originalChecks.length>0&&new Set(originalChecks).size===originalChecks.length,'original check coverage is invalid.');
   assert(originalChecks.every(id=>a.values.report.checks.some(c=>c.id===id)),'original report is missing configured check evidence.');
   for(const id of originalChecks)assert(b.values.contract.checks.some(c=>c.id===id)&&b.values.report.checks.some(c=>c.id===id&&c.status==='PASS'),'replacement check coverage is missing '+id+'.');
   for(const id of a.values.report.classes)assert(b.values.report.classes.includes(id),'replacement class coverage is missing '+id+'.');
   const request={source:source,successor:successor,expectedRunId:options.expectedRunId,expectedBinding:options.expectedBinding,expectedSuccessorRunId:options.expectedSuccessorRunId,expectedSuccessorBinding:options.expectedSuccessorBinding,reason:options.reason.trim()};
   if(old.supersession){
    const manifest=await validateSupersession(flow.home,old.supersession,old,binding);
    assert(digest(manifest.request)===digest(request),'a different supersession request already exists.');
    for(const name of names)assert(manifest.files['source-'+name+'.json'].sha256===digest(a.files[name]),'original evidence changed since the pending receipt.');
    assert(manifest.source.observedSourceBinding===sourceBinding.binding,'source binding changed since the pending receipt.');
    if(oldGate.active===false){
     assert(oldGate.disposition==='SUPERSEDED'&&digest(oldGate.supersession)===digest(old.supersession),'closed source gate has no matching receipt.');
     return {status:'SUPERSEDED',project:source,...old.supersession};
    }
    await atomicJson(oldGateFile,{schema:1,active:false,runId:old.runId,disposition:'SUPERSEDED',supersession:old.supersession},{durable:true});
    return {status:'SUPERSEDED',project:source,...old.supersession};
   }
   assert(oldGate.active===true&&!oldGate.supersession,'source is not an active replaceable task.');
   const evidence={};
   for(const name of names){evidence['source-'+name+'.json']=a.files[name];evidence['successor-'+name+'.json']=b.files[name];}
   const manifest={schema:1,sessionId:flow.sessionId,hostProject:flow.hostProject,request,
    source:{project:source,runId:old.runId,reportBinding:options.expectedBinding,observedSourceBinding:sourceBinding.binding,reportStatus:a.values.report.status},
    successor:{project:successor,runId:next.runId,binding:successorBinding.binding,status:'READY'},
    files:Object.fromEntries(Object.entries(evidence).map(([name,bytes])=>[name,{bytes:bytes.length,sha256:digest(bytes)}]))};
   assert(successorBinding.binding===result.binding,'replacement binding changed while archiving.');
   const reference=await writeArchive(flow.home,manifest,evidence);
   assert((await flow.binding(source)).binding===sourceBinding.binding,'source changed while archiving.');
   assert((await flow.status(successor)).status==='READY'&&(await flow.binding(successor)).binding===result.binding,'replacement lost fresh READY while archiving.');
   old.supersession=reference;
   await atomicJson(file,binding,{durable:true});
   await atomicJson(oldGateFile,{schema:1,active:false,runId:old.runId,disposition:'SUPERSEDED',supersession:reference},{durable:true});
   return {status:'SUPERSEDED',project:source,...reference};
  });
 });
}
