import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Workflow } from '../src/workflow.mjs';
import { hookEvent } from '../src/hooks.mjs';
import { snapshot, scan } from '../src/workspace.mjs';
import { fixture, candidate } from './helpers.mjs';
import { Catalog } from '../src/catalog.mjs';
import { pathToFileURL } from 'node:url';
import { runCheck } from '../src/process.mjs';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { projectGateFile } from '../src/io.mjs';

const check = { id: 'behavior', command: '$NODE', args: ['-e', 'process.exit(0)'] };

test('startup and session-end hooks never snapshot or fetch the catalog', async t => {
  const home = await fixture(t, { 'connection.json': '{"type":"unsupported"}' });
  // A source-root that cannot be traversed proves startup does not depend on traversal.
  const project = await fixture(t);
  const unavailable = path.join(project, 'not-mounted');
  const event = { cwd: unavailable, session_id: 'no-scan' };
  for (const name of ['SessionStart', 'UserPromptSubmit']) {
    const result = await hookEvent({ ...event, hook_event_name: name }, home);
    assert.match(result.hookSpecificOutput.additionalContext, /scar_prepare/);
    assert.doesNotMatch(result.hookSpecificOutput.additionalContext, /setup failed/);
  }
  assert.deepEqual(await hookEvent({ ...event, hook_event_name: 'SessionEnd' }, home), {});
});

test('prepare caches bounded hints without invalidating its source binding', async t => {
  const home = await fixture(t);
  const project = await fixture(t, { 'main.ts': 'export const value=1;' });
  const flow = new Workflow(home);
  await flow.prepare(project, { task: 'A real software task', checks: [check] });
  const result = await hookEvent({ cwd: project, session_id: 'cached', hook_event_name: 'SessionStart' }, home);
  assert.match(result.hookSpecificOutput.additionalContext, /SCAR-001/);
  const before = (await snapshot(project)).fingerprint;
  await writeFile(path.join(project, '.scar/context.json'), '{"schema":1}');
  assert.equal((await snapshot(project)).fingerprint, before);
});

test('Stop requires finish evidence and never executes project commands', async t => {
  const home = await fixture(t);
  const project = await fixture(t, { 'main.ts': 'export const value=1;' });
  const flow = new Workflow(home);
  const count = path.join(home, 'count');
  await flow.prepare(project, { task: 'Count executions', checks: [{ ...check, args: ['-e', `require('fs').appendFileSync(${JSON.stringify(count)},'x')`] }] });
  const event = { cwd: project, session_id: 'gate' };
  await hookEvent({ ...event, hook_event_name: 'SessionStart' }, home);
  await flow.review(project, 'Reviewed executable source and behavior coverage.');
  assert.equal((await hookEvent({ ...event, hook_event_name: 'Stop' }, home)).decision, 'block');
  await assert.rejects(() => access(count), { code: 'ENOENT' });
  assert.equal((await flow.finish(project)).status, 'READY');
  assert.deepEqual(await hookEvent({ ...event, hook_event_name: 'Stop' }, home), {});
  assert.equal(await readFile(count, 'utf8'), 'x');
  for (const operation of ['edit', 'add', 'delete']) {
    // Each new software task is armed by preparation. Mutations after finish
    // but before its Stop gate must revoke that task's evidence.
    await flow.prepare(project, { task: operation, checks: [check] });
    await flow.review(project, `Reviewed ${operation} before the mutation test.`);
    assert.equal((await flow.finish(project)).status, 'READY');
    if (operation === 'edit') await writeFile(path.join(project, 'main.ts'), 'export const value=2;');
    if (operation === 'add') await writeFile(path.join(project, 'added.ts'), 'export const extra=1;');
    if (operation === 'delete') await rm(path.join(project, 'added.ts'));
    assert.equal((await hookEvent({ ...event, hook_event_name: 'Stop' }, home)).decision, 'block', operation);
    await flow.review(project, `Reviewed ${operation} and all affected executable checks.`);
    assert.equal((await flow.finish(project)).status, 'READY');
    await hookEvent({ ...event, hook_event_name: 'UserPromptSubmit' }, home);
  }
});

test('identical prepare starts a new generation and deleted evidence cannot bypass the gate', async t => {
  const home = await fixture(t);
  const project = await fixture(t, { 'main.ts': 'export const value=1;' });
  const flow = new Workflow(home);
  const options = { task: 'Repeat the same task', checks: [check] };
  const event = { cwd: project, session_id: 'generation' };
  await hookEvent({ ...event, hook_event_name: 'SessionStart' }, home);
  await flow.prepare(project, options);
  await flow.review(project, 'Reviewed the original task and class protection.');
  await flow.finish(project);
  assert.deepEqual(await hookEvent({ ...event, hook_event_name: 'Stop' }, home), {});
  await writeFile(path.join(project, 'README.md'), 'An ordinary documentation conversation');
  await hookEvent({ ...event, hook_event_name: 'UserPromptSubmit' }, home);
  assert.deepEqual(await hookEvent({ ...event, hook_event_name: 'Stop' }, home), {});
  await flow.prepare(project, options);
  assert.equal((await hookEvent({ ...event, hook_event_name: 'Stop' }, home)).decision, 'block');
  await rm(path.join(project, '.scar'), { recursive: true });
  // A restarted session still sees the armed gate in the personal home.
  assert.equal((await hookEvent({ ...event, session_id: 'restart', hook_event_name: 'Stop' }, home)).decision, 'block');
});

