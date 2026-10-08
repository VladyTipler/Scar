import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ZCodeProtocolClient } from '../src/zcode-protocol.mjs';
import { bindScarSession } from '../src/zcode-session.mjs';
import { fixture } from './helpers.mjs';

const root = path.resolve(import.meta.dirname, '..');
const entry = process.env.SCAR_ZCODE_HOST;
const exec = promisify(execFile);

// Test-only request injection exercises the SAME host-launched MCP process.
// Its owner/workspace come from the real host env, never fixture-selected IDs.
const proofShim = bundle => `
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const owner=process.env.SCAR_HOST_SESSION_ID,project=process.env.SCAR_HOST_WORKSPACE;
let number=0, pending=new Map(), input='',output='',started=false;
const write=process.stdout.write.bind(process.stdout);
function send(name,args){return new Promise((resolve,reject)=>{const id='proof-'+(++number);pending.set(id,{resolve,reject});process.stdin.emit('data',Buffer.from(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}})+'\\n'));});}
function stop(){const r=cp.spawnSync(process.execPath,[${JSON.stringify(path.join(root, 'dist/hook.cjs'))},'--zcode'],{cwd:project,env:process.env,input:JSON.stringify({cwd:project,session_id:owner,hook_event_name:'Stop'}),encoding:'utf8',timeout:5000});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
async function proof(){try{
 const call=async(name,args)=>{const r=await send(name,args);assert.notEqual(r.isError,true,JSON.stringify(r));return r.structuredContent;};
 await call('scar_prepare',{project,task:'Owned synthetic host proof',mode:'implementation',checks:[{id:'behavior',command:'$NODE',args:['check.cjs']}]});
 assert.equal(stop().decision,'block');
 assert.equal((await call('scar_verify',{project})).status,'FAIL');
 assert.equal((await send('scar_finish',{project})).isError,true);
 assert.equal(fs.readFileSync(path.join(process.env.SCAR_HOME,path.basename(project)+'-count'),'utf8'),'x');
 fs.writeFileSync(path.join(project,'main.ts'),'export const value=1;');
 await call('scar_review',{project,reason:'Reviewed synthetic fix and exact host-owned verification.'});
 assert.equal((await call('scar_finish',{project})).status,'READY');
 assert.equal(fs.readFileSync(path.join(process.env.SCAR_HOME,path.basename(project)+'-count'),'utf8'),'xx');
 assert.equal((await send('scar_finish',{project:process.env.PROOF_FOREIGN})).isError,true);
 assert.deepEqual(stop(),{});
 fs.writeFileSync(process.env.PROOF_MARKER,JSON.stringify({ok:true,owner,pid:process.pid,project,count:2}));
 }catch(e){fs.writeFileSync(process.env.PROOF_MARKER,JSON.stringify({ok:false,owner,error:e.stack}));}}
process.stdout.write=(chunk,...rest)=>{
 const text=String(chunk);output+=text;let n;
 while((n=output.indexOf('\\n'))>=0){const line=output.slice(0,n);output=output.slice(n+1);let r;try{r=JSON.parse(line);}catch{}const p=pending.get(r?.id);if(p){pending.delete(r.id);if(r.error)p.reject(new Error(JSON.stringify(r.error)));else p.resolve(r.result);continue;}write(line+'\\n');if(!started&&r?.result?.tools){started=true;setImmediate(proof);}}
 const callback=rest.at(-1);if(typeof callback==='function')queueMicrotask(callback);
 return true;
};
require(${JSON.stringify(bundle)});
`;

async function logs(home) {
  const directory = path.join(home, '.zcode/cli/log');
  let names; try { names = await readdir(directory); } catch { return []; }
  const result = [];
  for (const name of names.filter(n => n.endsWith('.jsonl'))) {
    for (const line of (await readFile(path.join(directory, name), 'utf8')).split('\n')) {
      try { result.push(JSON.parse(line)); } catch { continue; }
    }
  }
  return result;
}

