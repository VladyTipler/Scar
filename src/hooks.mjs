import path from 'node:path';
import { rm, realpath } from 'node:fs/promises';
import { atomicJson, readJson, digest, catalogHome, projectGateFile, withLock } from './io.mjs';
import { bindingFile } from './task-scope.mjs';
import { taskFiles } from './task-scope.mjs';
import { abortable } from './abort.mjs';
import { readSessionTask, sessionTaskFile, cancellationStatus } from './task-state.mjs';

const contextOutput = (event, text) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
const instructions = 'Scar is enabled. Questions, reviews and read-only analysis use scar_prepare mode=analysis or scar_context/catalog: no contracts, commands or completion gate. Reviewer subagents only inspect; never prepare implementation. Only explicitly authorized implementation uses mode=implementation and a trusted owner session, SDD + TDD, verify/review/finish. Stop follows the owning task, not current cwd. Documentation-only implementation must explicitly choose scope.kind=documentation with Markdown paths and real docs checks; focusPaths is not scope. Preserve code findings as warnings, never claim repository READY. Unchanged FAIL: inspect status/details and report it, do not repeat finish. Analysis never clears an active implementation. Native PreToolUse injects a one-use owner binding for explicit implementation and its checks: use ordinary tools, never provide _scarBinding/session IDs yourself. Missing native binding refuses implementation; do not bypass using a legacy CLI. No Git or CI required.';
export const hookBudgets = { SessionStart: 1000, UserPromptSubmit: 1000, Stop: 2000, SessionEnd: 500 };

export function hookBudget(name, cwd) { return name === 'Stop' && typeof cwd === 'string' && cwd.startsWith('\\\\') ? 15000 : hookBudgets[name]; }

export function hookFailure(event, error) {
  const reason = `Scar INCOMPLETE: ${error.message}. Run scar_prepare/scar_finish through MCP; do not claim verified completion.`;
  if (event?.hook_event_name === 'Stop') return event.stop_hook_active
    ? { continue: false, stopReason: reason, systemMessage: 'Scar INCOMPLETE: repair limit reached. ' + reason }
    : { decision: 'block', reason };
  return contextOutput(event?.hook_event_name || 'SessionStart', `${instructions}\n${reason}`);
}

