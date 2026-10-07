import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink, mkdir, realpath, access } from 'node:fs/promises';
import path from 'node:path';
import { Workflow } from '../src/workflow.mjs';
import { hookEvent } from '../src/hooks.mjs';
import { compactReport, reportDetails } from '../src/presentation.mjs';
import { fixture } from './helpers.mjs';

const check = { id: 'docs', command: '$NODE', args: ['-e', 'process.exit(0)'] };
const scope = { kind: 'documentation', paths: ['docs', 'README.md'] };
const flowFor = home => new Workflow(home, { scoped: true, sessionId: 'sess_docs' });
async function prepared(t, files = {}) {
  const home = await fixture(t);
  const project = await fixture(t, { 'src/app.ts': 'try {} catch {}', 'README.md': '# README', 'docs/spec.md': '# Spec', ...files });
  const flow = flowFor(home);
  await hookEvent({ cwd: project, session_id: 'sess_docs', hook_event_name: 'SessionStart' }, home, { scoped: true });
  await flow.prepare(project, { mode: 'implementation', task: 'Only documentation', scope, checks: [check] });
  return { home, project, flow };
}
test('documentation task reaches scoped READY while preserving existing source findings as warnings', async t => {
  const { project, flow, home } = await prepared(t, { '.test-dist/test.js': 'try {} catch {}' });
  await writeFile(path.join(project, 'docs/spec.md'), '# Updated spec');
  await writeFile(path.join(project, 'docs/new.md'), '# New spec');
  await flow.review(project, 'Reviewed documentation with code unchanged.');
  const result = await flow.finish(project);
  assert.equal(result.status, 'READY');
  assert.equal(result.findings.length, 0);
  assert.deepEqual(result.warnings.map(f => f.file).sort(), ['.test-dist/test.js', 'src/app.ts']);
  assert.equal(result.scope.kind, 'documentation');
  assert.match(result.coverage, /documentation|repository.*not/i);
  const summary = compactReport(result);
  assert.equal(summary.warningCount, 2);
  assert.equal(summary.scope.kind, 'documentation');
  assert.equal((await reportDetails(flow, project, { section: 'warnings' })).total, 2);
  assert.deepEqual(await hookEvent({ cwd: project, session_id: 'sess_docs', hook_event_name: 'Stop' }, home, { scoped: true }), {});
});
test('source mutation before checks blocks without executing documentation commands', async t => {
  const { project, flow, home } = await prepared(t);
  const marker = path.join(home, 'ran');
  const contractFile = flow.files(project).contract;
  const contract = JSON.parse(await readFile(contractFile));
  await writeFile(contractFile, JSON.stringify({ ...contract, checks: [{ ...check, args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)},'yes')`] }] }));
  await writeFile(path.join(project, 'src/app.ts'), 'export const value=1;');
  const result = await flow.verify(project);
  assert.equal(result.status, 'FAIL');
  assert.ok(result.errors.some(e => /outside|unchanged|scope/i.test(e.message)));
  await assert.rejects(() => access(marker), { code: 'ENOENT' });
});
for (const operation of ['add', 'delete', 'rename', 'non-markdown']) {
  test(`documentation scope blocks ${operation} outside allowed Markdown`, async t => {
    const { project, flow } = await prepared(t);
    if (operation === 'add') await writeFile(path.join(project, 'src/new.ts'), 'export const value=1;');
    if (operation === 'delete') await unlink(path.join(project, 'src/app.ts'));
    if (operation === 'rename') { await unlink(path.join(project, 'src/app.ts')); await writeFile(path.join(project, 'src/moved.ts'), 'try {} catch {}'); }
    if (operation === 'non-markdown') await writeFile(path.join(project, 'docs/build.cjs'), 'process.exit(0)');
    assert.equal((await flow.verify(project)).status, 'FAIL');
  });
}
test('documentation check modifying source cannot produce READY', async t => {
  const home = await fixture(t), project = await fixture(t, { 'README.md': '# Docs', 'src/app.ts': 'export const value=1;' });
  const flow = flowFor(home);
  await flow.prepare(project, { mode: 'implementation', task: 'Docs with malicious check', scope, checks: [{ ...check, args: ['-e', "require('fs').writeFileSync('src/app.ts','export const value=2;')"] }] });
  await flow.review(project, 'Reviewed doc task boundary before execution.');
  assert.notEqual((await flow.finish(project)).status, 'READY');
});
test('scope paths and exclusions reject blanket or non-document targets before gate creation', async t => {
  for (const options of [
    { scope: { kind: 'documentation', paths: ['.'] } },
    { scope: { kind: 'documentation', paths: ['src'] } },
    { scope: { kind: 'documentation', paths: ['docs', 'docs'] } },
    { scope: { kind: 'documentation', paths: ['../docs'] } },
    { scope: { kind: 'documentation', paths: [] } },
    { scope: { kind: 'documentation', paths: ['package.json'] } },
    { scope, excludeRoots: ['src'] }
  ]) {
    const home = await fixture(t), project = await fixture(t);
    await assert.rejects(() => flowFor(home).prepare(project, { mode: 'implementation', task: 'Invalid scope', checks: [check], ...options }), /scope|documentation|paths|exclusion/i);
    await assert.rejects(() => access(path.join(project, '.scar')), { code: 'ENOENT' });
  }
});
test('docs scope requires explicit executable checks, not npm autodiscovery', async t => {
  const home = await fixture(t), project = await fixture(t, { 'package.json': '{"scripts":{"test":"exit 0"}}' });
  await assert.rejects(() => flowFor(home).prepare(project, { mode: 'implementation', task: 'Docs', scope }), /explicit|checks/i);
});
test('outside-baseline or scope tampering never renews scoped verification', async t => {
  const { home, project, flow } = await prepared(t);
  const file = flow.files(project).contract;
  const contract = JSON.parse(await readFile(file));
  assert.ok(contract.documentationBaseline);
  await writeFile(file, JSON.stringify({ ...contract, documentationBaseline: 'forged' }));
  await assert.rejects(() => flow.verify(project), /scope|baseline/i);
});
test('scope removal or replacement cannot silently renew a sealed docs task', async t => {
  for (const replacement of [undefined, { kind: 'documentation', paths: ['docs/spec.md'] }]) {
    const { project, flow } = await prepared(t);
    const file = flow.files(project).contract, contract = JSON.parse(await readFile(file));
    await writeFile(file, JSON.stringify({ ...contract, scope: replacement }));
    await assert.rejects(() => flow.verify(project), /scope|baseline/i);
  }
});
for (const file of ['dist/generated.js', 'build/generated.js', '.test-dist/generated.js', 'backup.zip', 'package.json']) {
  test(`documentation baseline protects ${file} even when default code scan excludes it`, async t => {
    const { project, flow } = await prepared(t, { [file]: 'original' });
    await writeFile(path.join(project, file), 'modified');
    const report = await flow.verify(project);
    assert.equal(report.status, 'FAIL');
    assert.equal(report.checks.length, 0);
    assert.ok(report.errors.some(e => e.id === 'SCAR-DOCS-BOUNDARY'));
  });
}
test('warning result stays bounded with full counts and scope metadata retained', async t => {
  const { project, flow } = await prepared(t);
  const result = await flow.verify(project);
  const warnings = Array.from({ length: 200 }, (_, i) => ({ id: 'SCAR-001', file: 'src/' + i + '.ts', line: 1, message: 'x'.repeat(1000) }));
  const summary = compactReport({ ...result, warnings, scope: { kind: 'documentation', paths: Array.from({ length: 32 }, (_, i) => 'docs/' + i + '/'+ 'a'.repeat(220)) } });
  assert.equal(summary.warningCount, 200);
  assert.equal(summary.scope.pathCount, 32);
  assert.ok(JSON.stringify(summary).length <= 6000);
  assert.ok(summary.warnings.length <= 8);
});
test('documentation checks can fail normally and missing coverage is never a warning-only success', async t => {
  const { project, flow } = await prepared(t);
  const file = flow.files(project).contract, contract = JSON.parse(await readFile(file));
  await writeFile(file, JSON.stringify({ ...contract, checks: [{ ...check, args: ['-e', 'process.exit(2)'] }] }));
  const result = await flow.verify(project);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.checks[0].exitCode, 2);
  assert.equal(result.warnings[0].id, 'SCAR-001');
});
test('documentation scope does not turn parser coverage errors into warnings', async t => {
  const { flow, project } = await prepared(t, { 'src/invalid.js': 'enum Mode { Active }' });
  const report = await flow.verify(project);
  assert.equal(report.status, 'FAIL');
  assert.ok(report.errors.some(e => e.file === 'src/invalid.js'));
});
test('fresh source mutation revokes prior documentation READY without a check rerun', async t => {
  const { project, flow, home } = await prepared(t);
  await flow.review(project, 'Reviewed documentation and protected source.');
  assert.equal((await flow.finish(project)).status, 'READY');
  await writeFile(path.join(project, 'src/app.ts'), 'export const value=1;');
  assert.notEqual((await flow.status(project)).status, 'READY');
  assert.equal((await hookEvent({ cwd: project, session_id: 'sess_docs', hook_event_name: 'Stop' }, home, { scoped: true })).decision, 'block');
});
test('default full-repository verification still blocks unchanged SCAR-001', async t => {
  const home = await fixture(t), project = await fixture(t, { 'app.ts': 'try {} catch {}' });
  const flow = new Workflow(home);
  await flow.prepare(project, { task: 'Implementation', checks: [check] });
  assert.equal((await flow.verify(project)).status, 'FAIL');
});
