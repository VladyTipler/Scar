import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { Catalog } from '../src/catalog.mjs';
import { Workflow } from '../src/workflow.mjs';
import { hookEvent } from '../src/hooks.mjs';
import { fixture } from './helpers.mjs';

const exec = promisify(execFile);
const behavior = { id: 'behavior', command: '$NODE', args: ['-e', 'process.exit(0)'] };
const record = {
  id: 'ADVERSARIAL-DEBUG',
  title: 'Unconditional debug flag',
  explanation: 'A production source must not enable debug without an environment condition.',
  prevention: 'Read debug mode from the explicit deployment environment.',
  extensions: ['.ts'],
  detector: `export default ({files}) => files.filter(f => /debug\\s*:\\s*true/.test(f.text)).map(f => ({file:f.path,line:1,message:'Unconditional debug flag'}));`,
  evidence: 'Independent synthetic defect and different formatting of the same class.',
  fixtures: {
    bad: [{ path: 'config.ts', text: 'const settings = {debug: true};' }],
    alternate: [{ path: 'options.ts', text: 'const options = { debug : true };' }],
    good: [{ path: 'config.ts', text: 'const settings = {debug: false};' }]
  }
};

async function closedStatus(project, home) {
  const flow = new Workflow(home);
  await flow.prepare(project, { task: 'Independent verification acceptance', checks: [behavior] });
  await flow.review(project, 'Reviewed declared native source guards and project acceptance checks.');
  return await flow.finish(project);
}

test('source with NUL bytes produces a coverage failure instead of READY', async t => {
  const root = await fixture(t, { 'broken.ts': 'export const value = 1;\u0000' });
  const result = await closedStatus(root, await fixture(t));
  assert.notEqual(result.status, 'READY', 'A declared .ts source was silently omitted as binary');
  assert.ok(result.errors.length, 'The unsupported source encoding needs an explicit diagnostic');
});

test('nested source directory named build remains part of detector coverage', async t => {
  const root = await fixture(t, { 'src/build/publish.ts': 'items.forEach(async item => await publish(item));' });
  const result = await closedStatus(root, await fixture(t));
  assert.notEqual(result.status, 'READY', 'src/build is source, not a root generated artifact');
  assert.ok(result.findings.some(f => f.id === 'SCAR-002' && f.file === 'src/build/publish.ts'));
});

test('invalid JavaScript is rejected even when it is syntactically valid TypeScript', async t => {
  const root = await fixture(t, { 'invalid.mjs': 'export const value: number = 1;' });
  await assert.rejects(() => exec(process.execPath, ['--check', path.join(root, 'invalid.mjs')]), /SyntaxError/);
  const result = await closedStatus(root, await fixture(t));
  assert.notEqual(result.status, 'READY', 'A real JS runtime rejects this source');
  assert.ok(result.errors.length, 'The syntax failure must be surfaced as a source diagnostic');
});

test('learning cannot prove a declared scope using fixtures from a different language', async t => {
  const home = await fixture(t);
  const catalog = new Catalog(home);
  const revision = (await catalog.read()).revision;
  await assert.rejects(
    () => catalog.learn({ ...record, extensions: ['.py'] }, revision),
    /fixture|extension|scope/i,
    'Fixtures must execute with the same file selection used for actual verification'
  );
  assert.equal((await catalog.read()).records.length, 0);
});

test('loss of a previously persisted personal catalog cannot silently reset knowledge', async t => {
  const home = await fixture(t);
  const catalog = new Catalog(home);
  await catalog.learn(record, (await catalog.read()).revision);
  assert.equal(JSON.parse(await readFile(path.join(home, 'catalog.json'))).records.length, 1);
  await rm(path.join(home, 'catalog.json'));
  // A new instance represents a fresh agent process, not a cached in-memory reader.
  await assert.rejects(() => new Catalog(home).read(), /missing|lost|catalog|unavailable/i);
});

test('native completion gate observes Dockerfile software changes in a no-Git project', async t => {
  const root = await fixture(t, { Dockerfile: 'FROM node:24\nCMD ["node", "server.mjs"]\n' });
  const home = await fixture(t);
  const event = { cwd: root, session_id: 'adversarial-docker' };
  await hookEvent({ ...event, hook_event_name: 'SessionStart' }, home);
  await writeFile(path.join(root, 'Dockerfile'), 'FROM node:24\nCMD ["node", "missing.mjs"]\n');
  const result = await hookEvent({ ...event, hook_event_name: 'Stop' }, home);
  assert.equal(result.decision, 'block', 'Runtime configuration changes require executable evidence too');
});