export async function hookEvent(input, home = catalogHome(), options = {}) {
  const event = input?.payload ? { ...input.payload, hook_event_name: input.name } : input;
  const name = event?.hook_event_name;
  if (!Object.hasOwn(hookBudgets, name)) return { decision: 'block', reason: 'Scar hook input requires a supported hook_event_name.' };
  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal.reason);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  const signal = controller.signal;
  const timer = setTimeout(() => controller.abort(new Error(`Scar ${name} budget exhausted; freshness is unverified`)), options.budgetMs ?? hookBudget(name, event?.cwd));
  const io = { signal, maxBytes: 64 * 1024 };
  try {
    return await abortable(async () => {
      if (typeof event.cwd !== 'string' || !path.isAbsolute(event.cwd) || typeof event.session_id !== 'string' || !event.session_id) throw new Error('Host must provide an absolute cwd and session_id.');
      let project = path.resolve(event.cwd);
      const identity = process.platform === 'win32' ? project.toLowerCase() : project;
      const file = path.join(home, 'sessions', `${digest({ project: identity, session: event.session_id })}.json`);
      if (name === 'SessionEnd') { await abortable(() => rm(file, { force: true }), signal); return {}; }
      const allow = async () => {
        if (options.cleanupSessionOnStop) await abortable(() => rm(file, { force: true }), signal);
        return {};
      };
      const previous = await readJson(file, null, io);
      if (name === 'SessionStart' || name === 'UserPromptSubmit') {
        if (!previous || name === 'UserPromptSubmit') await atomicJson(file, { ...previous, schema: 2, repairs: 0 }, io);
        const cached = await readJson(path.join(project, '.scar', 'context.json'), null, io);
        const hints = cached?.schema === 1 && Array.isArray(cached.classes)
          ? cached.classes.slice(0, 8).map(c => `${c.id}: ${c.title}. ${c.prevention}`).join('\n').slice(0, 5200)
          : '';
        return contextOutput(name, `${instructions}\n${options.scoped ? 'Native automatic session scope.' : 'Host chat scope for software tools: ' + JSON.stringify({ sessionId: event.session_id, hostProject: project })}\n${hints ? `Cached prevention hints; scar_prepare refreshes applicability and the catalog:\n${hints}` : 'Call scar_prepare to discover applicable failure classes; no source scan runs in this hook.'}`);
      }
      const task = options.scoped ? await readSessionTask(home, event.session_id, io) : null;
      if (task) project = task.project;
      if (!task || task.evidenceSessionId) {
        const scopeFile = bindingFile(home, task?.hostProject ?? event.cwd, event.session_id);
        const scope = await readJson(scopeFile, null, io);
        if (scope) {
          if (!previous && task?.active !== false) { await atomicJson(file, { schema: 2, repairs: 1 }, io); return { decision: 'block', reason: 'Scar INCOMPLETE: session start was not observed for this chat.' }; }
          const { stopSession } = await import('./session-stop.mjs');
          const reason = await stopSession(scope, scopeFile, { ...event, cwd: task?.hostProject ?? event.cwd }, home, io);
          if (reason) {
            const repairs = previous.repairs || 0;
            if (repairs >= 3) return { continue: false, stopReason: 'Scar verification remains INCOMPLETE.', systemMessage: 'Scar INCOMPLETE: repair limit reached. ' + reason };
            await atomicJson(file, { schema: 2, repairs: repairs + 1 }, io);
            return { decision: 'block', reason };
          }
          if (task) await atomicJson(sessionTaskFile(home, event.session_id), { ...task, active: false }, io);
          if (!options.cleanupSessionOnStop) await atomicJson(file, { schema: 2, repairs: 0 }, io);
          return await allow();
        }
        if (task?.evidenceSessionId) throw new Error('Scoped task binding is missing.');
      }
      const canonical = await abortable(() => realpath(project), signal);
      const gateFile = projectGateFile(home, canonical);
      const gate = await readJson(gateFile, null, io);
      if (gate && (gate.schema !== 1 || typeof gate.active !== 'boolean' || typeof gate.runId !== 'string')) throw new Error('Invalid project gate state.');
      const contract = await readJson(path.join(project, '.scar', 'contract.json'), null, io);
      if (task?.active === false && gate?.runId !== task.runId && gate?.ownerSessionId !== event.session_id) return await allow();
      if (task && (task.runId !== gate?.runId || task.ownerSessionId !== gate?.ownerSessionId || task.ownerSessionId !== contract?.ownerSessionId || task.runId !== contract?.runId)) throw new Error('Owned task, gate and contract generation mismatch.');
      if (options.scoped && gate?.ownerSessionId === event.session_id && !task) throw new Error('Owned implementation task pointer is missing.');
      if (gate?.ownerSessionId && gate.ownerSessionId !== event.session_id) return await allow();
      if (await cancellationStatus(home, canonical, contract, gate, io)) return await allow();
      if (gate?.active === false && contract?.runId === gate.runId) {
        if (task?.active) await atomicJson(sessionTaskFile(home, event.session_id), { ...task, active: false }, io);
        return await allow();
      }
      // Preparation arms a durable gate outside the project. Deleting .scar
      // cannot bypass it; ordinary conversations have no active software gate.
      if (!gate && !contract) return await allow();
      const refuse = async reason => {
        const repairs = previous?.repairs || 0;
        if (repairs >= 3) return { continue: false, stopReason: 'Scar verification remains INCOMPLETE.', systemMessage: `Scar INCOMPLETE: repair limit reached. ${reason}` };
        await atomicJson(file, { ...previous, schema: 2, repairs: repairs + 1 }, io);
        return { decision: 'block', reason };
      };
      if (!contract || gate && contract.runId !== gate.runId) return await refuse('Scar INCOMPLETE: active verification contract is missing or changed. Call scar_prepare and scar_finish.');
      if (!previous) return await refuse('Scar INCOMPLETE: session start was not observed. Initialize SessionStart and finish the software contract.');
      const { freshStatus } = await import('./evidence.mjs');
      const { PersonalCatalog } = await import('./sharing.mjs');
      const result = await freshStatus(project, new PersonalCatalog(home), { signal });
      if (result.status !== 'READY') {
        const { compactReport } = await import('./presentation.mjs');
        return await refuse(`Scar completion gate: ${JSON.stringify(compactReport(result))}. Inspect scar_details; run checks and scar_finish through MCP. No tests execute in Stop.`);
      }
      const closed = await withLock(`${gateFile}.lock`, async () => {
        const latest = await readJson(gateFile, null, io);
        if (latest && latest.runId !== gate?.runId) return false;
        await atomicJson(gateFile, { ...gate, schema: 1, active: false, runId: contract.runId || 'legacy' }, io);
        if (task) await atomicJson(sessionTaskFile(home, event.session_id), { ...task, active: false }, io);
        return true;
      }, io);
      if (!closed) return await refuse('Scar INCOMPLETE: a new task was prepared during the completion gate.');
      if (!options.cleanupSessionOnStop) await atomicJson(file, { schema: 2, repairs: 0 }, io);
      return await allow();
    }, signal);
  } catch (error) { return hookFailure(event, error); }
  finally { clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort); }
}
