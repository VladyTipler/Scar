import { digest } from './io.mjs';

export function validateTaskScope(scope, options = {}) {
  if (scope === undefined) return;
  if (!scope || scope.kind !== 'documentation' || Object.keys(scope).some(k => !['kind', 'paths'].includes(k)) || !Array.isArray(scope.paths) || scope.paths.length === 0 || scope.paths.length > 32) throw new Error('Invalid documentation scope: explicit paths are required.');
  const paths = new Set();
  for (const value of scope.paths) {
    if (typeof value !== 'string' || value.length > 240 || value.includes('\\') || value.includes('\0') || value.includes(':') || value.split('/').some(p => !p || p === '.' || p === '..') || !/^(?:docs(?:\/[^/]+)*|(?:README|CHANGELOG|CONTRIBUTING)(?:\.[a-zA-Z_-]+)?\.md)$/.test(value)) throw new Error('Documentation scope paths must be safe docs paths or designated root Markdown files.');
    if (paths.has(value)) throw new Error('Duplicate documentation scope paths.');
    paths.add(value);
  }
  if (options.excludeRoots !== undefined) throw new Error('Documentation scope cannot exclude protected roots.');
}
export function allowedDocument(file, scope) {
  return file.endsWith('.md') && scope.paths.some(p => file === p || file.startsWith(p + '/'));
}
export const documentationBaseline = (state, scope) => digest(state.entries.filter(([file]) => !allowedDocument(file, scope)));
export const scopeSeal = contract => digest({ scope: contract.scope, documentationBaseline: contract.documentationBaseline });
export function documentationViolation(state, contract) {
  if (!contract.scope) return null;
  validateTaskScope(contract.scope, contract);
  return documentationBaseline(state, contract.scope) === contract.documentationBaseline ? null : { id: 'SCAR-DOCS-BOUNDARY', message: 'Files outside the authorized Markdown documentation scope changed since preparation.' };
}
