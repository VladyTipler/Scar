import { mkdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { homedir } from 'node:os';
import { abortable } from './abort.mjs';

export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const catalogHome = () => path.resolve(process.env.SCAR_HOME || path.join(homedir(), '.scar'));
export async function readJson(file, fallback, { signal, maxBytes } = {}) {
  try {
    if (maxBytes && (await abortable(() => stat(file), signal)).size > maxBytes) throw new Error('Scar state exceeds its read budget.');
    return JSON.parse(await abortable(() => readFile(file, { encoding: 'utf8', signal }), signal));
  }
  catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error; }
}
export async function atomicJson(file, value, { signal } = {}) {
  await abortable(() => mkdir(path.dirname(file), { recursive: true }), signal);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    signal?.throwIfAborted();
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600, signal });
    signal?.throwIfAborted();
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

export const projectGateFile = (home, project) => {
  const resolved = path.resolve(project);
  const identity = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  return path.join(home, 'projects', `${digest(identity)}.json`);
};

export async function withLock(file, operation, { signal } = {}) {
  await abortable(() => mkdir(path.dirname(file), { recursive: true }), signal);
  signal?.throwIfAborted();
  try { await writeFile(file, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600, signal }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error(`Scar writer lock exists: ${file}. Check its owner before removing it.`); throw error; }
  try { signal?.throwIfAborted(); return await operation(); }
  finally { await rm(file, { force: true }); }
}
