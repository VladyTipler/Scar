# Bounded lifecycle hooks

Problem: all four hooks called full source context before handling their event. Prompt/startup read and hashed whole workspaces; Stop reran tests, and SessionEnd scanned before removing one record. Slow filesystem operations exceeded host timeouts.

## Contract

- SessionStart/UserPromptSubmit: local session bookkeeping and bounded cached hints; no traversal, source reads, parser initialization, detector execution or catalog transport. Missing hints direct the agent to prepare.
- Prepare: discover coverage/checks, write bounded cached hints, assign a new runId and arm a durable gate outside the project. Same-input preparation invalidates prior evidence.
- Verify/finish: expensive executable work through MCP/CLI, with fresh content/contract/catalog binding.
- Stop: validate the armed contract and existing evidence with live hashes and catalog revision. No checks or detectors run. Successful closure disarms the gate. Unknown, stale, missing or timed-out evidence is incomplete.
- SessionEnd: delete session bookkeeping only. Never clear a pending software gate.

Work budgets: startup/prompt 1000 ms, Stop 2000 ms, SessionEnd 500 ms. Native parent supervises a worker with an extra 1000 ms termination allowance and kills its process tree on failure. Stdin has its own 1500 ms limit. Actual scheduling/startup can add overhead. The original native hook declaration is retained so an already reviewed configuration is unchanged; its nominal 30/600-second timeouts do not override the runner's much shorter internal limits. Some hosts independently cap SessionEnd. No work is delegated to an untracked background job. MCP calls propagate cancellation cooperatively; native supervision also handles stalled OS operations.

The source scope excludes dependencies, root generated outputs, root `.worktrees`/`.claude`, and listed archive formats. Nested source/build paths stay covered. Oversized files fail coverage before content reading. Parser cache reuses analysis only; metadata timestamps never establish READY. Snapshot scope version changed so older reports cannot satisfy an armed new contract.

## Explicit limitations

Zero-scan hooks cannot detect code changes when preparation is skipped. The agent must prepare before each software task. Hook CWD and tool project must identify the same workspace. After gate closure a new software task must prepare again. Very large or slow workspaces can still exceed the bounded fresh-status check: report INCOMPLETE, never fabricate completion. Remote catalog freshness requires live transport in Stop and may time out; startup remains offline.

## Acceptance

Real native subprocess tests cover unavailable source roots, stalled filesystem workers, cancellation and process exit. Gate tests cover missing execution, same-input new generations, changed/add/delete source, changed catalog/contract, workspace-evidence deletion, session restart and prose after closure. Native/MCP/Nexus boundaries use the same engine. Fixture directories and processes are task-owned and cleaned by tests.
