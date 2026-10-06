import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { digest } from './io.mjs';
import { abortable } from './abort.mjs';

const excludedEverywhere = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.cache']);
const excludedRoot = new Set(['dist', 'build', 'coverage', '.next', '.nuxt', '.output', 'target', '.worktrees', '.claude']);
const archiveExtensions = new Set(['.dump', '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar']);
const evidenceFiles = new Set(['contract.json', 'report.json', 'review.json', 'context.json']);
export const builtins = [
  { id: 'SCAR-001', title: 'Empty catch swallows failures', extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue'], prevention: 'Handle or propagate the error; intentional suppression needs a documented project exception.' },
  { id: 'SCAR-002', title: 'Async forEach does not await callbacks', extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue'], prevention: 'Use for...of with await, or await Promise.all(items.map(...)).' },
  { id: 'SCAR-003', title: 'Async Promise executor loses rejected promises', extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue'], prevention: 'Use a direct async function or a synchronous Promise executor.' }
];
const sourceExtensions = new Set(builtins[0].extensions);

export async function snapshot(project, { signal, fs = {} } = {}) {
  const io = { readdir, readFile, realpath, stat, ...fs };
  const root = await abortable(() => io.realpath(path.resolve(project)), signal);
  const files = [];
  const entries = [];
  const errors = [];
  async function walk(directory, relative = '') {
    const children = (await abortable(() => io.readdir(directory, { withFileTypes: true }), signal)).sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      signal?.throwIfAborted();
      const name = path.posix.join(relative, child.name);
      const absolute = path.join(directory, child.name);
      if (child.isDirectory() && (excludedEverywhere.has(child.name) || !relative && excludedRoot.has(child.name))) continue;
      if (relative === '.scar' && (evidenceFiles.has(child.name) || child.name.endsWith('.tmp') || child.name.endsWith('.lock'))) continue;
      if (child.isSymbolicLink()) { errors.push({ file: name, message: 'Symlink is outside verified file coverage; replace it or explicitly narrow the project root.' }); entries.push([name, 'symlink']); continue; }
      if (child.isDirectory()) { await walk(absolute, name); continue; }
      if (!child.isFile()) continue;
      if (archiveExtensions.has(path.extname(name).toLowerCase())) continue;
      const info = await abortable(() => io.stat(absolute), signal);
      if (info.size > 10 * 1024 * 1024) {
        entries.push([name, `oversize:${info.size}`]);
        errors.push({ file: name, message: 'File exceeds 10 MiB inspection limit; narrow the verification root.' });
        continue;
      }
      const bytes = await abortable(() => io.readFile(absolute, { signal }), signal);
      entries.push([name, digest(bytes)]);
      if (bytes.length > 10 * 1024 * 1024) {
        errors.push({ file: name, message: 'File grew beyond 10 MiB inspection limit during reading.' });
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
