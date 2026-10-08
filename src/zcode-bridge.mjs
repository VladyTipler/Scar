import path from 'node:path';
import { stat, realpath } from 'node:fs/promises';
import { withLock, digest } from './io.mjs';
import { homedir } from 'node:os';
import { ZCodeProtocolClient } from './zcode-protocol.mjs';
import { bindScarSession } from './zcode-session.mjs';

async function main(argv) {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: node zcode-bridge.cjs --host <absolute-zcode-entry> --workspace <absolute-project> --session <persisted-host-id> [--scar-home <absolute-catalog>] [--inspect] --exclusive\nOperator-only NDJSON client: session/read|messages|events|subscribe|send|stop. Resume only an inactive existing root session. Desktop is not patched.\n');
    return;
  }
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--inspect') { values.inspect = true; continue; }
    if (key === '--exclusive') { values.exclusive = true; continue; }
    if (!['--host', '--workspace', '--session', '--scar-home'].includes(key) || !argv[i + 1] || values[key] !== undefined) throw new Error(`Invalid or duplicate launcher argument: ${key}`);
    values[key] = argv[++i];
  }
  if (!values.exclusive) throw new Error('Use --exclusive only after ensuring this session is inactive in Desktop and other launchers.');
  const host = values['--host'], workspace = values['--workspace'];
  if (!host || !path.isAbsolute(host) || !(await stat(host)).isFile()) throw new Error('A real absolute ZCode app-server entrypoint is required.');
  if (!workspace || !path.isAbsolute(workspace)) throw new Error('An absolute workspace is required.');
  const env = { ...process.env };
  if (!env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE) {
    for (const candidate of [path.join(path.dirname(host), 'provider/zcode-builtin.json'), path.resolve(path.dirname(host), '../config/provider/zcode-builtin.json')]) {
      try { if ((await stat(candidate)).isFile()) { env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = candidate; break; } }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  if (!env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE) env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = path.join(homedir(), '.zcode/v2/provider_config.json');
  const leaseHome = values['--scar-home'] || process.env.SCAR_HOME || path.join(homedir(), '.scar');
  const lease = path.join(leaseHome, 'bridges', `${digest({ sessionId: values['--session'], workspace: await realpath(workspace) })}.lock`);
  await withLock(lease, async () => {
  const emit = message => process.stdout.write(`${JSON.stringify(message)}\n`);
  const callbacks = new Map(); let callbackNumber = 0;
  const protocol = new ZCodeProtocolClient({
    command: process.execPath, args: [host, 'app-server', '--cwd', workspace], cwd: workspace, env,
    onNotification: emit,
    onRequest: message => {
      if (message.method === 'session/requestRuntimePreferences') return { nativeSearchEnhancementsEnabled: false, memoryEnabled: false, askUserQuestionAutoResolutionEnabled: false, modelContextBudgetStrategy: 'preflight-v1' };
      if (values.inspect) throw new Error('Inspection never approves permissions or provider credentials.');
      return new Promise((resolve, reject) => {
        const id = `host-callback-${++callbackNumber}`;
        const timer = setTimeout(() => { callbacks.delete(id); reject(new Error('Operator callback timed out.')); }, 15000);
        callbacks.set(id, { resolve, reject, timer });
        emit({ ...message, id });
      });
    }
  });
  let stopped = false;
  const shutdown = async () => {
    if (stopped) return; stopped = true;
    for (const c of callbacks.values()) { clearTimeout(c.timer); c.reject(new Error('Bridge closed.')); }
    callbacks.clear(); await protocol.close();
  };
  const signal = () => { process.stdin.destroy(); shutdown().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }); };
  process.once('SIGINT', signal); process.once('SIGTERM', signal);
  try {
    const bound = await bindScarSession(protocol, { sessionId: values['--session'], workspace, mcpBundle: path.join(path.dirname(process.argv[1]), 'mcp.cjs'), scarHome: values['--scar-home'] });
    emit({ method: 'scar/bridgeReady', params: { sessionId: bound.sessionId, workspace: bound.workspace, isolation: 'session', delegation: 'disabled', desktopIntegrated: false } });
    if (values.inspect) return;
    process.stdin.setEncoding('utf8');
    let buffer = '';
    let requests = Promise.resolve();
    const consume = line => {
      let message;
      try { message = JSON.parse(line); }
      catch { emit({ id: 'invalid-message', error: { code: -32700, message: 'Invalid NDJSON input.' } }); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) { emit({ id: 'invalid-message', error: { code: -32600, message: 'Expected NDJSON request.' } }); return; }
      const callback = callbacks.get(message.id);
      if (callback && !message.method) {
        callbacks.delete(message.id); clearTimeout(callback.timer);
        if (message.error) callback.reject(new Error(message.error.message || 'Operator declined host callback.'));
        else if ('result' in message) callback.resolve(message.result);
        else callback.reject(new Error('Invalid operator callback result.'));
        return;
      }
      if (typeof message.id !== 'string' || typeof message.method !== 'string' || Object.keys(message).some(k => !['id', 'method', 'params'].includes(k))) { emit({ id: 'invalid-message', error: { code: -32600, message: 'Use {id,method,params}; no JSON-RPC or configuration envelopes.' } }); return; }
      requests = requests.then(async () => {
        try { emit({ id: message.id, result: await bound.request(message.method, message.params) }); }
        catch (error) { emit({ id: message.id, error: { code: error.code || -32602, message: error.message } }); }
      });
    };
    for await (const chunk of process.stdin) {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (Buffer.byteLength(line) > 1024 * 1024) throw new Error('Operator request frame exceeds 1 MiB.');
        if (line.trim()) consume(line);
      }
      if (Buffer.byteLength(buffer) > 1024 * 1024) throw new Error('Operator request frame exceeds 1 MiB.');
    }
    if (buffer.trim()) consume(buffer);
    await requests;
  } finally {
    process.removeListener('SIGINT', signal); process.removeListener('SIGTERM', signal);
    await shutdown();
  }
  });
}
main(process.argv.slice(2)).catch(error => { process.stderr.write(`Scar bridge: ${error.message}\n`); process.exitCode = 1; });
