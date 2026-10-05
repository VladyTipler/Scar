import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { scan, fingerprint } from '../src/workspace.mjs';
import { Catalog } from '../src/catalog.mjs';
import { runCheck } from '../src/process.mjs';
import { fixture, candidate } from './helpers.mjs';

test('AST guards catch variants and pass valid counterexamples, including Vue', async t => {
  const root = await fixture(t, {
    'bad.ts': 'try { work(); } catch {}\nitems.forEach(async item => await save(item));\nnew Promise(async (resolve) => resolve(await work()));',
    'other.js': 'try { work(); } catch (error) { /* ignored */ }\nitems["forEach"](async function(item){ await save(item); });',
    'good.ts': 'try { work(); } catch(e) { report(e); }\nawait Promise.all(items.map(async i => save(i)));\nnew Promise(resolve => resolve(1));',
    'Panel.vue': '<template><p>Fine</p></template><script setup lang="ts">items.forEach(async i => await save(i));</script>',
    'strings.js': 'const example = "new Promise(async resolve => resolve(1))"; // catch {}'
  });
  const result = await scan(root);
  assert.equal(result.errors.length, 0);
  assert.equal(result.findings.filter(f => f.id === 'SCAR-001').length, 2);
  assert.equal(result.findings.filter(f => f.id === 'SCAR-002').length, 3);
  assert.equal(result.findings.filter(f => f.id === 'SCAR-003').length, 1);
  assert.ok(result.findings.every(f => !['good.ts', 'strings.js'].includes(f.file)));
});

test('malformed source is a coverage error, never a silent pass', async t => {
  const root = await fixture(t, { 'broken.ts': 'const = ;' });
  assert.ok((await scan(root)).errors.length);
});

test('fingerprints work without Git, ignore evidence and notice source/config changes', async t => {
  const root = await fixture(t, { 'main.py': 'print(1)', '.scar/report.json': '{}' });
  const first = await fingerprint(root);
  await writeFile(path.join(root, '.scar/report.json'), '{"updated":true}');
  assert.equal(await fingerprint(root), first);
  await writeFile(path.join(root, 'main.py'), 'print(2)');
  assert.notEqual(await fingerprint(root), first);
});

test('catalog only publishes proven classes, enforces revision and persists across instances', async t => {
  const home = await fixture(t);
  const catalog = new Catalog(home);
  const initial = await catalog.read();
  await assert.rejects(() => catalog.learn({ ...candidate, id: '../escape' }, initial.revision));
  await assert.rejects(() => catalog.learn({ ...candidate, detector: 'export default () => [];' }, initial.revision));
  await assert.rejects(() => catalog.learn({ ...candidate, detector: 'export default () => [{file:"fake",line:1,message:"all fail"}];' }, initial.revision));
  const updated = await catalog.learn(candidate, initial.revision);
  assert.equal((await new Catalog(home).read()).records[0].id, candidate.id);
  assert.notEqual(updated.revision, initial.revision);
  await assert.rejects(() => catalog.learn({ ...candidate, id: 'PERSONAL-002' }, initial.revision), /revision/i);
  await assert.rejects(() => catalog.learn(candidate, updated.revision), /exists/i);
  const replacement = { ...candidate, prevention: 'Updated preventive guidance with the same stable class ID.' };
  await catalog.learn(replacement, updated.revision, { replace: true });
  assert.equal((await catalog.read()).records[0].prevention, replacement.prevention);
  const raw = JSON.parse(await readFile(path.join(home, 'catalog.json'), 'utf8'));
  assert.equal(raw.records.length, 1);
});

test('command evidence captures failure and bounds time/output', async t => {
  const cwd = await fixture(t);
  const fail = await runCheck({ id: 'failure', command: '$NODE', args: ['-e', 'process.exit(7)'] }, cwd);
  assert.equal(fail.status, 'FAIL');
  assert.equal(fail.exitCode, 7);
  const timeout = await runCheck({ id: 'hang', command: '$NODE', args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 150 }, cwd);
  assert.equal(timeout.status, 'TIMEOUT');
  const overflow = await runCheck({ id: 'noise', command: '$NODE', args: ['-e', 'process.stdout.write("x".repeat(2_000_000))'] }, cwd);
  assert.equal(overflow.status, 'OUTPUT_LIMIT');
});

test('independent project checks do not inherit Node test worker internals', async t => {
  const cwd = await fixture(t);
  const result = await runCheck({id:'environment',command:'$NODE',args:['-e','if(process.env.NODE_TEST_CONTEXT || process.env.NODE_TEST_WORKER_ID) process.exit(1)']},cwd);
  assert.equal(result.status,'PASS');
});

test('expanding a class cannot forget previously proven failure variants', async t => {
  const home = await fixture(t);
  const catalog = new Catalog(home);
  const learned = await catalog.learn(candidate,(await catalog.read()).revision);
  const replacement = {...candidate,detector:`export default ({files}) => files.filter(f=>f.text.includes('debug: "on"')).map(f=>({file:f.path,line:1,message:'Debug enabled'}));`,fixtures:{bad:[{path:'config.js',text:'const cfg={debug: "on"}'}],alternate:[{path:'other.ts',text:'export const cfg={debug: "on"}'}],good:candidate.fixtures.good}};
  await assert.rejects(()=>catalog.learn(replacement,learned.revision,{replace:true}),/prior|regression/i);
  const expanded={...replacement,detector:`export default ({files}) => files.filter(f=>/debug\\s*:\\s*(true|"on")/.test(f.text)).map(f=>({file:f.path,line:1,message:'Debug enabled'}));`};
  const updated=await catalog.learn(expanded,learned.revision,{replace:true});
  assert.equal(updated.records[0].history.length,1);
  assert.deepEqual(updated.records[0].history[0].fixtures,candidate.fixtures);
});

test('UTF-8 findings survive characters split across stdout/stderr chunks', async t => {
  const cwd=await fixture(t);
  const script=`const text=JSON.stringify({message:'ошибка'});const bytes=Buffer.from(text);const cut=bytes.indexOf(Buffer.from('о'))+1;process.stdout.write(bytes.subarray(0,cut));process.stderr.write(bytes.subarray(0,cut));setTimeout(()=>{process.stdout.end(bytes.subarray(cut));process.stderr.end(bytes.subarray(cut));},30);`;
  const result=await runCheck({id:'unicode',command:'$NODE',args:['-e',script]},cwd);
  assert.equal(result.status,'PASS');
  assert.equal(JSON.parse(result.stdout).message,'ошибка');
  assert.equal(JSON.parse(result.stderr).message,'ошибка');
});
