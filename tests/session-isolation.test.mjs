import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {Workflow} from '../src/workflow.mjs';
import {hookEvent} from '../src/hooks.mjs';
import {snapshot} from '../src/workspace-state.mjs';
import {Catalog} from '../src/catalog.mjs';
import {fixture,candidate} from './helpers.mjs';
const check=exit=>({id:'behavior',command:'$NODE',args:['-e','process.exit('+exit+')']});
const prepare=(flow,root,exit=0)=>flow.prepare(root,{task:'Isolated behavior',checks:[check(exit)]});
const review=(flow,root)=>flow.review(root,'Reviewed session ownership and real executable checks.');
const event=(cwd,id,name)=>({cwd,session_id:id,hook_event_name:name});

test('two chats in one project retain separate checks and cannot close each other',async t=>{
 const home=await fixture(t),root=await fixture(t,{'main.ts':'export const value=1;'});
 const a=new Workflow(home,{sessionId:'a',hostProject:root}),b=new Workflow(home,{sessionId:'b',hostProject:root});
 await hookEvent(event(root,'a','SessionStart'),home);await hookEvent(event(root,'b','SessionStart'),home);
 await prepare(a,root);await prepare(b,root,1);await review(a,root);await review(b,root);
 assert.equal((await a.finish(root)).status,'READY');assert.equal((await b.finish(root)).status,'FAIL');
 assert.deepEqual(await hookEvent(event(root,'a','Stop'),home),{});
 assert.equal((await hookEvent(event(root,'b','Stop'),home)).decision,'block');
 assert.notEqual(a.files(root).contract,b.files(root).contract);
});

test('scoped chat in a worktree ignores unrelated legacy host contract without modifying it',async t=>{
 const home=await fixture(t),host=await fixture(t,{'main.ts':'export const host=1;'}),root=await fixture(t,{'main.ts':'export const prototype=1;'});
 const legacy=new Workflow(home);await prepare(legacy,host,1);await review(legacy,host);await legacy.finish(host);
 const before=await readFile(legacy.files(host).contract,'utf8');
 const scoped=new Workflow(home,{sessionId:'prototype',hostProject:host});
 await hookEvent(event(host,'prototype','SessionStart'),home);await prepare(scoped,root);await review(scoped,root);assert.equal((await scoped.finish(root)).status,'READY');
 assert.deepEqual(await hookEvent(event(host,'prototype','Stop'),home),{});
 assert.equal(await readFile(legacy.files(host).contract,'utf8'),before);
 await hookEvent(event(host,'old-HH','SessionStart'),home);assert.equal((await hookEvent(event(host,'old-HH','Stop'),home)).decision,'block');
});

test('one chat requires fresh READY from every prepared project and changed source revokes it',async t=>{
 const home=await fixture(t),host=await fixture(t),one=await fixture(t,{'a.ts':'export const a=1;'}),two=await fixture(t,{'b.ts':'export const b=1;'});
 const flow=new Workflow(home,{sessionId:'many',hostProject:host});await hookEvent(event(host,'many','SessionStart'),home);
 await prepare(flow,one);await review(flow,one);await flow.finish(one);await prepare(flow,two,1);await review(flow,two);await flow.finish(two);
 assert.equal((await hookEvent(event(host,'many','Stop'),home)).decision,'block');
 await prepare(flow,two);await review(flow,two);assert.equal((await flow.finish(two)).status,'READY');
 await writeFile(path.join(one,'a.ts'),'export const a=2;');assert.equal((await hookEvent(event(host,'many','Stop'),home)).decision,'block');
 await review(flow,one);await flow.finish(one);assert.deepEqual(await hookEvent(event(host,'many','Stop'),home),{});
});

test('durable session binding survives SessionEnd and deleted project evidence fails closed',async t=>{
 const home=await fixture(t),host=await fixture(t),root=await fixture(t,{'a.ts':'export const a=1;'});
 const flow=new Workflow(home,{sessionId:'restart',hostProject:host});await hookEvent(event(host,'restart','SessionStart'),home);await prepare(flow,root);
 await hookEvent(event(host,'restart','SessionEnd'),home);await rm(path.join(root,'.scar'),{recursive:true,force:true});
 await hookEvent(event(host,'restart','SessionStart'),home);assert.equal((await hookEvent(event(host,'restart','Stop'),home)).decision,'block');
});

