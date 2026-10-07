# Scar verification

## ZCode compatibility revision 0.1.1, 2026-10-07

- macOS arm64, Node 22.18.0: `npm ci`, `npm run build`, `npm test` and `npm run test:feature`. Unit checks: 21 pass. Feature/integration checks: 44 pass, seven Windows-specific tests skipped, zero failures.
- Five ZCode regressions cover current-session-only cleanup after prose/READY Stop, stale evidence rejection, repair-budget retention, the armed gate, repeated allowed Stop, next-prompt recreation and unchanged native SessionEnd behavior. Real declared commands and a real stdio MCP client run copied bundles from a path containing spaces without `node_modules`; all ten tools are discovered, missing execution blocks, fresh finish allows cleanup, and a new task blocks again.
- ZCode 0.16.9's bundled `plugins validate` accepts the native manifest. Installed-host source confirms `.zcode-plugin` precedence, plugin-root expansion, the three declared events and retained `cwd`/`session_id` in hook stdin. Its actual extracted hook-output processor was exercised with startup context, neutral `{}` success, blocking retry, and terminal INCOMPLETE context.
- ZCode ignores top-level Stop `continue:false` and does not inject `systemMessage` without a blocking decision. `--zcode` therefore also copies terminal INCOMPLETE guidance into `hookSpecificOutput.additionalContext`, without requesting another repair turn. The project gate and repair state remain armed; this is not READY.
- Source-level and isolated subprocess proof is not a live Desktop task or a host UI warning-display test. The existing installed copy is not updated by these source changes. Windows/Linux and native Codex/Claude hosts were not rerun for this revision; prior evidence below is historical, not renewed certification.
- Abandoned ZCode sessions may retain a small bookkeeping file. Only an allowed Stop removes its own record. There is no sweep, background job, catalog deletion or pending-gate bypass.

## Windows command-evidence revision, 2026-10-06

- A post-restart log inspection invalidated an earlier installed-MCP READY claim: npm's PowerShell shim emitted launcher errors and returned zero without running the intended tests. The directly executed 59-test hook revision evidence remains valid; that MCP npm report does not.
- Windows npm/npx now select native cmd shims through PowerShell, terminate on launcher errors, require a native exit code and retain UTF-8 logs. The actual cause was missing PATHEXT in minimal MCP environments: a controlled probe restored native execution by adding PATHEXT; ComSpec alone did not help. Scar restores missing/empty PATHEXT and normalizes Windows environment keys. Warnings with an actual zero exit remain valid. Unsupported cmd argument shapes fail before execution rather than silently checking different input; direct Node checks preserve those arguments.
- Eight subprocess regressions prove actual script execution through sentinel files, real failure exit7, UTF-8/warnings, a broken PowerShell shim on PATH, a missing native shim, npm/npx and explicit cmd variants, no READY for failing discovered checks, the real bundled MCP boundary, unsupported-argument rejection and the default minimal SDK environment without PATHEXT. Independent review passed all eight with no remaining blockers in this delta.
- Windows: 21 unit + 46 feature/integration tests pass through actual npm launched by the installed MCP in its default minimal environment. Full logs contain those test/pass counts and zero failures; no empty-output PASS is used as evidence. Linux/WSL: 60 tests pass, with seven Windows-specific tests explicitly skipped. macOS remains unverified.
- The generalized adjacent PowerShell invocation/unchecked-exit shape was learned privately with original-bad, two varied-bad and valid fixtures. It is bounded static protection; real subprocess regressions prove runtime behavior.

## Bounded-hook revision, 2026-10-06

- Windows: 21 unit + 38 feature/integration tests pass. Linux/WSL Node 24.13.1: all 59 tests pass. Fourteen hook-budget regressions cover no-source startup/end, no command execution in Stop, fresh changed/add/delete evidence, contract/catalog changes, same-input generations, evidence deletion, restart, closed-task prose, canonical path aliases and concurrent prepare/disarm.
- Real native subprocess tests cancel a transport and kill a filesystem-stalled worker; recorded child PIDs no longer exist. No detached verification job is created.
- Bundled startup/prompt/end commands measured 150–173 ms on Windows, including Node parent/worker startup. Local H: and original WSL UNC workspace were exercised. Samples are measurements, not latency guarantees; no full-source WSL verification benchmark is implied.
- Hook bundle excludes TypeScript/Vue parsers (about 25 KB instead of 4.6 MB). Content hashes establish freshness; only parser results use an in-process bounded cache.
- Active gate identity is canonical; prepare/publication and successful disarm share a lock. Independent review reproduced both original races, checked the fixes and independently passed all 14 hook regressions.
- Preparation is required for every software task: zero-scan startup does not infer unprepared edits. Slow freshness validation returns INCOMPLETE within its work budget. GitHub publication, installed process reload and macOS execution are separate evidence boundaries.

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

No measured production bug-reduction claim yet. Evaluate actual feature work by caught-before-completion classes, escaped bugs, useful new protections and runtime/context overhead. The 0.1.1 revision has macOS subprocess/SDK evidence and ZCode manifest/output-processor checks, but no live ZCode Desktop task proof. Claude compatibility metadata is present; this release does not claim an actual Claude host run.

The Nexus bridge has real MCP and host-process boundary proof, including explicit workspace/session and refusal of `continue:false`. Provider wiring and production activation remain a separate host integration; Nexus source, main and deployment were not changed. Installing native Codex hooks into today's isolated Nexus runner will not enforce completion.

## Resource accounting

Passing tests close their subprocesses and remove fixtures. An earlier Windows test-cleanup failure left two empty fixture directories; the cleanup order is now fixed and the clean-package test passes. Final automatic approval review rejected local removal (`blocked by policy`, no detailed reason), so those directories and task scratch files remain preserved. No bypass was attempted. The generated projectless `work/` holds the read-only design-workflow reference clone, generated Codex schemas, Linux source archive and already-used private learning helper. The empty old `outputs/Scar/.git` migration remnant is also retained after an earlier cleanup rejection. These are outside the source and public package. Source, installed plugin, personal catalog and project reports are intentionally durable.

The minimal-environment RED run also left one disposable npm fixture. Its owned stalled test process and descendants were terminated after checking their exact identities. Automatic approval review refused removal of the proven fixture with `blocked by policy`; it is preserved and not included in the public package. Subsequent passing tests close their processes and remove their fixtures normally.

Disposable server validation workspaces, synthetic catalogs and their npm caches were removed after process checks and exact-path validation. No task containers or services were created.
