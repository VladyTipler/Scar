import { runCheck } from './process.mjs';

async function main() {
  let text = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    text += chunk;
    if (Buffer.byteLength(text) > 128 * 1024) throw new Error('Hook payload exceeds 128 KiB.');
  }
  clearTimeout(inputTimer);
  const input = JSON.parse(text);
  const { hookEvent, hookFailure, hookBudget } = await import('./hooks.mjs');
  if (process.argv.includes('--worker')) return await hookEvent(input);
  const name = input?.payload ? input.name : input?.hook_event_name;
  // Parent does not read the workspace. The worker and all its descendants are
  // killed on deadline, including SSH and stalled OS requests.
  const cwd = input?.payload ? input.payload.cwd : input?.cwd;
  const result = await runCheck({ id: 'hook_worker', command: '$NODE', args: [process.argv[1], '--worker'], timeoutMs: (hookBudget(name, cwd) || 1000) + 1000 }, process.cwd(), JSON.stringify(input));
  if (result.status !== 'PASS') return hookFailure({ ...input, hook_event_name: name }, new Error(`hook worker ${result.status}`));
  return JSON.parse(result.stdout);
}

const inputTimer = setTimeout(() => {
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason: 'Scar INCOMPLETE: hook payload did not complete within its input budget.' })}\n`, () => process.exit(0));
}, 1500);
main().then(result => {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}).catch(error => {
  clearTimeout(inputTimer);
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason: `Scar hook input failed: ${error.message}` })}\n`);
});
