import { readJson, atomicJson, digest, projectGateFile, withLock } from './io.mjs';
import { taskFiles, validateBinding } from './task-scope.mjs';
import { freshStatus } from './evidence.mjs';
import { PersonalCatalog } from './sharing.mjs';
import { compactReport } from './presentation.mjs';
import { cancellationStatus } from './task-state.mjs';

export async function stopSession(binding, file, event, home, io) {
  validateBinding(binding, event.cwd, event.session_id);
  const pending = [];
  const catalog = new PersonalCatalog(home);
  for (const entry of binding.projects) {
    const gateFile = projectGateFile(home, entry.project, event.session_id);
    const gate = await readJson(gateFile, null, io);
    if (gate?.schema === 1 && gate.active === false && gate.runId === entry.runId) {
      if (gate.status === 'CANCELLED') { const contract = await readJson(taskFiles(entry.project, event.session_id).contract, null, io); await cancellationStatus(home, entry.project, contract, gate, io); }
      continue;
    }
    const contract = await readJson(taskFiles(entry.project, event.session_id).contract, null, io);
    if (!gate || gate.schema !== 1 || typeof gate.active !== 'boolean' || gate.runId !== entry.runId || !contract || contract.runId !== entry.runId || contract.sessionId !== event.session_id || gate.ownerSessionId && (gate.ownerSessionId !== event.session_id || contract.ownerSessionId !== event.session_id)) return 'Scar INCOMPLETE: this chat has missing or changed scoped verification evidence. Run scar_prepare and scar_finish with its sessionId and hostProject.';
    const result = await freshStatus(entry.project, catalog, { signal: io.signal, sessionId: event.session_id });
    if (result.status !== 'READY') return 'Scar completion gate for this chat: ' + JSON.stringify({ project: entry.project, sessionId: event.session_id, ...compactReport(result) }) + '. Run checks and scar_finish with this session scope. No tests execute in Stop.';
    pending.push({ gateFile, entry });
  }
  return await withLock(file + '.lock', async () => {
    const latest = await readJson(file, null, io);
    validateBinding(latest, event.cwd, event.session_id);
    if (digest(latest) !== digest(binding)) return 'Scar INCOMPLETE: this chat prepared a new task during Stop.';
    for (const { gateFile, entry } of pending) {
      const closed = await withLock(gateFile + '.lock', async () => {
        const gate = await readJson(gateFile, null, io);
        if (!gate || gate.runId !== entry.runId) return false;
        await atomicJson(gateFile, { ...gate, schema: 1, active: false, runId: entry.runId }, io);
        return true;
      }, io);
      if (!closed) return 'Scar INCOMPLETE: a new session generation cannot be closed by an earlier Stop.';
    }
    return null;
  }, io);
}
