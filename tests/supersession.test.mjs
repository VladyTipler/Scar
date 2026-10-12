import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import {Workflow} from '../src/workflow.mjs';
import {hookEvent} from '../src/hooks.mjs';
import {bindingFile,projectIdentity} from '../src/task-scope.mjs';
import {projectGateFile,digest} from '../src/io.mjs';
import {fixture} from './helpers.mjs';

const reason='Reviewed replacement fixes the old behavior and preserves all required checks.';
const check=(exit,id='behavior')=>({id,command:'$NODE',args:['-e','process.exit('+exit+')']});
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const native=(root,id)=>({cwd:root,session_id:id,hook_event_name:'Stop'});

async function setup(t,options={}) {
 const home=await fixture(t),host=await fixture(t);
 const old=await realpath(await fixture(t,{'main.ts':'try { work(); } catch {}'}));
 const next=await realpath(await fixture(t,options.nextFiles??{'main.ts':'export const fixed=1;'}));
 const sessionId='supersession',flow=new Workflow(home,{sessionId,hostProject:host});
 await hookEvent({...native(host,sessionId),hook_event_name:'SessionStart'},home);
 await flow.prepare(old,{task:'Original observable behavior',checks:[check(1),...(options.oldExtra??[])]});
 await flow.review(old,reason);assert.equal((await flow.finish(old)).status,'FAIL');
 await flow.prepare(next,{task:'Replacement observable behavior',checks:options.nextChecks??[check(0)]});
 await flow.review(next,reason);
 const result=await flow.finish(next);
 const oldContract=await json(flow.files(old).contract),oldReport=await json(flow.files(old).report);
 const newContract=await json(flow.files(next).contract),newReport=await json(flow.files(next).report);
 const request={successorProject:next,expectedRunId:oldContract.runId,expectedBinding:oldReport.binding,expectedSuccessorRunId:newContract.runId,expectedSuccessorBinding:newReport.binding,reason};
 return {home,host,old,next,flow,sessionId,request,result};
}
async function bytes(flow,root) {
 const out={};for(const name of ['contract','report','review','context'])out[name]=await readFile(flow.files(root)[name]);return out;
}
const oldGate=x=>projectGateFile(x.home,x.old,x.sessionId);

test('explicit supersession retains failed bytes and binding while active replacement still controls Stop',async t=>{
 const x=await setup(t),before=await bytes(x.flow,x.old);
 assert.equal((await hookEvent(native(x.host,x.sessionId),x.home)).decision,'block');
 assert.equal(typeof x.flow.supersede,'function','explicit supersession is missing');
 const result=await x.flow.supersede(x.old,x.request);
 assert.equal(result.status,'SUPERSEDED');assert.notEqual(result.status,'READY');
 assert.deepEqual(await bytes(x.flow,x.old),before);
 assert.equal((await x.flow.status(x.old)).status,'FAIL');
 const gate=await json(oldGate(x));assert.equal(gate.active,false);assert.equal(gate.disposition,'SUPERSEDED');
 const binding=await json(bindingFile(x.home,x.host,x.sessionId));
 assert.equal(binding.projects.length,2);assert.ok(binding.projects.some(p=>projectIdentity(p.project)===projectIdentity(x.old)));
 const manifest=await json(path.join(x.home,'supersessions',result.receiptId,'manifest.json'));
 assert.equal(manifest.source.reportStatus,'FAIL');
 for(const [name,data]of Object.entries(before))assert.deepEqual(await readFile(path.join(x.home,'supersessions',result.receiptId,'source-'+name+'.json')),data);
 assert.equal(manifest.files['source-report.json'].sha256,digest(before.report));
 await writeFile(path.join(x.next,'main.ts'),'export const fixed=2;');
 assert.equal((await hookEvent(native(x.host,x.sessionId),x.home)).decision,'block');
 await x.flow.review(x.next,reason);await x.flow.finish(x.next);
 assert.deepEqual(await hookEvent(native(x.host,x.sessionId),x.home),{});
});

test('stale and failed replacements cannot retire an active failed task',async t=>{
 for(const mode of ['stale','failed']){
  const x=await setup(t,mode==='failed'?{nextChecks:[check(1)]}:{});
  if(mode==='stale')await writeFile(path.join(x.next,'main.ts'),'export const fixed=3;');
  await assert.rejects(()=>x.flow.supersede(x.old,x.request),/READY/);
  assert.equal((await json(oldGate(x))).active,true);
 }
});

