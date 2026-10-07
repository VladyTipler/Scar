# Scar design

Approved scope: one cross-platform plugin for Codex and Nexus. Automatic integration with SDD + TDD, a growing personal catalog of failure classes, and executable verification. Git and CI are optional; CI integration is deferred.

## Components

- A portable Node.js core bundled into runnable plugin files. No npm install is required by plugin users.
- One Scar skill: preparation before implementation, evidence-based completion, and class-level learning after findings.
- Lifecycle hooks: inject cached rules without source traversal and refuse closure of prepared software tasks without fresh verification and a learning review. Preparation arms the gate; zero-scan startup cannot infer unprepared software edits. Closed gates leave ordinary conversations unaffected.
- MCP tools: the same prepare, verify, learn and finish operations, with structured results.
- A catalog stored outside the plugin installation. Built-in generic guards plus personal classes with applicable scope, evidence, counterexamples and reusable detector code.
- Existing repository checks remain the primary behavior/integration tests. Scar coordinates them rather than replacing the test runner. An explicit `.scar/project-checks.json` supplies mandatory project-wide checks independently of per-session contracts. Every implementation executes their validated union with task checks; conflicts fail closed and policy changes revoke evidence. Missing policy preserves legacy behavior. See [session verification policy](session-isolation.md).

## Source of truth and sharing

Persistent file-based catalog; no database or network service. Each catalog record owns its explanation, detector and fixture proof. Wiki pages can reference class IDs and preserve richer incident context. Generated snapshots and human-readable exports are derived data.

Default storage is per user across projects. A shared directory or optional SSH catalog transport supports the same personal catalog on multiple machines and Nexus without introducing a new daemon. Configured shared transport must fail visibly when unavailable; never silently substitute an empty catalog.

Updates use validated IDs, an exclusive writer lock, expected revision, atomic writes and read-back. The report includes the selected catalog digest. Personal records are never put into the public plugin repository.

## Verification Contract

Observable success: a defect learned in one ordinary folder becomes preventive context and a working detector in a different fresh folder/session.

Required evidence:

1. Known violations and independent variants fail; valid counterexamples pass.
2. New personal detectors are validated against bad, alternative bad and good fixtures before publication.
3. Failed commands, timeouts, changed sources, changed contracts and changed catalog revisions cannot produce READY. Mandatory project-policy changes also revoke evidence; no chat may replace or omit a configured mandatory command through its task checks. Task-specific failures and owner gates remain isolated.
4. Learning read-back and a second process observe the same record.
5. A real SDK MCP client exercises the stdio server.
6. Real hook payloads exercise SessionStart and Stop, including no-Git projects and non-coding tasks.
7. Plugin discovery is exercised through the actual host. A discovered plugin is not proof its hooks are trusted or active.
8. Temporary fixture folders and task processes are removed on success and failure.

## Coverage

The complete catalog is processed by code. Preventive descriptions are ranked by task/path and paginated (eight hints initially); omitted descriptions never suppress execution. Tool reports and class source reads are bounded, with targeted evidence retrieval. Expanded classes retain historical fixture proofs and extension scope.

Initial executable guards target well-defined JavaScript/TypeScript/Vue error shapes. Other languages remain supported through project checks and learned programmatic detectors. A catalog description without an executable protection is reported as a coverage gap, not a passing check.

A detector protects only its declared scope. Model review complements executable checks for contextual risks; it cannot substitute for required command evidence.

## Host constraints to verify

Codex plugin hooks require one-time trust in the host UI. Nexus command hooks run in a plugin-only sandbox; workspace inspection must use an appropriate runtime bridge. Current Nexus MCP hooks do not automatically forward the event payload, so a bridge must be verified before claiming automatic Nexus completion enforcement.

## Deferred

CI, branch protection, web dashboard, vector search, production deployment and licensing decisions are outside the initial implementation scope. macOS execution can only be reported as verified with a real macOS runtime.
