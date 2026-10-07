import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Workflow } from './workflow.mjs';
import { hookEvent } from './hooks.mjs';
import { consumeBinding } from './native-binding.mjs';
import { publicCatalog, compactReport, publicationResult, reportDetails, preventionContext, classSource } from './presentation.mjs';
const scoped = process.argv.includes('--zcode');
const flow = new Workflow(undefined, { scoped, sessionId: process.env.SCAR_HOST_SESSION_ID, workspace: process.env.SCAR_HOST_WORKSPACE });
const server = new McpServer({ name: 'scar', version: '0.1.7' });
const project = z.string().describe('Absolute workspace path on the same host as Scar.');
const sessionScope = scoped ? {} : { sessionId: z.string().optional().describe('Host chat identity for legacy native clients.'), hostProject: z.string().optional().describe('Original host cwd for legacy scoped clients.') };
const scopedFlow = (args, callFlow) => scoped ? callFlow : new Workflow(flow.home, { sessionId: args.sessionId, hostProject: args.hostProject ?? (args.sessionId === undefined ? undefined : args.project) });
const checkSchema = z.object({ id: z.string(), command: z.string(), args: z.array(z.string()), timeoutMs: z.number().int().optional() });
function register(name, description, inputSchema, operation) {
  const hostBound = scoped && ['scar_prepare', 'scar_verify', 'scar_review', 'scar_finish', 'scar_learn', 'scar_cancel', 'scar_status', 'scar_details'].includes(name);
  const schema = hostBound ? { ...inputSchema, _scarBinding: z.string().optional().describe('Host-injected one-use binding. Never supply this field yourself.') } : inputSchema;
  server.registerTool(name, { description, inputSchema: schema }, async args => {
    try {
      let callFlow = flow;
      if (hostBound && args._scarBinding !== undefined) {
        if (name === 'scar_prepare' && args.mode !== 'implementation') throw new Error('Analysis does not use implementation binding.');
        const identity = await consumeBinding(name, args, flow.home);
        if (flow.host.sessionId && flow.host.sessionId !== identity.sessionId) throw new Error('Native binding differs from isolated launcher session.');
        callFlow = new Workflow(flow.home, identity);
      }
      if (scoped && (name === 'scar_status' || name === 'scar_details') && !callFlow.host.sessionId) throw new Error('Evidence inspection requires a native session binding or isolated launcher identity.');
      const { _scarBinding: ignored, ...input } = args;
      const result = await operation(input, callFlow);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
}
register('scar_prepare', 'Explicit analysis reads prevention hints without state/checks/gate. Explicit implementation requires trusted host binding (automatically injected by native ZCode PreToolUse); checks and owner task remain strict.', { project, ...sessionScope, task: z.string(), mode: z.enum(['analysis', 'implementation']).optional().describe('Use analysis for questions/review: no writes, checks or completion gate. Implementation explicitly arms an owner task.'), checks: z.array(checkSchema).optional(), focusPaths: z.array(z.string()).optional(), excludeRoots: z.array(z.string()).optional(), scope: z.object({ kind: z.literal('documentation'), paths: z.array(z.string()) }).strict().optional().describe('Explicit Markdown-only task scope; baseline protects all other covered files. focusPaths never restricts checking.') }, (args, callFlow) => scopedFlow(args, callFlow).prepare(args.project, args));
register('scar_context', 'Retrieve additional applicable prevention hints by task/path and page; does not change the contract or execution coverage.', { project, task: z.string().optional(), focusPaths: z.array(z.string()).optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(20).optional() }, async args => preventionContext((await flow.context(args.project)).classes, args.task, args.focusPaths, args));
for (const operation of ['verify', 'finish', 'status']) register(`scar_${operation}`, `${operation}: executable checks and bounded fresh evidence. Only finish after a learning review can return READY.`, { project, ...sessionScope }, async (args, callFlow) => compactReport(await scopedFlow(args, callFlow)[operation](args.project)));
register('scar_review', 'Record learning review after learning all meaningful findings. Must explain why no new class was added or reference learned class IDs.', { project, ...sessionScope, reason: z.string() }, (args, callFlow) => scopedFlow(args, callFlow).review(args.project, args.reason));
register('scar_catalog', 'Bounded catalog index or one class by ID. To expand an existing detector, request its detector/fixtures source in 4000-character slices by ID. Never load the full catalog into context.', { id: z.string().optional(), source: z.enum(['detector', 'fixtures']).optional(), query: z.string().optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(20).optional() }, args => args.source ? classSource(flow.catalog, args) : publicCatalog(flow.catalog, args));
register('scar_details', 'Read bounded evidence pages or a 4000-character check log slice. Full evidence remains on disk.', { project, ...sessionScope, section: z.enum(['findings', 'warnings', 'errors', 'checks', 'classes']).optional(), checkId: z.string().optional(), stream: z.enum(['stdout', 'stderr']).optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(20).optional() }, (args, callFlow) => reportDetails(scopedFlow(args, callFlow), args.project, args));
register('scar_learn', 'Publish an executable error class after bad, alternate-bad and valid fixtures prove scope. Revision protects concurrent updates. replace=true expands an existing stable ID.', { record: z.record(z.string(), z.unknown()), expectedRevision: z.string(), replace: z.boolean().optional() }, async (args, callFlow) => {
  if (scoped) {
    const { readSessionTask } = await import('./task-state.mjs');
    const task = await readSessionTask(callFlow.home, callFlow.host.sessionId);
    if (!task?.active) throw new Error('Learning requires an active owned implementation task; analysis is read-only.');
    await callFlow.authorize(task.project);
  }
  return publicationResult(await callFlow.catalog.learn(args.record, args.expectedRevision, { replace: args.replace }), args.record.id);
});
register('scar_hook_event', 'Host adapter only: handle a native lifecycle event including cwd and session_id. Never use one implicit workspace for pooled sessions.', { event: z.record(z.string(), z.unknown()) }, args => { if (scoped) throw new Error('Native ZCode hooks are host-owned; model calls cannot supply lifecycle identity.'); return hookEvent(args.event); });
if (scoped) register('scar_cancel', 'Explicit withdrawal of the current owner task only: exact expectedRunId and reason; archives evidence, CANCELLED is never READY. Do not cancel merely to get a passing gate.', { project, expectedRunId: z.string(), reason: z.string() }, async (args, callFlow) => {
  if (!scoped) throw new Error('Owner cancellation is available only through a scoped native host. Legacy recovery stays administrative CLI.');
  await callFlow.authorize(args.project);
  return callFlow.cancel(args.project, args);
});
server.connect(new StdioServerTransport()).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