test('scoped evidence does not stale source but actual code under reserved directory remains scanned',async t=>{
 const home=await fixture(t),root=await fixture(t,{'main.ts':'export const a=1;'});const flow=new Workflow(home,{sessionId:'scan',hostProject:root});
 await prepare(flow,root);await review(flow,root);assert.equal((await flow.finish(root)).status,'READY');
 const before=(await snapshot(root)).fingerprint;await writeFile(flow.files(root).report,await readFile(flow.files(root).report));assert.equal((await snapshot(root)).fingerprint,before);
 await writeFile(path.join(path.dirname(flow.files(root).report),'actual.ts'),'try {} catch {}');
 assert.equal((await flow.finish(root)).status,'FAIL');
});

test('session IDs and host paths are validated, not interpolated into filenames',async t=>{
 const home=await fixture(t);assert.throws(()=>new Workflow(home,{sessionId:''}),/session/i);
 assert.throws(()=>new Workflow(home,{sessionId:'chat',hostProject:'relative'}),/absolute/i);
});

test('shared learned catalog and fixtures survive removing a scoped worktree',async t=>{
 const home=await fixture(t),first=await fixture(t,{'a.ts':'const a=1;'}),second=await fixture(t,{'config.js':'const config={debug:true};'});
 const catalog=new Catalog(home);await catalog.learn(candidate,(await catalog.read()).revision);const revision=(await catalog.read()).revision;
 const one=new Workflow(home,{sessionId:'one',hostProject:first});await prepare(one,first);await rm(first,{recursive:true,force:true});
 const two=new Workflow(home,{sessionId:'two',hostProject:second});await prepare(two,second);const result=await two.verify(second);
 assert.equal((await catalog.read()).revision,revision);assert.equal(result.status,'FAIL');assert.ok(result.findings.some(f=>f.id===candidate.id));
});

test('removing a completed worktree keeps chat closure and catalog but unfinished removal blocks',async t=>{
 const home=await fixture(t),host=await fixture(t),root=await fixture(t,{'a.ts':'export const a=1;'});
 const flow=new Workflow(home,{sessionId:'archived',hostProject:host});
 await hookEvent(event(host,'archived','SessionStart'),home);await prepare(flow,root);await review(flow,root);await flow.finish(root);
 assert.deepEqual(await hookEvent(event(host,'archived','Stop'),home),{});
 const before=(await flow.catalog.read()).revision;
 await rm(root,{recursive:true,force:true});
 assert.deepEqual(await hookEvent(event(host,'archived','Stop'),home),{});
 assert.equal((await flow.catalog.read()).revision,before);
 const pending=await fixture(t,{'pending.ts':'export const pending=1;'});
 await prepare(flow,pending);await rm(pending,{recursive:true,force:true});
 assert.equal((await hookEvent(event(host,'archived','Stop'),home)).decision,'block');
});


