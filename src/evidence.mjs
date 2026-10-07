import path from 'node:path';
import { snapshot, builtins } from './workspace-state.mjs';
import { readJson, digest } from './io.mjs';
import { validateCheck } from './process.mjs';
import {taskFiles} from './task-scope.mjs';

export async function workspaceContext(project, catalogReader, options = {}) {
  const state = await snapshot(project, options);
  const catalog = await catalogReader.read(options);
  const extensions = new Set(state.files.map(f => path.extname(f.path).toLowerCase()));
  const classes = [...builtins, ...catalog.records].filter(c => c.extensions.some(e => extensions.has(e)));
  // Native analysis/coverage policy is part of freshness, not just learned rules.
  return { state, catalog, classes, catalogDigest: digest({ version: 3, builtins, revision: catalog.revision }) };
}

export async function evidenceBinding(project, catalog, options = {}) {
  const context = await workspaceContext(project, catalog, options);
  const contract = await readJson(taskFiles(project,options.sessionId).contract, null, options);
  if (contract && (contract.schema !== 1 || !Array.isArray(contract.checks) || typeof contract.task !== 'string')) throw new Error('Invalid verification contract.');
  contract?.checks.forEach(validateCheck);
  return { ...context, contract, binding: digest({ source: context.state.fingerprint, contract, catalog: context.catalogDigest }) };
}

export async function freshStatus(project, catalog, options = {}) {
  const folder = taskFiles(project,options.sessionId).folder;
  const report = await readJson(path.join(folder, 'report.json'), null, options);
  if (!report) return { status: 'INCOMPLETE', reason: 'Verification has not run.' };
  const { binding } = await evidenceBinding(project, catalog, options);
  const review = await readJson(path.join(folder, 'review.json'), null, options);
  if (report.binding !== binding) return { status: 'STALE', reason: 'Source, contract or catalog changed.' };
  if (report.status !== 'VERIFIED') return report;
  if (review?.binding !== binding) return { ...report, status: 'INCOMPLETE', reason: 'A learning review is required for this source, contract and catalog.' };
  return { ...report, status: 'READY', review: review.reason };
}
