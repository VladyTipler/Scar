import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { Workflow } from '../src/workflow.mjs';
import { projectGateFile } from '../src/io.mjs';
import { sessionTaskFile } from '../src/task-state.mjs';
import { fixture } from './helpers.mjs';

const check = exit => ({ id: `exit-${exit}`, command: '$NODE', args: ['-e', `process.exit(${exit})`] });
const prepare = (flow, project, exit) => flow.prepare(project, { mode: 'implementation', task: 'Scoped session compatibility', checks: [check(exit)] });

test('strict sessions keep independent contracts and reports in one project', async t => {
  const home = await fixture(t), project = await fixture(t, { 'main.ts': 'export const value = 1;' });
  const a = new Workflow(home, { scoped: true, sessionId: 'strict-a', workspace: project });
  const b = new Workflow(home, { scoped: true, sessionId: 'strict-b', workspace: project });
  await prepare(a, project, 0);
  await prepare(b, project, 1);
  assert.notEqual(a.files(project).contract, b.files(project).contract);
  assert.equal((await a.verify(project)).status, 'VERIFIED');
  assert.equal((await b.verify(project)).status, 'FAIL');
  assert.notEqual(await readFile(a.files(project).report, 'utf8'), await readFile(b.files(project).report, 'utf8'));
});

test('strict owner cannot authorize another session task', async t => {
  const home = await fixture(t), project = await fixture(t, { 'main.ts': 'export const value = 1;' });
  const owner = new Workflow(home, { scoped: true, sessionId: 'owner-a', workspace: project });
  await prepare(owner, project, 0);
  const other = new Workflow(home, { scoped: true, sessionId: 'owner-b', workspace: project });
  await assert.rejects(() => other.authorize(project), /owner|implementation/i);
});

test('matching strict owner may read an old root task without migrating it', async t => {
  const home = await fixture(t), project = await fixture(t, { 'main.ts': 'export const value = 1;' });
  const owner = new Workflow(home, { scoped: true, sessionId: 'old-owner', workspace: project });
  const canonical = await realpath(project);
  const folder = path.join(project, '.scar');
  const runId = 'legacy-run';
  await mkdir(folder, { recursive: true });
  await mkdir(path.join(home, 'projects'), { recursive: true });
  await mkdir(path.join(home, 'tasks'), { recursive: true });
  await writeFile(path.join(folder, 'contract.json'), JSON.stringify({ schema: 1, runId, task: 'old task', checks: [check(0)], ownerSessionId: 'old-owner', mode: 'implementation' }));
  await writeFile(projectGateFile(home, canonical), JSON.stringify({ schema: 1, active: true, runId, ownerSessionId: 'old-owner' }));
  await writeFile(sessionTaskFile(home, 'old-owner'), JSON.stringify({ schema: 2, active: true, ownerSessionId: 'old-owner', project: canonical, runId }));
  assert.equal(owner.files(project).contract, path.join(folder, 'contract.json'));
  assert.equal((await owner.authorize(project)).runId, runId);
  const other = new Workflow(home, { scoped: true, sessionId: 'other-owner', workspace: project });
  assert.notEqual(other.files(project).contract, owner.files(project).contract);
  const original = await readFile(owner.files(project).contract, 'utf8');
  await assert.rejects(() => prepare(owner, project, 0), /legacy|active/i);
  await assert.rejects(() => other.cancel(project, { expectedRunId: runId, reason: 'Foreign session cannot cancel this old task.' }), /generation/i);
  const cancelled = await owner.cancel(project, { expectedRunId: runId, reason: 'Owner explicitly replaces the old task with a scoped phase.' });
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(JSON.parse(await readFile(cancelled.archive)).contract.runId, runId);
  await prepare(owner, project, 0);
  assert.notEqual(owner.files(project).contract, path.join(folder, 'contract.json'));
  assert.equal(await readFile(path.join(folder, 'contract.json'), 'utf8'), original);
  assert.equal((await owner.verify(project)).status, 'VERIFIED');
});
