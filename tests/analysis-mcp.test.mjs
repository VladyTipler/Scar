import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { runCheck } from '../src/process.mjs';
import { taskFiles } from '../src/task-scope.mjs';
import { fixture } from './helpers.mjs';

const root = path.resolve(import.meta.dirname, '..');
async function connect(t, home, sessionId) {
  const client = new Client({ name: 'analysis-boundary', version: '1' });
  t.after(() => client.close());
  const env = { ...process.env, SCAR_HOME: home };
  delete env.SCAR_HOST_SESSION_ID;
  if (sessionId) env.SCAR_HOST_SESSION_ID = sessionId;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/mcp.cjs'), '--zcode'], env }));
  return client;
}
test('ZCode MCP defaults to side-effect-free analysis and refuses forged implementation identity', async t => {
  const home = await fixture(t), project = await fixture(t, { 'main.ts': 'try {} catch {}' });
  const client = await connect(t, home);
  const call = (name, args) => client.callTool({ name, arguments: args });
  const r = await call('scar_prepare', { project, task: 'Question about specification' });
  assert.equal(r.structuredContent.status, 'ANALYSIS');
  await assert.rejects(() => access(path.join(project, '.scar')), { code: 'ENOENT' });
  for (const args of [
    { project, task: 'Implementation', mode: 'implementation' },
    { project, task: 'Implementation', mode: 'implementation', sessionId: 'forged' }
  ]) {
    const rejected = await call('scar_prepare', args);
    assert.equal(rejected.isError, true);
    assert.match(rejected.content[0].text, /trusted.*session|identity/i);
  }
  assert.equal((await call('scar_hook_event', { event: { cwd: project, session_id: 'forged', hook_event_name: 'SessionStart' } })).isError, true);
  assert.equal((await call('scar_verify', { project })).isError, true);
  await assert.rejects(() => access(path.join(project, '.scar')), { code: 'ENOENT' });
});

test('bridge-bound MCP refuses implementation outside verified workspace', async t => {
  const home = await fixture(t), project = await fixture(t), other = await fixture(t);
  const client = new Client({ name: 'bridge-workspace', version: '1' });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/mcp.cjs'), '--zcode'], env: { ...process.env, SCAR_HOME: home, SCAR_HOST_SESSION_ID: 'owner', SCAR_HOST_WORKSPACE: project } }));
  const r = await client.callTool({ name: 'scar_prepare', arguments: { project: other, task: 'Wrong workspace', mode: 'implementation' } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /workspace|project/i);
  await assert.rejects(() => access(path.join(other, '.scar')), { code: 'ENOENT' });
});

test('session-bound MCP and actual hook target owner project, not host cwd', async t => {
  const home = await fixture(t), project = await fixture(t, { 'main.ts': 'export const value=1;' }), cwd = await fixture(t);
  const client = await connect(t, home, 'owner');
  const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); assert.notEqual(r.isError, true, JSON.stringify(r)); return r.structuredContent; };
  const hook = async name => {
    const result = await runCheck({ id: name, command: '$NODE', args: [path.join(root, 'dist/hook.cjs'), '--zcode'], timeoutMs: 5000 }, cwd, JSON.stringify({ cwd, session_id: 'owner', hook_event_name: name }), { SCAR_HOME: home });
    assert.equal(result.status, 'PASS', result.stderr);
    return JSON.parse(result.stdout);
  };
  await hook('SessionStart');
  await call('scar_prepare', { project, task: 'Explicit implementation', mode: 'implementation', checks: [{ id: 'behavior', command: '$NODE', args: ['-e', 'process.exit(0)'] }] });
  assert.equal((await hook('Stop')).decision, 'block');
  const other = await connect(t, home, 'other');
  assert.equal((await other.callTool({ name: 'scar_finish', arguments: { project } })).isError, true);
  const reviewer = await connect(t, home, 'sess_subagent_agent_test');
  assert.equal((await reviewer.callTool({ name: 'scar_prepare', arguments: { project, task: 'Reviewer', mode: 'implementation' } })).isError, true);
  const before = await readFile(taskFiles(project, 'owner').contract);
  assert.equal((await call('scar_prepare', { project, task: 'Audit', mode: 'analysis' })).status, 'ANALYSIS');
  assert.deepEqual(await readFile(taskFiles(project, 'owner').contract), before);
  await call('scar_review', { project, reason: 'Reviewed owned source and behavior coverage.' });
  assert.equal((await call('scar_finish', { project })).status, 'READY');
  assert.deepEqual(await hook('Stop'), {});
  assert.equal(JSON.parse(await readFile(path.join(home, 'tasks', (await import('../src/io.mjs')).digest('owner') + '.json'))).active, false);
  await writeFile(path.join(project, 'main.ts'), 'export const value=2;');
  await hook('UserPromptSubmit');
  assert.deepEqual(await hook('Stop'), {});
});
