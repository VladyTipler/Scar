import path from 'node:path';
import { executeDetector } from './catalog.mjs';
import { PersonalCatalog } from './sharing.mjs';
import { snapshot, scan, builtins } from './workspace.mjs';
import { atomicJson, readJson, digest, catalogHome, withLock } from './io.mjs';
import { runCheck, validateCheck } from './process.mjs';
import { discoverChecks } from './discovery.mjs';
import { preventionContext } from './presentation.mjs';

export class Workflow {
  constructor(home = catalogHome()) { this.catalog = new PersonalCatalog(home); }
  files(project) { const folder = path.join(path.resolve(project), '.scar'); return { contract: path.join(folder, 'contract.json'), report: path.join(folder, 'report.json'), review: path.join(folder, 'review.json'), lock: path.join(folder, 'verify.lock') }; }
  async context(project) {
    const state = await snapshot(project);
    const catalog = await this.catalog.read();
    const extensions = new Set(state.files.map(f => path.extname(f.path).toLowerCase()));
    const classes = [...builtins, ...catalog.records].filter(c => c.extensions.some(e => extensions.has(e)));
    return { state, catalog, classes, catalogDigest: digest({ version: 1, builtins, revision: catalog.revision }) };
  }
  async prepare(project, options) {
    const context = await this.context(project);
    if (options) {
      const checks = options.checks ?? await discoverChecks(project);
      if (!options.task?.trim() || !Array.isArray(checks)) throw new Error('Task and checks are required.');
      checks.forEach(validateCheck);
      if (new Set(checks.map(c => c.id)).size !== checks.length) throw new Error('Duplicate check IDs.');
      if (options.focusPaths && (!Array.isArray(options.focusPaths) || options.focusPaths.some(p => typeof p !== 'string' || path.isAbsolute(p) || p.split(/[\\/]/).includes('..')))) throw new Error('focusPaths require safe relative paths.');
      await atomicJson(this.files(project).contract, { schema: 1, task: options.task, checks, ...(options.focusPaths ? { focusPaths: options.focusPaths } : {}) });
    }
    const contract = options || await readJson(this.files(project).contract, {});
    return { status: 'PREPARED', project: context.state.root, catalogRevision: context.catalog.revision, ...preventionContext(context.classes, contract.task, contract.focusPaths), errorCount: context.state.errors.length, errors: context.state.errors.slice(0, 4).map(e => ({ ...e, message: e.message.slice(0, 300) })) };
  }
  async binding(project) {
    const context = await this.context(project);
    const contract = await readJson(this.files(project).contract, null);
    if (contract && (contract.schema !== 1 || !Array.isArray(contract.checks) || typeof contract.task !== 'string')) throw new Error('Invalid verification contract.');
    contract?.checks.forEach(validateCheck);
    return { ...context, contract, binding: digest({ source: context.state.fingerprint, contract, catalog: context.catalogDigest }) };
  }
  async verify(project) {
    return await withLock(this.files(project).lock, async () => {
      const before = await this.binding(project);
      const native = await scan(project, before.state);
      const findings = [...native.findings], errors = [...native.errors], checks = [];
      for (const record of before.classes.filter(c => c.detector)) {
        try { findings.push(...await executeDetector(record, before.state.files.filter(f => record.extensions.includes(path.extname(f.path).toLowerCase())))); }
        catch (error) { errors.push({ id: record.id, message: error.message }); }
      }
      for (const check of before.contract?.checks || []) checks.push(await runCheck(check, before.state.root));
      const after = await this.binding(project);
      let status = 'VERIFIED';
      if (!before.contract || checks.length === 0) status = 'INCOMPLETE';
      if (findings.length || errors.length || checks.some(c => c.status !== 'PASS')) status = 'FAIL';
      if (before.binding !== after.binding) status = 'STALE';
      const report = { schema: 1, status, binding: before.binding, findings, errors, checks, classes: before.classes.map(c => c.id), coverage: 'Declared detector shapes and configured project checks only.' };
      await atomicJson(this.files(project).report, report);
      return report;
    });
  }
  async review(project, reason) {
    if (typeof reason !== 'string' || reason.trim().length < 12) throw new Error('Learning review requires a concrete explanation. Learn discovered classes before reviewing.');
    const { binding } = await this.binding(project);
    await atomicJson(this.files(project).review, { binding, reason });
    return { status: 'REVIEWED', binding };
  }
  async status(project) {
    const { binding } = await this.binding(project);
    const files = this.files(project);
    const report = await readJson(files.report, null);
    const review = await readJson(files.review, null);
    if (!report) return { status: 'INCOMPLETE', reason: 'Verification has not run.' };
    if (report.binding !== binding) return { status: 'STALE', reason: 'Source, contract or catalog changed.' };
    if (report.status !== 'VERIFIED') return report;
    if (review?.binding !== binding) return { ...report, status: 'INCOMPLETE', reason: 'A learning review is required for this source, contract and catalog.' };
    return { ...report, status: 'READY', review: review.reason };
  }
  async finish(project) { await this.verify(project); return await this.status(project); }
}
