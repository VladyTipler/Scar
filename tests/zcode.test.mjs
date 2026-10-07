import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile, readdir, access, realpath } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Workflow } from '../src/workflow.mjs';
import { hookEvent } from '../src/hooks.mjs';
import { projectGateFile } from '../src/io.mjs';
import { runCheck } from '../src/process.mjs';
import { fixture } from './helpers.mjs';

const root = path.resolve(import.meta.dirname, '..');
const cleanup = { cleanupSessionOnStop: true };
const pass = { id: 'behavior', command: '$NODE', args: ['-e', 'process.exit(0)'] };
const sessions = home => readdir(path.join(home, 'sessions'));

async function start(project, home, session = 'zcode') {
  const event = { cwd: project, session_id: session };
  await hookEvent({ ...event, hook_event_name: 'SessionStart' }, home, cleanup);
  return event;
}

test('ZCode prose Stop removes only its own session bookkeeping', async t => {
  const home = await fixture(t);
  const project = await fixture(t);
  const event = await start(project, home);
  await start(project, home, 'other');
  const before = await sessions(home);
  assert.equal(before.length, 2);
  assert.deepEqual(await hookEvent({ ...event, hook_event_name: 'Stop' }, home, cleanup), {});
  assert.equal((await sessions(home)).length, 1);
  assert.deepEqual(await hookEvent({ ...event, hook_event_name: 'Stop' }, home, cleanup), {});
  assert.equal((await sessions(home)).length, 1);
});

test('ZCode blocked Stop retains repair budget and the armed project gate', async t => {
  const home = await fixture(t);
  const project = await fixture(t, { 'main.ts': 'export const value=1;' });
  const event = await start(project, home);
  await new Workflow(home).prepare(project, { task: 'Missing executable evidence', checks: [] });
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.equal((await hookEvent({ ...event, hook_event_name: 'Stop' }, home, cleanup)).decision, 'block');
    assert.equal((await sessions(home)).length, 1);
  }
  const exhausted = await hookEvent({ ...event, hook_event_name: 'Stop', stop_hook_active: true }, home, cleanup);
  assert.equal(exhausted.continue, false);
  assert.match(exhausted.systemMessage, /INCOMPLETE/);
  assert.equal((await sessions(home)).length, 1);
  const gate = projectGateFile(home, await realpath(project));
  assert.equal(JSON.parse(await readFile(gate)).active, true);
  await hookEvent({ ...event, hook_event_name: 'UserPromptSubmit' }, home, cleanup);
  assert.equal((await hookEvent({ ...event, hook_event_name: 'Stop' }, home, cleanup)).decision, 'block');
});

test('ZCode READY Stop cleans bookkeeping and a later prompt rearms normal verification', async t => {
  const home = await fixture(t);
  const project = await fixture(t, { 'main.ts': 'export const value=1;' });
  const event = await start(project, home);
  const flow = new Workflow(home);
  await flow.prepare(project, { task: 'Verified task', checks: [pass] });
  await flow.review(project, 'Reviewed behavior and applicable classes.');
  assert.equal((await flow.finish(project)).status, 'READY');
  await writeFile(path.join(project, 'main.ts'), 'export const value=2;');
  assert.equal((await hookEvent({ ...event, hook_event_name: 'Stop' }, home, cleanup)).decision, 'block');
  assert.equal((await sessions(home)).length, 1);
  await flow.review(project, 'Reviewed the source change and executable coverage.');
  assert.equal((await flow.finish(project)).status, 'READY');
  assert.deepEqual(await hookEvent({ ...event, hook_event_name: 'Stop' }, home, cleanup), {});
  assert.deepEqual(await sessions(home), []);
  assert.deepEqual(await hookEvent({ ...event, hook_event_name: 'Stop' }, home, cleanup), {});
  await hookEvent({ ...event, hook_event_name: 'UserPromptSubmit' }, home, cleanup);
  assert.equal((await sessions(home)).length, 1);
  await flow.prepare(project, { task: 'Next software task', checks: [pass] });
  assert.equal((await hookEvent({ ...event, hook_event_name: 'Stop' }, home, cleanup)).decision, 'block');
});

