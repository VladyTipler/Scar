import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshot } from '../src/workspace-state.mjs';
import { fixture } from './helpers.mjs';

test('snapshot excludes only configured generated-output root directories', async (t) => {
  const project = await fixture(t, {
    'app.js': 'export const app = true;',
    '.test-dist/generated.js': 'throw new Error("generated");',
    'src/generated.js': 'export const source = true;',
    'src/.test-dist/source.js': 'export const nested = true;',
    'other/.test-dist.js': 'export const retained = true;'
  });

  const state = await snapshot(project, { excludeRoots: ['.test-dist'] });

  assert.deepEqual(state.files.map(({ path }) => path), [
    'app.js',
    'other/.test-dist.js',
    'src/.test-dist/source.js',
    'src/generated.js'
  ]);
  assert.ok(!state.entries.some(([name]) => name.startsWith('.test-dist/')));
});

test('snapshot rejects unsafe explicit root exclusions', async (t) => {
  const project = await fixture(t, { 'app.js': 'export const app = true;' });

  for (const excluded of ['.', '..', '/tmp', 'folder/name', 'folder\\name', '.scar', 'node_modules', 1]) {
    await assert.rejects(
      snapshot(project, { excludeRoots: [excluded] }),
      /excludeRoots/
    );
  }
});

test('snapshot requires unique string root exclusions', async (t) => {
  const project = await fixture(t, { 'app.js': 'export const app = true;' });

  await assert.rejects(snapshot(project, { excludeRoots: ['.test-dist', '.test-dist'] }), /excludeRoots/);
  await assert.rejects(snapshot(project, { excludeRoots: '.test-dist' }), /excludeRoots/);
});

test('explicit exclusions bind snapshot fingerprint even when roots do not exist', async (t) => {
  const project = await fixture(t, { 'app.js': 'export const app = true;' });

  const defaultState = await snapshot(project);
  const firstScope = await snapshot(project, { excludeRoots: ['.test-dist'] });
  const secondScope = await snapshot(project, { excludeRoots: ['.generated'] });

  assert.notEqual(defaultState.fingerprint, firstScope.fingerprint);
  assert.notEqual(firstScope.fingerprint, secondScope.fingerprint);
});
