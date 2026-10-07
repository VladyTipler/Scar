import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { executeDetector } from './catalog.mjs';
import { PersonalCatalog } from './sharing.mjs';
import { scan } from './workspace.mjs';
import { atomicJson, readJson, catalogHome, withLock, projectGateFile } from './io.mjs';
import { workspaceContext, evidenceBinding, freshStatus } from './evidence.mjs';
import { runCheck, validateCheck } from './process.mjs';
import { discoverChecks } from './discovery.mjs';
import { preventionContext } from './presentation.mjs';
import {taskFiles,bindingFile,validateBinding,validateSession,projectIdentity,maxSessionProjects} from './task-scope.mjs';

export class Workflow {
  constructor(home = catalogHome(),scope={}) {
    this.home=home;this.catalog=new PersonalCatalog(home);
    if(scope.sessionId!==undefined){this.sessionId=validateSession(scope.sessionId);if(scope.hostProject!==undefined)this.hostProject=projectIdentity(scope.hostProject);}
    else if(scope.hostProject!==undefined)throw new Error('hostProject requires a sessionId.');
  }
  files(project) { return taskFiles(project,this.sessionId); }
  async context(project, options = {}) {
    return await workspaceContext(project, this.catalog, options);
  }
  async prepare(project, options) {
    const context = await this.context(project);
    if (options) {
      const checks = options.checks ?? await discoverChecks(project);
      if (!options.task?.trim() || !Array.isArray(checks)) throw new Error('Task and checks are required.');
      checks.forEach(validateCheck);
      if (new Set(checks.map(c => c.id)).size !== checks.length) throw new Error('Duplicate check IDs.');
      if (options.focusPaths && (!Array.isArray(options.focusPaths) || options.focusPaths.some(p => typeof p !== 'string' || path.isAbsolute(p) || p.split(/[\\/]/).includes('..')))) throw new Error('focusPaths require safe relative paths.');
      const runId = randomUUID();
      // Arm outside the workspace first: deleting .scar cannot bypass an active gate.
      const gateFile = projectGateFile(this.home, context.state.root,this.sessionId);
      const prepareTask=()=>withLock(gateFile+'.lock',async()=>{
        await atomicJson(gateFile,{schema:1,active:true,runId});
        await atomicJson(this.files(project).contract,{schema:1,runId,task:options.task,checks,...(this.sessionId===undefined?{}:{sessionId:this.sessionId}),...(options.focusPaths?{focusPaths:options.focusPaths}:{})});
        await atomicJson(this.files(project).context,{schema:1,...preventionContext(context.classes,options.task,options.focusPaths)});
      });
      if(this.sessionId===undefined)await prepareTask();
      else{
        const hostProject=this.hostProject??projectIdentity(project),file=bindingFile(this.home,hostProject,this.sessionId);
        await withLock(file+'.lock',async()=>{
          const previous=await readJson(file,null);
          if(previous)validateBinding(previous,hostProject,this.sessionId);
          const projects=(previous?.projects??[]).filter(entry=>projectIdentity(entry.project)!==projectIdentity(context.state.root));
          if(projects.length>=maxSessionProjects)throw new Error('Session project limit reached; use a separate task.');
          projects.push({project:context.state.root,runId});
          // Durable ownership first: a partially prepared task must still block Stop.
          await atomicJson(file,{schema:1,hostProject,sessionId:this.sessionId,projects});
          await prepareTask();
        });
      }
    }
    const contract = options || await readJson(this.files(project).contract, {});
    return { status: 'PREPARED', project: context.state.root, catalogRevision: context.catalog.revision, ...preventionContext(context.classes, contract.task, contract.focusPaths), errorCount: context.state.errors.length, errors: context.state.errors.slice(0, 4).map(e => ({ ...e, message: e.message.slice(0, 300) })) };
  }
  async binding(project, options = {}) {
    return await evidenceBinding(project, this.catalog, {...options,sessionId:this.sessionId});
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
      const report = { schema: 1, status, binding: before.binding, findings, errors, acceptedExceptions: native.acceptedExceptions, checks, classes: before.classes.map(c => c.id), coverage: 'Declared detector shapes and configured project checks only.',evidence:path.relative(before.state.root,this.files(project).report).split(path.sep).join('/') };
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
  async status(project, options = {}) {
    return await freshStatus(project, this.catalog, {...options,sessionId:this.sessionId});
  }
  async finish(project) { await this.verify(project); return await this.status(project); }
}
