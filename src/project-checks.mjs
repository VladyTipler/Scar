import path from 'node:path';
import { readJson, digest } from './io.mjs';
import { validateCheck } from './process.mjs';

const checkFields = new Set(['id', 'command', 'args', 'timeoutMs']);
const definition = check => ({ command: check.command, args: check.args, timeoutMs: check.timeoutMs ?? 120_000 });

export async function projectChecks(project, taskChecks, options = {}) {
  const missing = Symbol('missing project checks');
  const value = await readJson(path.join(project, '.scar', 'project-checks.json'), missing, { ...options, maxBytes: Math.min(options.maxBytes ?? 65_536, 65_536) });
  const policy = value === missing ? null : value;
  if (options.required && value === missing) throw new Error('Required project checks policy is missing.');
  if (value !== missing) {
    if (!policy || policy.schema !== 1 || Object.keys(policy).some(key => !['schema', 'checks'].includes(key)) || !Array.isArray(policy.checks) || !policy.checks.length || policy.checks.length > 64) throw new Error('Invalid project checks policy: schema 1 and 1..64 checks are required.');
    const ids = new Set();
    for (const check of policy.checks) {
      validateCheck(check);
      if (typeof check.id !== 'string' || Object.keys(check).some(key => !checkFields.has(key))) throw new Error('Invalid project check fields: a string ID is required.');
      if (ids.has(check.id)) throw new Error('Duplicate project check IDs.');
      ids.add(check.id);
    }
  }
  const checks = [...(policy?.checks || [])];
  const byId = new Map(checks.map(check => [check.id, check]));
  for (const check of taskChecks) {
    const mandatory = byId.get(check.id);
    if (mandatory && digest(definition(mandatory)) !== digest(definition(check))) throw new Error('Task check conflicts with mandatory project check: ' + check.id);
    if (!mandatory) checks.push(check);
  }
  return { policy, checks };
}
