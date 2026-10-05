import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { Workflow } from '../src/workflow.mjs';
import { Catalog } from '../src/catalog.mjs';
import { createScarBoundary } from '../integrations/nexus/bridge.mjs';
import { runCheck } from '../src/process.mjs';
import { fixture, candidate } from './helpers.mjs';

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const pass = { id: 'behavior', command: '$NODE', args: ['-e', 'process.exit(0)'] };

test('low-ranked class beyond bounded hints still executes and prevents READY', async t => {
  const home = await fixture(t);
  const catalog = new Catalog(home);
  for (let i = 0; i < 9; i++) {
    await catalog.learn({ ...candidate, id: `AUDIT-${i}` }, (await catalog.read()).revision);
  }
  const project = await fixture(t, { 'main.ts': 'export const settings = {debug: true};' });
  const flow = new Workflow(home);
  const context = await flow.prepare(project, { task: 'Generic feature', checks: [pass] });
  assert.equal(context.classes.length, 8);
  assert.ok(!context.classes.some(c => c.id === 'AUDIT-8'));
  await flow.review(project, 'Reviewed the complete set of applicable executable class guards.');
  const report = await flow.finish(project);
  assert.equal(report.status, 'FAIL');
  assert.ok(report.findings.some(f => f.id === 'AUDIT-8'));
});

test('review cannot promote no-checks or failed-command evidence to READY', async t => {
  const project = await fixture(t, { 'main.ts': 'export const value=1;' });
  const flow = new Workflow(await fixture(t));
  await flow.prepare(project, { task: 'No configured checks', checks: [] });
  await flow.review(project, 'Reviewed native classes, but project check evidence is missing.');
  assert.equal((await flow.finish(project)).status, 'INCOMPLETE');
  await flow.prepare(project, { task: 'Failing check', checks: [{ ...pass, args: ['-e', 'process.exit(9)'] }] });
  await flow.review(project, 'Reviewed classes; command failures must still prevent completion.');
  assert.equal((await flow.finish(project)).status, 'FAIL');
  await flow.prepare(project, { task: 'Passing check', checks: [pass] });
  await flow.review(project, 'Reviewed all applicable classes and project acceptance checks.');
  assert.equal((await flow.finish(project)).status, 'READY');
  await writeFile(path.join(project, 'main.ts'), 'export const value=2;');
  assert.equal((await flow.status(project)).status, 'STALE');
});

test('replacement cannot remove old fixture languages from actual guard scope', async t => {
  const home = await fixture(t);
  const catalog = new Catalog(home);
  const original = await catalog.learn(candidate, (await catalog.read()).revision);
  const fixtures = Object.fromEntries(Object.entries(candidate.fixtures).map(([kind, files]) => [kind,
    files.map(file => ({ ...file, path: file.path.replace(/\.js$/, '.ts') }))
  ]));
  await assert.rejects(
    () => catalog.learn({ ...candidate, extensions: ['.ts'], fixtures }, original.revision, { replace: true }),
    /scope|extension|coverage|generation|regression/i,
    'Historical JS fixtures passing a detector directly does not prove they remain selected in real workspaces'
  );
  assert.deepEqual((await catalog.read()).records[0].extensions, candidate.extensions);
});

test('replacement also retains earlier bad behavior fixtures', async t => {
  const catalog = new Catalog(await fixture(t));
  const original = await catalog.learn(candidate, (await catalog.read()).revision);
  const replacement = {
    ...candidate,
    detector: `export default ({files}) => files.filter(f=>/logging\\s*:\\s*true/.test(f.text)).map(f=>({file:f.path,line:1,message:'Unconditional logging'}));`,
    fixtures: Object.fromEntries(Object.entries(candidate.fixtures).map(([kind, files]) => [kind,
      files.map(file => ({ ...file, text: file.text.replaceAll('debug', 'logging') }))
    ]))
  };
  await assert.rejects(() => catalog.learn(replacement, original.revision, { replace: true }), /regression/i);
  assert.equal((await catalog.read()).revision, original.revision);
});

test('Nexus boundary refuses continue:false and unavailable/malformed tool responses', async () => {
  const context = { project: root, sessionId: 'final-audit-nexus' };
  const boundary = createScarBoundary({ invoke: async () => ({ content: [{ type: 'text', text: JSON.stringify({ continue: false, systemMessage: 'Scar INCOMPLETE: repair budget exhausted' }) }] }) });
  await assert.rejects(() => boundary.finish(context), error => error.code === 'scar_incomplete' && /INCOMPLETE/.test(error.message));
  for (const response of [{ isError: true }, { content: [] }]) {
    const broken = createScarBoundary({ invoke: async () => response });
    await assert.rejects(() => broken.finish(context));
  }
});

test('runtime packaging keeps hooks on the Codex 0.156.1 legacy loader path', async () => {
  await assert.rejects(() => access(path.join(root, 'plugin.json')), { code: 'ENOENT' });
  const manifest = JSON.parse(await readFile(path.join(root, '.codex-plugin', 'plugin.json')));
  const hooks = JSON.parse(await readFile(path.join(root, manifest.hooks)));
  assert.deepEqual(Object.keys(hooks.hooks).sort(), ['SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit']);
  assert.ok(Object.values(hooks.hooks).every(groups => groups.every(group => group.hooks.every(hook => hook.type === 'command'))));
  const mcp = JSON.parse(await readFile(path.join(root, '.mcp.json')));
  assert.equal(mcp.mcpServers.scar.command, 'node');
});

test('another unsupported TypeScript declaration cannot produce JavaScript READY', async t => {
  const project = await fixture(t, { 'invalid.mjs': 'enum Mode { Active }' });
  await assert.rejects(() => exec(process.execPath, ['--check', path.join(project, 'invalid.mjs')]), /SyntaxError/);
  const flow = new Workflow(await fixture(t));
  await flow.prepare(project, { task: 'JavaScript syntax validation', checks: [pass] });
  await flow.review(project, 'Reviewed syntax guards and runtime source acceptance.');
  const report = await flow.finish(project);
  assert.notEqual(report.status, 'READY', 'Enum declarations cannot execute in a plain JavaScript runtime');
  assert.ok(report.errors.length);
});

test('command evidence preserves Unicode when UTF-8 bytes cross stream chunks', async () => {
  const expected = JSON.stringify({ message: 'ошибка' });
  const program = `const bytes=Buffer.from(${JSON.stringify(expected)});process.stdout.write(bytes.subarray(0,13));setTimeout(()=>process.stdout.end(bytes.subarray(13)),50);`;
  const result = await runCheck({ id: 'utf8_boundary', command: '$NODE', args: ['-e', program] }, root);
  assert.equal(result.status, 'PASS');
  assert.equal(result.stdout, expected, 'Logs and detector JSON must preserve exact UTF-8 characters');
});
