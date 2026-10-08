# Local native ZCode automation (introduced in 0.1.4, updated in local 0.1.8)

## User-facing behavior

Once the local plugin is updated and ZCode reloads it, no separate launcher, session ID, console command, or session restart is needed per task. The agent still selects the authorized task mode:
- questions/reviews: explicit analysis (or the analysis default), no gate/check/state writes;
- implementation: explicit implementation in the user's authorized absolute target directory, with host-owned identity attached automatically. The target need not be the chat workspace, its descendant, or a Git repository.

This does not auto-authorize implementation from arbitrary prompt wording. It automates transport of trusted identity, not user permission or classification.

## Native path

ZCode PreToolUse receives session_id, cwd, tool_name, tool_input and tool_use_id directly from the host. It supports hookSpecificOutput.updatedInput before input validation/permission/tool execution. The native plugin registers a narrowly matched PreToolUse handler for Scar's prepare/verify/review/finish/learn/cancel/status/details names.

For mutation, the handler records a random one-use nonce under the personal request-bindings directory, separate from persistent upstream chat/project bindings and injects only _scarBinding into the same input. It does NOT return permissionDecision=allow; normal permissions remain in force. Owner/workspace are never accepted from model arguments.

The record binds canonical argument fingerprint, exact operation, host session identity and real workspace. Host tool_use_id is stored as issuance/audit metadata; MCP does not expose that independent ID, so the token is an argument-bound one-use bearer capability, not authenticated downstream caller identity. The token expires after 60 seconds. MCP atomically claims the record, validates it and constructs a per-call scoped Workflow. Changed arguments, wrong method, fabricated/replayed/expired tokens refuse before execution. A delayed permission approval can expire; retry the same authorized tool to obtain a fresh native binding, not a supplied token.

Stateless analysis/context/catalog calls issue no binding. Native status/details receive an argument-bound capability for the caller's session evidence; these inspection calls never arm or clear a gate. Reviewer identities may inspect evidence but cannot mutate it. Child/reviewer sessions using the host's subagent identity prefix or parent metadata cannot issue mutating bindings. Foreign owners are still refused by task state. Local 0.1.8 separates the host chat workspace from the explicit target project. A user-authorized implementation may target any existing absolute directory allowed by the host; the one-use capability must bind that canonical target independently of host cwd. Owner/generation checks, normal permissions and Stop's durable task targeting remain mandatory. The core implementation now issues schema-2 request capabilities with separate workspace and targetProject fields. Schema-1 capabilities retain their exact-workspace meaning. Canonical target identity is checked again when the capability is consumed; redirecting a path alias cannot move it to another project. A schema-2 record missing its target fails closed instead of falling back to workspace. scar_learn has no project argument and remains authorized through the same session's active task pointer, not the host cwd. The owner-active check runs under its existing lock before durable binding writes, so a denied second prepare cannot leave a phantom project that blocks Stop. Fresh bundled integration tests pass; final verification and activation are recorded separately.

## Isolation and preservation

The same static MCP can receive independent owner-bound calls from separate sessions without assigning a global last-owner ID. The existing operator launcher remains optional; a native token cannot change its fixed session. Codex/Claude use their original hook declarations, not the ZCode PreToolUse adapter. Their default behavior is unchanged.

Unconsumed tokens after denied/cancelled calls expire; they are not task-completion evidence. Consumed files are removed. If spent-token deletion fails, the call refuses before any Workflow operation; the renamed claim is not reusable. A fresh authorized invocation obtains a new token. Cleanup failures are not converted into successful verification. There is no background daemon or silent cancellation of active tasks. Missing hook identity, unsupported tool naming or absent native binding keeps implementation refused; it never chooses a guessed owner.

## Trust boundary

This is defensive isolation against model mistakes and session mixing, not a hostile local-user sandbox. Hook payload and personal files are trusted same-OS inputs; code with filesystem access could modify them. Do not treat the private token directory as protection against arbitrary malicious shell access.

Automatic binding requires this registered plugin's exact MCP names and ZCode updatedInput semantics. The added PreToolUse is an identity transport hook, alongside the three existing lifecycle hooks; it is not an emulation of SessionEnd.

## Evidence

Unit fixtures verify one-use atomic consumption, key-order canonical fingerprints, expiration/tampering/foreign method, child rejection and read-only no writes. Bundled native hook → SDK MCP tests cover implementation, unchanged FAIL refusal, foreign owner, repair/review/READY and Stop. Installed host source confirms snake_case object payload plus updatedInput propagation to MCP; a live model-driven Desktop task is a separate acceptance boundary, not silently claimed from source inspection.
