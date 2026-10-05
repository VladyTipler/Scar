import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { discoverChecks } from '../src/discovery.mjs';
import { Workflow } from '../src/workflow.mjs';

test('plug-and-play discovers existing checks without user configuration', async t => {
  const project = await fixture(t, { 'package.json': JSON.stringify({ scripts: { test: 'vitest', 'test:feature': 'node --test integration/*.mjs', typecheck: 'tsc --noEmit', lint: 'eslint .', build: 'vite build', deploy: 'dangerous-command' } }), 'main.ts': 'export const value=1;' });
  const checks = await discoverChecks(project);
  assert.deepEqual(checks.map(c => c.id), ['test', 'test_feature', 'typecheck', 'lint', 'build']);
  assert.deepEqual(checks[0].args, ['run', 'test', '--', '--run']);
  assert.ok(checks.every(c => c.command === 'npm'));
  const flow = new Workflow(await fixture(t));
  await flow.prepare(project, { task: 'Example' });
  assert.equal((await flow.binding(project)).contract.checks.length, 5);
});

test('missing test infrastructure remains a visible gap; go and pytest use existing runners', async t => {
  const go = await fixture(t, { 'go.mod': 'module example\ngo 1.22' });
  assert.equal((await discoverChecks(go))[0].command, 'go');
  const python = await fixture(t, { 'pytest.ini': '[pytest]' });
  assert.deepEqual((await discoverChecks(python))[0].args, ['-m', 'pytest']);
  const empty = await fixture(t, { 'package.json': '{"scripts":{"test":"echo Error: no test specified && exit 1"}}' });
  assert.deepEqual(await discoverChecks(empty), []);
});
