import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createScarBoundary } from '../integrations/nexus/bridge.mjs';
import { createLocalInvoker } from '../integrations/nexus/local-invoker.mjs';
import { fixture } from './helpers.mjs';

test('Nexus bridge forwards explicit workspace/session and rejects completion through real MCP', async t => {
  const home = await fixture(t);
  const project = await fixture(t, { 'main.ts': 'export const value=1;' });
  const client = new Client({ name: 'nexus-boundary-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist/mcp.cjs')], env: { ...process.env, SCAR_HOME: home } }));
  t.after(() => client.close());
  const bridge = createScarBoundary({ invoke: args => client.callTool({ name: 'scar_hook_event', arguments: args }) });
  const context = { project, sessionId: 'nexus-real-contract' };
  assert.match(await bridge.begin(context), /Scar/);
  await client.callTool({ name: 'scar_prepare', arguments: { project, task: 'Change module', checks: [] } });
  await writeFile(path.join(project, 'main.ts'), 'new Promise(async resolve => resolve(1));');
  await client.callTool({ name: 'scar_verify', arguments: { project } });
  await assert.rejects(() => bridge.finish(context), error => error.code === 'scar_incomplete' && /SCAR-003/.test(error.message));
  await bridge.end(context);
});

test('host-local Nexus adapter actually reads workspace and keeps its personal catalog persistent', async t => {
  const home = await fixture(t);
  const project = await fixture(t, { 'main.py': 'print(1)' });
  const bridge = createScarBoundary({ invoke: createLocalInvoker({ runtime: path.resolve('dist/hook.cjs'), home }) });
  const context = { project, sessionId: 'host-local' };
  assert.match(await bridge.begin(context), /Scar/);
  const { Workflow } = await import('../src/workflow.mjs');
  await new Workflow(home).prepare(project, { task: 'Change Python program', checks: [] });
  await writeFile(path.join(project, 'main.py'), 'print(2)');
  await assert.rejects(() => bridge.finish(context), error => error.code === 'scar_incomplete');
  for (let i=0;i<3;i++) await assert.rejects(() => bridge.finish(context), error => error.code === 'scar_incomplete');
  await bridge.end(context);
});
