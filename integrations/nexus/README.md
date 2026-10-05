# Nexus provider boundary

The existing Nexus source has plugin stdio tools and skill loading. Its command-hook runner mounts the plugin, not the project. Its MCP hook arguments are static; SessionStart payload lacks cwd/session_id, and current providers do not dispatch a Stop event before results. Merely adding a hooks.json would not enforce verification.

This package supplies `createScarBoundary` with a real-MCP protocol contract test. Nexus's existing stdio sidecar is also isolated and cannot inspect arbitrary host workspaces. **Host wiring is required before automatic enforcement is active**:

1. Use the supplied host-local invoker to execute the pinned installed Scar hook bundle in the authorized workspace environment. A future scoped-workspace sandbox may replace that invoker, but do not bypass isolation for arbitrary plugins or presume today's sidecar has workspace access.
2. Derive explicit `{project, sessionId}` from the trusted provider execution context. Keep it scoped to the current execution; never accept another owner's workspace from model arguments.
3. Before the model starts, `begin(context)` returns developer context; append it to the provider's instructions. On later user turns, `refresh(context)` refreshes known classes.
4. Before emitting successful result/done, await `finish(context)`. On `scar_incomplete`, feed its reason back for a bounded repair pass; if externally blocked, return an explicit incomplete result. On transport/error failure, do not report successful completion.
5. Call `end(context)` only after finishing or cancelling; do not remove baseline state before the completion gate.

The root package is the native Codex legacy entry point. Its native hooks and stdio configuration must not be installed as Nexus sandbox hooks. A host integration should register the Scar skill and pin the bundled CLI/hook runtime for normal authorized workspace execution using `createLocalInvoker`; both use the same core and catalog protocol. Keep runtime/home configuration in the existing host configuration source, not per-project duplicates.

The prepared bridge is not a production rollout. Nexus source/deployment is unchanged by plugin installation. A provider-level host change must be tested and authorized before claiming automatic Nexus enforcement. This is a one-time host integration, not per-project setup.
