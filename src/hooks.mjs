import path from 'node:path';
import { rm, mkdir } from 'node:fs/promises';
import { Workflow } from './workflow.mjs';
import { atomicJson, readJson, digest, catalogHome } from './io.mjs';
import { preventionContext, compactReport } from './presentation.mjs';

const codeExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte', '.py', '.go', '.rs', '.java', '.kt', '.cs', '.cpp', '.c', '.h', '.php', '.rb', '.swift', '.sql', '.sh', '.ps1', '.json', '.yaml', '.yml', '.toml', '.prisma', '.graphql', '.proto', '.tf', '.css', '.scss', '.html']);
const codeNames = new Set(['Dockerfile', 'Makefile', 'Justfile', 'Gemfile']);
const codeDigest = state => digest(state.entries.filter(([file]) => codeExtensions.has(path.extname(file).toLowerCase()) || codeNames.has(path.basename(file)) || path.basename(file).startsWith('Dockerfile.')));
const contextOutput = (event, text) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });

export async function hookEvent(input, home = catalogHome()) {
  const event = input?.payload ? { ...input.payload, hook_event_name: input.name } : input;
  const name = event?.hook_event_name;
  if (!['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd'].includes(name)) return {};
  try {
    if (typeof event.cwd !== 'string' || !path.isAbsolute(event.cwd) || typeof event.session_id !== 'string' || !event.session_id) throw new Error('Host must provide an absolute cwd and session_id.');
    const flow = new Workflow(home);
    const context = await flow.context(event.cwd);
    const file = path.join(home, 'sessions', `${digest({ project: context.state.root, session: event.session_id })}.json`);
    const previous = await readJson(file, null);
    if (name === 'SessionEnd') { await rm(file, { force: true }); return {}; }
    const current = codeDigest(context.state);
    if (name === 'SessionStart' || name === 'UserPromptSubmit') {
      await mkdir(path.dirname(file), { recursive: true });
      if (!previous) await atomicJson(file, { baseline: current });
      else if (name === 'UserPromptSubmit') await atomicJson(file, { ...previous, repairs: 0 });
      const contract = await readJson(flow.files(event.cwd).contract, {});
      const hints = preventionContext(context.classes, contract.task, contract.focusPaths);
      const rules = hints.classes.map(c => `${c.id}: ${c.title}. ${c.prevention}`).join('\n');
      return contextOutput(name, `Scar is enabled. For software tasks: scar_prepare before code (discover project checks; enrich acceptance), SDD + TDD, scar_verify, learn real generalized findings with proven detectors, scar_review, scar_finish. READY requires fresh executable evidence. For non-software tasks do not create contracts. No Git or CI required. ${hints.applicableCount} guards applicable; showing ${hints.classes.length} hints, all applicable guards execute.\n${rules || 'No matching source extensions yet; consult scar_catalog when choosing a stack.'}`);
    }
    const refuse = async reason => {
      const repairs = previous?.repairs || 0;
      if (repairs >= 3) return { continue: false, stopReason: 'Scar verification remains INCOMPLETE.', systemMessage: `Scar INCOMPLETE: repair limit reached. ${reason}` };
      await atomicJson(file, { ...previous, baseline: previous?.baseline ?? null, repairs: repairs + 1 });
      return { decision: 'block', reason };
    };
    if (previous?.baseline === current) return {};
    if (!previous || previous.baseline === null) return await refuse('Scar did not observe session start. Call scar_hook_event with SessionStart, then scar_prepare and scar_finish; completion is not verified.');
    const contract = await readJson(flow.files(event.cwd).contract, null);
    if (!contract) await flow.prepare(event.cwd, { task: 'Software changes in this session' });
    const result = await flow.finish(event.cwd);
    if (result.status !== 'READY') {
      const brief = JSON.stringify(compactReport(result));
      return await refuse(`Scar completion gate: ${brief}. Use scar_details, fix failures, configure missing behavior/integration checks with scar_prepare, learn meaningful error classes, scar_review, then scar_finish. Do not claim complete while this gate fails. If blocked by environment/authority, explicitly report incomplete.`);
    }
    await atomicJson(file, { baseline: current });
    return {};
  } catch (error) {
    if (name === 'Stop') {
      const reason = `Scar INCOMPLETE: cannot verify completion: ${error.message}. Report incomplete or repair the verification environment.`;
      return event.stop_hook_active ? { continue: false, stopReason: reason, systemMessage: reason } : { decision: 'block', reason };
    }
    return contextOutput(name, `Scar setup failed: ${error.message}. Software completion remains unverified; repair before claiming success.`);
  }
}
