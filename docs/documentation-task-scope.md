# Documentation task scope — local 0.1.5

## Purpose and explicit contract

A documentation implementation is not a read-only analysis and does not certify repository code. It requires meaningful executable documentation checks, owner binding, review and fresh finish. It opts in through:

```json
{
  "project": "/absolute/current-project",
  "mode": "implementation",
  "task": "Update authorized documentation only",
  "scope": {"kind": "documentation", "paths": ["docs", "README.md"]},
  "checks": [{"id": "relative-markdown-links", "command": "python3", "args": ["approved-document-check.py"]}]
}
```

The command above is a schema example, not a shipped validator or recommendation to run an absent file. Choose a real authorized validator. Checks must be supplied explicitly; npm autodiscovery is disabled for documentation scope. Scope cannot be selected through focusPaths; that field still only ranks context.

Unreleased local 0.1.7 also executes any explicitly configured mandatory commands from `.scar/project-checks.json`, in addition to the documentation checks; documentation scope cannot waive project policy. With no policy, 0.1.6 behavior is unchanged. Configure only trusted authorized commands: they must not mutate protected files. The policy file itself is protected by the baseline, so changing it during a documentation task fails the boundary. See [shared check policy](session-isolation.md). Passing additional project commands does not widen documentation READY into repository certification.

Allowed changes are lowercase .md files under selected safe docs paths, or explicitly selected root README/CHANGELOG/CONTRIBUTING Markdown names. No blanket '.', source roots, JSON/config/test scripts or traversal targets. Root exclusion configuration is not accepted together with documentation scope.

## Protected baseline

Preparation captures a digest of all covered snapshot files except allowed Markdown. The contract stores this baseline; a scope/baseline seal is written to the external task gate (and owner pointer). Verification checks the boundary BEFORE commands, AFTER commands and in fresh status/Stop. Changing/addition/deletion/rename outside scope fails; pre-existing boundary violation executes no command. Changing scope or baseline in the project contract cannot renew evidence against the external seal.

Documentation protection includes generated output roots and archive files, unlike default code scanning. Established .git, dependency/cache exclusions, root .worktrees/.claude and generated Scar evidence remain outside snapshot coverage. This is not an adversarial sandbox or a claim to monitor every OS file. Symlink/oversize/parser/coverage errors remain blocking.

The baseline begins at preparation, not at Git HEAD. Existing uncommitted changes are part of the starting snapshot; this does not retrospectively approve them. No old contract is automatically migrated or marked READY.

## Result semantics

Unchanged built-in source findings outside the Markdown scope are preserved as warnings, not blocking documentation findings. warnings and warningCount are exposed by summary and scar_details(section="warnings"). Custom personal code-detector programs are not executed for documentation certification; existing native parser/coverage failures still fail closed. All authorized documentation checks must pass and protected files remain unchanged.

READY is accompanied by scope and coverage text explicitly limiting it to authorized Markdown checks plus protected-file invariance. It is NOT repository/production readiness, and existing SCAR-001 stays visible. Full default implementation continues executing its applicable native/personal guards and blocks on findings.

## Existing blocked owner task

The old full-project task is not implicitly re-scoped. If the user explicitly withdraws/replaces its mistakenly broad contract, its SAME owning session may call scar_cancel with the exact current expectedRunId and reason. Native binding and owner authorization remain mandatory. Cancellation preserves gate/contract/report/review in the personal archive and records CANCELLED, never READY.

Only then prepare a new explicitly scoped phase from the current files, run real documentation checks, review and finish. Do not edit the old evidence or cancel another session's task. Documentation already written is retained; warnings are not hidden. The old task remains active unless its user-authorized owner makes this explicit transition.

## Evidence

Tests reproduce the original full-project FAIL despite passing document checks, then prove docs-only READY with source/generated warnings, owner-only cancellation, baseline/seal tamper refusal, source add/delete/rename/non-Markdown mutation, pre-check no execution, during-check source mutation and fresh-status revocation. Generated-root protection and bounded warning summaries are exercised. Native default guard behavior remains strict. No user-project contract/code/evidence is edited by local plugin installation.
