import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { fixture, candidate } from './helpers.mjs';
import { atomicJson } from '../src/io.mjs';
import path from 'node:path';
import { Workflow } from '../src/workflow.mjs';
import { publicCatalog, compactReport, preventionContext } from '../src/presentation.mjs';

test('a thousand-class catalog stays outside bounded preparation context', async t => {
  const home = await fixture(t);
  const project = await fixture(t, { 'src/main.ts': 'export const value=1;' });
  const records = Array.from({ length: 1000 }, (_, i) => ({ ...candidate, id: `PERSONAL-${String(i).padStart(4, '0')}`, title: `${candidate.title} ${i}`, explanation: 'Large incident evidence. '.repeat(400), prevention: 'Useful bounded guidance. '.repeat(100) }));
  await atomicJson(path.join(home, 'catalog.json'), { schema: 1, records });
  const flow = new Workflow(home);
  const prepared = await flow.prepare(project, { task: 'Feature', checks: [] });
  assert.equal(prepared.applicableCount, 1003);
  assert.ok(prepared.classes.length <= 8);
  assert.ok(JSON.stringify(prepared).length < 6500);
  assert.ok(prepared.classes.every(c => !('detector' in c) && !('fixtures' in c) && !('explanation' in c)));
  // Context budget must never narrow actual execution coverage.
  assert.equal((await flow.context(project)).classes.length, 1003);
  const index = await publicCatalog(flow.catalog, { limit: 5 });
  assert.equal(index.total, 1000);
  assert.equal(index.classes.length, 5);
  assert.ok(JSON.stringify(index).length < 4000);
  const detail = await publicCatalog(flow.catalog, { id: records[17].id });
  assert.equal(detail.record.id, records[17].id);
  assert.ok(!('detector' in detail.record) && !('fixtures' in detail.record));
});

test('task/path hints rank prevention context but all extension-applicable guards remain selected', async t => {
  const home = await fixture(t);
  const project = await fixture(t, { 'src/auth/owner.ts': 'export const owner=1;' });
  await atomicJson(path.join(home, 'catalog.json'), { schema: 1, records: [
    { ...candidate, id: 'PERSONAL-001', title: 'Image layout', tags: ['layout'], paths: ['src/images/'] },
    { ...candidate, id: 'PERSONAL-002', title: 'Owner authorization', tags: ['auth', 'owner'], paths: ['src/auth/'] }
  ] });
  const flow = new Workflow(home);
  const prepared = await flow.prepare(project, { task: 'Owner authorization', checks: [], focusPaths: ['src/auth/owner.ts'] });
  assert.equal(prepared.classes[0].id, 'PERSONAL-002');
  assert.equal((await flow.context(project)).classes.length, 5);
});

test('failure summaries preserve failure counts and never dump command logs or unlimited findings', () => {
  const report = { status: 'FAIL', findings: Array.from({ length: 600 }, (_, i) => ({ id: 'RULE', file: `file${i}.ts`, line: 1, message: 'Failed '.repeat(300) })), errors: [], checks: [{ id: 'test', status: 'FAIL', exitCode: 1, stdout: 'x'.repeat(900_000), stderr: 'trace'.repeat(1000) }], classes: Array.from({ length: 1000 }, (_, i) => `RULE-${i}`) };
  const compact = compactReport(report);
  assert.equal(compact.status, 'FAIL');
  assert.equal(compact.findingCount, 600);
  assert.ok(compact.findings.length <= 8);
  assert.ok(JSON.stringify(compact).length < 6500);
  assert.ok(!JSON.stringify(compact).includes('trace'));
});

test('oversized scalar metadata cannot hang a compact report with empty evidence arrays', () => {
  const module = new URL('../src/presentation.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { compactReport } from ${JSON.stringify(module)};
    const report = compactReport({ status: 'FAIL', binding: 'b'.repeat(12000), evidence: 'e'.repeat(12000), findings: [], errors: [], checks: [], acceptedExceptions: [{ id: 'SCAR-001' }] });
    process.stdout.write(JSON.stringify(report));
  `], { encoding: 'utf8', timeout: 1500 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.ok(result.stdout.length <= 6000);
  assert.equal(JSON.parse(result.stdout).acceptedExceptionCount, 1);
});

test('context budgets are enforced against metadata and paginated reads are explicit', async t => {
  const home = await fixture(t);
  const flow = new Workflow(home);
  await assert.rejects(() => publicCatalog(flow.catalog, { limit: 10000 }), /limit/i);
  await assert.rejects(() => publicCatalog(flow.catalog, { id: 'MISSING' }), /found/i);
});

test('additional prevention hints are retrievable without changing execution selection', () => {
  const classes=Array.from({length:30},(_,i)=>({...candidate,id:`PERSONAL-${i}`}));
  const first=preventionContext(classes);
  const second=preventionContext(classes,'',[],{offset:first.nextOffset,limit:12});
  assert.equal(first.nextOffset,8);
  assert.equal(second.classes[0].id,'PERSONAL-8');
  assert.equal(second.applicableCount,30);
  assert.equal(second.classes.length,12);
  const worst=compactReport({status:'FAIL',findings:Array.from({length:100},()=>({id:'i'.repeat(64),file:'f'.repeat(1000),line:1,message:'m'.repeat(1000)})),errors:Array.from({length:100},()=>({id:'i'.repeat(64),file:'f'.repeat(1000),message:'m'.repeat(1000)})),checks:Array.from({length:100},()=>({id:'i'.repeat(80),status:'FAIL',exitCode:1}))});
  assert.ok(JSON.stringify(worst).length<6500);
});
