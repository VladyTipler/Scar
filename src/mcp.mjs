import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Workflow } from './workflow.mjs';
import { hookEvent } from './hooks.mjs';
import { publicCatalog, compactReport, publicationResult, reportDetails, preventionContext, classSource } from './presentation.mjs';
const flow = new Workflow();
const server = new McpServer({ name: 'scar', version: '0.1.1' });
const project = z.string().describe('Absolute workspace path on the same host as Scar.');
const checkSchema = z.object({ id: z.string(), command: z.string(), args: z.array(z.string()), timeoutMs: z.number().int().optional() });
function register(name, description, inputSchema, operation) {
  server.registerTool(name, { description, inputSchema }, async args => {
    try {
      const result = await operation(args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
}
register('scar_prepare', 'Before implementation: bounded prevention hints and verification contract. All applicable guards still execute. Checks auto-discover; supply task-specific acceptance/integration checks.', { project, task: z.string(), checks: z.array(checkSchema).optional(), focusPaths: z.array(z.string()).optional() }, args => flow.prepare(args.project, args));
register('scar_context', 'Retrieve additional applicable prevention hints by task/path and page; does not change the contract or execution coverage.', { project, task: z.string().optional(), focusPaths: z.array(z.string()).optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(20).optional() }, async args => preventionContext((await flow.context(args.project)).classes, args.task, args.focusPaths, args));
for (const operation of ['verify', 'finish', 'status']) register(`scar_${operation}`, `${operation}: executable checks and bounded fresh evidence. Only finish after a learning review can return READY.`, { project }, async args => compactReport(await flow[operation](args.project)));
register('scar_review', 'Record learning review after learning all meaningful findings. Must explain why no new class was added or reference learned class IDs.', { project, reason: z.string() }, args => flow.review(args.project, args.reason));
register('scar_catalog', 'Bounded catalog index or one class by ID. To expand an existing detector, request its detector/fixtures source in 4000-character slices by ID. Never load the full catalog into context.', { id: z.string().optional(), source: z.enum(['detector', 'fixtures']).optional(), query: z.string().optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(20).optional() }, args => args.source ? classSource(flow.catalog, args) : publicCatalog(flow.catalog, args));
register('scar_details', 'Read bounded evidence pages or a 4000-character check log slice. Full evidence remains on disk.', { project, section: z.enum(['findings', 'errors', 'checks', 'classes']).optional(), checkId: z.string().optional(), stream: z.enum(['stdout', 'stderr']).optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(20).optional() }, args => reportDetails(flow, args.project, args));
register('scar_learn', 'Publish an executable error class after bad, alternate-bad and valid fixtures prove scope. Revision protects concurrent updates. replace=true expands an existing stable ID.', { record: z.record(z.string(), z.unknown()), expectedRevision: z.string(), replace: z.boolean().optional() }, async args => publicationResult(await flow.catalog.learn(args.record, args.expectedRevision, { replace: args.replace }), args.record.id));
register('scar_hook_event', 'Host adapter only: handle a native lifecycle event including cwd and session_id. Never use one implicit workspace for pooled sessions.', { event: z.record(z.string(), z.unknown()) }, args => hookEvent(args.event));
server.connect(new StdioServerTransport()).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
