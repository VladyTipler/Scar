import path from 'node:path';
import { realpath, mkdir, writeFile, rename, lstat, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { catalogHome, digest, readJson } from './io.mjs';
import { trustedSession, reviewerSession } from './task-state.mjs';

const operations = new Set(['scar_prepare', 'scar_verify', 'scar_review', 'scar_finish', 'scar_learn', 'scar_cancel', 'scar_status', 'scar_details']);
const field = '_scarBinding';
const readOperations = new Set(['scar_status', 'scar_details']);
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]));
  return value;
};
const fingerprint = (method, args) => digest(canonical({ method, args }));
const params = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Native binding requires object tool input.');
  return value;
};

export async function issueBinding(event, home = catalogHome()) {
  if (event?.hook_event_name !== 'PreToolUse') throw new Error('Native binding requires the host PreToolUse event.');
  const match = /^mcp__plugin_scar_scar__(scar_[a-z_]+)$/.exec(event.tool_name || '');
  if (!match || !operations.has(match[1])) return {};
  const method = match[1], input = params(event.tool_input);
  if (method === 'scar_prepare' && input.mode !== 'implementation') return {};
  if (field in input) throw new Error('A model-supplied binding is refused; the native host injects it.');
  const sessionId = trustedSession(event.session_id);
  if (!readOperations.has(method) && (reviewerSession(sessionId) || event.parentSessionId || event.parent_session_id)) throw new Error('Reviewer/child session cannot mutate an implementation task.');
  if (typeof event.tool_use_id !== 'string' || !event.tool_use_id || event.tool_use_id.length > 256) throw new Error('Native binding requires host tool call identity.');
  if (typeof event.cwd !== 'string' || !path.isAbsolute(event.cwd)) throw new Error('Native binding requires absolute host workspace.');
  const workspace = await realpath(event.cwd);
  let targetProject;
  if (method !== 'scar_learn') {
    if (typeof input.project !== 'string' || !path.isAbsolute(input.project)) throw new Error('Native binding requires an absolute target project.');
    targetProject = await realpath(input.project);
  }
  const token = randomBytes(32).toString('hex');
  const directory = path.join(home, 'request-bindings');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, token + '.json'), JSON.stringify({ schema: 2, sessionId, workspace, ...(targetProject ? { targetProject } : {}), method, toolCallId: event.tool_use_id, fingerprint: fingerprint(method, input), expiresAt: Date.now() + 60000 }), { flag: 'wx', mode: 0o600 });
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...input, [field]: token } } };
}

export async function consumeBinding(method, input, home = catalogHome()) {
  const token = input?.[field];
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Missing or invalid native host binding.');
  const file = path.join(home, 'request-bindings', token + '.json');
  const claimed = file + '.' + randomBytes(16).toString('hex') + '.claim';
  try { await rename(file, claimed); }
  catch (error) { if (error.code === 'ENOENT') throw new Error('Native binding is missing, expired or already used.'); throw error; }
  try {
    const info = await lstat(claimed);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16384) throw new Error('Invalid native binding file.');
    const record = await readJson(claimed, null, { maxBytes: 16384 });
    const { [field]: ignored, ...args } = params(input);
    if (!record || ![1, 2].includes(record.schema) || record.method !== method || !operations.has(method) || record.fingerprint !== fingerprint(method, args)) throw new Error('Native binding does not match method or arguments.');
    if (!Number.isSafeInteger(record.expiresAt) || record.expiresAt < Date.now() || record.expiresAt > Date.now() + 60000) throw new Error('Native binding expired or invalid.');
    const sessionId = trustedSession(record.sessionId);
    if ((!readOperations.has(method) && reviewerSession(sessionId)) || typeof record.workspace !== 'string' || !path.isAbsolute(record.workspace) || !record.toolCallId) throw new Error('Invalid native owner binding.');
    let targetProject;
    if (method !== 'scar_learn') {
      targetProject = record.schema === 1 ? record.workspace : record.targetProject;
      if (typeof targetProject !== 'string' || !path.isAbsolute(targetProject) || typeof args.project !== 'string' || !path.isAbsolute(args.project)) throw new Error('Invalid native target project binding.');
      if (await realpath(args.project) !== targetProject) throw new Error('Native binding project mismatch.');
    }
    return { scoped: true, sessionId, workspace: record.workspace, ...(targetProject ? { targetProject } : {}) };
  } finally { await rm(claimed, { force: true }); }
}
