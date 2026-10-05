import path from 'node:path';
import { tmpdir } from 'node:os';
import { readJson, atomicJson, withLock, digest } from './io.mjs';
import { runCheck } from './process.mjs';

const detectorRunner = `process.stdin.setEncoding('utf8'); let input=''; for await(const chunk of process.stdin) input+=chunk; const {detector,files}=JSON.parse(input); const module=await import('data:text/javascript;base64,'+Buffer.from(detector).toString('base64')); const result=await module.default({files}); process.stdout.write(JSON.stringify(result));`;
function validateFiles(files) {
  if (!Array.isArray(files) || files.length === 0 || files.some(f => !f || typeof f.path !== 'string' || !f.path || path.isAbsolute(f.path) || f.path.split(/[\\/]/).includes('..') || typeof f.text !== 'string')) throw new Error('Fixtures require safe relative paths and text.');
}
export function validateRecord(record) {
  if (!record || !/^[A-Z][A-Z0-9_-]{2,63}$/.test(record.id) || record.id.startsWith('SCAR-')) throw new Error('Invalid personal class ID; SCAR- is reserved.');
  for (const field of ['title', 'explanation', 'prevention', 'detector', 'evidence']) {
    if (typeof record[field] !== 'string' || !record[field].trim()) throw new Error(`Class requires ${field}.`);
  }
  if (!Array.isArray(record.extensions) || record.extensions.length === 0 || record.extensions.some(e => !/^\.[a-z0-9]+$/.test(e))) throw new Error('Class requires explicit file extensions.');
  for (const field of ['tags', 'paths']) if (record[field] !== undefined && (!Array.isArray(record[field]) || record[field].some(v => typeof v !== 'string'))) throw new Error(`Class ${field} requires string entries.`);
  if (!record.fixtures) throw new Error('Class requires bad/alternate/good fixtures.');
  for (const name of ['bad', 'alternate', 'good']) validateFiles(record.fixtures[name]);
  for (const name of ['bad', 'alternate', 'good']) {
    if (record.fixtures[name].some(file => !record.extensions.includes(path.extname(file.path).toLowerCase()))) throw new Error('Fixture lies outside the declared extension scope.');
  }
  if (digest(record.fixtures.bad) === digest(record.fixtures.alternate)) throw new Error('Alternate fixture must demonstrate another variant.');
}
export async function executeDetector(record, files) {
  const result = await runCheck({ id: record.id, command: '$NODE', args: ['--input-type=module', '-e', detectorRunner], timeoutMs: 10_000 }, tmpdir(), JSON.stringify({ detector: record.detector, files }));
  if (result.status !== 'PASS') throw new Error(`${record.id} detector ${result.status}: ${result.stderr}`);
  let findings;
  try { findings = JSON.parse(result.stdout); } catch { throw new Error(`${record.id} detector must return JSON findings only.`); }
  if (!Array.isArray(findings) || findings.some(f => !f || !files.some(file => file.path === f.file) || !Number.isInteger(f.line) || f.line < 1 || typeof f.message !== 'string' || !f.message)) throw new Error(`${record.id} detector returned invalid findings.`);
  return findings.map(f => ({ ...f, id: record.id }));
}
export class Catalog {
  constructor(home) { this.home = path.resolve(home); this.file = path.join(this.home, 'catalog.json'); }
  async read() {
    const established = await readJson(path.join(this.home, 'established.json'), null);
    const data = await readJson(this.file, null);
    if (!data) {
      if (established) throw new Error('Established catalog is missing; restore it instead of silently starting an empty catalog.');
      return { schema: 1, records: [], revision: digest({ schema: 1, records: [] }) };
    }
    if (data.schema !== 1 || !Array.isArray(data.records)) throw new Error('Unsupported or corrupt Scar catalog.');
    data.records.forEach(validateRecord);
    if (new Set(data.records.map(r => r.id)).size !== data.records.length) throw new Error('Duplicate catalog class IDs.');
    return { ...data, revision: digest(data) };
  }
  async learn(record, expectedRevision, options = {}) {
    validateRecord(record);
    const proof = {};
    for (const name of ['bad', 'alternate', 'good']) {
      const findings = await executeDetector(record, record.fixtures[name]);
      if ((name === 'good') !== (findings.length === 0)) throw new Error(`Class fixture ${name} failed its expected result.`);
      proof[name] = { findings: findings.length, digest: digest(record.fixtures[name]) };
    }
    return await withLock(path.join(this.home, 'catalog.lock'), async () => {
      const before = await this.read();
      if (before.revision !== expectedRevision) throw new Error('Catalog revision changed; reread before learning.');
      const exists = before.records.some(r => r.id === record.id);
      if (exists && !options.replace) throw new Error('Class already exists; keep its stable ID and review a replacement explicitly.');
      if (!exists && options.replace) throw new Error('Cannot replace a missing class.');
      const prior = before.records.find(r => r.id === record.id);
      if (prior?.extensions.some(extension => !record.extensions.includes(extension))) throw new Error('Replacement cannot narrow prior extension scope.');
      const history = prior ? [...(prior.history || []), { generation: prior.generation || 1, fixtures: prior.fixtures }] : [];
      for (const generation of history) {
        for (const name of ['bad', 'alternate', 'good']) {
          const findings = await executeDetector(record, generation.fixtures[name]);
          if ((name === 'good') !== (findings.length === 0)) throw new Error(`Prior generation ${generation.generation} regression: ${name} no longer passes its expected result.`);
        }
      }
      const updated = { ...record, proof, generation: (prior?.generation || 0) + 1, ...(history.length ? { history } : {}) };
      const records = exists ? before.records.map(r => r.id === record.id ? updated : r) : [...before.records, updated];
      const after = { schema: 1, records };
      await atomicJson(this.file, after);
      await atomicJson(path.join(this.home, 'established.json'), { schema: 1 });
      const persisted = await this.read();
      if (persisted.revision !== digest(after)) throw new Error('Catalog read-back mismatch.');
      return persisted;
    });
  }
}
