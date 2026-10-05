import { hookEvent } from './hooks.mjs';
async function main() {
 let input = '';
 try {
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 128 * 1024) throw new Error('Hook payload exceeds 128 KiB.');
  }
  process.stdout.write(`${JSON.stringify(await hookEvent(JSON.parse(input)))}\n`);
 } catch (error) {
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason: `Scar hook input failed: ${error.message}` })}\n`);
 }
}
main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
