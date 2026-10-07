import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { trustedSession, reviewerSession, sessionTaskFile, readSessionTask, requireOwner, cancellationStatus } from './task-state.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { taskFiles, bindingFile, validateBinding, validateSession, projectIdentity, maxSessionProjects } from './task-scope.mjs';
import { randomUUID } from 'node:crypto';
import { validateTaskScope, documentationBaseline, documentationViolation, scopeSeal } from './documentation-scope.mjs';
import { executeDetector } from './catalog.mjs';
import { PersonalCatalog } from './sharing.mjs';
import { scan } from './workspace.mjs';
import { atomicJson, readJson, catalogHome, withLock, projectGateFile, digest } from './io.mjs';
import { workspaceContext, evidenceBinding, freshStatus } from './evidence.mjs';
import { runCheck, validateCheck } from './process.mjs';
import { discoverChecks } from './discovery.mjs';
import { projectChecks } from './project-checks.mjs';
import { preventionContext } from './presentation.mjs';

export class Workflow {
  constructor(home = catalogHome(), host = {}) {
    this.home = home; this.catalog = new PersonalCatalog(home); this.host = host;
    this.strict = host.scoped === true;
    if (host.sessionId !== undefined) this.sessionId = validateSession(host.sessionId);
    if (host.hostProject !== undefined) { if (!this.sessionId) throw new Error('hostProject requires sessionId.'); this.hostProject = projectIdentity(host.hostProject); }
    else if (host.workspace) this.hostProject = projectIdentity(host.workspace);
  }
  files(project) {
    const files = taskFiles(project, this.sessionId);
    if (this.host.scoped && this.sessionId && !existsSync(files.contract)) {
      const legacy = taskFiles(project);
      if (existsSync(legacy.contract)) {
        const contract = JSON.parse(readFileSync(legacy.contract, 'utf8'));
        if (contract.ownerSessionId === this.sessionId) return legacy;
      }
    }
    return files;
  }
  evidenceSession(project) { return this.files(project).folder === taskFiles(project).folder ? undefined : this.sessionId; }
  gateFile(project) { return projectGateFile(this.home, project, this.evidenceSession(project)); }
  async context(project, options = {}) {
    return await workspaceContext(project, this.catalog, options);
  }
  async prepare(project, options) {
    const mode = options?.mode ?? (this.host.scoped ? 'analysis' : 'implementation');
    if (!['analysis', 'implementation'].includes(mode)) throw new Error('Mode must be analysis or implementation.');
    if (mode === 'analysis' && (options?.checks !== undefined || options?.excludeRoots !== undefined || options?.scope !== undefined)) throw new Error('Analysis never configures or executes checks or implementation exclusions.');
    validateTaskScope(options?.scope, options);
    if (options?.scope && (!Array.isArray(options.checks) || options.checks.length === 0)) throw new Error('Documentation tasks require explicit meaningful executable checks; autodiscovery is disabled.');
    let ownerSessionId;
    if (mode === 'implementation' && this.host.scoped) {
      ownerSessionId = trustedSession(this.host.sessionId);
      if (reviewerSession(ownerSessionId)) throw new Error('Reviewer subagents cannot create an implementation task.');
      if (this.host.workspace && await realpath(project) !== await realpath(this.host.workspace)) throw new Error('Implementation project differs from the verified host workspace.');
    }
    const context = await this.context(project, { excludeRoots: options?.excludeRoots, scopeProtection: Boolean(options?.scope) });
    if (mode === 'analysis') return { status: 'ANALYSIS', mode, project: context.state.root, ...preventionContext(context.classes, options?.task, options?.focusPaths), errorCount: context.state.errors.length, errors: context.state.errors.slice(0, 4) };
    let preparedRunId;
    if (options) {
      const checks = options.checks ?? await discoverChecks(project);
      if (!options.task?.trim() || !Array.isArray(checks)) throw new Error('Task and checks are required.');
      checks.forEach(validateCheck);
      if (new Set(checks.map(c => c.id)).size !== checks.length) throw new Error('Duplicate check IDs.');
      const { policy } = await projectChecks(context.state.root, checks);
      if (options.focusPaths && (!Array.isArray(options.focusPaths) || options.focusPaths.some(p => typeof p !== 'string' || path.isAbsolute(p) || p.split(/[\\/]/).includes('..')))) throw new Error('focusPaths require safe relative paths.');
      const runId = randomUUID();
      const documentation = options.scope ? { scope: options.scope, documentationBaseline: documentationBaseline(context.state, options.scope) } : {};
      const seal = options.scope ? { scopeSeal: scopeSeal(documentation) } : {};
      // Arm outside the workspace first: deleting .scar cannot bypass an active gate.
      const previousFiles = this.files(project);
      if (this.host.scoped && previousFiles.folder === taskFiles(project).folder) {
        const legacyGate = await readJson(projectGateFile(this.home, context.state.root), null);
        if (legacyGate?.active) throw new Error('Existing legacy owner task is active; finish or explicitly cancel it before a new scoped generation.');
      }
      const files = taskFiles(project, this.sessionId);
      const gateFile = projectGateFile(this.home, context.state.root, this.sessionId);
      const arm = async () => withLock(`${gateFile}.lock`, async () => {
        const gate = await readJson(gateFile, null);
        const prior = await readJson(files.contract, null);
        if (gate?.active && (ownerSessionId || prior?.ownerSessionId)) throw new Error('An active task already owns this project; finish or explicitly cancel it before preparing another.');
        // Persistent author bindings are distinct from trusted per-chat ownership.
        if (this.sessionId) {
          const hostProject = this.hostProject ?? projectIdentity(project);
          const file = bindingFile(this.home, hostProject, this.sessionId);
          const previousBinding = await readJson(file, null);
          if (previousBinding) validateBinding(previousBinding, hostProject, this.sessionId);
          const projects = (previousBinding?.projects || []).filter(e => projectIdentity(e.project) !== projectIdentity(context.state.root));
          if (projects.length >= maxSessionProjects) throw new Error('Session project limit reached.');
          projects.push({ project: context.state.root, runId });
          await atomicJson(file, { schema: 1, hostProject, sessionId: this.sessionId, projects });
        }
        if (ownerSessionId) {
          const previous = await readSessionTask(this.home, ownerSessionId);
          if (previous?.active) throw new Error('This session already has an active task; it cannot be replaced implicitly.');
          await atomicJson(sessionTaskFile(this.home, ownerSessionId), { schema: 2, active: true, ownerSessionId, project: context.state.root, runId, evidenceSessionId: this.sessionId ?? null, hostProject: this.hostProject ?? projectIdentity(project), ...seal });
        }
        await atomicJson(gateFile, { schema: 1, active: true, runId, ...seal, ...(ownerSessionId ? { ownerSessionId } : {}) });
        await atomicJson(files.contract, { schema: 1, runId, task: options.task, checks, ...(policy ? { projectChecksRequired: true } : {}), ...(this.sessionId ? { sessionId: this.sessionId } : {}), ...documentation, ...(ownerSessionId ? { ownerSessionId, mode } : {}), ...(options.focusPaths ? { focusPaths: options.focusPaths } : {}), ...(options.excludeRoots ? { excludeRoots: options.excludeRoots } : {}) });
        await atomicJson(files.context, { schema: 1, ...preventionContext(context.classes, options.task, options.focusPaths) });
      });
      if (ownerSessionId) await withLock(`${sessionTaskFile(this.home, ownerSessionId)}.lock`, () => withLock(bindingFile(this.home, this.hostProject ?? projectIdentity(project), this.sessionId) + '.lock', arm));
      else if (this.sessionId) await withLock(bindingFile(this.home, this.hostProject ?? projectIdentity(project), this.sessionId) + '.lock', arm);
      else await arm();
      preparedRunId = runId;
    }
    const contract = options || await readJson(this.files(project).contract, {});
    return { status: 'PREPARED', mode, ...(preparedRunId ? { runId: preparedRunId } : {}), project: context.state.root, catalogRevision: context.catalog.revision, ...preventionContext(context.classes, contract.task, contract.focusPaths), errorCount: context.state.errors.length, errors: context.state.errors.slice(0, 4).map(e => ({ ...e, message: e.message.slice(0, 300) })) };
  }
  async binding(project, options = {}) {
    return await evidenceBinding(project, this.catalog, { ...options, sessionId: this.evidenceSession(project) });
  }
  async authorize(project) {
    if (this.host.scoped) {
      const sessionId = trustedSession(this.host.sessionId);
      if (reviewerSession(sessionId)) throw new Error('Reviewer subagents may inspect only, not execute or mutate implementation.');
      if (this.host.workspace && await realpath(project) !== await realpath(this.host.workspace)) throw new Error('Implementation project differs from the verified host workspace.');
    }
    const contract = await readJson(this.files(project).contract, null);
    requireOwner(contract, this.host);
    if (this.host.scoped) {
      const task = await readSessionTask(this.home, this.host.sessionId);
      if (!task?.active || task.project !== await realpath(project) || task.runId !== contract.runId) throw new Error('Owned task identity or generation does not match this project.');
    }
    const canonical = await realpath(project);
    const gate = await readJson(this.gateFile(canonical), null);
    if (await cancellationStatus(this.home, canonical, contract, gate)) throw new Error('Task was CANCELLED, not verified.');
    return contract;
  }
  async verify(project) {
    await this.authorize(project);
    return await withLock(this.files(project).lock, async () => {
      await this.authorize(project);
      const before = await this.binding(project);
      const prior = await readJson(this.files(project).report, null);
      if (this.host.scoped && prior?.binding === before.binding && prior.status !== 'VERIFIED') throw new Error('Unchanged failure: inspect scar_status/scar_details instead of rerunning checks. Change source, contract or catalog before retrying.');
      if (before.scopeViolation) {
        const report = { schema: 1, status: 'FAIL', binding: before.binding, findings: [], errors: [before.scopeViolation], checks: [], classes: [], scope: before.contract.scope, warnings: [], coverage: 'Documentation scope violated; no executable check ran.' };
        await atomicJson(this.files(project).report, report);
        return report;
      }
      const docsOnly = Boolean(before.contract?.scope);
      const native = await scan(project, before.state);
      const findings = docsOnly ? [] : [...native.findings], warnings = docsOnly ? [...native.findings] : [], errors = [...native.errors], checks = [];
      for (const record of before.classes.filter(c => c.detector && !docsOnly)) {
        try { findings.push(...await executeDetector(record, before.state.files.filter(f => record.extensions.includes(path.extname(f.path).toLowerCase())))); }
        catch (error) { errors.push({ id: record.id, message: error.message }); }
      }
      for (const check of before.checks) checks.push(await runCheck(check, before.state.root));
      const after = await this.binding(project);
      let status = 'VERIFIED';
      if (!before.contract || checks.length === 0) status = 'INCOMPLETE';
      if (findings.length || errors.length || checks.some(c => c.status !== 'PASS')) status = 'FAIL';
      if (after.scopeViolation) errors.push(after.scopeViolation);
      if (before.binding !== after.binding) status = 'STALE';
      if (after.scopeViolation) status = 'FAIL';
      const report = { schema: 1, status, binding: before.binding, findings, errors, acceptedExceptions: native.acceptedExceptions, evidence: path.relative(before.state.root, this.files(project).report).split(path.sep).join('/'), checks, ...(before.projectPolicy ? { projectCheckIds: before.projectPolicy.checks.map(c => c.id) } : {}), classes: before.classes.map(c => c.id), ...(docsOnly ? { scope: before.contract.scope, warnings } : {}), coverage: docsOnly ? 'Authorized Markdown documentation checks plus protected-file invariance; repository code is not certified.' : 'Declared detector shapes and configured project checks only.' };
      await atomicJson(this.files(project).report, report);
      return report;
    });
  }
  async review(project, reason) {
    if (typeof reason !== 'string' || reason.trim().length < 12) throw new Error('Learning review requires a concrete explanation. Learn discovered classes before reviewing.');
    await this.authorize(project);
    const { binding } = await this.binding(project);
    await atomicJson(this.files(project).review, { binding, reason });
    return { status: 'REVIEWED', binding };
  }
  async status(project, options = {}) {
    const canonical = await realpath(project);
    const contract = await readJson(this.files(project).contract, null, options);
    const gate = await readJson(this.gateFile(canonical), null, options);
    return await cancellationStatus(this.home, canonical, contract, gate, options) || await freshStatus(project, this.catalog, { ...options, sessionId: this.evidenceSession(project) });
  }
  async cancel(project, { expectedRunId, reason } = {}) {
    if (typeof reason !== 'string' || reason.trim().length < 12) throw new Error('Cancellation requires a concrete administrative reason.');
    const canonical = await realpath(project), files = this.files(canonical);
    const gateFile = this.gateFile(canonical);
    return await withLock(`${gateFile}.lock`, async () => withLock(files.lock, async () => {
      const gate = await readJson(gateFile, null);
      const contract = await readJson(files.contract, null);
      if (!gate?.active || !expectedRunId || gate.runId !== expectedRunId || contract?.runId !== expectedRunId) throw new Error('Active run generation changed; cancellation refused.');
      if (contract.ownerSessionId) {
        if (!this.host.scoped) throw new Error('Owned cancellation requires the trusted owner session; legacy CLI cannot disarm it.');
        await this.authorize(canonical);
      }
      const archive = path.join(this.home, 'cancellations', `${digest({ project: canonical, runId: expectedRunId })}.json`);
      const record = { status: 'CANCELLED', runId: expectedRunId, project: canonical, reason, cancelledAt: new Date().toISOString(), gate, contract, report: await readJson(files.report, null), review: await readJson(files.review, null) };
      await atomicJson(archive, record);
      await atomicJson(gateFile, { ...gate, active: false, status: 'CANCELLED', archive });
      if (contract.ownerSessionId) {
        const task = await readSessionTask(this.home, contract.ownerSessionId);
        if (task?.runId === expectedRunId) await atomicJson(sessionTaskFile(this.home, contract.ownerSessionId), { ...task, active: false, status: 'CANCELLED', archive });
      }
      return { status: 'CANCELLED', runId: expectedRunId, reason, archive };
    }));
  }
  async finish(project) { await this.verify(project); return await this.status(project); }
}
