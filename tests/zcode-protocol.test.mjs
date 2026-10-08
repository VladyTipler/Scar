import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fixture } from './helpers.mjs';

async function launch(t, body, options = {}) {
  const root = await fixture(t, { 'host.cjs': body });
  const { ZCodeProtocolClient } = await import('../src/zcode-protocol.mjs');
  const client = new ZCodeProtocolClient({ command: process.execPath, args: [path.join(root, 'host.cjs')], cwd: root, timeoutMs: 2000, ...options });
  t.after(() => client.close());
  return client;
}
const header = "const rl=require('node:readline').createInterface({input:process.stdin});const send=r=>process.stdout.write(JSON.stringify(r)+'\\n');";

test('protocol supports host callbacks, interleaved notifications and Unicode responses', async t => {
  const notices = [];
  const client = await launch(t, header + "let original;rl.on('line',l=>{const r=JSON.parse(l);if(r.method){original=r;send({method:'state.updated',params:{ready:true}});send({id:'host-callback',method:'session/requestRuntimePreferences',params:{}});}else if(r.id==='host-callback')send({id:original.id,result:{message:'ошибка',preferences:r.result}});});", { onNotification: r => notices.push(r), onRequest: async () => ({ memoryEnabled: false }) });
  const r = await client.request('runtime/capabilities', {});
  assert.deepEqual(r, { message: 'ошибка', preferences: { memoryEnabled: false } });
  assert.equal(notices.length, 1);
});

test('protocol rejects host errors, deadlines, EOF and oversized output', async t => {
  const err = await launch(t, header + "rl.on('line',l=>send({id:JSON.parse(l).id,error:{code:-32004,message:'Session not found'}}));");
  await assert.rejects(() => err.request('session/resume', {}), /Session not found/);
  const timeout = await launch(t, header + "rl.on('line',()=>{});", { timeoutMs: 150 });
  await assert.rejects(() => timeout.request('wait', {}), /timed out/);
  const eof = await launch(t, header + "rl.on('line',()=>process.exit(0));");
  await assert.rejects(() => eof.request('exit', {}), /closed|exit/);
  const huge = await launch(t, header + "rl.on('line',()=>process.stdout.write('x'.repeat(1500)));", { maxFrameBytes: 1024 });
  await assert.rejects(() => huge.request('huge', {}), /frame|limit/);
});

test('transport failure terminates a stalled host without relying on caller cleanup', async t => {
  const client = await launch(t, header + "rl.on('line',()=>{process.stdout.write('invalid-json'+String.fromCharCode(10));setInterval(()=>{},1000);});");
  const pid = client.child.pid;
  await assert.rejects(() => client.request('broken', {}), /NDJSON/);
  const deadline = Date.now() + 4500;
  let gone = false;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') { gone = true; break; } throw e; }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(gone, true, 'Transport error left the private host alive');
});

test('closing protocol refuses new requests and rejects pending calls', async t => {
  const client = await launch(t, header + "rl.on('line',()=>{});");
  const waiting = client.request('pending', {});
  const rejected = assert.rejects(waiting, /closed/);
  await client.close();
  await rejected;
  await assert.rejects(() => client.request('later', {}), /closed/);
});