test('real bundled pooled MCP preserves explicit chat scope and native Stop follows its worktree',async t=>{
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');const {StdioClientTransport}=await import('@modelcontextprotocol/sdk/client/stdio.js');const {runCheck}=await import('../src/process.mjs');
 const home=await fixture(t),host=await fixture(t,{'host.ts':'export const host=1;'}),root=await fixture(t,{'main.ts':'export const a=1;'});
 const legacy=new Workflow(home);await prepare(legacy,host,1);await review(legacy,host);await legacy.finish(host);const legacyBefore=await readFile(legacy.files(host).contract,'utf8');
 const client=new Client({name:'scar-scope-test',version:'1.0'}),transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/mcp.cjs')],env:{...process.env,SCAR_HOME:home},stderr:'pipe'});t.after(()=>client.close());await client.connect(transport);
 const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});assert.notEqual(r.isError,true,JSON.stringify(r));return JSON.parse(r.content[0].text)};
 const native=async(id,name)=>{const r=await runCheck({id:'native',command:'$NODE',args:[path.resolve('dist/hook.cjs')],timeoutMs:12000},host,JSON.stringify(event(host,id,name)),{SCAR_HOME:home});assert.equal(r.status,'PASS',r.stderr);return JSON.parse(r.stdout)};
 const a={project:root,sessionId:'proto',hostProject:host},b={project:root,sessionId:'HH',hostProject:host};
 const start=await native('proto','SessionStart');assert.match(start.hookSpecificOutput.additionalContext,/Host chat scope/);await native('HH','SessionStart');
 await call('scar_prepare',{...a,task:'Prototype',checks:[check(0)]});await call('scar_prepare',{...b,task:'Other chat',checks:[check(1)]});
 await call('scar_review',{...a,reason:'Reviewed native session isolation and actual executable boundary.'});assert.equal((await call('scar_finish',a)).status,'READY');
 await call('scar_review',{...b,reason:'Reviewed failing behavior for an independent parallel session.'});assert.equal((await call('scar_finish',b)).status,'FAIL');
 assert.deepEqual(await native('proto','Stop'),{});assert.equal((await native('HH','Stop')).decision,'block');
 const details=await call('scar_details',{...a,section:'checks'});assert.equal(details.entries[0].status,'PASS');
 // Older unscoped tools still cannot overwrite the scoped report.
 await call('scar_prepare',{project:root,task:'Legacy pool',checks:[check(1)]});await call('scar_finish',{project:root});assert.equal((await call('scar_status',a)).status,'READY');
 assert.equal(await readFile(legacy.files(host).contract,'utf8'),legacyBefore);
 const invalid=await client.callTool({name:'scar_status',arguments:{project:root,sessionId:''}});assert.equal(invalid.isError,true);
});

test('actual CLI scoped flags prepare worktree ownership consumed by native hook',async t=>{
 const {runCheck}=await import('../src/process.mjs');const home=await fixture(t),host=await fixture(t),root=await fixture(t,{'main.ts':'export const a=1;'});
 const contract=path.join(home,'input.json');await writeFile(contract,JSON.stringify({task:'CLI scoped task',checks:[check(0)]}));
 const flags=['--home',home,'--session','cli-chat','--host-project',host];
 for(const [operation,extra]of [['prepare',['--contract',contract]],['review',['--reason','Reviewed exact CLI, native Stop and project evidence boundaries.']],['finish',[]]]){
  const r=await runCheck({id:operation,command:'$NODE',args:[path.resolve('dist/cli.cjs'),operation,root,...flags,...extra]},root);assert.equal(r.status,'PASS',r.stderr);
 }
 await hookEvent(event(host,'cli-chat','SessionStart'),home);assert.deepEqual(await hookEvent(event(host,'cli-chat','Stop'),home),{});
 const missing=await runCheck({id:'invalid',command:'$NODE',args:[path.resolve('dist/cli.cjs'),'status',root,'--home',home,'--session']},root);assert.equal(missing.status,'FAIL');
});

test('catalog changes invalidate every unfinished scoped task, not just the last writer',async t=>{
 const home=await fixture(t),root=await fixture(t,{'a.ts':'export const a=1;'});const a=new Workflow(home,{sessionId:'a',hostProject:root}),b=new Workflow(home,{sessionId:'b',hostProject:root});
 for(const flow of [a,b]){await prepare(flow,root);await review(flow,root);assert.equal((await flow.finish(root)).status,'READY');}
 const catalog=new Catalog(home);await catalog.learn(candidate,(await catalog.read()).revision);
 assert.equal((await a.status(root)).status,'STALE');assert.equal((await b.status(root)).status,'STALE');
});

test('changed or missing scoped contracts cannot borrow a legacy READY',async t=>{
 const home=await fixture(t),root=await fixture(t,{'a.ts':'export const a=1;'}),legacy=new Workflow(home);await prepare(legacy,root);await review(legacy,root);await legacy.finish(root);
 const scoped=new Workflow(home,{sessionId:'scoped',hostProject:root});await hookEvent(event(root,'scoped','SessionStart'),home);await prepare(scoped,root);await review(scoped,root);await scoped.finish(root);
 const contract=JSON.parse(await readFile(scoped.files(root).contract,'utf8'));contract.runId='changed';await writeFile(scoped.files(root).contract,JSON.stringify(contract));
 assert.equal((await hookEvent(event(root,'scoped','Stop'),home)).decision,'block');await rm(scoped.files(root).contract);assert.equal((await hookEvent(event(root,'scoped','Stop'),home)).decision,'block');
 assert.equal((await legacy.status(root)).status,'READY');
});


