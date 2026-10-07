import path from 'node:path';
import { digest } from './io.mjs';

export const maxSessionProjects = 16;
export function validateSession(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 512 || /[\x00-\x1f]/.test(sessionId)) throw new Error('A nonempty host sessionId is required.');
  return sessionId;
}
export function projectIdentity(project) {
  if (typeof project !== 'string' || !path.isAbsolute(project)) throw new Error('An absolute hostProject is required.');
  const resolved = path.resolve(project);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
export function taskFiles(project, sessionId) {
  let folder = path.join(path.resolve(project), '.scar');
  if (sessionId !== undefined) folder = path.join(folder, 'sessions', digest(validateSession(sessionId)));
  return { folder, contract: path.join(folder, 'contract.json'), report: path.join(folder, 'report.json'), review: path.join(folder, 'review.json'), context: path.join(folder, 'context.json'), lock: path.join(folder, 'verify.lock') };
}
export function bindingFile(home, hostProject, sessionId) {
  return path.join(home, 'bindings', digest({ project: projectIdentity(hostProject), session: validateSession(sessionId) }) + '.json');
}
export function validateBinding(binding, hostProject, sessionId) {
  if (binding?.schema !== 1 || binding.sessionId !== sessionId || binding.hostProject !== projectIdentity(hostProject) || !Array.isArray(binding.projects) || !binding.projects.length || binding.projects.length > maxSessionProjects) throw new Error('Invalid session verification binding.');
  const seen = new Set();
  for (const entry of binding.projects) {
    const identity = projectIdentity(entry.project);
    if (typeof entry.runId !== 'string' || !entry.runId || seen.has(identity)) throw new Error('Invalid bound project generation.');
    seen.add(identity);
  }
  return binding;
}
