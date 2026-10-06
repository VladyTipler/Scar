# Scar

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

## Normal workflow

Tell the agent what to build. Scar complements your existing SDD and TDD instructions, including superpowers.

1. Before code, the agent calls `scar_prepare`: the engine finds applicable failure classes and discovers existing project checks. The agent adds missing behavior/integration checks itself.
2. The agent develops through SDD + TDD. Scar's catalog traversals and detectors run as code, without model calls.
3. `scar_verify` executes every applicable guard and the project's checks. Missing checks, parser/coverage errors, timeouts, failures and stale evidence prevent readiness.
4. For a meaningful defect, the agent generalizes its class, searches analogues and publishes a detector through `scar_learn`. Original bad, independent bad and good fixtures must prove the declared protection.
5. `scar_review` records the learning decision; `scar_finish` reruns verification. A trusted Stop hook validates that evidence against current source, contract and catalog without rerunning tests. Three repair prompts are allowed, then it stops with an explicit INCOMPLETE warning.

Startup hooks read only small Scar state files and cached prevention hints. They do not traverse source, parse code, run checks or contact a remote catalog. `scar_prepare` refreshes hints and arms the software completion gate; every preparation creates a new task generation. After successful Stop, the gate closes so ordinary conversations do not rerun it. **Zero-scan hooks cannot discover software edits when an agent skips preparation.** The skill requires preparation for every software task. Deleting workspace evidence does not clear an armed gate.

Hooks have internal work budgets of 1 second for startup/prompt, 2 seconds for Stop, and 0.5 seconds for SessionEnd. A native supervisor allows a further second to terminate the worker and descendants. These are upper work budgets, not promised execution times. If fresh evidence cannot be established within the budget, Stop reports INCOMPLETE; it never accepts a cached READY without validation or starts a background verification job. See [hook design](docs/hook-latency.md).

An expanded class retains its ID, old extension scope and historical fixture coverage. The personal catalog lives outside the installation at `<user-home>/.scar/catalog.json`, survives plugin upgrades and applies across projects. Project `.scar/` contains generated contracts and complete reports. Neither belongs in the public plugin repository.

## Catalog size and model cost

Preparation returns a first page of eight short preventive hints; **eight is not a limit on checks**. Task/path hints rank those descriptions. `scar_context` retrieves additional pages without changing the execution contract. `scar_catalog` searches/paginates or reads one class by ID; detector/fixture source is available in explicit 4000-character slices. All extension-applicable guards execute, including guards omitted from the model's context.

Tool verification responses contain bounded summaries and full counts. `scar_details` retrieves paginated findings or short log slices. Full evidence stays on disk. Running checks uses CPU/time, but Scar makes no LLM/API calls; interpreting failures, adding detectors and fixing code still consumes model tokens.

## Current coverage

Built-in AST guards detect empty catch blocks, async `forEach` callbacks and async Promise executors in JS/TS/JSX/TSX and Vue script blocks. JavaScript grammar is validated separately from TypeScript; Vue external scripts and unsupported encodings report coverage gaps.

Existing npm test/typecheck/lint/build scripts, Go, Cargo and pytest checks are discoverable. Other tools and language-specific protection are added by the agent through executable project checks and proven personal detectors. An empty suite is incomplete. `READY` means the declared checks passed against fresh source, contract and catalog; it does not prove every possible bug is absent. Custom detector programs are trusted code with time/output limits, not a security sandbox.

## Nexus and sharing

[Nexus boundary adapters](integrations/nexus/README.md) forward explicit workspace/session context and reject unsuccessful completion through the same engine. They have real-process and MCP contract tests. Current Nexus command/MCP sidecars cannot inspect host workspaces or enforce Stop by installing this package alone. One host integration is required; **Nexus production activation is not part of this release**. Do not install native Codex hooks into an isolated Nexus hook sandbox and expect them to work.

An optional SSH catalog transport provides one canonical personal catalog across machines without a daemon/database. The agent/admin configures its trusted host/runtime/home once in personal `connection.json`; individual projects need no config. A configured transport failure blocks verification instead of falling back to an empty local catalog. Local mode works offline. Transport data is processed by code, never dumped into the model context.

## Development and evidence

```text
npm ci
npm run build
npm test
npm run test:feature
```

On Windows run npm/npx through PowerShell. Tests cover real filesystem/process/MCP boundaries, no-Git learning and fresh-process reuse, stale reports, bounded context, prior-generation regression retention, native payloads and isolated bundles without `node_modules`. Windows and Linux runtime suites are exercised; macOS has not been exercised on a real host. See [verification evidence](docs/verification.md) for exact results and activation boundaries.

Source licensing remains to be selected. Bundled dependency licenses are preserved in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
