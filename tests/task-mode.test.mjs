import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { Workflow } from '../src/workflow.mjs';
import { hookEvent } from '../src/hooks.mjs';
import { projectGateFile } from '../src/io.mjs';
import { fixture } from './helpers.mjs';

const pass = { id: 'behavior', command: '$NODE', args: ['-e', 'process.exit(0)'] };
const host = sessionId => ({ scoped: true, sessionId });
const event = (cwd, session_id, hook_event_name = 'Stop') => ({ cwd, session_id, hook_event_name });
const missing = file => assert.rejects(() => access(file), { code: 'ENOENT' });

test('analysis does not write project/catalog state or execute discovered commands', async t => {
  const home = await fixture(t);
  const project = await fixture(t, { 'main.ts': 'try {} catch {}', 'package.json': JSON.stringify({ scripts: { test: 'node -e "require(\'fs\').writeFileSync(\'ran\',\'yes\')"' } }) });
  const flow = new Workflow(home, host('owner'));
  const result = await flow.prepare(project, { mode: 'analysis', task: 'Read-only review' });
  assert.equal(result.status, 'ANALYSIS');
  assert.equal(result.mode, 'analysis');
  assert.equal(result.classes.length, 3);
  await missing(path.join(project, '.scar'));
  await missing(path.join(project, 'ran'));
  assert.deepEqual(await readdir(home), []);
  assert.deepEqual(await hookEvent(event(project, 'owner'), home, { scoped: true }), {});
  await assert.rejects(() => flow.verify(project), /implementation|owned|task/i);
  await assert.rejects(() => flow.prepare(project, { mode: 'analysis', task: 'Audit', checks: [pass] }), /analysis/i);
});

test('implementation requires a trusted owner and reviewer subagents cannot arm a gate', async t => {
  const project = await fixture(t);
  for (const sessionId of [undefined, 'sess_subagent_agent_reviewer']) {
    const home = await fixture(t);
    const flow = new Workflow(home, host(sessionId));
    await assert.rejects(() => flow.prepare(project, { mode: 'implementation', task: 'Make change', checks: [pass], sessionId: 'forged-owner' }), /session|subagent|owner/i);
    assert.deepEqual(await readdir(home), []);
    await missing(path.join(project, '.scar'));
  }
});

test('owner task targets project independently of cwd; another session cannot replace it', async t => {
  const home = await fixture(t);
  const project = await fixture(t, { 'main.ts': 'export const value=1;' });
  const cwd = await fixture(t);
  const owner = new Workflow(home, host('owner'));
  const other = new Workflow(home, host('other'));
  await hookEvent(event(cwd, 'owner', 'SessionStart'), home, { scoped: true });
  const prepared = await owner.prepare(project, { mode: 'implementation', task: 'Feature', checks: [pass] });
  assert.ok(prepared.runId);
  assert.equal((await hookEvent(event(cwd, 'owner'), home, { scoped: true })).decision, 'block');
  assert.deepEqual(await hookEvent(event(cwd, 'other'), home, { scoped: true }), {});
  await other.prepare(project, { mode: 'implementation', task: 'Independent task', checks: [pass] });
  assert.notEqual(owner.files(project).contract, other.files(project).contract);
  assert.equal((await other.verify(project)).status, 'VERIFIED');
  await assert.rejects(() => owner.prepare(cwd, { mode: 'implementation', task: 'Other project', checks: [pass] }), /active|task/i);
  const contract = await readFile(owner.files(project).contract);
  assert.equal((await owner.prepare(project, { mode: 'analysis', task: 'Question' })).status, 'ANALYSIS');
  assert.deepEqual(await readFile(owner.files(project).contract), contract);
  assert.equal((await hookEvent(event(cwd, 'owner'), home, { scoped: true })).decision, 'block');
  await owner.review(project, 'Reviewed source, tests and applicable classes.');
  assert.equal((await owner.finish(project)).status, 'READY');
  assert.deepEqual(await hookEvent(event(cwd, 'owner'), home, { scoped: true }), {});
});

test('owned task cannot be mutated by legacy clients or implicitly replaced by owner', async t => {
  const home = await fixture(t), project = await fixture(t);
  const owner = new Workflow(home, host('owner'));
  await owner.prepare(project, { mode: 'implementation', task: 'Feature', checks: [pass] });
  const before = await readFile(owner.files(project).contract);
  await assert.rejects(() => owner.prepare(project, { mode: 'implementation', task: 'Replacement', checks: [pass] }), /active|owner|task/i);
  const legacy = new Workflow(home);
  await legacy.prepare(project, { task: 'Independent legacy task', checks: [pass] });
  await legacy.review(project, 'Review independent legacy evidence only.');
  assert.deepEqual(await readFile(owner.files(project).contract), before);
});

test('corrupt owner/generation state cannot make an active owner Stop succeed', async t => {
  const home = await fixture(t), project = await fixture(t);
  const flow = new Workflow(home, host('owner'));
  await flow.prepare(project, { mode: 'implementation', task: 'Active task', checks: [pass] });
  const gateFile = projectGateFile(home, await realpath(project), 'owner');
  const gate = JSON.parse(await readFile(gateFile));
  await writeFile(gateFile, JSON.stringify({ ...gate, ownerSessionId: 'other' }));
  assert.equal((await hookEvent(event(project, 'owner'), home, { scoped: true })).decision, 'block');
});

