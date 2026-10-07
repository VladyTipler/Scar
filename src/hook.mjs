import { runCheck } from './process.mjs';

const zcode = process.argv.includes('--zcode');

async function main() {
  let text = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    text += chunk;
    if (Buffer.byteLength(text) > 128 * 1024) throw new Error('Hook payload exceeds 128 KiB.');
  }
  clearTimeout(inputTimer);
  const input = JSON.parse(text);
  if (zcode && process.argv.includes('--bind-request')) {
    const { issueBinding } = await import('./native-binding.mjs');
    try { return await issueBinding(input); }
    catch (error) { return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: error.message } }; }
  }
  const { hookEvent, hookFailure, hookBudget } = await import('./hooks.mjs');
  if (process.argv.includes('--worker')) return await hookEvent(input, undefined, { cleanupSessionOnStop: zcode, scoped: zcode });
  const name = input?.payload ? input.name : input?.hook_event_name;
  // Parent does not read the workspace. The worker and all its descendants are
  // killed on deadline, including SSH and stalled OS requests.
  const cwd = input?.payload ? input.payload.cwd : input?.cwd;
  const result = await runCheck({ id: 'hook_worker', command: '$NODE', args: [process.argv[1], ...process.argv.slice(2), '--worker'], timeoutMs: (hookBudget(name, cwd) || 1000) + 1000 }, process.cwd(), JSON.stringify(input));
  if (result.status !== 'PASS') return hookFailure({ ...input, hook_event_name: name }, new Error(`hook worker ${result.status}`));
  return JSON.parse(result.stdout);
}

const inputTimer = setTimeout(() => {
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason: 'Scar INCOMPLETE: hook payload did not complete within its input budget.' })}\n`, () => process.exit(0));
}, 1500);
main().then(result => {
  // ZCode ignores Stop systemMessage without a blocking decision; terminal
  // INCOMPLETE must remain context without requesting another repair turn.
  if (zcode && result.continue === false) result = { ...result, hookSpecificOutput: { hookEventName: 'Stop', additionalContext: result.systemMessage || result.stopReason } };
  process.stdout.write(`${JSON.stringify(result)}\n`);
}).catch(error => {
  clearTimeout(inputTimer);
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason: `Scar hook input failed: ${error.message}` })}\n`);
});
