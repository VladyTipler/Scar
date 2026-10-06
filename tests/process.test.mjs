import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './helpers.mjs';
import { runCheck } from '../src/process.mjs';
import { Workflow } from '../src/workflow.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const windows = { skip: process.platform !== 'win32' };

test('direct Node checks preserve quoted, empty and shell metacharacter arguments', async t => {
  const root = await fixture(t);
  const args = ['say "quoted"', '', 'a&b', 'x|y', '%PATH%', 'C:\\space here\\'];
  const result = await runCheck({ id: 'literal', command: '$NODE', args: ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...args] }, root);
  assert.equal(result.status, 'PASS', result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), args);
});

async function npmProject(t) {
  return fixture(t, {
    'package.json': JSON.stringify({ scripts: { test: 'node proof.mjs', fail: 'node proof.mjs fail' } }),
    '.npmrc': 'cache=./node_modules/.cache\noffline=true\n',
    'proof.mjs': `import {mkdirSync,writeFileSync} from 'node:fs';
mkdirSync('node_modules',{recursive:true});
writeFileSync('node_modules/executed.json', JSON.stringify(process.argv.slice(2)));
console.log('Проверка действительно запущена');
console.error('Допустимое предупреждение');
process.exit(process.argv[2] === 'fail' ? 7 : 0);`
  });
}

test('Windows npm executes the real script, preserves UTF-8 and propagates failure', windows, async t => {
  const root = await npmProject(t);
  const passed = await runCheck({ id: 'pass', command: 'npm', args: ['run', 'test'] }, root);
  assert.equal(passed.status, 'PASS', passed.stderr);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'node_modules', 'executed.json'), 'utf8')), []);
  assert.match(passed.stdout, /Проверка действительно запущена/);
  assert.match(passed.stderr, /Допустимое предупреждение/);
  const failed = await runCheck({ id: 'fail', command: 'npm', args: ['run', 'fail'] }, root);
  assert.equal(failed.status, 'FAIL', JSON.stringify(failed));
  assert.equal(failed.exitCode, 7);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'node_modules', 'executed.json'), 'utf8')), ['fail']);
});

test('Windows npm avoids a failing PowerShell shim and never passes a missing native shim', windows, async t => {
  const root = await npmProject(t);
  const poison = await fixture(t, { 'npm.ps1': "Write-Error 'launcher failed before running tests'" });
  const passed = await runCheck({ id: 'shim', command: 'npm', args: ['run', 'test'] }, root, undefined, { PATH: `${poison};${process.env.PATH}` });
  assert.equal(passed.status, 'PASS', passed.stderr);
  assert.match(passed.stdout, /Проверка действительно запущена/);
  const powershellDirectory = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0');
  const missing = await runCheck({ id: 'missing', command: 'npm', args: ['run', 'test'] }, root, undefined, { PATH: `${poison};${powershellDirectory}` });
  assert.equal(missing.status, 'FAIL', JSON.stringify(missing));
  assert.equal(missing.exitCode, 1, JSON.stringify(missing));
  assert.match(missing.stderr, /npm\.cmd/);
});

test('Windows explicit npm.cmd and npx.cmd cross PowerShell and forward ordinary arguments', windows, async t => {
  const root = await npmProject(t);
  const npm = await runCheck({ id: 'cmd', command: 'npm.cmd', args: ['run', 'test', '--', 'argument with spaces', "O'Brien", '$literal', '`literal'] }, root);
  assert.equal(npm.status, 'PASS', npm.stderr);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'node_modules', 'executed.json'), 'utf8')), ['argument with spaces', "O'Brien", '$literal', '`literal']);
  const npx = await runCheck({ id: 'npx', command: 'npx', args: ['--offline', '--no-install', '--call', 'node proof.mjs fail'] }, root);
  assert.equal(npx.status, 'FAIL', JSON.stringify(npx));
  assert.equal(npx.exitCode, 7, JSON.stringify(npx));
  assert.match(npx.stdout, /Проверка действительно запущена/);
  const explicit = await runCheck({ id: 'npx_cmd', command: 'npx.cmd', args: ['--offline', '--no-install', '--call', 'node proof.mjs'] }, root);
  assert.equal(explicit.status, 'PASS', explicit.stderr);
});

test('Windows discovered npm verification cannot mark an actually failing project READY', windows, async t => {
  const home = await fixture(t);
  const root = await npmProject(t);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node proof.mjs fail' } }));
  const flow = new Workflow(home);
  await flow.prepare(root, { task: 'Check actual npm failure' });
  await flow.review(root, 'Regression for Windows npm boundary.');
  const report = await flow.finish(root);
  assert.equal(report.status, 'FAIL', JSON.stringify(report));
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'node_modules', 'executed.json'), 'utf8')), ['fail']);
});

test('Windows bundled MCP rejects failing npm checks even with a broken PowerShell shim on PATH', windows, async t => {
  const home = await fixture(t);
  const root = await npmProject(t);
  const poison = await fixture(t, { 'npm.ps1': "Write-Error 'launcher failed before running tests'" });
  const client = new Client({ name: 'scar-npm-boundary', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist/mcp.cjs')],
    env: { ...process.env, SCAR_HOME: home, PATH: `${poison};${process.env.PATH}` }, stderr: 'pipe' }));
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return result.structuredContent ?? JSON.parse(result.content[0].text);
  };
  await call('scar_prepare', { project: root, task: 'Prove actual failing npm behavior',
    checks: [{ id: 'behavior', command: 'npm', args: ['run', 'fail'] }] });
  await call('scar_review', { project: root, reason: 'Real npm failure must reject completion.' });
  assert.equal((await call('scar_finish', { project: root })).status, 'FAIL');
  assert.equal((await call('scar_details', { project: root, checkId: 'behavior', stream: 'stdout' })).text.includes('Проверка действительно запущена'), true);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'node_modules', 'executed.json'), 'utf8')), ['fail']);
});

test('Windows npm refuses arguments its cmd shim cannot forward literally', windows, async t => {
  const root = await npmProject(t);
  for (const argument of ['say "quoted"', '', 'a&b', 'x|y', '%PATH%', 'a(b)', 'line\nbreak', 'C:\\space here\\']) {
    const result = await runCheck({ id: 'unsupported', command: 'npm', args: ['run', 'test', '--', argument] }, root);
    assert.equal(result.status, 'FAIL', JSON.stringify(result));
    assert.match(result.stderr, /cannot forward.*literally/i);
    await assert.rejects(readFile(path.join(root, 'node_modules', 'executed.json')), { code: 'ENOENT' });
  }
});

test('Windows bundled MCP executes npm under the SDK minimal environment without PATHEXT', windows, async t => {
  const home = await fixture(t);
  const root = await npmProject(t);
  const client = new Client({ name: 'scar-minimal-environment', version: '1.0.0' });
  t.after(() => client.close());
  // Deliberately inherit only the SDK defaults, as real MCP hosts can do.
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist/mcp.cjs')],
    env: { SCAR_HOME: home }, stderr: 'pipe' }));
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return result.structuredContent ?? JSON.parse(result.content[0].text);
  };
  await call('scar_prepare', { project: root, task: 'Run npm in minimal MCP environment' });
  await call('scar_review', { project: root, reason: 'A minimal MCP environment must execute the actual test.' });
  assert.equal((await call('scar_finish', { project: root })).status, 'READY');
  assert.match((await call('scar_details', { project: root, checkId: 'test', stream: 'stdout' })).text, /Проверка действительно запущена/);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'node_modules', 'executed.json'), 'utf8')), []);
});