test('native hosts retain their session until SessionEnd', async t => {
  const home = await fixture(t);
  const project = await fixture(t);
  const event = { cwd: project, session_id: 'native' };
  await hookEvent({ ...event, hook_event_name: 'SessionStart' }, home);
  assert.deepEqual(await hookEvent({ ...event, hook_event_name: 'Stop' }, home), {});
  assert.equal((await sessions(home)).length, 1);
  assert.deepEqual(await hookEvent({ ...event, hook_event_name: 'SessionEnd' }, home), {});
  assert.deepEqual(await sessions(home), []);
});

test('ZCode declarations launch isolated bundled MCP and hooks without SessionEnd or dependencies', async t => {
  const base = await fixture(t);
  const install = path.join(base, 'Scar plugin');
  await mkdir(path.join(install, 'dist'), { recursive: true });
  for (const name of ['mcp', 'hook']) await copyFile(path.join(root, 'dist', `${name}.cjs`), path.join(install, 'dist', `${name}.cjs`));
  await assert.rejects(() => access(path.join(install, 'node_modules')), { code: 'ENOENT' });
  const manifest = JSON.parse(await readFile(path.join(root, '.zcode-plugin/plugin.json')));
  const hooks = JSON.parse(await readFile(path.join(root, manifest.hooks))).hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ['SessionStart', 'Stop', 'UserPromptSubmit']);
  const declaration = manifest.mcpServers.scar;
  const expand = value => value.replaceAll('${CLAUDE_PLUGIN_ROOT}', install);
  const home = await fixture(t);
  const project = await fixture(t, { 'main.ts': 'export const value=1;' });
  const client = new Client({ name: 'zcode-package-test', version: '1' });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: declaration.command, args: declaration.args.map(expand), env: { ...process.env, SCAR_HOME: home } }));
  const tools = (await client.listTools()).tools.map(tool => tool.name);
  assert.equal(tools.length, 10);
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return result.structuredContent;
  };
  const event = { cwd: project, session_id: 'bundled-zcode' };
  const hook = async name => {
    const declaration = hooks[name][0].hooks[0];
    const command = expand(process.platform === 'win32' ? declaration.commandWindows : declaration.command);
    const result = await runCheck({ id: `zcode_${name}`, command: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh', args: process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command], timeoutMs: 5000 }, project, JSON.stringify({ ...event, hook_event_name: name }), { SCAR_HOME: home });
    assert.equal(result.status, 'PASS', result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.match((await hook('SessionStart')).hookSpecificOutput.additionalContext, /scar_prepare/);
  await call('scar_prepare', { project, task: 'ZCode integration', checks: [pass] });
  assert.equal((await hook('Stop')).decision, 'block');
  await call('scar_review', { project, reason: 'Reviewed ZCode executable boundary and behavior.' });
  assert.equal((await call('scar_finish', { project })).status, 'READY');
  assert.deepEqual(await hook('Stop'), {});
  assert.deepEqual(await sessions(home), []);
  await hook('UserPromptSubmit');
  await call('scar_prepare', { project, task: 'Next ZCode task', checks: [pass] });
  assert.equal((await hook('Stop')).decision, 'block');
  for (let attempt = 0; attempt < 2; attempt++) assert.equal((await hook('Stop')).decision, 'block');
  const exhausted = await hook('Stop');
  assert.equal(exhausted.continue, false);
  assert.equal(exhausted.decision, undefined);
  assert.match(exhausted.hookSpecificOutput?.additionalContext ?? '', /INCOMPLETE/);
  assert.equal(exhausted.hookSpecificOutput.hookEventName, 'Stop');
  assert.equal((await sessions(home)).length, 1);
});
