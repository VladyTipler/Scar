import path from 'node:path';
import { readJson, digest } from './io.mjs';

export function trustedSession(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(value)) throw new Error('Implementation requires a trusted host session identity.');
  return value;
}
export const reviewerSession = value => value.startsWith('sess_subagent_');
export const sessionTaskFile = (home, sessionId) => path.join(home, 'tasks', `${digest(trustedSession(sessionId))}.json`);
export async function readSessionTask(home, sessionId, options = {}) {
  const task = await readJson(sessionTaskFile(home, sessionId), null, { maxBytes: 64 * 1024, ...options });
  if (task && (task.schema !== 2 || task.ownerSessionId !== sessionId || typeof task.project !== 'string' || !path.isAbsolute(task.project) || typeof task.runId !== 'string' || typeof task.active !== 'boolean')) throw new Error('Invalid owned Scar task state.');
  return task;
}
export function requireOwner(contract, host) {
  if (contract?.ownerSessionId && contract.ownerSessionId !== host.sessionId) throw new Error('Scar task belongs to another owner session.');
  if (host.scoped && (!contract?.ownerSessionId || !contract.runId || contract.mode !== 'implementation')) throw new Error('No owned implementation task. Use analysis for review or explicitly prepare implementation.');
}
export async function cancellationStatus(home, project, contract, gate, options = {}) {
  if (gate?.status !== 'CANCELLED') return null;
  if (typeof gate.archive !== 'string' || path.dirname(gate.archive) !== path.join(home, 'cancellations')) throw new Error('Invalid cancellation archive path.');
  const record = await readJson(gate.archive, null, { maxBytes: 1024 * 1024, ...options });
  if (!record || record.status !== 'CANCELLED' || record.runId !== gate.runId || record.project !== project || contract?.runId !== gate.runId || gate.active !== false) throw new Error('Invalid cancellation history; no completion was established.');
  return { status: 'CANCELLED', reason: record.reason, runId: record.runId, archive: gate.archive };
}
