import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
// Read-only native discovery; never starts a model turn or trusts hooks.
const executable = process.argv[2];
if (!executable) throw new Error('Pass the absolute Codex executable path.');
const child = spawn(executable, ['app-server', '-c', 'features.hooks=true'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const pending = new Map();
let id = 0;
const lines = createInterface({ input: child.stdout });
lines.on('line', text => {
  try { const message = JSON.parse(text); const request = pending.get(message.id); if (request) { pending.delete(message.id); clearTimeout(request.timer); message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result); } }
  catch (error) { process.stderr.write(`Probe protocol: ${error.message}\n`); }
});
child.stderr.on('data', () => {});
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
    result.mcp = inventory.data.filter(server => server.name.includes('scar')).map(server => ({ name: server.name, tools: Object.keys(server.tools || {}) }));
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  for (const request of pending.values()) clearTimeout(request.timer);
  lines.close();
  child.stdin.end();
  const exited = once(child, 'close');
  const timeout = setTimeout(() => child.kill(), 2000);
  await exited;
  clearTimeout(timeout);
}
