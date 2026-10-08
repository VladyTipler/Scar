---
name: scar
description: "Use when implementing software, reviewing code/specifications, answering technical questions, or investigating verification failures. Not for non-software tasks."
---

# Scar — prevention without widening authority

## Choose the mode before any tool call

**Questions, investigation, planning, specification review or read-only audit:** use `scar_prepare` with explicit `mode: "analysis"`, absolute target `project`, and `task`; or read `scar_context` / `scar_catalog`. Analysis reads only: no contract, executable checks, detector programs, review/finish, learning publication, or completion gate. Findings belong in the answer, not an obligation to edit code. Do not infer permission to run tests/build from the topic being software. Never supply checks for analysis.

**Explicitly authorized implementation:** use `mode: "implementation"`. The scoped host obtains the owner identity from its trusted launcher, never model arguments. If trusted session identity is unavailable, report that limitation; do not bypass via a legacy CLI, inject an environment identity yourself, spoof lifecycle events, or use a dummy check. Local 0.1.8 retains automatic identity from native PreToolUse: call ordinary Scar tools without session IDs, tokens or launcher commands. The host injects a one-use _scarBinding parameter; never supply or copy it yourself. Use the user's authorized absolute target project, even when it differs from the chat's workspace. Native binding identifies the actual owner and exact canonical target independently of host cwd; it does not grant filesystem or command permissions. An active task still cannot be replaced implicitly. Another chat's task/report/gate is never yours to mutate. If native binding is unavailable or expired, report the exact refusal; do not bypass it. The optional operator session bridge is not needed for normally bound plugin calls and must not be launched by the model.

Preparation creates an owner-bound generation and canonical target project. Stop follows that task even if host cwd differs. Analysis never clears an active implementation. An existing active task cannot be replaced by another prepare; finish it, or have an authorized administrator cancel the exact generation with a recorded reason. Cancellation is not READY.

## Subagents and target selection

Reviewer subagents only inspect context/catalog and code; they never prepare implementation, verify, finish, learn or close the parent's task. The owner coordinates executable verification. Use the actual target repository, not an unrelated host cwd. A delegated audit must not create another project contract.

## Documentation-only implementation

For explicitly authorized Markdown changes, prepare with `scope: {kind:"documentation", paths:["docs","README.md"]}` and explicit real documentation checks. Do not treat focusPaths as verification scope. Only named Markdown may change; code/tests/config/generated files are protected by the preparation baseline. Existing built-in code findings are warnings, still reported; scoped READY is not whole-repository READY. Source changes or incomplete coverage block. Do not run npm test/build just because documentation changes.

Do not rewrite an active old contract. Only if the user explicitly authorizes withdrawing/replacing its mistaken full-project task, its owner can call scar_cancel with exact expectedRunId and concrete reason; CANCELLED preserves evidence and is not READY. Then start a new authorized documentation phase. Never cancel another owner or hide source defects to pass. See [documentation scope](../../docs/documentation-task-scope.md).

## Implementation cycle

1. Read project guidance and prevention hints. Follow existing SDD/TDD.
2. Supply meaningful behavior/integration checks using argument arrays. Missing checks never qualify as READY. Explicit `excludeRoots` may name confirmed generated root directories, such as `.test-dist`; scope is bound to evidence. Do not blanket-ignore tests or suppress all empty catches.
3. Implement via TDD. Meaningful defects may justify a proven reusable detector: read [learning](references/learning.md), search prior classes, prove original-bad/independent-bad/good fixtures, preserve prior scope.
4. Run `scar_verify`. For unchanged FAIL/INCOMPLETE, inspect `scar_status` / `scar_details` and report the gap. Do not repeatedly call finish or edit unrelated code just to get READY. An intentional test catch needs review, not automatic dismissal.
5. Record learning rationale via `scar_review`; then `scar_finish` runs fresh checks. Only READY supports an implementation-complete claim. Stale or failed evidence remains incomplete.

No personal incidents, credentials or catalogs belong in the public repo. Detector programs are trusted code, not a security sandbox.

[Operations](references/operations.md) covers administrator recovery and legacy host behavior. Legacy CLI is not an escape hatch from scoped host refusals.
