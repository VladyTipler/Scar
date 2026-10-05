// Nexus must call this at the provider boundary, before emitting completion.
// The invoker must run where the workspace and trusted catalog are accessible.
export function createScarBoundary({ invoke }) {
  if (typeof invoke !== 'function') throw new Error('Scar boundary needs a host-local or workspace-enabled MCP invoker.');
  async function dispatch(context, name) {
    if (!context?.project || !context?.sessionId) throw new Error('Scar Nexus boundary needs explicit project and sessionId.');
    const response = await invoke({ event: { hook_event_name: name, cwd: context.project, session_id: context.sessionId } });
    if (response?.isError) throw Object.assign(new Error('Scar verification tool failed.'), { code: 'scar_unavailable' });
    if (!Array.isArray(response?.content)) throw new Error('Invalid Scar MCP response.');
    const result = JSON.parse(response.content.find(c => c.type === 'text')?.text || 'null');
    if (!result || typeof result !== 'object') throw new Error('Invalid Scar lifecycle response.');
    if (result.decision === 'block' || result.continue === false) throw Object.assign(new Error(result.reason || result.systemMessage || result.stopReason), { code: 'scar_incomplete' });
    return result;
  }
  return Object.freeze({
    async begin(context) {
      const result = await dispatch(context, 'SessionStart');
      return result.hookSpecificOutput?.additionalContext || '';
    },
    async refresh(context) {
      const result = await dispatch(context, 'UserPromptSubmit');
      return result.hookSpecificOutput?.additionalContext || '';
    },
    async finish(context) { return await dispatch(context, 'Stop'); },
    async end(context) { return await dispatch(context, 'SessionEnd'); }
  });
}
