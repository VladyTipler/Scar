# Scar Implementation Plan

> Execution: direct, task by task, with TDD and independent verification at the integration boundary.

**Goal:** Ship an installable plugin proving cross-task failure-class learning and executable verification without Git or CI.

**Architecture:** A shared bundled Node core exposes MCP and lifecycle adapters. A persistent personal file catalog supplies reusable guards; native project commands supply behavior and integration evidence.

**Tech stack:** Node 20+, JavaScript modules, Node test runner, TypeScript syntax parser, Vue SFC parser, MCP TypeScript SDK, esbuild for self-contained distribution.

## Tasks

1. Write failing unit and process-level feature tests for catalog validation, counterexamples and persistence; implement the smallest file catalog.
2. Write failing tests for source traversal, built-in AST guards, stale evidence and command failures; implement scanner and verifier.
3. Write failing no-Git feature tests for prepare, learning, fresh-process reuse and completion; implement the workflow.
4. Write real SDK stdio tests and native hook payload tests; implement MCP and hook adapters.
5. Bundle runtime dependencies, generate host manifests, validate through native plugin discovery. Verify the Nexus boundary against current runtime code; preserve unrelated checkout state.
6. Run Windows and Linux suites, independent review, class-level self-verification and simplify. Publish the verified source and runnable bundles to the authorized public repository.
7. Update Tasks.md and durable Wiki evidence. Clean only task-owned fixtures, processes and caches; preserve source, tests, reports and installed plugin data.

Run focused RED before implementation, focused GREEN after each change, then the complete relevant suite and feature suite. Integration proof must cross real filesystem, subprocess, MCP or lifecycle boundaries.

No unresolved user decisions block this implementation. Hook trust and production activation may require host-side user action after the package is concrete and verified.
