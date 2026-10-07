import { readJson } from './io.mjs';

const clip = (value, max) => typeof value === 'string' ? (value.length > max ? `${value.slice(0, max - 1)}…` : value) : '';
const hint = c => ({ id: clip(c.id, 64), title: clip(c.title, 120), prevention: clip(c.prevention, 400) });
const words = value => new Set(String(value || '').toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []);
export function preventionContext(classes, task = '', focusPaths = [], options = {}) {
  const { limit, offset } = page(options);
  const tokens = words(task);
  const score = c => {
    const terms = words(`${c.title} ${(c.tags || []).join(' ')}`);
    let result = [...terms].filter(term => tokens.has(term)).length;
    for (const prefix of c.paths || []) if (focusPaths.some(file => file.startsWith(prefix))) result += 10;
    return result;
  };
  const ranked = classes.map((c, index) => ({ c, index, score: score(c) })).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = [];
  for (const { c } of ranked.slice(offset, offset + limit)) {
    const entry = hint(c);
    if (JSON.stringify([...selected, entry]).length > 5200) break;
    selected.push(entry);
  }
  return { applicableCount: classes.length, omittedCount: classes.length - selected.length, offset, nextOffset: offset + selected.length < classes.length ? offset + selected.length : null, classes: selected };
}
function page(options) {
  const limit = options.limit ?? 8, offset = options.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('limit must be between 1 and 20.');
  if (!Number.isInteger(offset) || offset < 0) throw new Error('offset must be a non-negative integer.');
  return { limit, offset };
}
export async function publicCatalog(catalog, options = {}) {
  const { limit, offset } = page(options);
  const data = await catalog.read();
  if (options.id) {
    const record = data.records.find(c => c.id === options.id);
    if (!record) throw new Error('Catalog class not found.');
    return { revision: data.revision, record: { ...hint(record), explanation: clip(record.explanation, 2000), evidence: clip(record.evidence, 1000), extensions: record.extensions.slice(0, 30), generation: record.generation, proof: record.proof } };
  }
  const query = String(options.query || '').toLowerCase();
  const records = data.records.filter(c => !query || `${c.id} ${c.title} ${(c.tags || []).join(' ')}`.toLowerCase().includes(query));
  return { revision: data.revision, total: data.records.length, matchedCount: records.length, offset, nextOffset: offset + limit < records.length ? offset + limit : null, classes: records.slice(offset, offset + limit).map(hint) };
}
export function publicationResult(catalog, id) {
  const record = catalog.records.find(c => c.id === id);
  return { id, revision: catalog.revision, generation: record?.generation, proof: record?.proof };
}
export function compactReport(report) {
  const result = {
    status: report.status, binding: report.binding, reason: clip(report.reason, 500),
    findingCount: report.findings?.length || 0, errorCount: report.errors?.length || 0,
    acceptedExceptionCount: report.acceptedExceptions?.length || 0,
    checkCount: report.checks?.length || 0, classCount: report.classes?.length || 0,
    findings: (report.findings || []).slice(0, 8).map(f => ({ id: clip(f.id, 64), file: clip(f.file, 200), line: f.line, message: clip(f.message, 300) })),
    errors: (report.errors || []).slice(0, 4).map(e => ({ id: clip(e.id, 64), file: clip(e.file, 200), message: clip(e.message, 300) })),
    checks: (report.checks || []).slice(0, 8).map(c => ({ id: clip(c.id, 80), status: c.status, exitCode: c.exitCode, durationMs: c.durationMs })),
    evidence: `${report.evidence || '.scar/report.json'}; use scar_details for bounded evidence pages.`
  };
  while (JSON.stringify(result).length > 6000) {
    const field = ['findings', 'errors', 'checks'].sort((a, b) => JSON.stringify(result[b]).length - JSON.stringify(result[a]).length)[0];
    result[field].pop();
  }
  return result;
}
export async function classSource(catalog, options) {
  const offset = options.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) throw new Error('offset must be a non-negative integer.');
  if (!['detector', 'fixtures'].includes(options.source)) throw new Error('Invalid class source section.');
  const data = await catalog.read();
  const record = data.records.find(c => c.id === options.id);
  if (!record) throw new Error('Catalog class not found.');
  const body = options.source === 'detector' ? record.detector : JSON.stringify(record.fixtures);
  return { id: record.id, revision: data.revision, source: options.source, offset, text: body.slice(offset, offset + 4000), nextOffset: offset + 4000 < body.length ? offset + 4000 : null };
}
export async function reportDetails(flow, project, options = {}) {
  const { limit, offset } = page(options);
  const report = await readJson(flow.files(project).report, null);
  if (!report) throw new Error('Verification report not found.');
  const section = options.section || 'findings';
  if (!['findings', 'errors', 'checks', 'classes'].includes(section)) throw new Error('Invalid report section.');
  if (options.checkId) {
    const check = report.checks.find(c => c.id === options.checkId);
    if (!check) throw new Error('Check not found.');
    const stream = options.stream || 'stderr';
    if (!['stdout', 'stderr'].includes(stream)) throw new Error('Invalid log stream.');
    const log = check[stream] || '';
    return { status: report.status, binding: report.binding, id: check.id, stream, offset, text: log.slice(offset, offset + 4000), nextOffset: offset + 4000 < log.length ? offset + 4000 : null };
  }
  const entries = report[section] || [];
  const selected = entries.slice(offset, offset + limit).map(item => typeof item === 'string' ? clip(item, 64) : Object.fromEntries(Object.entries(item).filter(([key]) => !['stdout', 'stderr'].includes(key)).map(([key, value]) => [key, typeof value === 'string' ? clip(value, 300) : value])));
  return { status: report.status, binding: report.binding, section, total: entries.length, offset, nextOffset: offset + limit < entries.length ? offset + limit : null, entries: selected };
}
