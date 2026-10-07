# Session-scoped verification

Problem: native Stop uses its host cwd while explicit tool projects may be other worktrees. Project-global contract/report/review/gates let another chat replace or fail the current task. The personal rule catalog is already external and must remain one canonical source.

Contract: opt-in explicit sessionId + hostProject on prepare/verify/review/finish/status/details. Never infer chat identity from a pooled MCP process or a transport session. Native hook context supplies the host session/cwd; agents pass that context. CLI exposes the same scope through --session and --host-project. Legacy unscoped callers remain compatible; new scoped callers never read or overwrite legacy task state.

Data: scoped task files live in project/.scar/sessions/<session hash>; gate outside project uses canonical project+session. Durable host-project/session binding outside workspace tracks at most16 prepared project/runId pairs, survives SessionEnd and missing workspace evidence. Native Stop reads only this binding and verifies every active bound project with source/contract/catalog freshness; it executes no checks. Fresh READY on all projects allows closing only that session's exact generations, under binding/gate locks. Deleted, malformed, stale or changed contracts fail closed. Other chats and legacy HH reports remain untouched.

TDD: two same-project chats success/failure isolation; legacy coexistence; different worktrees from one host cwd; all-project aggregation; generation races; alias canonicalization; missing evidence/restart; blocked old pool tools cannot overwrite scoped paths; real stdio MCP/CLI/native hook subprocess; retained shared catalog/detector fixtures and legacy suites. Build/package integrity, scoped simplify and cleanup before authorized GitHub push. Installed hook/MCP bundles updated atomically with rollback retained; already-running pooled MCP activation reported separately.

Open questions: none for implementation. A pooled server may require host reload to expose updated schema; do not kill user processes.
