import path from 'node:path';
import { taskFiles } from './task-scope.mjs';
import { snapshot, builtins } from './workspace-state.mjs';
import { readJson, digest, projectGateFile } from './io.mjs';
import { validateCheck } from './process.mjs';
import { validateTaskScope, documentationViolation, scopeSeal } from './documentation-scope.mjs';
import { projectChecks } from './project-checks.mjs';

export async function workspaceContext(project, catalogReader, options = {}) {
  const state = await snapshot(project, options);
  const catalog = await catalogReader.read(options);
  const extensions = new Set(state.files.map(f => path.extname(f.path).toLowerCase()));
  const classes = [...builtins, ...catalog.records].filter(c => c.extensions.some(e => extensions.has(e)));
  return { state, catalog, classes, catalogDigest: digest({ version: 4, builtins, revision: catalog.revision }) };
}

export async function evidenceBinding(project, catalog, options = {}) {
  const contract = await readJson(taskFiles(project, options.sessionId).contract, null, options);
  validateTaskScope(contract?.scope, contract || {});
  const context = await workspaceContext(project, catalog, { ...options, excludeRoots: contract?.excludeRoots, scopeProtection: Boolean(contract?.scope) });
  const gate = catalog.home ? await readJson(projectGateFile(catalog.home, context.state.root, options.sessionId), null, options) : null;
  if (contract?.scope || gate?.scopeSeal) {
    if (!contract?.scope || gate?.runId !== contract.runId || gate?.scopeSeal !== scopeSeal(contract)) throw new Error('Documentation scope or baseline differs from the armed task.');
  }
  if (contract && (contract.schema !== 1 || !Array.isArray(contract.checks) || typeof contract.task !== 'string')) throw new Error('Invalid verification contract.');
  contract?.checks.forEach(validateCheck);
  if (contract?.projectChecksRequired !== undefined && contract.projectChecksRequired !== true) throw new Error('Invalid required project checks marker.');
  const { policy, checks } = await projectChecks(context.state.root, contract?.checks || [], { ...options, required: contract?.projectChecksRequired });
  return { ...context, contract, checks, projectPolicy: policy, scopeViolation: documentationViolation(context.state, contract || {}), binding: digest({ source: context.state.fingerprint, contract, catalog: context.catalogDigest, ...(policy ? { projectChecks: policy } : {}) }) };
}

export async function freshStatus(project, catalog, options = {}) {
  const folder = taskFiles(project, options.sessionId).folder;
  const report = await readJson(path.join(folder, 'report.json'), null, options);
  if (!report) return { status: 'INCOMPLETE', reason: 'Verification has not run.' };
  const { binding, scopeViolation } = await evidenceBinding(project, catalog, options);
  if (scopeViolation) return { ...report, status: 'FAIL', errors: [...(report.errors || []), scopeViolation] };
  const review = await readJson(path.join(folder, 'review.json'), null, options);
  if (report.binding !== binding) return { status: 'STALE', reason: 'Source, contract or catalog changed.' };
  if (report.status !== 'VERIFIED') return report;
  if (review?.binding !== binding) return { ...report, status: 'INCOMPLETE', reason: 'A learning review is required for this source, contract and catalog.' };
  return { ...report, status: 'READY', review: review.reason };
}
