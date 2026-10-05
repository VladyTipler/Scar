import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
// Read-only native discovery; never starts a model turn or trusts hooks.
const executable = process.argv[2];
if (!executable) throw new Error('Pass the absolute Codex executable path.');
const overrides = [];
if (process.argv.includes('--mcp')) {
  const configuration = await readFile(path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'config.toml'), 'utf8');
  for (const match of configuration.matchAll(/^\[(mcp_servers|plugins)\.("[^"]+"|[A-Za-z0-9_-]+)\]\s*$/gm)) {
    if (match[1] === 'plugins' && match[2] === '"scar@scar-marketplace"') continue;
    overrides.push('-c', `${match[1]}.${match[2]}.enabled=false`);
  }
}
// Command-line overrides isolate discovery from unrelated connectors, without changing user config.
const child = spawn(executable, ['app-server', '-c', 'features.hooks=true', ...overrides], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const pending = new Map();
let id = 0;
const lines = createInterface({ input: child.stdout });
lines.on('line', text => {
  try { const message = JSON.parse(text); const request = pending.get(message.id); if (request) { pending.delete(message.id); clearTimeout(request.timer); message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result); } }
  catch (error) { process.stderr.write(`Probe protocol: ${error.message}\n`); }
});
let diagnostics = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-8000); });
function request(method, params) {
  return new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(new Error(`Native probe timed out: ${method}`)); }, 20_000);
    pending.set(key, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id: key, method, params })}\n`);
  });
}
try {
  await request('initialize', { clientInfo: { name: 'scar-readonly-probe', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  child.stdin.write('{"method":"initialized"}\n');
  const started = await request('thread/start', { cwd: process.cwd(), ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only' });
  const skills = await request('skills/list', { cwds: [process.cwd()], forceReload: true });
  const hooks = await request('hooks/list', { cwds: [process.cwd()] });
  const scarSkills = skills.data.flatMap(entry => entry.skills.filter(skill => skill.pluginId === 'scar@scar-marketplace'));
  const scarHooks = hooks.data.flatMap(entry => entry.hooks.filter(hook => hook.pluginId === 'scar@scar-marketplace'));
  const result = { skills: scarSkills, hooks: scarHooks, hookErrors: hooks.data.flatMap(entry => entry.errors || []) };
  if (process.argv.includes('--mcp')) {
    const inventory = await request('mcpServerStatus/list', { detail: 'toolsAndAuthOnly', limit: 100, threadId: started.thread.id });
    result.mcp = inventory.data.filter(server => server.name.includes('scar')).map(server => ({name:server.name,runtimeStatus:server.runtimeStatus,tools:Object.keys(server.tools || {}),toolsError:server.toolsError}));
    result.diagnostics = diagnostics.split('\n').filter(line => /scar|mcp.cjs|MODULE_NOT_FOUND|Cannot find module/i.test(line)).slice(-10);
  }
  console.log(JSON.stringify(result, null, 2));
  if (process.argv.includes('--mcp') && !result.mcp.some(server => server.runtimeStatus === 'connected' && server.tools.length >= 10)) throw new Error('Installed Scar MCP did not expose its executable tools through the native host.');
} finally {
  for (const request of pending.values()) clearTimeout(request.timer);
  lines.close();
  child.stdin.end();
  const exited = once(child, 'close');
  const timeout = setTimeout(() => child.kill(), 2000);
  await exited;
  clearTimeout(timeout);
}
