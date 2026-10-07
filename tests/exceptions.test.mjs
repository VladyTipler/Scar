import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Workflow } from '../src/workflow.mjs';
import { digest } from '../src/io.mjs';
import { fixture, candidate } from './helpers.mjs';
import { Catalog } from '../src/catalog.mjs';

const source = 'try { readOptionalPreference(); } catch {}\n';
const entry = { id: 'SCAR-001', file: 'optional.ts', line: 1, sourceHash: digest(Buffer.from(source)), reason: 'Preference storage is optional; denied reads keep the documented system default.' };
const checks = [{ id: 'contract', command: '$NODE', args: ['-e', 'process.exit(0)'] }];
async function setup(t, exception) {
  const root = await fixture(t, { 'optional.ts': source, ...(exception === undefined ? {} : { '.scar/exceptions.json': typeof exception === 'string' ? exception : JSON.stringify(exception) }) });
  const flow = new Workflow(await fixture(t));
  await flow.prepare(root, { task: 'Document optional fallback with exact evidence', checks });
  return { root, flow };
}

test('documented exact exception crosses real workflow and remains auditable', async t => {
  const { root, flow } = await setup(t);
  assert.equal((await flow.verify(root)).status, 'FAIL');
  await writeFile(path.join(root, '.scar/exceptions.json'), JSON.stringify({ schema: 1, entries: [entry] }));
  await flow.review(root, 'Reviewed optional preference fallback; native guards stay active.');
  const result = await flow.finish(root);
  assert.equal(result.status, 'READY');
  assert.deepEqual(result.acceptedExceptions, [entry]);
  await writeFile(path.join(root, 'new.ts'), 'try { unrelatedFailure(); } catch {}');
  assert.equal((await flow.status(root)).status, 'STALE');
  const next = await flow.verify(root);
  assert.equal(next.status, 'FAIL');
  assert.ok(next.findings.some(f => f.file === 'new.ts'));
});

test('any source edit revokes exact exception and removing finding makes it stale', async t => {
  const { root, flow } = await setup(t, { schema: 1, entries: [entry] });
  await writeFile(path.join(root, 'optional.ts'), source.replace('readOptionalPreference', 'readCriticalPreference'));
  let result = await flow.verify(root);
  assert.equal(result.status, 'FAIL');
  assert.match(result.errors.map(e => e.message).join('\n'), /hash|stale/i);
  await writeFile(path.join(root, 'optional.ts'), 'export const fixed = true;');
  result = await flow.verify(root);
  assert.equal(result.status, 'FAIL');
  assert.match(result.errors.map(e => e.message).join('\n'), /unused|stale/i);
});

for (const [name, config] of Object.entries({
  malformed: '{', wrongSchema: { schema: 2, entries: [entry] }, duplicate: { schema: 1, entries: [entry, entry] },
  unknownRule: { schema: 1, entries: [{ ...entry, id: 'SCAR-002' }] }, wrongLine: { schema: 1, entries: [{ ...entry, line: 2 }] },
  wrongHash: { schema: 1, entries: [{ ...entry, sourceHash: '0'.repeat(64) }] }, shortReason: { schema: 1, entries: [{ ...entry, reason: 'ignore' }] },
  directory: { schema: 1, entries: [{ ...entry, file: '.' }] }, traversal: { schema: 1, entries: [{ ...entry, file: '../optional.ts' }] },
  unexpectedField: { schema: 1, entries: [{ ...entry, ignore: true }] }, unexpectedRoot: { schema: 1, entries: [entry], ignoreDirectories: ['src'] },
})) test(`invalid exception ${name} fails coverage without swallowing findings`, async t => {
  const { root, flow } = await setup(t, config);
  const result = await flow.verify(root);
  assert.equal(result.status, 'FAIL');
  assert.ok(result.errors.some(e => e.file === '.scar/exceptions.json'));
  assert.ok(result.findings.some(f => f.id === 'SCAR-001'));
});

test('valid exception cannot waive parse errors or other built-in guards', async t => {
  const { root, flow } = await setup(t, { schema: 1, entries: [entry] });
  await writeFile(path.join(root, 'broken.ts'), 'const = ;');
  await writeFile(path.join(root, 'async.ts'), 'items.forEach(async item => await save(item));');
  const result = await flow.verify(root);
  assert.equal(result.status, 'FAIL');
  assert.ok(result.errors.some(e => e.file === 'broken.ts'));
  assert.ok(result.findings.some(f => f.id === 'SCAR-002'));
});

test('a single hashed exception audits all same-line catches; learned guards remain active', async t => {
  const { root, flow } = await setup(t);
  const sameLine = 'try { optionalA(); } catch {} try { optionalB(); } catch {}';
  await writeFile(path.join(root, 'optional.ts'), sameLine);
  const exact = { ...entry, sourceHash: digest(Buffer.from(sameLine)) };
  await writeFile(path.join(root, '.scar/exceptions.json'), JSON.stringify({ schema: 1, entries: [exact] }));
  let result = await flow.verify(root);
  assert.equal(result.status, 'VERIFIED');
  assert.deepEqual(result.acceptedExceptions, [exact]);
  await new Catalog(flow.home).learn(candidate, (await new Catalog(flow.home).read()).revision);
  await writeFile(path.join(root, 'settings.ts'), 'export const settings = {debug: true};');
  result = await flow.verify(root);
  assert.equal(result.status, 'FAIL');
  assert.ok(result.findings.some(f => f.id === candidate.id));
});

test('changed exception metadata revokes freshness and invalid partial configs grant no approvals', async t => {
  const { root, flow } = await setup(t, { schema: 1, entries: [entry] });
  await flow.review(root, 'Reviewed fallback and source-hash approval before freshness checks.');
  assert.equal((await flow.finish(root)).status, 'READY');
  await writeFile(path.join(root, '.scar/exceptions.json'), JSON.stringify({ schema: 1, entries: [entry, { ...entry, file: 'missing.ts' }] }));
  assert.equal((await flow.status(root)).status, 'STALE');
  const result = await flow.verify(root);
  assert.equal(result.status, 'FAIL');
  assert.deepEqual(result.acceptedExceptions, []);
  assert.ok(result.findings.some(f => f.file === 'optional.ts'));
});
