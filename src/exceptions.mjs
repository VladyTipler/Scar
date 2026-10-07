import path from 'node:path';

const configFile = '.scar/exceptions.json';
const fields = ['id', 'file', 'line', 'sourceHash', 'reason'];
const exactFields = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));

// Only the documented optional-fallback policy for SCAR-001 can be approved.
// An exact raw-file hash revokes approval on any edit, including a new catch.
export function applyExceptions(state, findings) {
  const errors = [], acceptedExceptions = [];
  if (!state.entries.some(([file]) => file === configFile)) return { findings, errors, acceptedExceptions };
  const fail = message => errors.push({ file: configFile, message: `Invalid project exception: ${message}` });
  let config;
  try { config = JSON.parse(state.files.find(file => file.path === configFile)?.text); }
  catch (error) { fail(`Malformed JSON: ${error.message}`); return { findings, errors, acceptedExceptions }; }
  if (!exactFields(config, ['schema', 'entries']) || config.schema !== 1 || !Array.isArray(config.entries)) {
    fail('Expected schema 1 with an entries array and no other fields.');
    return { findings, errors, acceptedExceptions };
  }
  const seen = new Set(), hashes = new Map(state.entries), approved = new Set();
  for (const entry of config.entries) {
    if (!exactFields(entry, fields) || entry.id !== 'SCAR-001' || typeof entry.file !== 'string' ||
        !entry.file || entry.file.includes('\\') || path.posix.isAbsolute(entry.file) || path.win32.isAbsolute(entry.file) ||
        entry.file.split('/').some(part => !part || part === '.' || part === '..') ||
        !Number.isInteger(entry.line) || entry.line < 1 || !/^[a-f0-9]{64}$/.test(entry.sourceHash) ||
        typeof entry.reason !== 'string' || entry.reason.trim().length < 40) {
      fail('Entry requires SCAR-001, a safe relative file, positive line, SHA-256 sourceHash and a substantive reason.');
      continue;
    }
    const key = JSON.stringify([entry.id, entry.file, entry.line]);
    if (seen.has(key)) { fail(`Duplicate entry for ${entry.file}:${entry.line}.`); continue; }
    seen.add(key);
    if (!findings.some(f => f.id === entry.id && f.file === entry.file && f.line === entry.line)) {
      fail(`Unused or stale exception for ${entry.file}:${entry.line}.`); continue;
    }
    if (hashes.get(entry.file) !== entry.sourceHash) { fail(`Stale source hash for ${entry.file}:${entry.line}.`); continue; }
    approved.add(key);
    acceptedExceptions.push(entry);
  }
  // Malformed metadata never grants a partial approval.
  if (errors.length) return { findings, errors, acceptedExceptions: [] };
  return { findings: findings.filter(f => !approved.has(JSON.stringify([f.id, f.file, f.line]))), errors, acceptedExceptions };
}
