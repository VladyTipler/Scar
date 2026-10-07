import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, copyFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { runCheck } from '../src/process.mjs';
import { fixture } from './helpers.mjs';

const root = path.resolve(import.meta.dirname, '..');
const pass = { id: 'behavior', command: '$NODE', args: ['-e', 'process.exit(0)'] };

test('ZCode packaging preserves all four native lifecycle declarations', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, '.zcode-plugin/plugin.json')));
  const hooks = JSON.parse(await readFile(path.join(root, manifest.hooks))).hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ['SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit']);
  const native = JSON.parse(await readFile(path.join(root, 'hooks/native.json'))).hooks;
  assert.deepEqual(hooks, native);
});

test('ZCode-declared bundles retain bookkeeping through Stop and clean it only at SessionEnd', async t => {
  const base = await fixture(t);
  const install = path.join(base, 'Scar plugin');
  await mkdir(path.join(install, 'dist'), { recursive: true });
  for (const name of ['mcp', 'hook']) await copyFile(path.join(root, 'dist', `${name}.cjs`), path.join(install, 'dist', `${name}.cjs`));
  await assert.rejects(() => access(path.join(install, 'node_modules')), { code: 'ENOENT' });
  const manifest = JSON.parse(await readFile(path.join(root, '.zcode-plugin/plugin.json')));
  const hooks = JSON.parse(await readFile(path.join(root, manifest.hooks))).hooks;
  assert.ok(hooks.SessionEnd, 'SessionEnd must remain a real declared lifecycle event');
  const declaration = manifest.mcpServers.scar;
  const expand = value => value.replaceAll('${CLAUDE_PLUGIN_ROOT}', install);
  const home = await fixture(t);
  const project = await fixture(t, { 'main.ts': 'export const value=1;' });
  const client = new Client({ name: 'zcode-package-test', version: '1' });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: declaration.command, args: declaration.args.map(expand), env: { ...process.env, SCAR_HOME: home } }));
  assert.equal((await client.listTools()).tools.length, 10);
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return result.structuredContent;
  };
  const event = { cwd: project, session_id: 'bundled-zcode' };
  const hook = async name => {
    const declaration = hooks[name][0].hooks[0];
    const command = expand(process.platform === 'win32' ? declaration.commandWindows : declaration.command);
    const result = await runCheck({ id: `lifecycle_${name}`, command: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh', args: process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command], timeoutMs: 5000 }, project, JSON.stringify({ ...event, hook_event_name: name }), { SCAR_HOME: home });
    assert.equal(result.status, 'PASS', result.stderr);
    return JSON.parse(result.stdout);
  };
  const sessions = () => readdir(path.join(home, 'sessions'));
  assert.match((await hook('SessionStart')).hookSpecificOutput.additionalContext, /scar_prepare/);
  assert.deepEqual(await hook('Stop'), {});
  assert.equal((await sessions()).length, 1, 'Ending an answer must not end the session');
  await call('scar_prepare', { project, task: 'Native lifecycle contract', checks: [pass] });
  assert.equal((await hook('Stop')).decision, 'block');
  assert.deepEqual(await hook('SessionEnd'), {});
  assert.deepEqual(await sessions(), []);
  await hook('SessionStart');
  assert.equal((await hook('Stop')).decision, 'block', 'SessionEnd must not clear an unfinished project gate');
  await call('scar_review', { project, reason: 'Reviewed executable lifecycle and pending-gate preservation.' });
  assert.equal((await call('scar_finish', { project })).status, 'READY');
  assert.deepEqual(await hook('Stop'), {});
  assert.equal((await sessions()).length, 1, 'READY ends the task, not the session');
  await hook('UserPromptSubmit');
  await call('scar_prepare', { project, task: 'Next task in the same session', checks: [pass] });
  for (let attempt = 0; attempt < 3; attempt++) assert.equal((await hook('Stop')).decision, 'block');
  const exhausted = await hook('Stop');
  assert.equal(exhausted.continue, false);
  assert.match(exhausted.systemMessage, /INCOMPLETE/);
  assert.equal((await sessions()).length, 1);
  assert.deepEqual(await hook('SessionEnd'), {});
  assert.deepEqual(await sessions(), []);
});
