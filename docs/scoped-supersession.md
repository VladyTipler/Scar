# Explicit scoped supersession

A failed historical workspace can block the same chat after its corrected implementation has moved to another workspace. Use supersession only when that task has actually been replaced. This retains FAIL/STALE evidence; it does not report historical verification success or authorize release.

The replacement must belong to the same native session/host binding, retain an active exact generation, and have fresh READY. Every original configured check ID and reported class ID must exist in its passing evidence. Changing check implementations remains an explicit reviewed responsibility; matching IDs alone does not prove arbitrary behavioral equivalence.

MCP scar_supersede requires project, sessionId, hostProject, successorProject, expectedRunId, expectedBinding, expectedSuccessorRunId, expectedSuccessorBinding, and a substantive reason. expectedBinding pins the preserved original report, which may be historical/stale. The archive separately records the currently observed original source binding. The replacement binding must be current.

CLI:

    node <plugin>/dist/cli.cjs supersede <obsolete-project> --record <request.json> --session <native-session-id> --host-project <native-cwd>

The JSON request contains the six replacement/generation/binding fields and reason listed above. Obtain run IDs from the exact scoped contracts and bindings from their reports; do not infer a native session from a pooled MCP transport.

Before closing the old gate, Scar archives exact contract/report/review/context bytes from both generations in the private catalog home's supersessions/<receipt-id> directory. File hashes and a manifest bind ownership, generations, reason, old report status and replacement READY. Files are exclusively created, fsynced and read back; the receipt directory is atomically installed. Original files, binding entries, source and catalog remain intact. No power-loss guarantee beyond the filesystem's file-sync/rename contract is claimed.

The result is SUPERSEDED, not READY. Native Stop checks the matching receipt and archive hashes, then verifies every remaining active task normally. A stale/failed replacement, missing archive, altered proof or incomplete transition blocks Stop. Preparing the obsolete project again starts a new active generation and leaves its historical archive intact.

New reports bind their exact runId and contract digest; the archived learning review must match that report binding. Legacy reports lacking these fields are eligible only when their full binding still matches the current source, contract and catalog. A newly prepared generation cannot borrow an earlier report. Recovery additionally requires the current original source binding to match the pending receipt.

Binding and both gate/verification locks protect concurrent preparations, verifications and Stop. If the binding references a retained receipt but the old gate is still active, repeat only the identical request after inspecting ownership. Scar validates the same archive and fresh replacement before finalizing. A different request, changed generation or corrupt archive cannot recover. An archive persisted before an interrupted binding write is reused after exact byte validation, never overwritten.

Supersession is explicit and agent-owned. Do not auto-retire findings, waive checks, delete task evidence, replace another chat's generation, or use unrelated READY evidence as a substitute. Shared learned catalog and historical detector fixtures remain unchanged.
