import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, access, readFile, writeFile, realpath } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fixture } from './helpers.mjs';

const load = () => import('../src/native-binding.mjs');
const tool = 'mcp__plugin_scar_scar__scar_prepare';
const event = (cwd, input, session = 'sess_owner') => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, tool_use_id: 'call-one', session_id: session, cwd });
const args = project => ({ project, mode: 'implementation', task: 'Explicit feature', checks: [] });

test('native hook supplies one-use binding to exact method, args, owner and workspace', async t => {
  const project = await fixture(t), home = await fixture(t);
  const { issueBinding, consumeBinding } = await load();
  const input = args(project), result = await issueBinding(event(project, input), home);
  assert.equal(result.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(result.hookSpecificOutput.permissionDecision, undefined);
  const updated = result.hookSpecificOutput.updatedInput;
  assert.ok(updated._scarBinding); assert.deepEqual({ ...updated, _scarBinding: undefined }, { ...input, _scarBinding: undefined });
  const host = await consumeBinding('scar_prepare', updated, home);
  assert.equal(host.sessionId, 'sess_owner'); assert.equal(host.workspace, await realpath(project));
  await assert.rejects(() => consumeBinding('scar_prepare', updated, home), /missing|used|binding/i);
  assert.deepEqual(await readdir(path.join(home, 'request-bindings')), []);
});

test('read-only calls do not issue tokens or write state', async t => {
  const project = await fixture(t), home = await fixture(t);
  const { issueBinding } = await load();
  for (const e of [
    event(project, { project, task: 'Question', mode: 'analysis' }),
    event(project, { project, task: 'Question' }),
    { ...event(project, {}), tool_name: 'mcp__plugin_scar_scar__scar_context' },
    { ...event(project, {}), tool_name: 'Read' }
  ]) assert.deepEqual(await issueBinding(e, home), {});
  assert.deepEqual(await readdir(home), []);
});

test('invalid project, missing identity, forged token and child mutation fail without issuance', async t => {
  const project = await fixture(t), home = await fixture(t);
  const { issueBinding } = await load();
  for (const e of [
    event(project, args('relative/project')),
    event(project, { ...args(project), project: undefined }),
    { ...event(project, args(project)), session_id: undefined },
    event(project, { ...args(project), _scarBinding: 'forged' }),
    event(project, args(project), 'sess_subagent_agent_review'),
    { ...event(project, args(project)), parentSessionId: 'parent' }
  ]) await assert.rejects(() => issueBinding(e, home), /identity|session|review|project|workspace|binding|child/i);
  assert.deepEqual(await readdir(home), []);
});

test('binding cannot be replayed across method or params, stale token never executes', async t => {
  const project = await fixture(t), home = await fixture(t);
  const { issueBinding, consumeBinding } = await load();
  const get = async () => (await issueBinding(event(project, args(project)), home)).hookSpecificOutput.updatedInput;
  const changed = await get();
  await assert.rejects(() => consumeBinding('scar_prepare', { ...changed, task: 'Other' }, home), /match|binding/i);
  await assert.rejects(() => consumeBinding('scar_prepare', changed, home), /binding/i);
  const method = await get();
  await assert.rejects(() => consumeBinding('scar_finish', method, home), /match|binding/i);
  const expired = await get();
  const file = path.join(home, 'request-bindings', expired._scarBinding + '.json');
  const record = JSON.parse(await readFile(file));
  await writeFile(file, JSON.stringify({ ...record, expiresAt: 1 }));
  await assert.rejects(() => consumeBinding('scar_prepare', expired, home), /expired|binding/i);
  await assert.rejects(() => consumeBinding('scar_prepare', { ...args(project), _scarBinding: '../../x' }, home), /binding/i);
});

test('spent-token cleanup failure refuses before workflow and cannot make the nonce reusable', async t => {
  const project = await fixture(t), home = await fixture(t);
  const { issueBinding, consumeBinding } = await load();
  const updated = (await issueBinding(event(project, args(project)), home)).hookSpecificOutput.updatedInput;
  const original = fs.rm;
  fs.rm = async (file, ...rest) => {
    if (String(file).endsWith('.claim')) throw Object.assign(new Error('Cleanup denied'), { code: 'EACCES' });
    return original(file, ...rest);
  };
  syncBuiltinESMExports();
  try { await assert.rejects(() => consumeBinding('scar_prepare', updated, home), /Cleanup denied/); }
  finally { fs.rm = original; syncBuiltinESMExports(); }
  await assert.rejects(() => consumeBinding('scar_prepare', updated, home), /used|missing/);
  await assert.rejects(() => access(path.join(project, '.scar')), { code: 'ENOENT' });
  assert.equal((await readdir(path.join(home, 'request-bindings'))).filter(n => n.endsWith('.claim')).length, 1);
});

test('concurrent calls consume a token once and unrelated sessions retain distinct identity', async t => {
  const project = await fixture(t), home = await fixture(t);
  const { issueBinding, consumeBinding } = await load();
  const one = (await issueBinding(event(project, args(project), 'sess_one'), home)).hookSpecificOutput.updatedInput;
  const two = (await issueBinding(event(project, args(project), 'sess_two'), home)).hookSpecificOutput.updatedInput;
  const results = await Promise.allSettled([consumeBinding('scar_prepare', one, home), consumeBinding('scar_prepare', one, home)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await consumeBinding('scar_prepare', two, home)).sessionId, 'sess_two');
  assert.deepEqual(await readdir(path.join(home, 'request-bindings')), []);
});