test('closing one session does not hold the other chat gate or close its new generation',async t=>{
 const {default:fs}=await import('node:fs/promises'),{syncBuiltinESMExports}=await import('node:module'),{projectGateFile}=await import('../src/io.mjs');
 const home=await fixture(t),root=await fixture(t,{'a.ts':'export const a=1;'});const a=new Workflow(home,{sessionId:'a',hostProject:root}),b=new Workflow(home,{sessionId:'b',hostProject:root});
 await hookEvent(event(root,'a','SessionStart'),home);await prepare(a,root);await review(a,root);await a.finish(root);
 const gate=projectGateFile(home,await fs.realpath(root),'a'),original=fs.rename;let release,entered;
 const pause=new Promise(resolve=>{release=resolve}),reached=new Promise(resolve=>{entered=resolve});
 fs.rename=async(from,to)=>{if(to===gate&&JSON.parse(await readFile(from,'utf8')).active===false){entered();await pause;}return original(from,to)};syncBuiltinESMExports();
 try{
  const stopping=hookEvent(event(root,'a','Stop'),home);await reached;
  await prepare(b,root,1);release();assert.deepEqual(await stopping,{});
  assert.equal(JSON.parse(await readFile(projectGateFile(home,await fs.realpath(root),'b'),'utf8')).active,true);
  await hookEvent(event(root,'b','SessionStart'),home);assert.equal((await hookEvent(event(root,'b','Stop'),home)).decision,'block');
 }finally{release();fs.rename=original;syncBuiltinESMExports();}
});

test('same chat cannot replace a generation while old Stop commits its closure',async t=>{
 const {default:fs}=await import('node:fs/promises'),{syncBuiltinESMExports}=await import('node:module'),{projectGateFile}=await import('../src/io.mjs');
 const home=await fixture(t),root=await fixture(t,{'a.ts':'export const a=1;'});const flow=new Workflow(home,{sessionId:'a',hostProject:root});
 await hookEvent(event(root,'a','SessionStart'),home);await prepare(flow,root);await review(flow,root);await flow.finish(root);
 const gate=projectGateFile(home,await fs.realpath(root),'a'),original=fs.rename;let release,entered;
 const pause=new Promise(resolve=>{release=resolve}),reached=new Promise(resolve=>{entered=resolve});
 fs.rename=async(from,to)=>{if(to===gate&&JSON.parse(await readFile(from,'utf8')).active===false){entered();await pause;}return original(from,to)};syncBuiltinESMExports();
 try{const stopping=hookEvent(event(root,'a','Stop'),home);await reached;await assert.rejects(()=>prepare(flow,root),/lock/i);release();await stopping;await prepare(flow,root);assert.equal((await hookEvent(event(root,'a','Stop'),home)).decision,'block');}
 finally{release();fs.rename=original;syncBuiltinESMExports();}
});

test('project aliases canonicalize within a session and do not duplicate or reuse generations',async t=>{
 const {default:fs}=await import('node:fs/promises');const home=await fixture(t),root=await fixture(t,{'a.ts':'export const a=1;'}),host=await fixture(t);
 let alias;if(process.platform==='win32')alias=root.toUpperCase();else{alias=path.join(await fixture(t),'alias');await fs.symlink(root,alias,'dir');}
 const flow=new Workflow(home,{sessionId:'alias',hostProject:host});await hookEvent(event(host,'alias','SessionStart'),home);
 await prepare(flow,alias);await review(flow,root);assert.equal((await flow.finish(root)).status,'READY');assert.deepEqual(await hookEvent(event(host,'alias','Stop'),home),{});
 await prepare(flow,root);assert.equal((await hookEvent(event(host,'alias','Stop'),home)).decision,'block');
});
