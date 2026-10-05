import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture, candidate } from './helpers.mjs';
import { atomicJson } from '../src/io.mjs';
const exec = promisify(execFile);
const bin = name => path.resolve(`dist/${name}.cjs`);

async function hook(event, home) {
  const { spawn } = await import('node:child_process');
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin('hook')], { env: { ...process.env, SCAR_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(JSON.parse(out || '{}')) : reject(new Error(err)));
    child.stdin.end(JSON.stringify(event));
  });
}

test('real bundled MCP stdio supports verification and isolates projects/sessions', async t => {
  const home = await fixture(t);
  const root = await fixture(t, { 'main.ts': 'export const value=1;', 'check.mjs': 'process.exit(0)' });
  const other = await fixture(t, { 'main.py': 'print(1)' });
  const client = new Client({ name: 'scar-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [bin('mcp')], env: { ...process.env, SCAR_HOME: home }, stderr: 'pipe' });
  t.after(() => client.close());
  await client.connect(transport);
  assert.ok((await client.listTools()).tools.some(tool => tool.name === 'scar_prepare'));
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  };
  await call('scar_prepare', { project: root, task: 'Feature', checks: [{ id: 'behavior', command: '$NODE', args: ['check.mjs'] }] });
  await call('scar_review', { project: root, reason: 'Behavior and all selected failure classes checked.' });
  assert.equal((await call('scar_finish', { project: root })).status, 'READY');
  await call('scar_hook_event', { event: { hook_event_name: 'SessionStart', cwd: root, session_id: 'one' } });
  await call('scar_hook_event', { event: { hook_event_name: 'SessionStart', cwd: other, session_id: 'two' } });
  await writeFile(path.join(root, 'main.ts'), 'items.forEach(async i => await save(i));');
  assert.equal((await call('scar_hook_event', { event: { hook_event_name: 'Stop', cwd: root, session_id: 'one' } })).decision, 'block');
  assert.equal((await call('scar_hook_event', { event: { hook_event_name: 'Stop', cwd: other, session_id: 'two' } })).decision, undefined);
});

test('native hook payloads block a changed no-Git project, allow verified source and skip prose', async t => {
  const home = await fixture(t);
  const root = await fixture(t, { 'main.ts': 'export const value=1;' });
  const event = { cwd: root, session_id: 'native' };
  const start = await hook({ ...event, hook_event_name: 'SessionStart' }, home);
  assert.match(start.hookSpecificOutput.additionalContext, /Scar/);
  await writeFile(path.join(root, 'README.md'), 'Documentation only');
  assert.equal((await hook({ ...event, hook_event_name: 'Stop' }, home)).decision, undefined);
  await writeFile(path.join(root, 'main.ts'), 'export const value=2;');
  assert.equal((await hook({ ...event, hook_event_name: 'Stop' }, home)).decision, 'block');
  // Compact/resume must not erase the evidence of pending changes.
  await hook({ ...event, hook_event_name: 'SessionStart', source: 'compact' }, home);
  assert.equal((await hook({ ...event, hook_event_name: 'Stop' }, home)).decision, 'block');
  const contract = path.join(home, 'contract-input.json');
  await writeFile(contract, JSON.stringify({ task: 'Value', checks: [{ id: 'behavior', command: '$NODE', args: ['-e', 'process.exit(0)'] }] }));
  await exec(process.execPath, [bin('cli'), 'prepare', root, '--home', home, '--contract', contract]);
  await exec(process.execPath, [bin('cli'), 'review', root, '--home', home, '--reason', 'Checked the value and relevant error classes.']);
  assert.equal((await hook({ ...event, hook_event_name: 'Stop' }, home)).decision, undefined);
  assert.equal(JSON.parse(await readFile(path.join(root, '.scar/report.json'))).status, 'VERIFIED');
  await hook({ name: 'SessionEnd', payload: event }, home);
});

test('missing/malformed hook payload fails visibly instead of accepting completion', async t => {
  const home = await fixture(t);
  assert.equal((await hook({ hook_event_name: 'Stop' }, home)).decision, 'block');
});

test('bundled MCP returns bounded catalog and report evidence instead of dumping programs or logs', async t => {
  const home = await fixture(t);
  const root = await fixture(t, { 'main.ts': 'export const value=1;' });
  await atomicJson(path.join(home, 'catalog.json'), { schema: 1, records: Array.from({length: 40}, (_, i) => ({...candidate, id: `PERSONAL-${i}`})) });
  const client = new Client({ name: 'scar-budget-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [bin('mcp')], env: { ...process.env, SCAR_HOME: home } }));
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  };
  const catalog = await call('scar_catalog', {limit: 3});
  assert.equal(catalog.total, 40);
  assert.equal(catalog.classes.length, 3);
  assert.ok(!JSON.stringify(catalog).includes('detector'));
  await call('scar_prepare', {project: root, task: 'Feature', checks: [{id:'failure', command:'$NODE', args:['-e', 'console.error("trace".repeat(1000));process.exit(1)']}]});
  const result = await call('scar_verify', {project: root});
  assert.equal(result.status, 'FAIL');
  assert.ok(!JSON.stringify(result).includes('trace'));
  const detail = await call('scar_details', {project: root, checkId:'failure', stream:'stderr'});
  assert.equal(detail.text.length, 4000);
  assert.equal(detail.nextOffset, 4000);
});

test('completion gate bounds automatic repairs without converting failure into approval', async t => {
  const home = await fixture(t);
  const root = await fixture(t, { 'main.ts': 'export const value=1;' });
  const event = {cwd:root,session_id:'bounded'};
  await hook({...event, hook_event_name:'SessionStart'}, home);
  await writeFile(path.join(root,'main.ts'), 'export const value=2;');
  for(let attempt=0;attempt<3;attempt++) assert.equal((await hook({...event,hook_event_name:'Stop',stop_hook_active:attempt>0},home)).decision,'block');
  const exhausted = await hook({...event,hook_event_name:'Stop',stop_hook_active:true},home);
  assert.equal(exhausted.continue,false);
  assert.match(exhausted.systemMessage,/INCOMPLETE/);
  await hook({...event,hook_event_name:'UserPromptSubmit'},home);
  assert.equal((await hook({...event,hook_event_name:'Stop'},home)).decision,'block');
});

test('real native hook accepts UTF-8 JSON when a project name spans stdin chunks', async t => {
  const home=await fixture(t);
  const base=await fixture(t);
  const {mkdir}=await import('node:fs/promises');
  const root=path.join(base,'проект');
  await mkdir(root);
  const {spawn}=await import('node:child_process');
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[bin('hook')],{env:{...process.env,SCAR_HOME:home},stdio:['pipe','pipe','pipe']});
    let out='';
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>out+=chunk);
    child.on('error',reject);child.on('close',()=>resolve(JSON.parse(out)));
    const bytes=Buffer.from(JSON.stringify({hook_event_name:'SessionStart',cwd:root,session_id:'unicode'}));
    const cut=bytes.indexOf(Buffer.from('п'))+1;
    child.stdin.write(bytes.subarray(0,cut));
    setTimeout(()=>child.stdin.end(bytes.subarray(cut)),800);
  });
  assert.doesNotMatch(result.hookSpecificOutput.additionalContext,/setup failed/);
});
