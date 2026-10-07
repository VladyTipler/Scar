import { spawn } from 'node:child_process';

export class ZCodeProtocolClient {
  constructor({ command, args, cwd, env = process.env, timeoutMs = 30000, maxFrameBytes = 16 * 1024 * 1024, onRequest, onNotification, stderr = process.stderr }) {
    this.options = { command, args, cwd, env, timeoutMs, maxFrameBytes, onRequest, onNotification, stderr };
    this.timeoutMs = timeoutMs; this.maxFrameBytes = maxFrameBytes;
    this.onRequest = onRequest; this.onNotification = onNotification;
    this.pending = new Map(); this.sequence = 0; this.buffer = ''; this.closed = false;
    this.child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
    this.exit = new Promise(resolve => this.child.once('close', resolve));
    this.child.on('error', error => this.fail(error));
    this.child.once('close', () => this.fail(new Error('ZCode host connection closed.')));
    this.child.stdin.on('error', error => this.fail(error));
    this.child.stderr.on('data', chunk => stderr.write(chunk));
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      this.buffer += chunk;
      let newline;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
        if (Buffer.byteLength(line) > maxFrameBytes) { this.fail(new Error('ZCode frame exceeds output limit.')); break; }
        if (line.trim()) this.receive(line);
      }
      if (Buffer.byteLength(this.buffer) > maxFrameBytes) this.fail(new Error('ZCode frame exceeds output limit.'));
    });
  }
  write(message) {
    if (this.closed) throw new Error('ZCode host connection closed.');
    const line = JSON.stringify(message);
    if (Buffer.byteLength(line) > this.maxFrameBytes) throw new Error('ZCode request exceeds frame limit.');
    this.child.stdin.write(`${line}\n`);
  }
  request(method, params = {}) {
    if (this.closed) return Promise.reject(new Error('ZCode host connection closed.'));
    const id = `scar-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error(`ZCode request timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  receive(line) {
    let message;
    try { message = JSON.parse(line); }
    catch { this.fail(new Error('Invalid ZCode NDJSON output.')); return; }
    if (message && typeof message.method === 'string') {
      if (message.id === undefined) {
        try { this.onNotification?.(message); } catch (error) { this.fail(error); }
        return;
      }
      Promise.resolve().then(() => {
        if (!this.onRequest) throw new Error(`Unsupported host callback: ${message.method}`);
        return this.onRequest(message);
      }).then(result => { if (!this.closed) this.write({ id: message.id, result }); }, error => { if (!this.closed) this.write({ id: message.id, error: { code: -32601, message: error.message } }); }).catch(error => this.fail(error));
      return;
    }
    const pending = this.pending.get(message?.id);
    if (!pending) return;
    this.pending.delete(message.id); clearTimeout(pending.timer);
    if (message.error) {
      const error = new Error(message.error.message || 'ZCode host error.');
      error.code = message.error.code; error.data = message.error.data;
      pending.reject(error);
    } else if ('result' in message) pending.resolve(message.result);
    else pending.reject(new Error('Malformed ZCode host response.'));
  }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.child.stdin.end();
    this.cleanup = this.dispose();
    this.cleanup.catch(() => {});
  }
  async restart() {
    await this.close();
    this.replacement = new ZCodeProtocolClient(this.options);
    return this.replacement;
  }
  async close() {
    if (this.replacement) { await this.replacement.close(); return; }
    this.fail(new Error('ZCode host connection closed.'));
    await this.cleanup;
  }
  async dispose() {
    const wait = async ms => { let timer; try { return await Promise.race([this.exit.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), ms); })]); } finally { clearTimeout(timer); } };
    const terminate = signal => {
      try {
        if (process.platform === 'win32') this.child.kill(signal);
        else process.kill(-this.child.pid, signal);
      } catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    if (!await wait(1500)) { terminate('SIGTERM'); if (!await wait(1500)) { terminate('SIGKILL'); await this.exit; } }
  }
}
