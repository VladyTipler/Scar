# Scar 0.1.0 verification

Validated 2026-10-05. Windows Node 24.13.1; Linux Node 22.22.3; Codex CLI 0.156.1.

- Windows: `npm test` 21/21 and `npm run test:feature` 24/24 pass.
- Linux: the same 45 tests pass in an isolated disposable workspace. No deployment, services or containers.
- Clean-install proof: copied bundles run from a separate temporary directory without `node_modules`; a real SDK stdio client prepares an unrelated no-Git project.
- Native Codex app-server: `skills/list` discovers enabled `scar:scar`; `hooks/list` discovers SessionStart, UserPromptSubmit, Stop, SessionEnd with no loading errors. `mcpServerStatus/list` confirms Scar connected with all ten executable tools. Actual native startup initially failed because MCP arguments retained a hook-style path variable literally; plugin-relative cwd and relative bundle arguments fix the handshake. Clean-package tests now use the real declaration. Hooks are **untrusted** until reviewed in the host UI. No model turn or trust change was used for discovery.
- Real SSH proof: publish, read-back, fresh client and project execution share one disposable server catalog. Windows Git OpenSSH completes cleanly; Microsoft OpenSSH on this machine emitted a local closed-socket error after successful remote commands. The transport does not ignore failed exit status; a trusted absolute executable override is supported.
- A 1000-class catalog produces bounded prevention context. Independent execution proof demonstrates a class absent from the first eight hints still executes and blocks readiness. Additional context pages are available separately.
- First real learned class is stored in the user's private catalog, outside this repository, with bad/alternate/good proof and reuse in another ordinary folder. Synthetic test catalogs are not personal knowledge.
- Independent adversarial audit found coverage holes in encoding, nested build directories, JS grammar, fixture scope, missing persisted catalogs, Dockerfiles and replacements. It also found UTF-8 corruption across stream chunks; stdout/stderr and JSON input now use streaming decoders, with a real Cyrillic-path hook proof. Regression checks reject those paths. Scoped simplification review found no justified abstraction changes.

## Boundaries

READY covers declared detector shapes plus selected project behavior/integration checks, fresh source/contract/catalog and learning review. Source, contract or catalog changes revoke prior evidence. Failures, missing checks and unverified encodings cannot become READY.

No measured production bug-reduction claim yet. Evaluate actual feature work by caught-before-completion classes, escaped bugs, useful new protections and runtime/context overhead. macOS has no real-host execution evidence. Claude compatibility metadata is present; this release does not claim an actual Claude host run.

The Nexus bridge has real MCP and host-process boundary proof, including explicit workspace/session and refusal of `continue:false`. Provider wiring and production activation remain a separate host integration; Nexus source, main and deployment were not changed. Installing native Codex hooks into today's isolated Nexus runner will not enforce completion.

## Resource accounting

Passing tests close their subprocesses and remove fixtures. An earlier Windows test-cleanup failure left two empty fixture directories; the cleanup order is now fixed and the clean-package test passes. Final automatic approval review rejected local removal (`blocked by policy`, no detailed reason), so those directories and task scratch files remain preserved. No bypass was attempted. The generated projectless `work/` holds the read-only design-workflow reference clone, generated Codex schemas, Linux source archive and already-used private learning helper. The empty old `outputs/Scar/.git` migration remnant is also retained after an earlier cleanup rejection. These are outside the source and public package. Source, installed plugin, personal catalog and project reports are intentionally durable.

Disposable server validation workspaces, synthetic catalogs and their npm caches were removed after process checks and exact-path validation. No task containers or services were created.