test('generation and report binding pins reject changed or foreign evidence',async t=>{
 const x=await setup(t);
 for(const key of ['expectedRunId','expectedBinding','expectedSuccessorRunId','expectedSuccessorBinding']){
  await assert.rejects(()=>x.flow.supersede(x.old,{...x.request,[key]:'wrong'}),/generation|binding/i);
 }
 const other=new Workflow(x.home,{sessionId:'other',hostProject:x.host});
 await assert.rejects(()=>other.supersede(x.old,x.request),/bound|binding|scope/i);
 assert.equal((await json(oldGate(x))).active,true);
});

test('supersession requires explicit host/chat scope, a different project and substantive reason',async t=>{
 const x=await setup(t);
 await assert.rejects(()=>new Workflow(x.home).supersede(x.old,x.request),/scope|session/i);
 await assert.rejects(()=>new Workflow(x.home,{sessionId:x.sessionId}).supersede(x.old,x.request),/host|scope/i);
 await assert.rejects(()=>x.flow.supersede(x.old,{...x.request,successorProject:x.old}),/different/i);
 await assert.rejects(()=>x.flow.supersede(x.old,{...x.request,reason:''}),/reason/i);
});

test('replacement cannot silently lose check IDs or applicable class IDs',async t=>{
 const checks=await setup(t,{oldExtra:[check(0,'receipt')]});
 await assert.rejects(()=>checks.flow.supersede(checks.old,checks.request),/check.*receipt|coverage/i);
 const classes=await setup(t,{nextFiles:{'README.md':'No executable native protection.'}});
 await assert.rejects(()=>classes.flow.supersede(classes.old,classes.request),/class|coverage/i);
});

test('missing original report or review fails closed without retiring the gate',async t=>{
 for(const name of ['report','review']){
  const x=await setup(t);await rm(x.flow.files(x.old)[name]);
  await assert.rejects(()=>x.flow.supersede(x.old,x.request),/evidence|ENOENT|review|report/i);
  assert.equal((await json(oldGate(x))).active,true);
 }
});

test('unchanged exact retry is idempotent and a different transition is rejected',async t=>{
 const x=await setup(t),first=await x.flow.supersede(x.old,x.request),gate=await readFile(oldGate(x));
 assert.equal((await x.flow.supersede(x.old,x.request)).receiptId,first.receiptId);
 assert.deepEqual(await readFile(oldGate(x)),gate);
 await assert.rejects(()=>x.flow.supersede(x.old,{...x.request,reason:reason+' Different request.'}),/different|receipt|supersed/i);
});

test('retired archive tampering or deletion still blocks native Stop',async t=>{
 for(const mode of ['tamper','delete']){
  const x=await setup(t),r=await x.flow.supersede(x.old,x.request);
  const report=path.join(x.home,'supersessions',r.receiptId,'source-report.json');
  if(mode==='tamper')await writeFile(report,'{}');else await rm(report);
  const stopped=await hookEvent(native(x.host,x.sessionId),x.home);
  assert.equal(stopped.decision,'block');assert.match(stopped.reason,/supersession|archive|receipt/i);
 }
});

test('preparing the old root again creates an active generation without deleting its historical receipt',async t=>{
 const x=await setup(t),r=await x.flow.supersede(x.old,x.request);
 await x.flow.prepare(x.old,{task:'New independent work',checks:[check(1)]});
 const gate=await json(oldGate(x));assert.equal(gate.active,true);assert.notEqual(gate.runId,x.request.expectedRunId);
 assert.equal((await json(path.join(x.home,'supersessions',r.receiptId,'manifest.json'))).source.runId,x.request.expectedRunId);
 assert.equal((await hookEvent(native(x.host,x.sessionId),x.home)).decision,'block');
});

test('live verification ownership refuses supersession and preserves both gates',async t=>{
 const x=await setup(t);await writeFile(x.flow.files(x.next).lock,JSON.stringify({pid:process.pid}));
 await assert.rejects(()=>x.flow.supersede(x.old,x.request),/lock/i);
 assert.equal((await json(oldGate(x))).active,true);
});

test('partial binding-to-gate commit remains blocked and exact retry resumes the retained receipt',async t=>{
 const x=await setup(t),{default:fs}=await import('node:fs/promises'),{syncBuiltinESMExports}=await import('node:module');
 const original=fs.rename;let fail=true;
 fs.rename=async(from,to)=>{if(to===oldGate(x)&&fail){fail=false;throw new Error('Injected gate commit failure');}return original(from,to);};
 syncBuiltinESMExports();
 try{await assert.rejects(()=>x.flow.supersede(x.old,x.request),/Injected/);}finally{fs.rename=original;syncBuiltinESMExports();}
 assert.equal((await json(oldGate(x))).active,true);
 const pending=await json(bindingFile(x.home,x.host,x.sessionId));
 const reference=pending.projects.find(p=>projectIdentity(p.project)===projectIdentity(x.old)).supersession;
 assert.ok(reference,'durable pending receipt must precede gate closure');
 assert.equal((await hookEvent(native(x.host,x.sessionId),x.home)).decision,'block');
 assert.equal((await x.flow.supersede(x.old,x.request)).receiptId,reference.receiptId);
 assert.deepEqual(await hookEvent(native(x.host,x.sessionId),x.home),{});
});

