import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { runCheck } from '../src/process.mjs';
import { taskFiles } from '../src/task-scope.mjs';
import { fixture } from './helpers.mjs';

const root = path.resolve(import.meta.dirname, '..');
async function native(home, project, sessionId, name, args) {
  const event = { cwd: project, session_id: sessionId, hook_event_name: 'PreToolUse', tool_name: 'mcp__plugin_scar_scar__' + name, tool_input: args, tool_use_id: 'test-' + name };
  const r = await runCheck({ id: 'native', command: '$NODE', args: [path.join(root, 'dist/hook.cjs'), '--zcode', '--bind-request'], timeoutMs: 5000 }, project, JSON.stringify(event), { SCAR_HOME: home });
  assert.equal(r.status, 'PASS', r.stderr);
  return JSON.parse(r.stdout);
}
async function client(t, home) {
  const c = new Client({ name: 'native-auto-proof', version: '1' });
  t.after(() => c.close());
  const env = { ...process.env, SCAR_HOME: home }; delete env.SCAR_HOST_SESSION_ID; delete env.SCAR_HOST_WORKSPACE;
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/mcp.cjs'), '--zcode'], env }));
  return c;
}
test('unbound static MCP executes owned implementation only with native updatedInput, not manual identity', async t => {
  const home = await fixture(t), project = await fixture(t, { 'main.ts': 'try {} catch {}' }), c = await client(t, home);
  const call = async (sessionId, name, args) => {
    const hook = await native(home, project, sessionId, name, args);
    assert.notEqual(hook.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(hook));
    const result = await c.callTool({ name, arguments: hook.hookSpecificOutput?.updatedInput || args });
    return result;
  };
  await runCheck({ id: 'start', command: '$NODE', args: [path.join(root, 'dist/hook.cjs'), '--zcode'], timeoutMs: 5000 }, project, JSON.stringify({ cwd: project, session_id: 'sess_owner', hook_event_name: 'SessionStart' }), { SCAR_HOME: home });
  const prepare = { project, task: 'Actual automatic request path', mode: 'implementation', checks: [{ id: 'behavior', command: '$NODE', args: ['-e', 'process.exit(0)'] }] };
  assert.equal((await c.callTool({ name: 'scar_prepare', arguments: prepare })).isError, true);
  const h = await native(home, project, 'sess_owner', 'scar_prepare', prepare);
  const first = await c.callTool({ name: 'scar_prepare', arguments: h.hookSpecificOutput.updatedInput });
  assert.equal(first.structuredContent.status, 'PREPARED');
  assert.equal((await c.callTool({ name: 'scar_prepare', arguments: h.hookSpecificOutput.updatedInput })).isError, true);
  assert.equal(JSON.parse(await readFile(taskFiles(project, 'sess_owner').contract)).ownerSessionId, 'sess_owner');
  assert.equal((await call('sess_other', 'scar_finish', { project })).isError, true);
  assert.equal((await call('sess_owner', 'scar_verify', { project })).structuredContent.status, 'FAIL');
  const repeat = await call('sess_owner', 'scar_finish', { project });
  assert.equal(repeat.isError, true); assert.match(repeat.content[0].text, /Unchanged failure/);
  await writeFile(path.join(project, 'main.ts'), 'export const value=1;');
  assert.equal((await call('sess_owner', 'scar_review', { project, reason: 'Reviewed root owner and actual hook-bound fix.' })).structuredContent.status, 'REVIEWED');
  assert.equal((await call('sess_owner', 'scar_finish', { project })).structuredContent.status, 'READY');
  const end = await runCheck({ id: 'stop', command: '$NODE', args: [path.join(root, 'dist/hook.cjs'), '--zcode'], timeoutMs: 5000 }, project, JSON.stringify({ cwd: project, session_id: 'sess_owner', hook_event_name: 'Stop' }), { SCAR_HOME: home });
  assert.deepEqual(JSON.parse(end.stdout), {});
  assert.deepEqual(await readdir(path.join(home, 'request-bindings')), []);
});
test('native owner explicitly retires legacy task then prepares documentation without hiding code findings', async t => {
  const home = await fixture(t), project = await fixture(t, { 'src/app.ts': 'try {} catch {}', 'docs/spec.md': '# Existing docs' }), c = await client(t, home);
  const call = async (sid, name, args) => {
    const h = await native(home, project, sid, name, args);
    assert.notEqual(h.hookSpecificOutput.permissionDecision, 'deny', JSON.stringify(h));
    return c.callTool({ name, arguments: h.hookSpecificOutput.updatedInput });
  };
  const initial = await call('sess_docs', 'scar_prepare', { project, mode: 'implementation', task: 'Legacy full scope task', checks: [{ id: 'docs', command: '$NODE', args: ['-e', 'process.exit(0)'] }] });
  const runId = initial.structuredContent.runId;
  assert.equal((await call('sess_other', 'scar_cancel', { project, expectedRunId: runId, reason: 'Wrong session attempts scope replacement.' })).isError, true);
  assert.equal((await call('sess_docs', 'scar_cancel', { project, expectedRunId: 'wrong', reason: 'Owner passed a stale generation identifier.' })).isError, true);
  assert.equal((await call('sess_docs', 'scar_cancel', { project, expectedRunId: runId, reason: 'Withdraw mistaken full scope; create newly authorized documentation phase.' })).structuredContent.status, 'CANCELLED');
  const next = await call('sess_docs', 'scar_prepare', { project, mode: 'implementation', task: 'New explicit docs task', scope: { kind: 'documentation', paths: ['docs'] }, checks: [{ id: 'docs', command: '$NODE', args: ['-e', 'process.exit(0)'] }] });
  assert.equal(next.structuredContent.status, 'PREPARED');
  await writeFile(path.join(project, 'docs/spec.md'), '# Revised documentation');
  assert.equal((await call('sess_docs', 'scar_review', { project, reason: 'Reviewed docs only, existing source defect remains warning.' })).structuredContent.status, 'REVIEWED');
  const finished = await call('sess_docs', 'scar_finish', { project });
  assert.equal(finished.structuredContent.status, 'READY');
  assert.equal(finished.structuredContent.scope.kind, 'documentation');
  assert.equal(finished.structuredContent.warningCount, 1);
  assert.equal(finished.structuredContent.warnings[0].id, 'SCAR-001');
  assert.equal((await call('sess_docs', 'scar_details', { project, section: 'warnings' })).structuredContent.total, 1);
  assert.equal((await readdir(path.join(home, 'cancellations'))).length, 1);
});

test('native hook does not bind analysis, rejects reviewer mutation and leaves unknown forged identity refused', async t => {
  const home = await fixture(t), project = await fixture(t), c = await client(t, home);
  const args = { project, task: 'Question', mode: 'analysis' };
  assert.deepEqual(await native(home, project, 'sess_subagent_agent_reader', 'scar_prepare', args), {});
  const r = await c.callTool({ name: 'scar_prepare', arguments: args });
  assert.equal(r.structuredContent.status, 'ANALYSIS');
  await assert.rejects(() => access(path.join(project, '.scar')), { code: 'ENOENT' });
  assert.deepEqual(await readdir(home), []);
  const denied = await native(home, project, 'sess_subagent_agent_reader', 'scar_prepare', { project, task: 'Wrong mutation', mode: 'implementation' });
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.deepEqual(await readdir(home), []);
  assert.equal((await c.callTool({ name: 'scar_prepare', arguments: { project, task: 'Forged', mode: 'implementation', _scarBinding: 'x'.repeat(64) } })).isError, true);
});
