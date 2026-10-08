# Session-scoped verification

Problem: native Stop uses its host cwd while explicit tool projects may be other worktrees. Project-global contract/report/review/gates let another chat replace or fail the current task. The personal rule catalog is already external and must remain one canonical source.

Contract: opt-in explicit sessionId + hostProject on prepare/verify/review/finish/status/details. Never infer chat identity from a pooled MCP process or a transport session. Native hook context supplies the host session/cwd; agents pass that context. CLI exposes the same scope through --session and --host-project. Legacy unscoped callers remain compatible; new scoped callers never read or overwrite legacy task state.

Data: scoped task files live in project/.scar/sessions/<session hash>; gate outside project uses canonical project+session. Durable host-project/session binding outside workspace tracks at most16 prepared project/runId pairs, survives SessionEnd and missing workspace evidence. Native Stop reads only this binding and verifies every active bound project with source/contract/catalog freshness; it executes no checks. Fresh READY on all projects allows closing only that session's exact generations, under binding/gate locks. Deleted, malformed, stale or changed contracts fail closed. Other chats and legacy HH reports remain untouched.

TDD: two same-project chats success/failure isolation; legacy coexistence; different worktrees from one host cwd; all-project aggregation; generation races; alias canonicalization; missing evidence/restart; blocked old pool tools cannot overwrite scoped paths; real stdio MCP/CLI/native hook subprocess; retained shared catalog/detector fixtures and legacy suites. Build/package integrity, scoped simplify and cleanup before authorized GitHub push. Installed hook/MCP bundles updated atomically with rollback retained; already-running pooled MCP activation reported separately.

## Native target independence (unreleased local 0.1.8)

Native ZCode calls and trusted launcher calls may select a user-authorized absolute project outside the chat cwd, including unrelated directories and worktrees. The original workspace remains the host-project binding origin; the selected canonical project is bound to the exact operation/arguments in a schema-2 one-use capability. Schema-1 capabilities retain their original exact-workspace meaning; old runtimes refuse schema 2 rather than widening it. One active owner task per ZCode chat, owner-only mutation/cancellation, project-local mandatory checks and isolated reports remain unchanged. Stop follows the stored target and original host-project binding, without executing commands. A rejected prepare for another target does not modify durable bindings.

## Shared mandatory project checks (unreleased local 0.1.7)

Task isolation does not isolate the project's required verification policy. An agent/operator may explicitly configure `.scar/project-checks.json` once in the canonical project:

```json
{
  "schema": 1,
  "checks": [
    {"id": "tests", "command": "npm", "args": ["test"], "timeoutMs": 120000},
    {"id": "integration", "command": "npm", "args": ["run", "test:feature"], "timeoutMs": 600000}
  ]
}
```

These are schema examples: configure only real authorized commands for that project. Setup remains agent-owned; end users need no runtime installation or manual per-chat configuration. Scar does not promote the first chat's task-specific commands to global policy, create this file during analysis, or change policy through `scar_prepare`. The file is project configuration, not generated session evidence; it remains private alongside exact project exceptions.

- Every implementation, including legacy unscoped callers and documentation-scoped tasks, executes the current mandatory commands before its own commands. An explicit empty task list can be sufficient only when mandatory commands exist and pass. Documentation still requires its own explicit nonempty checks and retains its protected baseline; project commands are trusted executable configuration, not a sandbox.
- The policy must be an object with exactly `schema` and `checks`, schema 1, and 1..64 unique check IDs. Each check allows only `id`, `command`, `args`, and optional `timeoutMs`, using the existing check validator and process limits. Reads are capped at 64 KiB and respect cancellation. Malformed JSON, null/scalar values, unsupported fields, invalid timeouts and duplicate IDs fail closed.
- Mandatory and task checks with the same ID must have identical command, arguments and effective timeout (omitted means 120000 ms). Identical definitions run once; conflicting definitions fail before arming a new task and are also rejected during fresh verification.
- The contract keeps only that chat's task-specific checks. `projectChecksRequired:true` records that a policy existed at preparation; deleting that file then refuses verification. Full reports list effective command results and `projectCheckIds`. Contracts/reports/reviews/gates and owner pointers remain session-isolated.
- Verification reads the current policy, rather than a frozen copy from prepare. Adding or changing mandatory checks invalidates evidence for every active task in that project, including already-prepared tasks. Source freshness includes the raw policy file; the binding additionally includes its parsed policy so old-engine evidence cannot certify previously ignored mandatory commands.
- A missing policy preserves the previous 0.1.6 check-selection behavior and binding format. Projects/worktrees do not inherit each other's policy. Completed gates remain closed; this does not reactivate finished chats or retroactively execute commands.
- Stop validates freshness and blocks stale, missing or malformed policy evidence; it executes no checks. Exact SCAR-001 exceptions, generated-root exclusions, native one-use identity and administrative owner cancellation retain their existing contracts.

This is trusted configuration, not a tamper-proof administrator ACL: an actor authorized to edit the project can change its policy and must obtain new evidence. Updating source bundles does not update resident MCP processes; old runtimes cannot enforce a new policy until explicitly updated/reloaded. No installation or publication is implied.

Open questions: none for implementation. A pooled server may require host reload to expose updated schema; do not kill user processes.