test('supersession cannot race same-chat generation preparation',async t=>{
 const x=await setup(t),{default:fs}=await import('node:fs/promises'),{syncBuiltinESMExports}=await import('node:module');
 const original=fs.rename;let reached,release;
 const entered=new Promise(r=>{reached=r;}),pause=new Promise(r=>{release=r;});
 fs.rename=async(from,to)=>{if(to===oldGate(x)){reached();await pause;}return original(from,to);};syncBuiltinESMExports();
 try{
  const retiring=x.flow.supersede(x.old,x.request);await Promise.race([entered,retiring]);
  await assert.rejects(()=>x.flow.prepare(x.next,{task:'Concurrent generation',checks:[check(0)]}),/lock/i);
  release();assert.equal((await retiring).status,'SUPERSEDED');
 }finally{release();fs.rename=original;syncBuiltinESMExports();}
});

test('archive committed before a failed binding write is reused without overwriting history',async t=>{
 const x=await setup(t),{default:fs}=await import('node:fs/promises'),{syncBuiltinESMExports}=await import('node:module');
 const file=bindingFile(x.home,x.host,x.sessionId),before=await readFile(file),original=fs.rename;let fail=true;
 fs.rename=async(from,to)=>{if(to===file&&fail){fail=false;throw new Error('Injected binding commit failure');}return original(from,to);};syncBuiltinESMExports();
 try{await assert.rejects(()=>x.flow.supersede(x.old,x.request),/Injected/);}finally{fs.rename=original;syncBuiltinESMExports();}
 assert.deepEqual(await readFile(file),before);assert.equal((await json(oldGate(x))).active,true);
 const archives=await fs.readdir(path.join(x.home,'supersessions'));assert.equal(archives.length,1);
 const manifest=await readFile(path.join(x.home,'supersessions',archives[0],'manifest.json'));
 const recovered=await x.flow.supersede(x.old,x.request);assert.equal(recovered.receiptId,archives[0]);
 assert.deepEqual(await readFile(path.join(x.home,'supersessions',archives[0],'manifest.json')),manifest);
});

test('a newly prepared generation cannot borrow a previous failed report or learning review',async t=>{
 const x=await setup(t);
 await x.flow.prepare(x.old,{task:'Unverified new generation',checks:[check(1)]});
 const contract=await json(x.flow.files(x.old).contract);
 await assert.rejects(()=>x.flow.supersede(x.old,{...x.request,expectedRunId:contract.runId}),/generation|contract|review/i);
 assert.equal((await json(oldGate(x))).active,true);
});

test('pending recovery rejects source changes after its immutable receipt was recorded',async t=>{
 const x=await setup(t),{default:fs}=await import('node:fs/promises'),{syncBuiltinESMExports}=await import('node:module'),original=fs.rename;let fail=true;
 fs.rename=async(from,to)=>{if(to===oldGate(x)&&fail){fail=false;throw new Error('Injected gate commit failure');}return original(from,to);};syncBuiltinESMExports();
 try{await assert.rejects(()=>x.flow.supersede(x.old,x.request),/Injected/);}finally{fs.rename=original;syncBuiltinESMExports();}
 await writeFile(path.join(x.old,'main.ts'),'try { changed(); } catch {}');
 await assert.rejects(()=>x.flow.supersede(x.old,x.request),/source.*changed|source.*binding/i);
 assert.equal((await json(oldGate(x))).active,true);
});

test('legacy failed evidence is accepted only when its full current binding proves this generation',async t=>{
 for(const reprepare of [false,true]){
  const x=await setup(t),report=await json(x.flow.files(x.old).report);
  delete report.runId;delete report.contractDigest;await writeFile(x.flow.files(x.old).report,JSON.stringify(report));
  if(reprepare){
   await x.flow.prepare(x.old,{task:'A later unverified generation',checks:[check(1)]});
   x.request.expectedRunId=(await json(x.flow.files(x.old).contract)).runId;
   await assert.rejects(()=>x.flow.supersede(x.old,x.request),/legacy.*generation/i);
  }else assert.equal((await x.flow.supersede(x.old,x.request)).status,'SUPERSEDED');
 }
});

test('a different learning-review binding cannot approve the archived generation',async t=>{
 const x=await setup(t),review=await json(x.flow.files(x.old).review);
 review.binding='unrelated';await writeFile(x.flow.files(x.old).review,JSON.stringify(review));
 await assert.rejects(()=>x.flow.supersede(x.old,x.request),/review.*binding/i);
});
