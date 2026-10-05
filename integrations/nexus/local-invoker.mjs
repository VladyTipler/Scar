import path from 'node:path';
import { runCheck } from '../../src/process.mjs';

// Host authority selects a pinned installed package and catalog location.
// Never let model input choose runtime, catalog or another owner's workspace.
export function createLocalInvoker({ runtime, home }) {
  if (!path.isAbsolute(runtime) || !path.isAbsolute(home)) throw new Error('Scar runtime and catalog home must be absolute host-owned paths.');
  return async ({ event }) => {
    // Child-specific env is passed explicitly; do not mutate global process env.
    const result = await runCheck({ id: 'scar_host_hook', command: '$NODE', args: [runtime], timeoutMs: 600_000 }, event.cwd, JSON.stringify(event), { SCAR_HOME: home });
    if (result.status !== 'PASS') throw Object.assign(new Error(`Scar host invocation ${result.status}: ${result.stderr}`), { code: 'scar_unavailable' });
    return { content: [{ type: 'text', text: result.stdout }] };
  };
}