// Opt-in: the host binary is not shipped with Scar; no model/provider turns.
test('actual ZCode resume launches isolated owner MCPs and completes scripted verification', { skip: !entry, timeout: 45000 }, async t => {
  const base = await fixture(t), home = path.join(base, 'home'), workA = path.join(base, 'project-a'), workB = path.join(base, 'project-b'), catalog = path.join(base, 'catalog');
  for (const dir of [home, workA, workB, catalog]) await mkdir(dir, { recursive: true });
  await mkdir(path.join(home, '.zcode/cli'), { recursive: true });
  await writeFile(path.join(home, '.zcode/cli/config.json'), JSON.stringify({ plugins: { enabled: false }, mcp: { enabled: false, servers: {} }, hooks: { enabled: false }, memory: { enabled: false } }));
  for (const work of [workA, workB]) {
    await writeFile(path.join(work, 'main.ts'), 'try {} catch {}');
    await writeFile(path.join(work, 'check.cjs'), "require('fs').appendFileSync(require('path').join(process.env.SCAR_HOME,require('path').basename(process.cwd())+'-count'),'x');");
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ZCODE_|SCAR_|ANTHROPIC_|OPENAI_|ZAI_)/.test(k)));
  Object.assign(env, { HOME: home, ZCODE_STORAGE_DIR: path.join(home, '.zcode'), ZCODE_SESSION_DB_PATH: path.join(base, 'sessions.sqlite'), ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: process.env.SCAR_ZCODE_PROVIDER_CONFIG, ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: path.join(base, 'personal-provider.json') });
  assert.ok(env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE, 'Opt-in host test requires SCAR_ZCODE_PROVIDER_CONFIG for packaged CLI bootstrap.');
  const protocolOptions = { command: process.execPath, args: [entry, 'app-server', '--cwd', workA], cwd: workA, env,
    onRequest: async r => { if (r.method !== 'session/requestRuntimePreferences') throw new Error('No user/model actions in fixture.'); return { nativeSearchEnhancementsEnabled: false, memoryEnabled: false, askUserQuestionAutoResolutionEnabled: false, modelContextBudgetStrategy: 'preflight-v1' }; }
  };
  const protocol = new ZCodeProtocolClient(protocolOptions);
  t.after(() => protocol.close());
  const created = [];
  for (const work of [workA, workB]) {
    const snapshot = await protocol.request('session/create', { workspace: { workspacePath: work, workspaceKey: work }, mode: 'plan', persistence: 'immediate', titleGenerationEnabled: false, importedHistory: { source: 'claudeCode', title: 'Synthetic host proof', messages: [{ role: 'user', content: 'Synthetic fixture: no model prompt execution.' }] }, mcpServers: [], offPeakToolEnabled: false, dynamicWorkflowEnabled: false });
    created.push(snapshot.session.sessionId);
  }
  assert.notEqual(created[0], created[1]);
  const shim = path.join(base, 'proof.cjs');
  await writeFile(shim, proofShim(path.join(root, 'dist/mcp.cjs')));
  await protocol.close();
  const hosts = [];
  t.after(async () => { for (const h of hosts) await h.close(); });
  const markers = [];
  for (const [index, work] of [workA, workB].entries()) {
    const marker = path.join(base, `proof-${index}.json`); markers.push(marker);
    // Inject fixture-only env after production bridge built its real owner config.
    const privateHost = new ZCodeProtocolClient(protocolOptions); hosts.push(privateHost);
    let active = privateHost;
    const fixtureHost = { async restart() { active = await privateHost.restart(); return this; }, request(method, params) {
      if (method === 'session/resume' && params.mcpServers) {
        const server = params.mcpServers[0];
        server.env.push({ name: 'PROOF_MARKER', value: marker }, { name: 'PROOF_FOREIGN', value: index ? workA : workB });
      }
      return active.request(method, params);
    } };
    const bound = await bindScarSession(fixtureHost, { sessionId: created[index], workspace: work, mcpBundle: shim, scarHome: catalog });
    assert.match(JSON.stringify(bound.snapshot.messages), /Synthetic fixture: no model prompt execution/);
  }
  const rows = [];
  for (const marker of markers) {
    let row; const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try { row = JSON.parse(await readFile(marker, 'utf8')); break; } catch { row = undefined; }
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.ok(row, 'Host-launched proof did not complete'); assert.equal(row.ok, true, row?.error); rows.push(row);
  }
  assert.deepEqual(rows.map(r => r.owner), created);
  assert.notEqual(rows[0].pid, rows[1].pid);
  const events = await logs(home);
  for (const id of created) assert.ok(events.some(r => r.event === 'mcp.server.connected' && r.sessionId === id && r.context.toolCount === 11 && r.context.mcpIsolation === 'session'));
  assert.equal(events.some(r => r.event === 'model.request.started'), false);
  for (const h of hosts) await h.close();
  for (const row of rows) assert.throws(() => process.kill(row.pid, 0), { code: 'ESRCH' });
  const inspected = await exec(process.execPath, [path.join(root, 'dist/zcode-bridge.cjs'), '--host', entry, '--workspace', workA, '--session', created[0], '--scar-home', catalog, '--inspect', '--exclusive'], { env, timeout: 15000, maxBuffer: 1024 * 1024 });
  const frames = inspected.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.ok(frames.some(frame => frame.method === 'scar/bridgeReady' && frame.params.sessionId === created[0] && frame.params.desktopIntegrated === false));
});
