import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';

export const delegationTools = ['Agent', 'Task', 'SendMessage', 'CreateWorkflow', 'AmendWorkflow', 'ResumeWorkflowRun', 'CronCreate', 'OffPeakCreate'];
const allowedMethods = new Set(['session/read', 'session/messages', 'session/events', 'session/subscribe', 'session/stop', 'session/send']);
const sendKeys = new Set(['sessionId', 'content', 'attachments', 'inputId', 'queryId', 'expectedRevision', 'toolDenylist', 'modelExecution']);

async function verifiedSnapshot(snapshot, sessionId, workspace) {
  const s = snapshot?.session;
  if (s?.sessionId !== sessionId) throw new Error('Host session identity does not match the requested persisted session.');
  if (s.sessionKind !== 'interactive' || s.parentSessionId) throw new Error('Only an interactive root session may own the bridge; subagents/forks are refused.');
  if (!['idle', 'completed'].includes(s.status)) throw new Error('Session must be idle before bridge rematerialization.');
  if (!s.workspace || await realpath(s.workspace.workspacePath) !== workspace) throw new Error('Host session workspace does not match the operator-selected project.');
  return s;
}

export async function bindScarSession(protocol, { sessionId, workspace, mcpBundle, scarHome, nodeExecutable = process.execPath } = {}) {
  if (typeof sessionId !== 'string' || !/^sess_[a-zA-Z0-9_-]{1,180}$/.test(sessionId)) throw new Error('A persisted host-issued session identity is required.');
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) throw new Error('An absolute workspace is required.');
  if (typeof mcpBundle !== 'string' || !path.isAbsolute(mcpBundle) || !(await stat(mcpBundle)).isFile()) throw new Error('An existing absolute Scar MCP bundle is required.');
  if (scarHome !== undefined && (typeof scarHome !== 'string' || !path.isAbsolute(scarHome))) throw new Error('Scar catalog home must be an absolute path.');
  const canonical = await realpath(workspace);
  // The launcher validates the host response before passing identity to MCP;
  // no model argument, imported fake session or global ID substitution is used.
  const initial = await protocol.request('session/resume', { sessionId });
  const owner = await verifiedSnapshot(initial, sessionId, canonical);
  if (typeof protocol.restart !== 'function') throw new Error('Bridge requires a private restartable host process; in-place session close would delete event history.');
  const boundProtocol = await protocol.restart();
  const configuration = {
    sessionId: owner.sessionId, workspace: owner.workspace,
    dynamicWorkflowEnabled: false, offPeakToolEnabled: false,
    toolDenylist: [...delegationTools],
    mcpServers: [{
      name: 'plugin:scar:scar', command: nodeExecutable, args: [mcpBundle, '--zcode'], isolation: 'session', timeoutMs: 30000,
      env: [
        { name: 'SCAR_HOST_SESSION_ID', value: owner.sessionId },
        { name: 'SCAR_HOST_WORKSPACE', value: canonical },
        ...(scarHome ? [{ name: 'SCAR_HOME', value: scarHome }] : [])
      ]
    }]
  };
  const resumed = await boundProtocol.request('session/resume', configuration);
  await verifiedSnapshot(resumed, owner.sessionId, canonical);
  return {
    sessionId: owner.sessionId, workspace: canonical, snapshot: resumed,
    async request(method, params = {}) {
      if (!allowedMethods.has(method)) throw new Error('Method is not allowed by the single-session Scar bridge.');
      if (params.sessionId !== owner.sessionId) throw new Error('Request belongs to a different session.');
      if (method === 'session/send') {
        if (Object.keys(params).some(k => !sendKeys.has(k))) throw new Error('Session send parameters cannot override bridge configuration.');
        if (params.toolDenylist !== undefined && (!Array.isArray(params.toolDenylist) || params.toolDenylist.some(n => typeof n !== 'string'))) throw new Error('Invalid tool denylist.');
        return boundProtocol.request(method, { ...params, toolDenylist: [...new Set([...delegationTools, ...(params.toolDenylist || [])])], modelExecution: { ...params.modelExecution, selectionScope: 'execution', subagents: { foregroundModel: 'submission', background: 'deny' } } });
      }
      if ('mcpServers' in params || 'workspace' in params) throw new Error('Session configuration overrides are not allowed.');
      return boundProtocol.request(method, params);
    }
  };
}