test('parser cache retains language grammar and fresh changed content', async t => {
  const project = await fixture(t, { 'same.ts': 'export const value: number = 1;' });
  assert.equal((await scan(project)).errors.length, 0);
  await writeFile(path.join(project, 'same.js'), 'export const value: number = 1;');
  assert.ok((await scan(project)).errors.some(e => e.file === 'same.js'));
  await writeFile(path.join(project, 'same.ts'), 'try {} catch {}');
  assert.ok((await scan(project)).findings.some(e => e.file === 'same.ts' && e.id === 'SCAR-001'));
});

test('an old Stop cannot disarm a concurrently prepared generation', async t => {
  const home = await fixture(t);
  const project = await fixture(t, { 'main.ts': 'export const value=1;' });
  const flow = new Workflow(home);
  const event = { cwd: project, session_id: 'concurrent' };
  await hookEvent({ ...event, hook_event_name: 'SessionStart' }, home);
  await flow.prepare(project, { task: 'Old generation', checks: [check] });
  await flow.review(project, 'Reviewed original task executable protection.');
  await flow.finish(project);
  const gateFile = projectGateFile(home, await fs.realpath(project));
  const originalRename = fs.rename;
  let release;
  const pause = new Promise(resolve => { release = resolve; });
  let entered;
  const reached = new Promise(resolve => { entered = resolve; });
  fs.rename = async (from, to) => {
    if (to === gateFile && JSON.parse(await readFile(from)).active === false) { entered(); await pause; }
    return await originalRename(from, to);
  };
  syncBuiltinESMExports();
  try {
    const stopping = hookEvent({ ...event, hook_event_name: 'Stop' }, home);
    await reached;
    let conflict;
    try { await flow.prepare(project, { task: 'New generation', checks: [check] }); }
    catch (error) { conflict = error; }
    release();
    await stopping;
    if (conflict) {
      assert.match(conflict.message, /lock/i);
      await flow.prepare(project, { task: 'New generation', checks: [check] });
    }
    assert.equal(JSON.parse(await readFile(gateFile)).active, true, 'New generation was silently disarmed by an old Stop');
    assert.equal((await hookEvent({ ...event, hook_event_name: 'Stop' }, home)).decision, 'block');
  } finally { release(); fs.rename = originalRename; syncBuiltinESMExports(); }
});

test('aliases of one project share a gate and cannot reuse a closed generation', async t => {
  const home = await fixture(t);
  const project = await fixture(t, { 'main.ts': 'export const value=1;' });
  const canonical = await fs.realpath(project);
  let alias = project;
  if (alias === canonical) {
    if (process.platform === 'win32') { t.skip('No short-path alias on this Windows host'); return; }
    alias = path.join(await fixture(t), 'project-alias');
    await fs.symlink(canonical, alias, 'dir');
  }
  const flow = new Workflow(home);
  const event = { cwd: alias, session_id: 'alias' };
  await hookEvent({ ...event, hook_event_name: 'SessionStart' }, home);
  await flow.prepare(alias, { task: 'First task', checks: [check] });
  await flow.review(alias, 'Reviewed first task and source protection.');
  await flow.finish(alias);
  assert.deepEqual(await hookEvent({ ...event, hook_event_name: 'Stop' }, home), {});
  await flow.prepare(canonical, { task: 'Second task', checks: [check] });
  assert.equal((await hookEvent({ ...event, hook_event_name: 'Stop' }, home)).decision, 'block');
  await rm(path.join(canonical, '.scar'), { recursive: true });
  assert.equal((await hookEvent({ ...event, hook_event_name: 'Stop' }, home)).decision, 'block');
});

