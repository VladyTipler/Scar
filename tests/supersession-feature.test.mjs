import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {Workflow} from '../src/workflow.mjs';
import {runCheck} from '../src/process.mjs';
import {fixture} from './helpers.mjs';
const check=exit=>({id:'behavior',command:'$NODE',args:['-e','process.exit('+exit+')']});
const reason='The verified replacement retains the original behavioral checks and native guards.';
const json=async file=>JSON.parse(await readFile(file,'utf8'));
async function setup(t){
 const home=await fixture(t),host=await fixture(t),old=await fixture(t,{'main.ts':'try {} catch {}'}),next=await fixture(t,{'main.ts':'export const valid=1;'});
 const sessionId='boundary',scope={sessionId,hostProject:host},flow=new Workflow(home,scope);
 for(const [root,code]of [[old,1],[next,0]]){await flow.prepare(root,{task:'Observable behavior',checks:[check(code)]});await flow.review(root,reason);await flow.finish(root);}
 const a=await json(flow.files(old).contract),b=await json(flow.files(next).contract),ar=await json(flow.files(old).report),br=await json(flow.files(next).report);
 return {home,host,old,next,flow,scope,request:{successorProject:next,expectedRunId:a.runId,expectedBinding:ar.binding,expectedSuccessorRunId:b.runId,expectedSuccessorBinding:br.binding,reason}};
}
const bin=name=>path.resolve('dist',name+'.cjs');
async function native(x,event){
 const r=await runCheck({id:'native',command:'$NODE',args:[bin('hook')],timeoutMs:15000},x.host,JSON.stringify({cwd:x.host,session_id:x.scope.sessionId,hook_event_name:event}),{SCAR_HOME:x.home});
 assert.equal(r.status,'PASS',r.stderr);return JSON.parse(r.stdout);
}
test('actual bundled CLI supersedes exact failed evidence and native Stop enforces replacement freshness',async t=>{
 const x=await setup(t);await native(x,'SessionStart');assert.equal((await native(x,'Stop')).decision,'block');
 const input=path.join(x.home,'request.json');await writeFile(input,JSON.stringify(x.request));
 const r=await runCheck({id:'supersede',command:'$NODE',args:[bin('cli'),'supersede',x.old,'--record',input,'--home',x.home,'--session',x.scope.sessionId,'--host-project',x.host]},x.host);
 assert.equal(r.status,'PASS',r.stderr);assert.equal(JSON.parse(r.stdout).status,'SUPERSEDED');
 assert.equal((await x.flow.status(x.old)).status,'FAIL');
 await writeFile(path.join(x.next,'main.ts'),'export const valid=2;');assert.equal((await native(x,'Stop')).decision,'block');
 await x.flow.review(x.next,reason);await x.flow.finish(x.next);assert.deepEqual(await native(x,'Stop'),{});
});
test('actual bundled MCP exposes scoped supersession and rejects unscoped or stale replacement',async t=>{
 const x=await setup(t),client=new Client({name:'supersession-test',version:'1'});
 t.after(()=>client.close());
 await client.connect(new StdioClientTransport({command:process.execPath,args:[bin('mcp')],env:{...process.env,SCAR_HOME:x.home},stderr:'pipe'}));
 const listed=(await client.listTools()).tools;assert.ok(listed.some(tool=>tool.name==='scar_supersede'),'MCP supersession tool is missing');
 const missing=await client.callTool({name:'scar_supersede',arguments:{project:x.old,...x.request}});assert.equal(missing.isError,true);
 await writeFile(path.join(x.next,'main.ts'),'export const valid=2;');
 const stale=await client.callTool({name:'scar_supersede',arguments:{project:x.old,...x.scope,...x.request}});assert.equal(stale.isError,true);
 await x.flow.review(x.next,reason);await x.flow.finish(x.next);
 x.request.expectedSuccessorBinding=(await json(x.flow.files(x.next).report)).binding;
 const result=await client.callTool({name:'scar_supersede',arguments:{project:x.old,...x.scope,...x.request}});
 assert.notEqual(result.isError,true,JSON.stringify(result));assert.equal(JSON.parse(result.content[0].text).status,'SUPERSEDED');
 await native(x,'SessionStart');assert.deepEqual(await native(x,'Stop'),{});
});

test('actual bundled CLI rejects a prepared generation borrowing an older report',async t=>{
 const x=await setup(t);
 await x.flow.prepare(x.old,{task:'Unverified next generation',checks:[check(1)]});
 x.request.expectedRunId=(await json(x.flow.files(x.old).contract)).runId;
 const input=path.join(x.home,'request.json');await writeFile(input,JSON.stringify(x.request));
 const result=await runCheck({id:'generation',command:'$NODE',args:[bin('cli'),'supersede',x.old,'--record',input,'--home',x.home,'--session',x.scope.sessionId,'--host-project',x.host]},x.host);
 assert.equal(result.status,'FAIL');assert.match(result.stderr,/generation|contract/i);
});
