import path from 'node:path';
import ts from 'typescript';
import { parse as parseVue } from '@vue/compiler-sfc';
import { parse as parseJavaScript } from '@babel/parser';
import { digest } from './io.mjs';
import { applyExceptions } from './exceptions.mjs';

import { snapshot, builtins } from './workspace-state.mjs';
export { snapshot, fingerprint, builtins } from './workspace-state.mjs';
const sourceExtensions = new Set(builtins[0].extensions);

function scanScript(file, text, offset, findings, errors, scriptKind) {
  const kind = scriptKind ?? (file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.jsx') ? ts.ScriptKind.JSX : /\.(js|mjs|cjs)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  for (const diagnostic of tree.parseDiagnostics) errors.push({ file, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n') });
  if (kind === ts.ScriptKind.JS || kind === ts.ScriptKind.JSX) {
    // TypeScript's JS mode accepts TS-only grammar; validate JS with its own parser.
    try { parseJavaScript(text, { sourceType: file.endsWith('.mjs') || file.endsWith('.vue') ? 'module' : file.endsWith('.cjs') ? 'commonjs' : 'unambiguous', plugins: kind === ts.ScriptKind.JSX ? ['jsx'] : [], attachComment: false }); }
    catch (error) { errors.push({ file, message: error.message }); }
  }
  const asyncFunction = node => (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword);
  const emit = (id, node) => findings.push({ id, file, line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1 + offset, message: builtins.find(b => b.id === id).title });
  function visit(node) {
    if (ts.isCatchClause(node) && node.block.statements.length === 0) emit('SCAR-001', node);
    if (ts.isCallExpression(node)) {
      const target = node.expression;
      const forEach = ts.isPropertyAccessExpression(target) && target.name.text === 'forEach' || ts.isElementAccessExpression(target) && ts.isStringLiteral(target.argumentExpression) && target.argumentExpression.text === 'forEach';
      if (forEach && node.arguments[0] && asyncFunction(node.arguments[0])) emit('SCAR-002', node);
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Promise' && node.arguments?.[0] && asyncFunction(node.arguments[0])) emit('SCAR-003', node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
}
const analysisCache = new Map();
export async function scan(project, existingSnapshot) {
  const state = existingSnapshot || await snapshot(project);
  const findings = [];
  const errors = [...state.errors];
  for (const file of state.files) {
    if (!sourceExtensions.has(path.extname(file.path).toLowerCase())) continue;
    // Content is freshly hashed; only parser results are reused, never freshness evidence.
    const key = digest({ version: 1, path: file.path, text: file.text });
    const cached = analysisCache.get(key);
    if (cached) { findings.push(...cached.findings); errors.push(...cached.errors); continue; }
    const localFindings = [], localErrors = [];
    if (!file.path.endsWith('.vue')) scanScript(file.path, file.text, 0, localFindings, localErrors);
    else {
      const parsed = parseVue(file.text, { filename: file.path });
      for (const error of parsed.errors) localErrors.push({ file: file.path, message: String(error.message || error) });
      for (const block of [parsed.descriptor.script, parsed.descriptor.scriptSetup].filter(Boolean)) {
        if (block.src) localErrors.push({ file: file.path, message: 'External Vue script requires a project integration check.' });
        const kind = block.lang === 'tsx' ? ts.ScriptKind.TSX : block.lang === 'ts' ? ts.ScriptKind.TS : block.lang === 'jsx' ? ts.ScriptKind.JSX : ts.ScriptKind.JS;
        scanScript(file.path, block.content, block.loc.start.line - 1, localFindings, localErrors, kind);
      }
    }
    if (analysisCache.size >= 256) analysisCache.delete(analysisCache.keys().next().value);
    analysisCache.set(key, { findings: localFindings, errors: localErrors });
    findings.push(...localFindings); errors.push(...localErrors);
  }
  const approved = applyExceptions(state, findings);
  return { findings: approved.findings, errors: [...errors, ...approved.errors], acceptedExceptions: approved.acceptedExceptions, snapshot: state };
}
