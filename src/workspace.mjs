import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { parse as parseVue } from '@vue/compiler-sfc';
import { parse as parseJavaScript } from '@babel/parser';
import { digest } from './io.mjs';

const excludedEverywhere = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.cache']);
const excludedRoot = new Set(['dist', 'build', 'coverage', '.next', '.nuxt', '.output', 'target']);
const evidenceFiles = new Set(['contract.json', 'report.json', 'review.json']);
export const builtins = [
  { id: 'SCAR-001', title: 'Empty catch swallows failures', extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue'], prevention: 'Handle or propagate the error; intentional suppression needs a documented project exception.' },
  { id: 'SCAR-002', title: 'Async forEach does not await callbacks', extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue'], prevention: 'Use for...of with await, or await Promise.all(items.map(...)).' },
  { id: 'SCAR-003', title: 'Async Promise executor loses rejected promises', extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue'], prevention: 'Use a direct async function or a synchronous Promise executor.' }
];
const sourceExtensions = new Set(builtins[0].extensions);

export async function snapshot(project) {
  const root = await realpath(path.resolve(project));
  const files = [];
  const entries = [];
  const errors = [];
  async function walk(directory, relative = '') {
    const children = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      const name = path.posix.join(relative, child.name);
      const absolute = path.join(directory, child.name);
      if (child.isDirectory() && (excludedEverywhere.has(child.name) || !relative && excludedRoot.has(child.name))) continue;
      if (relative === '.scar' && (evidenceFiles.has(child.name) || child.name.endsWith('.tmp') || child.name.endsWith('.lock'))) continue;
      if (child.isSymbolicLink()) { errors.push({ file: name, message: 'Symlink is outside verified file coverage; replace it or explicitly narrow the project root.' }); entries.push([name, 'symlink']); continue; }
      if (child.isDirectory()) { await walk(absolute, name); continue; }
      if (!child.isFile()) continue;
      const bytes = await readFile(absolute);
      entries.push([name, digest(bytes)]);
      if (bytes.length > 10 * 1024 * 1024) {
        errors.push({ file: name, message: 'File exceeds 10 MiB inspection limit; narrow the verification root.' });
        continue;
      }
      let text;
      if (bytes[0] === 0xff && bytes[1] === 0xfe) text = bytes.subarray(2).toString('utf16le');
      else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        const swapped = Buffer.from(bytes.subarray(2));
        if (swapped.length % 2) { errors.push({ file: name, message: 'Malformed UTF-16 source.' }); continue; }
        text = swapped.swap16().toString('utf16le');
      } else if (!bytes.includes(0)) text = bytes.toString('utf8');
      if (text !== undefined) files.push({ path: name, text });
      else if (sourceExtensions.has(path.extname(name).toLowerCase())) errors.push({ file: name, message: 'Unsupported source encoding; convert to UTF-8 or UTF-16 with BOM.' });
    }
  }
  await walk(root);
  return { root, files, entries, errors, fingerprint: digest(entries) };
}
export async function fingerprint(project) { return (await snapshot(project)).fingerprint; }

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
export async function scan(project, existingSnapshot) {
  const state = existingSnapshot || await snapshot(project);
  const findings = [];
  const errors = [...state.errors];
  for (const file of state.files) {
    if (!sourceExtensions.has(path.extname(file.path).toLowerCase())) continue;
    if (!file.path.endsWith('.vue')) { scanScript(file.path, file.text, 0, findings, errors); continue; }
    const parsed = parseVue(file.text, { filename: file.path });
    for (const error of parsed.errors) errors.push({ file: file.path, message: String(error.message || error) });
    for (const block of [parsed.descriptor.script, parsed.descriptor.scriptSetup].filter(Boolean)) {
      if (block.src) errors.push({ file: file.path, message: 'External Vue script requires a project integration check.' });
      const kind = block.lang === 'tsx' ? ts.ScriptKind.TSX : block.lang === 'ts' ? ts.ScriptKind.TS : block.lang === 'jsx' ? ts.ScriptKind.JSX : ts.ScriptKind.JS;
      scanScript(file.path, block.content, block.loc.start.line - 1, findings, errors, kind);
    }
  }
  return { findings, errors, snapshot: state };
}
