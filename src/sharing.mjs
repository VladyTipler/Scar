import path from 'node:path';
import { runCheck } from './process.mjs';
import { Catalog } from './catalog.mjs';
import { readJson } from './io.mjs';

const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
export function sshArguments(config) {
  if (!config || typeof config.host !== 'string' || !/^(?:[a-zA-Z0-9_.-]+@)?[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(config.host)) throw new Error('SSH catalog requires a host or user@host without SSH options.');
  for (const key of ['runtime', 'home']) {
    if (typeof config[key] !== 'string' || !config[key].startsWith('/') || /[\r\n\0]/.test(config[key])) throw new Error(`SSH catalog requires an absolute POSIX ${key} path.`);
  }
  if (config.executable !== undefined && (typeof config.executable !== 'string' || !path.isAbsolute(config.executable))) throw new Error('SSH executable override must be an absolute trusted path.');
  const script = `source ~/.profile >/dev/null 2>&1; exec node ${shellQuote(config.runtime)} catalog-rpc ${shellQuote(config.home)}`;
  return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', config.host, `bash -lc ${shellQuote(script)}`];
}
export class RemoteCatalog {
  constructor(config, invoke) {
    this.invoke = invoke || (async input => {
      const result = await runCheck({ id: 'catalog_ssh', command: config.executable || 'ssh', args: sshArguments(config), timeoutMs: 45_000 }, process.cwd(), JSON.stringify(input), {}, { maxOutputBytes: 64 * 1024 * 1024 });
      if (result.status !== 'PASS') throw new Error(`Configured SSH catalog unavailable (${result.status}): ${result.stderr}`);
      try { return JSON.parse(result.stdout); } catch { throw new Error('SSH catalog returned an invalid RPC response.'); }
    });
  }
  async request(input) {
    const result = await this.invoke(input);
    if (result?.error) throw new Error(result.error);
    if (result?.schema !== 1 || !Array.isArray(result.records) || typeof result.revision !== 'string') throw new Error('Invalid remote catalog response.');
    return result;
  }
  async read() { return await this.request({ operation: 'read' }); }
  async learn(record, expectedRevision, options = {}) { return await this.request({ operation: 'learn', record, expectedRevision, options }); }
}
export class PersonalCatalog {
  constructor(home) { this.home = path.resolve(home); }
  async backend() {
    const config = await readJson(path.join(this.home, 'connection.json'), null);
    if (!config) return new Catalog(this.home);
    if (config.type !== 'ssh') throw new Error('Unsupported configured catalog transport.');
    sshArguments(config);
    return new RemoteCatalog(config);
  }
  async read() { return await (await this.backend()).read(); }
  async learn(record, expectedRevision, options) { return await (await this.backend()).learn(record, expectedRevision, options); }
}
export async function catalogRpc(home, input) {
  const catalog = new Catalog(home);
  try {
    if (input.operation === 'read') return await catalog.read();
    if (input.operation === 'learn') return await catalog.learn(input.record, input.expectedRevision, input.options);
    throw new Error('Unsupported catalog RPC operation.');
  } catch (error) { return { error: error.message }; }
}
