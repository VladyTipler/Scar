# Optional operator ZCode session bridge (introduced in 0.1.3)

Local 0.1.4 adds [automatic native binding](zcode-native-binding.md) for ordinary plugin calls. The launcher below is a separate optional operator path, not required per task when native PreToolUse binding is loaded.

## Boundary

In the original 0.1.3 path the static Desktop plugin could not receive identity through its manifest. Local 0.1.4 still defaults to analysis but can bind explicit implementation calls automatically through native PreToolUse; see the native binding document above. The optional `dist/zcode-bridge.cjs` is an operator-controlled NDJSON launcher for an existing persisted interactive root session. It is not an MCP tool and must not be invoked by the model to bypass an identity refusal.

The operator must ensure the selected session is inactive in Desktop/other hosts and acknowledge `--exclusive`. A personal lease prevents duplicate bridge launchers for the same canonical workspace and session; it is not a lock against an independently running Desktop. Same-OS access is trusted code, not an adversarial security sandbox. Do not attach a bridge to a running user conversation.

## Bind algorithm

1. Start a private ZCode `app-server`, using the operator-selected absolute host entrypoint.
2. Resume the persisted session through the actual host; verify returned ID, canonical workspace, interactive root kind, no parent, and idle/completed status.
3. Stop/restart only this private host process. Do not issue `session/close`: that method deletes event-store data.
4. Resume the exact verified ID with `mcpServers` overriding `plugin:scar:scar`. Supply `SCAR_HOST_SESSION_ID` and canonical `SCAR_HOST_WORKSPACE` from verified metadata, not model input. Use `isolation:"session"` and the bundled MCP `--zcode` path.
5. Revalidate the returned snapshot. Permit only read/messages/events/subscribe/send/stop for that session.

Implementation remains explicitly mode=implementation. Since local 0.1.8 the bridge-bound MCP may prepare a user-authorized project outside the verified chat workspace. The bridge still verifies the actual session's workspace/identity and refuses session/configuration substitution; those checks do not restrict which project that session may implement. Unbound MCP still refuses implementation. A task in another project cannot be finished or cancelled without its exact owning session and generation. `bridgeReady` means the binding was configured, not a model-driven task or provider credential check completed.

## Delegation policy

Until per-child host binding is implemented, the bridge disables Agent/Task/SendMessage, workflow spawning/resume and scheduled work tools; session forks/creates/resumes and MCP/plugin mutations are not forwarded. Every send preserves the denylist and adds any caller restrictions; configuration overrides are rejected. Operator callbacks are forwarded, not auto-approved. Inspection refuses permissions and provider credential requests.

No script imports fake history in production. Empty fresh sessions without persisted messages are not made persistent by inventing a conversation. Create real sessions through normal ZCode use, then bind them when inactive.

## Operator usage

```text
node <installed-scar>/dist/zcode-bridge.cjs --host <absolute-zcode.cjs> --workspace <absolute-project> --session <existing-sess_ID> --exclusive --inspect
```

Without `--inspect`, a local protocol client sends newline records `{ "id":"request-id", "method":"session/read", "params":{"sessionId":"same-sess_ID"} }` and receives host notifications/replies. Session send starts model execution only when the operator/client submits it. Host permission/question/credential callbacks require operator responses; they time out closed. The adapter is not integrated into the ordinary Desktop launcher or TUI.

The entrypoint uses packaged provider configuration when discoverable; explicit ZCode provider environment settings remain supported. It does not copy credentials into MCP identity or change global plugin settings. `--scar-home` optionally supplies a separate absolute catalog.

## Verification and limits

Unit/transport tests cover identity/workspace/active-parent mismatch, host errors, Unicode callbacks, frame limits, EOF/shutdown and forbidden configuration/delegation overrides. The opt-in real host test uses synthetic temporary imported-history fixtures solely to avoid model requests, while the production bridge resumes only pre-existing sessions.

Real test: two actual host-issued root IDs, separate host/MCP processes, 10 tools per MCP, scripted calls in those SAME host-launched MCPs: prepare implementation → blocked Stop → FAIL → unchanged finish refusal → source fix → review/finish READY → allowed Stop. An attempt to finish an unrelated, unowned project is rejected; this is task ownership, not a cwd restriction. Process PIDs are gone after cleanup; no model requests are logged. The CLI inspection entrypoint is also exercised.

This does not prove a live model edit, normal Desktop automatic activation, Windows/Linux execution of this host bridge, or safe child-session propagation. Delegation intentionally remains disabled.