test('native parent kills a stalled worker and returns INCOMPLETE within its budget', async t => {
  const home = await fixture(t);
  const project = await fixture(t);
  const preload = path.join(home, 'stall.mjs');
  const pidFile = path.join(home, 'worker.pid');
  await writeFile(preload, `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';
    if(process.argv.includes('--worker')) {
      await fs.writeFile(${JSON.stringify(pidFile)},String(process.pid));
      const original=fs.stat;
      fs.stat=(file,...args)=>String(file).endsWith('context.json')?new Promise(()=>setInterval(()=>{},1000)):original(file,...args);
      syncBuiltinESMExports();
    }`);
  const started = performance.now();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve('src/hook.mjs')], { env: { ...process.env, SCAR_HOME: home, NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Native hook deadline failed')); }, 4500);
    let output = '';
    child.stdout.setEncoding('utf8'); child.stdout.on('data', text => output += text);
    child.on('error', reject);
    child.on('close', () => { clearTimeout(timer); resolve(JSON.parse(output)); });
    child.stdin.end(JSON.stringify({ cwd: project, session_id: 'stalled', hook_event_name: 'SessionStart' }));
  });
  assert.match(result.hookSpecificOutput.additionalContext, /INCOMPLETE/);
  assert.ok(performance.now() - started < 4500);
  const pid = Number(await readFile(pidFile, 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('cancellation kills a real transport subprocess', async t => {
  const home = await fixture(t);
  const pidFile = path.join(home, 'transport.pid');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300);
  const result = await runCheck({ id: 'hanging_transport', command: '$NODE', args: ['-e', `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`] }, home, undefined, {}, { signal: controller.signal });
  clearTimeout(timer);
  assert.equal(result.status, 'CANCELLED');
  const pid = Number(await readFile(pidFile, 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('Stop deadline returns INCOMPLETE and cancels the work instead of approving or rerunning', async t => {
  const home = await fixture(t);
  const project = await fixture(t, { 'main.ts': 'export const value=1;' });
  await new Workflow(home).prepare(project, { task: 'Bounded gate', checks: [check] });
  const event = { cwd: project, session_id: 'deadline' };
  await hookEvent({ ...event, hook_event_name: 'SessionStart' }, home);
  const controller = new AbortController();
  controller.abort(new Error('Scar hook budget exhausted'));
  const result = await hookEvent({ ...event, hook_event_name: 'Stop' }, home, { signal: controller.signal });
  assert.equal(result.decision, 'block');
  assert.match(result.reason, /INCOMPLETE|budget/);
});

test('contract and catalog changes revoke the Stop gate', async t => {
  const home = await fixture(t);
  const project = await fixture(t, { 'main.ts': 'export const value=1;' });
  const flow = new Workflow(home);
  await flow.prepare(project, { task: 'Fresh gate', checks: [check] });
  await flow.review(project, 'Reviewed classes and contract coverage.');
  await flow.finish(project);
  const event = { cwd: project, session_id: 'binding' };
  await hookEvent({ ...event, hook_event_name: 'SessionStart' }, home);
  const catalog = new Catalog(home);
  await catalog.learn(candidate, (await catalog.read()).revision);
  assert.equal((await hookEvent({ ...event, hook_event_name: 'Stop' }, home)).decision, 'block');
  await flow.review(project, 'Reviewed the additional accumulated class.');
  await flow.finish(project);
  const file = path.join(project, '.scar/contract.json');
  const contract = JSON.parse(await readFile(file));
  await writeFile(file, JSON.stringify({ ...contract, task: 'Modified contract' }));
  assert.equal((await hookEvent({ ...event, hook_event_name: 'Stop' }, home)).decision, 'block');
});

test('snapshot excludes nested workspaces and archives but retains nested source build', async t => {
  const project = await fixture(t, {
    'main.ts': 'export const value=1;',
    '.worktrees/other/main.ts': 'try{}catch{}',
    '.claude/archive/old.ts': 'try{}catch{}',
    'backup.dump': 'archive',
    'src/build/source.ts': 'items.forEach(async item => save(item));'
  });
  const state = await snapshot(project);
  assert.deepEqual(state.entries.map(([file]) => file).sort(), ['main.ts', 'src/build/source.ts']);
  assert.ok((await scan(project, state)).findings.some(f => f.id === 'SCAR-002'));
});

test('oversized source is rejected by metadata before reading any content', async t => {
  const project = await fixture(t, { 'large.ts': 'tiny' });
  let reads = 0;
  const state = await snapshot(project, { fs: {
    stat: async () => ({ size: 11 * 1024 * 1024 }),
    readFile: async () => { reads++; throw new Error('Must not read oversized file'); }
  } });
  assert.equal(reads, 0);
  assert.match(state.errors[0].message, /10 MiB/);
});

test('real native hook starts on unavailable workspace and exits without detached work', async t => {
  const home = await fixture(t, { 'connection.json': '{"type":"unsupported"}' });
  const project = await fixture(t);
  const started = performance.now();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve('src/hook.mjs')], { env: { ...process.env, SCAR_HOME: home }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Hook did not exit within budget')); }, 5000);
    let output = '', errors = '';
    child.stdout.setEncoding('utf8'); child.stdout.on('data', text => output += text);
    child.stderr.on('data', text => errors += text);
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(JSON.parse(output)) : reject(new Error(errors)); });
    child.stdin.end(JSON.stringify({ cwd: path.join(project, 'unavailable'), session_id: 'native-short', hook_event_name: 'SessionStart' }));
  });
  assert.ok(performance.now() - started < 5000);
  assert.doesNotMatch(result.hookSpecificOutput.additionalContext, /setup failed/);
});