test('completed owner is not blocked when a different session starts the next generation', async t => {
  const home = await fixture(t), project = await fixture(t);
  const owner = new Workflow(home, host('owner'));
  await hookEvent(event(project, 'owner', 'SessionStart'), home, { scoped: true });
  await owner.prepare(project, { mode: 'implementation', task: 'First task', checks: [pass] });
  await owner.review(project, 'Reviewed first implementation.');
  assert.equal((await owner.finish(project)).status, 'READY');
  assert.deepEqual(await hookEvent(event(project, 'owner'), home, { scoped: true }), {});
  const other = new Workflow(home, host('other'));
  await other.prepare(project, { mode: 'implementation', task: 'Next generation', checks: [pass] });
  assert.deepEqual(await hookEvent(event(project, 'owner'), home, { scoped: true }), {});
  assert.equal((await hookEvent(event(project, 'other'), home, { scoped: true })).decision, 'block');
});

test('unchanged FAIL is inspected without re-executing checks; changed evidence permits a retry', async t => {
  const home = await fixture(t), project = await fixture(t, { 'main.ts': 'try {} catch {}' });
  const count = path.join(home, 'count');
  const flow = new Workflow(home, host('owner'));
  await flow.prepare(project, { mode: 'implementation', task: 'Fix catch', checks: [{ ...pass, args: ['-e', `require('fs').appendFileSync(${JSON.stringify(count)},'x')`] }] });
  await flow.review(project, 'Reviewed executable checks and unresolved finding.');
  assert.equal((await flow.verify(project)).status, 'FAIL');
  await assert.rejects(() => flow.finish(project), /unchanged|status|details/i);
  assert.equal(await readFile(count, 'utf8'), 'x');
  await writeFile(path.join(project, 'main.ts'), 'export const value=1;');
  await flow.review(project, 'Reviewed fix and executable coverage.');
  assert.equal((await flow.finish(project)).status, 'READY');
  assert.equal(await readFile(count, 'utf8'), 'xx');
});

test('explicit generated root exclusion binds evidence without suppressing source findings', async t => {
  const home = await fixture(t);
  const project = await fixture(t, { 'main.ts': 'try {} catch {}', '.test-dist/main.js': 'try {} catch {}' });
  const flow = new Workflow(home, host('owner'));
  await flow.prepare(project, { mode: 'implementation', task: 'Remove duplicate generated finding', checks: [pass], excludeRoots: ['.test-dist'] });
  const report = await flow.verify(project);
  assert.equal(report.status, 'FAIL');
  assert.deepEqual(report.findings.map(f => f.file), ['main.ts']);
  const file = flow.files(project).contract;
  const contract = JSON.parse(await readFile(file));
  await writeFile(file, JSON.stringify({ ...contract, excludeRoots: [] }));
  assert.equal((await flow.status(project)).status, 'STALE');
});

test('legacy cancellation cannot disarm an owned task and only its trusted owner may cancel it', async t => {
  const home = await fixture(t), project = await fixture(t);
  const owner = new Workflow(home, host('owner'));
  const prepared = await owner.prepare(project, { mode: 'implementation', task: 'Owned feature', checks: [pass] });
  for (const flow of [new Workflow(home), new Workflow(home, host('other')), new Workflow(home, host('sess_subagent_agent_reviewer'))]) {
    await assert.rejects(() => flow.cancel(project, { expectedRunId: prepared.runId, reason: 'Cancel a task belonging to someone else.' }), /owner|session|subagent|owned|generation/i);
  }
  const gateFile = projectGateFile(home, await realpath(project), 'owner');
  assert.equal(JSON.parse(await readFile(gateFile)).active, true);
  assert.equal((await owner.cancel(project, { expectedRunId: prepared.runId, reason: 'Owner explicitly withdrew implementation.' })).status, 'CANCELLED');
  assert.equal((await owner.status(project)).status, 'CANCELLED');
  assert.deepEqual(await hookEvent(event(project, 'owner'), home, { scoped: true }), {});
});

test('administrative cancellation archives exact legacy run and never fabricates READY', async t => {
  const home = await fixture(t), project = await fixture(t);
  const flow = new Workflow(home);
  await flow.prepare(project, { task: 'Erroneously armed read-only review', checks: [] });
  const original = JSON.parse(await readFile(flow.files(project).contract));
  await assert.rejects(() => flow.cancel(project, { expectedRunId: 'different', reason: 'Wrong contract' }), /generation|run|changed/i);
  const result = await flow.cancel(project, { expectedRunId: original.runId, reason: 'Created for a read-only question by mistake.' });
  assert.equal(result.status, 'CANCELLED');
  const history = JSON.parse(await readFile(result.archive));
  assert.deepEqual(history.contract, original);
  assert.equal(history.gate.active, true);
  assert.equal((await flow.status(project)).status, 'CANCELLED');
  assert.deepEqual(await hookEvent(event(project, 'owner'), home, { scoped: true }), {});
  const gate = JSON.parse(await readFile(projectGateFile(home, await realpath(project))));
  assert.equal(gate.active, false);
  assert.equal(gate.status, 'CANCELLED');
  assert.deepEqual(JSON.parse(await readFile(flow.files(project).contract)), original);
});
