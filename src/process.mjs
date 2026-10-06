import { spawn } from 'node:child_process';
import path from 'node:path';
const quotePowerShell = value => `'${value.replaceAll("'", "''")}'`;

export function validateCheck(check) {
  if (!check || !/^[a-zA-Z0-9_-]{1,80}$/.test(check.id) || typeof check.command !== 'string' || !check.command || !Array.isArray(check.args) || check.args.some(a => typeof a !== 'string')) throw new Error('Invalid check: id, executable command and string args are required.');
  if (check.timeoutMs !== undefined && (!Number.isInteger(check.timeoutMs) || check.timeoutMs < 50 || check.timeoutMs > 600_000)) throw new Error('Check timeout must be 50..600000 ms.');
}

export async function runCheck(check, cwd, input, env = {}, limits = {}) {
  limits.signal?.throwIfAborted();
  validateCheck(check);
  const outputLimit = limits.maxOutputBytes ?? 1024 * 1024;
  if (!Number.isInteger(outputLimit) || outputLimit < 1 || outputLimit > 64 * 1024 * 1024) throw new Error('Invalid output budget.');
  const inheritedEnv = { ...process.env, CI: '1', ...env };
  const childEnv = process.platform === 'win32'
    ? Object.fromEntries(Object.entries(inheritedEnv).map(([key, value]) => [key.toUpperCase(), value]))
    : inheritedEnv;
  // MCP hosts may omit PATHEXT; PowerShell otherwise skips native commands.
  if (process.platform === 'win32') childEnv.PATHEXT ||= '.COM;.EXE;.BAT;.CMD';
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.NODE_TEST_WORKER_ID;
  let command = check.command === '$NODE' ? process.execPath : check.command;
  let args = check.args;
  if (process.platform === 'win32' && /^(npm|npx)(\.cmd)?$/i.test(path.basename(command))) {
    const nativeCommand = /\.cmd$/i.test(command) ? command : `${command}.cmd`;
    // PowerShell 5.1 plus a cmd shim cannot preserve these argument shapes.
    if (/["%!\r\n]/.test(nativeCommand) || args.some(arg => !arg || /["&|<>^%!()\r\n]/.test(arg) || (/\s/.test(arg) && /\\$/.test(arg)))) {
      return { id: check.id, status: 'FAIL', exitCode: null, stdout: '', stderr: 'Windows npm/npx cmd shims cannot forward these arguments literally. Configure a $NODE check that invokes the required CLI JavaScript entry point with argument arrays.', durationMs: 0 };
    }
    const script = [
      "$ErrorActionPreference = 'Stop'",
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
      '$OutputEncoding = [Console]::OutputEncoding',
      '$LASTEXITCODE = $null',
      `& ${quotePowerShell(nativeCommand)} ${args.map(quotePowerShell).join(' ')}`,
      "if ($null -eq $LASTEXITCODE) { throw 'Native command returned no exit code' }",
      'exit $LASTEXITCODE'
    ].join('; ');
    args = ['-NoProfile', '-NonInteractive', '-Command', script];
    command = 'powershell.exe';
  }
  return await new Promise(resolve => {
    const started = performance.now();
    const child = spawn(command, args, { cwd, env: childEnv, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', size = 0, forced, settled = false;
    function killTree() {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') child.kill('SIGKILL'); }
      }
    }
    function terminate(status) { if (!forced) { forced = status; killTree(); } }
    const onAbort = () => terminate('CANCELLED');
    limits.signal?.addEventListener('abort', onAbort, { once: true });
    if (limits.signal?.aborted) onAbort();
    const timer = setTimeout(() => terminate('TIMEOUT'), check.timeoutMs || 120_000);
    function capture(kind, chunk) {
      size += Buffer.byteLength(chunk);
      if (size > outputLimit) { terminate('OUTPUT_LIMIT'); return; }
      if (kind === 'out') stdout += chunk; else stderr += chunk;
    }
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => capture('out', chunk));
    child.stderr.on('data', chunk => capture('err', chunk));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    function finish(exitCode, error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      limits.signal?.removeEventListener('abort', onAbort);
      if (process.platform !== 'win32') killTree();
      resolve({ id: check.id, status: forced || (error || exitCode !== 0 ? 'FAIL' : 'PASS'), exitCode, stdout, stderr: error ? `${stderr}\n${error.message}` : stderr, durationMs: Math.round(performance.now() - started) });
    }
    child.on('error', error => finish(null, error));
    child.on('close', code => finish(code));
  });
}
