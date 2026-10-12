# Scoped Supersession Implementation Plan

> Execute with SDD + TDD and one final independent review.

**Goal:** Explicitly supersede an obsolete scoped task with a verified replacement while retaining failed evidence and enforcing the replacement's active gate.

**Architecture:** Add Workflow.supersede, CLI supersede and MCP scar_supersede. Bind both exact generations and report bindings in the same native chat. Require a fresh READY active replacement covering every original check ID and class ID. Persist private hash-bound copies of both generations' contract/report/review/context before changing the binding and old gate. Never mark historical FAIL as READY.

**Tech Stack:** Node.js fs promises, existing locks/Workflow, Zod/MCP, bundled CLI/native hooks. No new dependency, Git or database requirement.

## Contract

- Explicit sessionId + hostProject, absolute different canonical projects, expected old run/report binding, expected replacement run/binding, substantive reason.
- Old report remains historical, including FAIL/STALE. Capture current observed source binding without asserting the old report is fresh. Reject missing/invalid evidence, mismatched generations, changed replacement, lost checks/classes and unscoped/cross-chat operations.
- Archive exact bytes privately; hash-check and fsync before state transition. Keep binding entries and all original files. Return SUPERSEDED, never READY for the obsolete task.
- Lock binding, both gates and verification owners in consistent order. Pending binding with active old gate fails closed; exact retry may finalize the same valid receipt. Different retry/generation rejects.
- Stop validates supersession archive and matching binding/gate metadata, then checks remaining active tasks normally. Changed replacement still blocks; preparing an old project reactivates its new generation. Old archives survive.
- No unrelated source/catalog changes, detector weakening, automatic supersession, source deletion or release approval.

## Tasks

- [x] RED unit: preservation, stale/failed successor, coverage loss, wrong ownership/generation, idempotency, partial write recovery, archive tamper, reprepare, locks.
- [x] RED actual CLI/MCP/native-hook boundary.
- [x] Minimal implementation and GREEN focused tests.
- [x] Document API/lifecycle and keep original suites.
- [x] Full unit/build/feature checks; simplify; independent review; learning review; fresh READY.
- [x] Commit/push GitHub; update Codex plugin; verify installed hashes and real synthetic MCP/CLI/Stop.
- [x] Apply explicit replacement only to obsolete scopes after fresh successor proof; preserve history and current release gate.
- [x] Cleanup owned test resources; Wiki and readback. Four policy-rejected synthetic directories retained and reported.

## Decisions

Deleting evidence and changing old expected identities were rejected. A reason-only cancellation could waive unfinished behavior; require a verified replacement and retained coverage instead. Supersession is a lifecycle disposition, not a successful test result.

## Unresolved questions

None for implementation. Already-running pooled MCP may need reconnect; do not kill host processes.

## Evidence

Original unit RED executed11 cases; actual CLI/MCP RED executed2. Independent review found two Important gaps: cross-generation report reuse and changed-source pending recovery. Both reproduced by true RED before fixes, plus actual bundled CLI RED for generation borrowing. New reports bind runId/contract digest; legacy reports require their full current binding. Pending recovery now rejects changed source binding. No rereview claim.

Simplify: NO_CHANGES after the complete source/test/doc diff; helpers and validation ordering retained. Existing catalog unchanged; semantic persistence/generation invariants are proved by project-owned actual filesystem/CLI/MCP regressions rather than an unproven lexical detector.

Windows TEMP short-path aliases are covered by canonicalized fixture roots. Fault-injection waits reject early operation failures rather than waiting indefinitely. Test-owned process cleanup and retained-resource limitations are recorded privately.

Publication and installation acceptance completed:123 project tests pass, shipped CLI/MCP/native hooks pass three real boundary cases from the installed plugin directory. Four explicitly replaced generations retain their original evidence bytes and private hash-bound receipts. The replacement implementation and release operator remain active and require fresh READY. Existing pooled MCP processes were preserved; a new connection exposes the new tool.
