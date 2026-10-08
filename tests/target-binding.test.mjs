import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, realpath, symlink, unlink, access } from 'node:fs/promises';
import path from 'node:path';
import { issueBinding, consumeBinding } from '../src/native-binding.mjs';
import { Workflow } from '../src/workflow.mjs';
import { hookEvent } from '../src/hooks.mjs';
import { fixture } from './helpers.mjs';
import { bindingFile } from '../src/task-scope.mjs';

const pass = { id: 'behavior', command: '$NODE', args: ['-e', 'process.exit(0)'] };
const input = project => ({ project, mode: 'implementation', task: 'Authorized external project', checks: [pass] });
const event = (cwd, args) => ({ cwd, session_id: 'owner', hook_event_name: 'PreToolUse', tool_name: 'mcp__plugin_scar_scar__scar_prepare', tool_use_id: 'target-proof', tool_input: args });
const hook = (cwd, name) => ({ cwd, session_id: 'owner', hook_event_name: name });

test('native binding separates chat cwd from exact project and Stop follows that project', async t => {
  const home = await fixture(t), cwd = await fixture(t, { 'host.ts': 'try {} catch {}' });
  const project = await fixture(t, { 'main.ts': 'export const value = 1;' });
  const args = input(project), bound = (await issueBinding(event(cwd, args), home)).hookSpecificOutput.updatedInput;
  const host = await consumeBinding('scar_prepare', bound, home);
  assert.equal(host.workspace, await realpath(cwd));
  assert.equal(host.targetProject, await realpath(project));
  const flow = new Workflow(home, host);
  await hookEvent(hook(cwd, 'SessionStart'), home, { scoped: true });
  await flow.prepare(project, args);
  assert.equal(flow.hostProject, await realpath(cwd));
  assert.equal((await hookEvent(hook(cwd, 'Stop'), home, { scoped: true })).decision, 'block');
  await flow.review(project, 'Reviewed the actual target rather than unrelated host source.');
  const result = await flow.finish(project);
  assert.equal(result.status, 'READY');
  assert.equal(result.findings.length, 0);
  assert.deepEqual(await hookEvent(hook(cwd, 'Stop'), home, { scoped: true }), {});
});

test('native binding still rejects changed project arguments and replay across directories', async t => {
  const home = await fixture(t), cwd = await fixture(t), project = await fixture(t), other = await fixture(t);
  const bound = (await issueBinding(event(cwd, input(project)), home)).hookSpecificOutput.updatedInput;
  await assert.rejects(consumeBinding('scar_prepare', { ...bound, project: other }, home), /match/);
  await assert.rejects(consumeBinding('scar_prepare', bound, home), /missing|used/);
});

test('schema 2 requires a target while schema 1 retains its original exact-workspace binding', async t => {
  const home = await fixture(t), project = await fixture(t);
  const get = async () => (await issueBinding(event(project, input(project)), home)).hookSpecificOutput.updatedInput;
  const bound = await get(), file = path.join(home, 'request-bindings', bound._scarBinding + '.json');
  const record = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(record.schema, 2);
  await writeFile(file, JSON.stringify({ ...record, targetProject: undefined }));
  await assert.rejects(consumeBinding('scar_prepare', bound, home), /target|project/);
  const legacy = await get(), legacyFile = path.join(home, 'request-bindings', legacy._scarBinding + '.json');
  await writeFile(legacyFile, JSON.stringify({ ...JSON.parse(await readFile(legacyFile, 'utf8')), schema: 1, targetProject: undefined }));
  const host = await consumeBinding('scar_prepare', legacy, home);
  assert.equal(host.targetProject, await realpath(project));
  const flow = new Workflow(home, host);
  await flow.prepare(project, input(project));
  assert.equal((await flow.verify(project)).status, 'VERIFIED');
  const external = await fixture(t);
  const oldExternal = (await issueBinding(event(project, input(external)), home)).hookSpecificOutput.updatedInput;
  const oldFile = path.join(home, 'request-bindings', oldExternal._scarBinding + '.json');
  await writeFile(oldFile, JSON.stringify({ ...JSON.parse(await readFile(oldFile, 'utf8')), schema: 1, targetProject: undefined }));
  await assert.rejects(consumeBinding('scar_prepare', oldExternal, home), /project.*mismatch/);
});

test('retargeting a path alias after issuance cannot redirect its capability', { skip: process.platform === 'win32' }, async t => {
  const home = await fixture(t), cwd = await fixture(t), project = await fixture(t), other = await fixture(t);
  const alias = path.join(cwd, 'alias');
  await symlink(project, alias, 'dir');
  const bound = (await issueBinding(event(cwd, input(alias)), home)).hookSpecificOutput.updatedInput;
  await unlink(alias);
  await symlink(other, alias, 'dir');
  await assert.rejects(consumeBinding('scar_prepare', bound, home), /project.*mismatch/);
});

test('trusted launcher may choose external target but per-call target and active owner remain exact', async t => {
  const home = await fixture(t), cwd = await fixture(t), project = await fixture(t), other = await fixture(t);
  const host = { scoped: true, sessionId: 'owner', workspace: cwd };
  const flow = new Workflow(home, host);
  await flow.prepare(project, input(project));
  assert.equal(flow.hostProject, path.resolve(cwd));
  const file = bindingFile(home, path.resolve(cwd), 'owner');
  const before = await readFile(file, 'utf8');
  await assert.rejects(flow.prepare(other, input(other)), /active/);
  assert.equal(await readFile(file, 'utf8'), before);
  const changedOrigin = await fixture(t);
  const moved = new Workflow(home, { ...host, workspace: changedOrigin });
  await assert.rejects(moved.prepare(other, input(other)), /active/);
  await assert.rejects(access(bindingFile(home, path.resolve(changedOrigin), 'owner')), { code: 'ENOENT' });
  assert.equal(await readFile(file, 'utf8'), before);
  await assert.rejects(flow.verify(other), /owned|owner|implementation/);
  const constrained = new Workflow(home, { ...host, targetProject: project });
  await assert.rejects(constrained.authorize(other), /target|project/);
  await assert.rejects(constrained.prepare(other, input(other)), /target|project/);
  assert.equal((await flow.verify(project)).status, 'VERIFIED');
});
