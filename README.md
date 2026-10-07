# Scar

**English** · [Русский](README_ru.md)

**Every bug leaves a defense.**

Scar adds cumulative failure-class verification to agent-driven SDD + TDD workflows. One plugin bundles skills, lifecycle hooks, executable checks, and a persistent personal catalog. It works with ordinary project folders; Git, CI, databases and paid model APIs are not required.

## Install in Codex

Prerequisite: Node.js 20+. Runtime dependencies are bundled; users do **not** run `npm install` or start a server.

```text
codex plugin marketplace add VladyTipler/Scar
codex plugin add scar@scar-marketplace
```

Open a new chat. Review and trust Scar's four command hooks in Codex's Hooks UI once. Installation alone does not grant hook trust. Without it the skill/tools remain usable, but automatic completion enforcement is not active. No project configuration, Git repository, CI, database or paid model API is required.

Validated with Codex 0.156.1. This release uses `.codex-plugin/plugin.json` and `.mcp.json`: that version intentionally skips plugin hooks for the newer root `plugin.json` format. The future-format example is kept under `docs/`; it is not the runtime entry point. [Host source](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/core-plugins/src/loader.rs#L950), [hook trust documentation](https://learn.chatgpt.com/docs/hooks).

Codex MCP arguments use a relative bundle path with a plugin-relative `cwd`; this loader does not expand hook path variables in MCP arguments. Claude's compatibility manifest supplies its own host path syntax. [MCP loader source](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/codex-mcp/src/plugin_config.rs).

## Install in ZCode

Prerequisite: Node.js 20+ available to ZCode. Runtime dependencies are bundled; no `npm install` or separate server is needed.

1. Open **Plugin Marketplace → Add → Add Plugin Marketplace** and enter `VladyTipler/Scar` (or this repository's Git URL).
2. In **Personal → scar-marketplace**, open **Scar** and click **Install**. For an existing installation, refresh that marketplace source and update the local Scar build to **0.1.6**.
3. Open a new task and select the **scar** skill. ZCode should discover one skill, the scoped Scar MCP server with eleven tools (including owner-only cancellation), and three lifecycle hooks (`SessionStart`, `UserPromptSubmit`, `Stop`) plus a narrowly matched `PreToolUse` identity-binding hook.

ZCode selects `.zcode-plugin/plugin.json` and `hooks/zcode.json`. It does not emit `SessionEnd`. Instead, an allowed Stop removes only that session's bookkeeping; blocked or incomplete attempts retain their repair counter and the durable project gate. The next prompt/start recreates session bookkeeping. Abandoned sessions can leave a small record; no background cleanup or scan is scheduled. The personal catalog is never removed.

This adapter is **ZCode-only and opt-in**: the native `.zcode-plugin` manifest uses `${ZCODE_PLUGIN_ROOT}`, and its MCP launcher and Stop command pass `--zcode`. Codex/Claude continue loading `hooks/native.json` with all four events and no adapter flag. Their Stop retains session bookkeeping until SessionEnd and keeps the original terminal output. Environment variables alone never enable the adapter; MCP/CLI defaults remain unchanged.

Local 0.1.4 preserves analysis/implementation separation and adds [automatic native binding](docs/zcode-native-binding.md). For questions/reviews, call `scar_prepare` with `mode:"analysis"`; it creates no evidence/gate/checks. For explicit implementation, use ordinary tools in the actual project workspace: native PreToolUse injects a one-use request binding using the host session, exact arguments and cwd. No manual session ID, token or console launcher is needed per task. Missing/stale binding fails closed. Reviewer subagents cannot arm or mutate tasks; unchanged FAIL is inspected, not rerun.

The optional operator-owned [ZCode session bridge](docs/zcode-session-bridge.md) can resume an inactive persisted root session with its host-verified identity and separate Scar MCP process. It uses a private host restart rather than deleting session event history, fixes the target workspace, and disables delegation. It remains an optional operator path; native plugin automation in 0.1.4 does not require it per task.

Local 0.1.5 adds [explicit documentation task scope](docs/documentation-task-scope.md). Supply authorized Markdown paths and real docs checks; protected covered files outside scope must remain unchanged. Existing native source findings are warnings; documentation READY is not repository readiness. focusPaths does not restrict verification. Old active tasks are not silently re-scoped; user-authorized owner cancellation archives them before a new phase.

Administrative cancellation archives the exact mistaken generation with status CANCELLED, never READY. Explicit generated root exclusions are bound to evidence; no blanket test or empty-catch suppression exists.

Installation/discovery is not proof that the hooks execute in a live task. Check the host's hook/MCP status and try a disposable software task: prepare it, verify a failing check cannot finish, then repair it, review and finish. See [verification boundaries](docs/verification.md).

## Normal workflow

Tell the agent what to build. Scar complements your existing SDD and TDD instructions, including superpowers.

1. Before code, the agent calls `scar_prepare`: the engine finds applicable failure classes and discovers existing project checks. The agent adds missing behavior/integration checks itself.
2. The agent develops through SDD + TDD. Scar's catalog traversals and detectors run as code, without model calls.
3. `scar_verify` executes every applicable guard and the project's checks. Missing checks, parser/coverage errors, timeouts, failures and stale evidence prevent readiness.
4. For a meaningful defect, the agent generalizes its class, searches analogues and publishes a detector through `scar_learn`. Original bad, independent bad and good fixtures must prove the declared protection.
5. `scar_review` records the learning decision; `scar_finish` reruns verification. A trusted Stop hook validates that evidence against current source, contract and catalog without rerunning tests. Three repair prompts are allowed, then it stops with an explicit INCOMPLETE warning.

Startup hooks read only small Scar state files and cached prevention hints. They do not traverse source, parse code, run checks or contact a remote catalog. `scar_prepare` refreshes hints and arms the software completion gate; every preparation creates a new task generation. After successful Stop, the gate closes so ordinary conversations do not rerun it. **Zero-scan hooks cannot discover software edits when an agent skips preparation.** The skill requires preparation for every software task. Deleting workspace evidence does not clear an armed gate.

Hooks have internal work budgets of 1 second for startup/prompt, 2 seconds for local Stop (15 seconds for UNC shares, including WSL), and 0.5 seconds for SessionEnd. A native supervisor allows a further second to terminate the worker and descendants. Fresh byte reads use at most 16 concurrent filesystem operations; no size/mtime freshness cache is used. These are upper work budgets, not promised execution times. If fresh evidence cannot be established within the budget, Stop reports INCOMPLETE; it never accepts a cached READY without validation or starts a background verification job. See [hook design](docs/hook-latency.md).

An expanded class retains its ID, old extension scope and historical fixture coverage. The personal catalog lives outside the installation at `<user-home>/.scar/catalog.json`, survives plugin upgrades and applies across projects. Project `.scar/` contains generated contracts and complete reports. Neither belongs in the public plugin repository.

Native Codex/Claude chats use explicit `sessionId` and `hostProject` arguments supplied by hook context. ZCode calls instead receive identity through the trusted one-use native binding; never supply session IDs or tokens manually. Each chat keeps separate contracts/reports and can verify worktrees outside its original cwd; Stop checks every active workspace bound to that chat. Legacy unscoped tools retain shared project behavior. Learned detector programs and fixtures stay in the single personal catalog when a worktree is removed. See [session isolation](docs/session-isolation.md). An already-running MCP connection needs a host reload to expose updated tools. The bundled CLI supports legacy/native-host use, but is not an escape hatch for owner-bound ZCode tasks. Local **0.1.6** combines these upstream improvements with all ZCode customizations; see [port and compatibility](docs/local-upstream-port.md).

Unreleased local **0.1.7** adds optional project-wide mandatory checks in `.scar/project-checks.json`: every implementation chat runs these in addition to its own checks, without sharing tasks or reports. Conflicting same-ID task commands are refused; policy changes invalidate prior evidence. No policy preserves 0.1.6 behavior. The agent configures only authorized real project commands; analysis creates nothing. See [shared check policy](docs/session-isolation.md#shared-mandatory-project-checks-unreleased-local-017). This source revision is not published or installed.

## Catalog size and model cost

Preparation returns a first page of eight short preventive hints; **eight is not a limit on checks**. Task/path hints rank those descriptions. `scar_context` retrieves additional pages without changing the execution contract. `scar_catalog` searches/paginates or reads one class by ID; detector/fixture source is available in explicit 4000-character slices. All extension-applicable guards execute, including guards omitted from the model's context.

Tool verification responses contain bounded summaries and full counts. `scar_details` retrieves paginated findings or short log slices. Full evidence stays on disk. Running checks uses CPU/time, but Scar makes no LLM/API calls; interpreting failures, adding detectors and fixing code still consumes model tokens.

## Current coverage

Built-in AST guards detect empty catch blocks, async `forEach` callbacks and async Promise executors in JS/TS/JSX/TSX and Vue script blocks. JavaScript grammar is validated separately from TypeScript; Vue external scripts and unsupported encodings report coverage gaps.

An intentional optional fallback can use an [exact documented SCAR-001 exception](docs/project-exceptions.md), bound to its rule, file, catch line and whole-file SHA-256. Approvals remain auditable in the report; stale or invalid approvals fail coverage. Parser errors and other guards cannot be waived.

Existing npm test/typecheck/lint/build scripts, Go, Cargo and pytest checks are discoverable. Other tools and language-specific protection are added by the agent through executable project checks and proven personal detectors. An empty suite is incomplete. `READY` means the declared checks passed against fresh source, contract and catalog; it does not prove every possible bug is absent. Custom detector programs are trusted code with time/output limits, not a security sandbox.

## Sharing a catalog across machines

An optional SSH catalog transport provides one canonical personal catalog across machines without a daemon/database. The agent/admin configures its trusted host/runtime/home once in personal `connection.json`; individual projects need no config. A configured transport failure blocks verification instead of falling back to an empty local catalog. Local mode works offline. Transport data is processed by code, never dumped into the model context.

## Development and evidence

```text
npm ci
npm run build
npm test
npm run test:feature
```

On Windows run npm/npx through PowerShell. Tests cover real filesystem/process/MCP boundaries, no-Git learning and fresh-process reuse, stale reports, bounded context, prior-generation regression retention, native payloads and isolated bundles without `node_modules`. Windows and Linux runtime suites were exercised previously; the ZCode compatibility revision also runs the available suites and isolated bundled integration tests on macOS. Windows-only tests are skipped on macOS; this does not imply a live ZCode task was exercised. See [verification evidence](docs/verification.md) for exact results and activation boundaries.

Source licensing remains to be selected. Bundled dependency licenses are preserved in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
