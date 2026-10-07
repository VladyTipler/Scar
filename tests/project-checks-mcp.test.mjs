import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { runCheck } from '../src/process.mjs';
import { taskFiles } from '../src/task-scope.mjs';
import { projectGateFile } from '../src/io.mjs';
import { fixture } from './helpers.mjs';

const bundleRoot = process.env.SCAR_TEST_BUNDLE_ROOT || path.resolve(import.meta.dirname, '..');
test('real pooled native MCP enforces shared checks without widening one-use owner authority', async t => {
  const home = await fixture(t);
  const required = exit => ({ id: 'required', command: '$NODE', args: ['-e', "console.log('mandatory-project-check'); process.exit(" + exit + ')'] });
  const project = await fixture(t, {
    'main.ts': 'export const value = 1;',
    '.scar/project-checks.json': JSON.stringify({ schema: 1, checks: [required(7)] })
  });
  const client = new Client({ name: 'shared-project-policy', version: '1' });
  t.after(() => client.close());
  const env = { ...process.env, SCAR_HOME: home };
  delete env.SCAR_HOST_SESSION_ID; delete env.SCAR_HOST_WORKSPACE;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(bundleRoot, 'dist/mcp.cjs'), '--zcode'], env }));
  const hook = async (sessionId, event, extra = {}) => {
    const result = await runCheck({ id: 'native', command: '$NODE', args: [path.join(bundleRoot, 'dist/hook.cjs'), '--zcode', ...(event === 'PreToolUse' ? ['--bind-request'] : [])], timeoutMs: 5000 }, project, JSON.stringify({ cwd: project, session_id: sessionId, hook_event_name: event, ...extra }), { SCAR_HOME: home });
    assert.equal(result.status, 'PASS', result.stderr);
    return JSON.parse(result.stdout);
  };
  const bound = async (sessionId, name, args) => {
    const result = await hook(sessionId, 'PreToolUse', { tool_name: 'mcp__plugin_scar_scar__' + name, tool_input: args, tool_use_id: 'policy-' + name });
    assert.notEqual(result.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(result));
    return result.hookSpecificOutput.updatedInput;
  };
  const call = async (sessionId, name, args) => client.callTool({ name, arguments: await bound(sessionId, name, args) });
  const prepare = { project, task: 'Shared mandatory policy over trusted native transport', mode: 'implementation', checks: [] };
  assert.equal((await client.callTool({ name: 'scar_prepare', arguments: prepare })).isError, true);
  await hook('sess_policy_a', 'SessionStart'); await hook('sess_policy_b', 'SessionStart');
  const firstInput = await bound('sess_policy_a', 'scar_prepare', prepare);
  assert.equal((await client.callTool({ name: 'scar_prepare', arguments: firstInput })).structuredContent.status, 'PREPARED');
  assert.equal((await client.callTool({ name: 'scar_prepare', arguments: firstInput })).isError, true);
  assert.equal((await call('sess_policy_b', 'scar_prepare', prepare)).structuredContent.status, 'PREPARED');
  for (const sid of ['sess_policy_a', 'sess_policy_b']) {
    const result = await call(sid, 'scar_verify', { project });
    assert.equal(result.structuredContent.status, 'FAIL');
    assert.deepEqual(result.structuredContent.checks.map(c => [c.id, c.exitCode]), [['required', 7]]);
    const details = await call(sid, 'scar_details', { project, checkId: 'required', stream: 'stdout' });
    assert.match(details.structuredContent.text, /mandatory-project-check/);
    const contract = JSON.parse(await readFile(taskFiles(project, sid).contract, 'utf8'));
    assert.equal(contract.ownerSessionId, sid);
    assert.equal(contract.projectChecksRequired, true);
    assert.deepEqual(contract.checks, []);
  }
  const unchanged = await call('sess_policy_a', 'scar_finish', { project });
  assert.equal(unchanged.isError, true);
  assert.match(unchanged.content[0].text, /Unchanged failure/);
  assert.equal((await call('sess_policy_foreign', 'scar_finish', { project })).isError, true);
  await writeFile(path.join(project, '.scar/project-checks.json'), JSON.stringify({ schema: 1, checks: [required(0)] }));
  for (const sid of ['sess_policy_a', 'sess_policy_b']) {
    assert.equal((await call(sid, 'scar_status', { project })).structuredContent.status, 'STALE');
    assert.equal((await call(sid, 'scar_review', { project, reason: 'Reviewed current mandatory policy and isolated native ownership.' })).structuredContent.status, 'REVIEWED');
    assert.equal((await call(sid, 'scar_finish', { project })).structuredContent.status, 'READY');
  }
  const before = await readFile(taskFiles(project, 'sess_policy_b').report, 'utf8');
  assert.deepEqual(await hook('sess_policy_a', 'Stop'), {});
  assert.equal(JSON.parse(await readFile(projectGateFile(home, await realpath(project), 'sess_policy_b'), 'utf8')).active, true);
  assert.equal(await readFile(taskFiles(project, 'sess_policy_b').report, 'utf8'), before);
  await writeFile(path.join(project, 'main.ts'), 'export const value = 2;');
  assert.equal((await hook('sess_policy_b', 'Stop')).decision, 'block');
});
