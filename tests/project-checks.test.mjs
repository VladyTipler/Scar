import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Workflow } from '../src/workflow.mjs';
import { hookEvent } from '../src/hooks.mjs';
import { fixture } from './helpers.mjs';
import { projectChecks } from '../src/project-checks.mjs';
import { digest } from '../src/io.mjs';

const check = (id, exit = 0) => ({ id, command: '$NODE', args: ['-e', 'process.exit(' + exit + ')'] });
const policyFile = root => path.join(root, '.scar', 'project-checks.json');

test('policy read budget, check count and cancellation refuse incomplete configuration', async t => {
  const root = await fixture(t);
  await policy(root, [check('required')]);
  const bytes = await readFile(policyFile(root), 'utf8');
  await writeFile(policyFile(root), bytes.padEnd(65_536));
  assert.equal((await projectChecks(root, [])).checks.length, 1);
  await writeFile(policyFile(root), bytes.padEnd(65_537));
  await assert.rejects(projectChecks(root, []), /read budget/);
  await policy(root, Array.from({ length: 65 }, (_, i) => check('required_' + i)));
  await assert.rejects(projectChecks(root, []), /1\.\.64/);
  await policy(root, [check('required')]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(projectChecks(root, [], { signal: controller.signal }), { name: 'AbortError' });
});

test('default timeout deduplicates and a later mandatory conflict cannot run a task override', async t => {
  const home = await fixture(t), root = await fixture(t);
  await policy(root, [{ ...check('required'), timeoutMs: 120000 }]);
  const flow = new Workflow(home);
  await prepare(flow, root, [check('required')]);
  await review(flow, root);
  const result = await flow.finish(root);
  assert.equal(result.status, 'READY');
  assert.deepEqual(result.checks.map(c => c.id), ['required']);
  await policy(root, [check('required', 4)]);
  await assert.rejects(flow.verify(root), /conflicts.*required/);
  assert.equal((await hookEvent({ cwd: root, hook_event_name: 'Stop' }, home)).decision, 'block');
});

test('old-engine READY cannot certify a policy it never executed', async t => {
  const home = await fixture(t), root = await fixture(t);
  await policy(root, [check('required')]);
  const flow = new Workflow(home);
  await prepare(flow, root);
  const report = await flow.verify(root), context = await flow.binding(root);
  const legacyBinding = digest({ source: context.state.fingerprint, contract: context.contract, catalog: context.catalogDigest });
  await writeFile(flow.files(root).report, JSON.stringify({ ...report, binding: legacyBinding, checks: report.checks.filter(c => c.id === 'task'), projectCheckIds: undefined }));
  await writeFile(flow.files(root).review, JSON.stringify({ binding: legacyBinding, reason: 'Old runtime reviewed task checks without shared enforcement.' }));
  assert.equal((await flow.status(root)).status, 'STALE');
  await review(flow, root);
  const fresh = await flow.finish(root);
  assert.equal(fresh.status, 'READY');
  assert.deepEqual(fresh.checks.map(c => c.id), ['required', 'task']);
});

test('scoped Stop refuses malformed and oversized current policies without running commands', async t => {
  const home = await fixture(t), root = await fixture(t);
  await policy(root, [check('required')]);
  const flow = new Workflow(home, { sessionId: 'budget', hostProject: root });
  const event = name => ({ cwd: root, session_id: 'budget', hook_event_name: name });
  await hookEvent(event('SessionStart'), home);
  await prepare(flow, root); await review(flow, root);
  assert.equal((await flow.finish(root)).status, 'READY');
  const report = await readFile(flow.files(root).report, 'utf8');
  for (const bytes of ['null', JSON.stringify({ schema: 1, checks: [check('required')] }).padEnd(65_537)]) {
    await writeFile(policyFile(root), bytes);
    assert.equal((await hookEvent(event('Stop'), home)).decision, 'block');
    assert.equal(await readFile(flow.files(root).report, 'utf8'), report);
  }
});

test('project policy is local to its canonical workspace, not the original host cwd', async t => {
  const home = await fixture(t), host = await fixture(t), root = await fixture(t);
  await policy(host, [check('required', 5)]);
  const flow = new Workflow(home, { sessionId: 'worktree', hostProject: host });
  await prepare(flow, root); await review(flow, root);
  const result = await flow.finish(root);
  assert.equal(result.status, 'READY');
  assert.deepEqual(result.checks.map(c => c.id), ['task']);
  const hosted = new Workflow(home, { sessionId: 'host', hostProject: host });
  await prepare(hosted, host);
  assert.equal((await hosted.verify(host)).status, 'FAIL');
});
async function policy(root, checks) {
  await mkdir(path.join(root, '.scar'), { recursive: true });
  await writeFile(policyFile(root), JSON.stringify({ schema: 1, checks }));
}
const prepare = (flow, root, checks = [check('task')], options = {}) => flow.prepare(root, { task: 'Verify shared project checks', checks, ...options });
const review = (flow, root) => flow.review(root, 'Reviewed mandatory commands and independent task evidence.');

test('mandatory project failure applies to both chats and legacy callers without sharing reports', async t => {
  const home = await fixture(t), root = await fixture(t, { 'main.ts': 'export const value = 1;' });
  await policy(root, [check('required', 7)]);
  const a = new Workflow(home, { sessionId: 'a', hostProject: root });
  const b = new Workflow(home, { sessionId: 'b', hostProject: root });
  const legacy = new Workflow(home);
  for (const flow of [a, b, legacy]) {
    await prepare(flow, root, [check('local')]);
    await review(flow, root);
    const result = await flow.finish(root);
    assert.equal(result.status, 'FAIL');
    assert.deepEqual(result.checks.map(c => [c.id, c.status]), [['required', 'FAIL'], ['local', 'PASS']]);
  }
  assert.notEqual(a.files(root).report, b.files(root).report);
  assert.notEqual(a.files(root).report, legacy.files(root).report);
  const before = await readFile(b.files(root).report, 'utf8');
  await prepare(a, root, [check('other')]);
  await a.verify(root);
  assert.equal(await readFile(b.files(root).report, 'utf8'), before);
});

test('shared checks do not share task-specific failures or close another chat', async t => {
  const home = await fixture(t), root = await fixture(t);
  await policy(root, [check('required')]);
  const a = new Workflow(home, { sessionId: 'a', hostProject: root }), b = new Workflow(home, { sessionId: 'b', hostProject: root });
  await hookEvent({ cwd: root, session_id: 'a', hook_event_name: 'SessionStart' }, home);
  await hookEvent({ cwd: root, session_id: 'b', hook_event_name: 'SessionStart' }, home);
  await prepare(a, root); await prepare(b, root, [check('task', 3)]);
  await review(a, root); await review(b, root);
  assert.equal((await a.finish(root)).status, 'READY');
  assert.equal((await b.finish(root)).status, 'FAIL');
  assert.deepEqual(await hookEvent({ cwd: root, session_id: 'a', hook_event_name: 'Stop' }, home), {});
  assert.equal((await hookEvent({ cwd: root, session_id: 'b', hook_event_name: 'Stop' }, home)).decision, 'block');
});

test('task checks cannot replace a mandatory command and identical commands execute once', async t => {
  const home = await fixture(t), root = await fixture(t);
  await policy(root, [check('required', 5)]);
  const flow = new Workflow(home);
  await assert.rejects(prepare(flow, root, [check('required')]), /conflict.*required|mandatory.*required/i);
  await assert.rejects(readFile(flow.files(root).contract), { code: 'ENOENT' });
  await prepare(flow, root, [check('required', 5)]);
  const result = await flow.verify(root);
  assert.equal(result.status, 'FAIL');
  assert.deepEqual(result.checks.map(c => c.id), ['required']);
});

test('an empty task suite still executes mandatory checks', async t => {
  const home = await fixture(t), root = await fixture(t);
  await policy(root, [check('required')]);
  const flow = new Workflow(home);
  await prepare(flow, root, []);
  await review(flow, root);
  const result = await flow.finish(root);
  assert.equal(result.status, 'READY');
  assert.deepEqual(result.checks.map(c => c.id), ['required']);
});

test('new and changed policy invalidates both reports and is enforced on already-prepared tasks', async t => {
  const home = await fixture(t), root = await fixture(t);
  const a = new Workflow(home, { sessionId: 'a', hostProject: root }), b = new Workflow(home, { sessionId: 'b', hostProject: root });
  for (const flow of [a, b]) { await prepare(flow, root); await review(flow, root); assert.equal((await flow.finish(root)).status, 'READY'); }
  await policy(root, [check('required', 9)]);
  for (const flow of [a, b]) {
    assert.equal((await flow.status(root)).status, 'STALE');
    const result = await flow.verify(root);
    assert.equal(result.status, 'FAIL');
    assert.equal(result.checks.find(c => c.id === 'required').exitCode, 9);
  }
  await policy(root, [check('required')]);
  for (const flow of [a, b]) {
    assert.equal((await flow.status(root)).status, 'STALE');
    await review(flow, root);
    assert.equal((await flow.finish(root)).status, 'READY');
  }
});

test('deleting a policy required at preparation fails closed', async t => {
  const home = await fixture(t), root = await fixture(t);
  await policy(root, [check('required')]);
  const flow = new Workflow(home);
  await prepare(flow, root);
  await review(flow, root);
  assert.equal((await flow.finish(root)).status, 'READY');
  await rm(policyFile(root));
  await assert.rejects(flow.verify(root), /required.*project.*checks|project.*checks.*missing/i);
  const stopped = await hookEvent({ cwd: root, hook_event_name: 'Stop' }, home);
  assert.equal(stopped.decision, 'block');
});

test('malformed and duplicate policies fail before arming a task', async t => {
  const home = await fixture(t), root = await fixture(t);
  const flow = new Workflow(home);
  for (const value of [
    '{', 'null', 'false', '0', '""',
    JSON.stringify({ schema: 2, checks: [check('required')] }),
    JSON.stringify({ schema: 1, checks: [] }),
    JSON.stringify({ schema: 1, checks: [check('required'), check('required')] }),
    JSON.stringify({ schema: 1, checks: [check('required')], ignored: true }),
    JSON.stringify({ schema: 1, checks: [{ ...check('required'), env: { SKIP: '1' } }] }),
    JSON.stringify({ schema: 1, checks: [{ ...check('required'), timeoutMs: 1 }] }),
    JSON.stringify({ schema: 1, checks: [{ ...check('required'), id: 123 }] })
  ]) {
    await mkdir(path.join(root, '.scar'), { recursive: true });
    await writeFile(policyFile(root), value);
    await assert.rejects(prepare(flow, root));
    await assert.rejects(readFile(flow.files(root).contract), { code: 'ENOENT' });
  }
});

test('documentation baseline and explicit docs checks remain enforced alongside project checks', async t => {
  const home = await fixture(t), root = await fixture(t, { 'README.md': '# Old', 'main.ts': 'export const value = 1;' });
  await policy(root, [check('required', 6)]);
  const flow = new Workflow(home);
  const scope = { kind: 'documentation', paths: ['README.md'] };
  await assert.rejects(prepare(flow, root, [], { scope }), /Documentation tasks require/);
  await prepare(flow, root, [check('docs')], { scope });
  await writeFile(path.join(root, 'README.md'), '# New');
  const result = await flow.verify(root);
  assert.equal(result.status, 'FAIL');
  assert.deepEqual(result.checks.map(c => c.id), ['required', 'docs']);
  await writeFile(path.join(root, 'main.ts'), 'export const value = 2;');
  const violation = await flow.verify(root);
  assert.equal(violation.status, 'FAIL');
  assert.equal(violation.errors[0].id, 'SCAR-DOCS-BOUNDARY');
  assert.deepEqual(violation.checks, []);
});

test('analysis neither creates nor executes shared project checks', async t => {
  const home = await fixture(t), root = await fixture(t);
  const flow = new Workflow(home);
  assert.equal((await flow.prepare(root, { mode: 'analysis', task: 'Read-only question' })).status, 'ANALYSIS');
  await assert.rejects(readFile(policyFile(root)), { code: 'ENOENT' });
  await policy(root, [{ id: 'required', command: '$NODE', args: ['-e', "require('node:fs').writeFileSync('executed', 'bad')"] }]);
  assert.equal((await flow.prepare(root, { mode: 'analysis', task: 'Read-only question' })).status, 'ANALYSIS');
  await assert.rejects(readFile(path.join(root, 'executed')), { code: 'ENOENT' });
});
