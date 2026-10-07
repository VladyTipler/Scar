import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { fixture } from './helpers.mjs';

const modulePath = new URL('../src/zcode-session.mjs', import.meta.url);
const load = () => import(modulePath.href);
const sid = 'sess_01234567-89ab-cdef-0123-456789abcdef';
const bundle = path.resolve(import.meta.dirname, '../dist/mcp.cjs');
const snapshot = workspace => ({ session: { sessionId: sid, sessionKind: 'interactive', status: 'idle', workspace: { workspacePath: workspace, workspaceKey: workspace } } });

function host(workspace, mutate = value => value) {
  const calls = [];
  return { calls, async restart() { calls.push({ method: 'host/restart' }); return this; }, async request(method, params) {
    calls.push({ method, params });
    if (method === 'session/close') return { closed: true };
    return mutate(snapshot(workspace), calls);
  } };
}

test('bridge uses host-verified root identity and installs session-scoped MCP on resume', async t => {
  const workspace = await fixture(t), h = host(workspace);
  const { bindScarSession } = await load();
  const bound = await bindScarSession(h, { sessionId: sid, workspace, mcpBundle: bundle });
  assert.equal(bound.sessionId, sid);
  assert.deepEqual(h.calls.map(c => c.method), ['session/resume', 'host/restart', 'session/resume']);
  const resume = h.calls[2].params;
  assert.equal(resume.sessionId, sid);
  assert.equal(resume.dynamicWorkflowEnabled, false);
  assert.equal(resume.offPeakToolEnabled, false);
  const mcp = resume.mcpServers.find(s => s.name === 'plugin:scar:scar');
  assert.equal(mcp.isolation, 'session');
  assert.deepEqual(mcp.args, [bundle, '--zcode']);
  assert.equal(mcp.env.find(e => e.name === 'SCAR_HOST_SESSION_ID').value, sid);
  assert.equal(mcp.env.find(e => e.name === 'SCAR_HOST_WORKSPACE').value, await realpath(workspace));
  assert.equal(resume.toolDenylist.includes('Agent'), true);
  assert.equal(resume.toolDenylist.includes('CreateWorkflow'), true);
});

test('foreign ID, child session, active turn and workspace mismatch fail before session close', async t => {
  const workspace = await fixture(t), other = await fixture(t);
  const { bindScarSession } = await load();
  for (const mutation of [
    s => ({ session: { ...s.session, sessionId: 'sess_other' } }),
    s => ({ session: { ...s.session, parentSessionId: 'parent' } }),
    s => ({ session: { ...s.session, sessionKind: 'subagent_child' } }),
    s => ({ session: { ...s.session, status: 'running' } }),
    s => ({ session: { ...s.session, workspace: { workspacePath: other, workspaceKey: other } } })
  ]) {
    const h = host(workspace, mutation);
    await assert.rejects(() => bindScarSession(h, { sessionId: sid, workspace, mcpBundle: bundle }), /identity|root|idle|workspace/i);
    assert.equal(h.calls.some(c => c.method === 'session/close'), false);
  }
});

test('failed rematerialization never enables execution or silently loses host errors', async t => {
  const workspace = await fixture(t), h = host(workspace);
  const { bindScarSession } = await load();
  h.restart = async () => { throw new Error('Host restart failed'); };
  await assert.rejects(() => bindScarSession(h, { sessionId: sid, workspace, mcpBundle: bundle }), /restart/i);
  const changed = host(workspace, (s, calls) => calls.length > 2 ? { session: { ...s.session, sessionId: 'wrong' } } : s);
  await assert.rejects(() => bindScarSession(changed, { sessionId: sid, workspace, mcpBundle: bundle }), /identity/i);
});

test('bound dispatch rejects forks, forged session and MCP overrides; send cannot reenable delegation', async t => {
  const workspace = await fixture(t), h = host(workspace);
  const { bindScarSession } = await load();
  const bound = await bindScarSession(h, { sessionId: sid, workspace, mcpBundle: bundle });
  for (const [method, params] of [
    ['session/fork', { sessionId: sid }],
    ['session/resume', { sessionId: sid, mcpServers: [] }],
    ['session/create', { workspace }],
    ['session/read', { sessionId: 'other' }],
    ['plugins/setEnabled', {}]
  ]) await assert.rejects(() => bound.request(method, params), /allowed|session|override/i);
  await bound.request('session/send', { sessionId: sid, content: 'Authorized operator prompt', toolDenylist: ['Bash'], modelExecution: { selectionScope: 'execution', subagents: { foregroundModel: 'submission', background: 'deny' } } });
  const forwarded = h.calls.at(-1).params;
  assert.equal(forwarded.toolDenylist.includes('Bash'), true);
  assert.equal(forwarded.toolDenylist.includes('Agent'), true);
  assert.equal(forwarded.toolDenylist.includes('CreateWorkflow'), true);
  assert.equal(forwarded.modelExecution.subagents.background, 'deny');
  await assert.rejects(() => bound.request('session/send', { sessionId: sid, content: 'Override', mcpServers: [] }), /override|parameters/i);
});
