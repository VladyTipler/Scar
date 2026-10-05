import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { Workflow } from '../src/workflow.mjs';
import { Catalog } from '../src/catalog.mjs';
import { fixture, candidate } from './helpers.mjs';
const exec = promisify(execFile);
const cli = path.resolve('src/cli.mjs');
const check = { id: 'behavior', command: '$NODE', args: ['check.mjs'] };

test('no-Git prepare → real project check → learning review → fresh READY; changes revoke it', async t => {
  const root = await fixture(t, { 'main.ts': 'export const value = 1;', 'check.mjs': 'import {readFileSync} from "node:fs"; if(!readFileSync("main.ts","utf8").includes("value = 1")) process.exit(1);' });
  const home = await fixture(t);
  const flow = new Workflow(home);
  await flow.prepare(root, { task: 'Add a value', checks: [check] });
  assert.equal((await flow.verify(root)).status, 'VERIFIED');
  assert.equal((await flow.finish(root)).status, 'INCOMPLETE');
  await flow.review(root, 'No new error class found; behavior and failure paths checked.');
  assert.equal((await flow.finish(root)).status, 'READY');
  await writeFile(path.join(root, 'main.ts'), 'export const value = 2;');
  assert.equal((await flow.status(root)).status, 'STALE');
  assert.equal((await flow.finish(root)).status, 'FAIL');
});

test('learned detector reaches unrelated folder in a new process, then catches the class', async t => {
  const home = await fixture(t);
  const first = await fixture(t, { 'config.js': 'export const settings = {debug: true};' });
  const second = await fixture(t, { 'settings.ts': 'const options = {debug : true};', 'check.mjs': 'process.exit(0)' });
  const catalog = new Catalog(home);
  await catalog.learn(candidate, (await catalog.read()).revision);
  const { stdout } = await exec(process.execPath, [cli, 'prepare', second, '--home', home]);
  assert.ok(JSON.parse(stdout).classes.some(c => c.id === candidate.id));
  const flow = new Workflow(home);
  await flow.prepare(second, { task: 'Settings', checks: [check] });
  const result = await flow.verify(second);
  assert.equal(result.status, 'FAIL');
  assert.ok(result.findings.some(f => f.id === candidate.id));
  assert.ok((await flow.prepare(first)).classes.some(c => c.id === candidate.id));
});

test('empty check set, failing check and changing source during verification cannot close', async t => {
  const root = await fixture(t, { 'main.ts': 'export const value=1;' });
  const flow = new Workflow(await fixture(t));
  await flow.prepare(root, { task: 'Demo', checks: [] });
  assert.equal((await flow.verify(root)).status, 'INCOMPLETE');
  await flow.prepare(root, { task: 'Demo', checks: [{ id: 'change', command: '$NODE', args: ['-e', 'require("fs").writeFileSync("main.ts","export const value=2;")'] }] });
  assert.equal((await flow.verify(root)).status, 'STALE');
});

test('catalog update and contract tampering invalidate existing verification', async t => {
  const root = await fixture(t, { 'main.ts': 'export const value=1;', 'check.mjs': 'process.exit(0)' });
  const home = await fixture(t);
  const flow = new Workflow(home);
  await flow.prepare(root, { task: 'Demo', checks: [check] });
  await flow.review(root, 'Checked class coverage.');
  assert.equal((await flow.finish(root)).status, 'READY');
  const catalog = new Catalog(home);
  await catalog.learn(candidate, (await catalog.read()).revision);
  assert.equal((await flow.status(root)).status, 'STALE');
  await flow.review(root, 'Reviewed the newly added class.');
  assert.equal((await flow.finish(root)).status, 'READY');
  const contractPath = path.join(root, '.scar/contract.json');
  const contract = JSON.parse(await readFile(contractPath));
  contract.task = 'Changed';
  await writeFile(contractPath, JSON.stringify(contract));
  assert.equal((await flow.status(root)).status, 'STALE');
});
