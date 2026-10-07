# Exact project exceptions

SCAR-001 permits intentional suppression only when its fallback is documented. Other native and learned guards, parser errors, unsupported encodings and project checks cannot be waived.

The agent audits each catch and its caller before writing `.scar/exceptions.json`:

```json
{
  "schema": 1,
  "entries": [{
    "id": "SCAR-001",
    "file": "src/preferences.ts",
    "line": 12,
    "sourceHash": "<64 lowercase hexadecimal characters>",
    "reason": "Denied optional preference storage leaves the documented system default; callers do not depend on persistence."
  }]
}
```

`sourceHash` is SHA-256 of the entire raw file bytes, including its encoding and line endings. `file` uses safe project-relative forward slashes. `line` is the catch's one-based source line. `reason` must contain at least 40 non-padding characters; length is structural validation, not proof the rationale is correct. Audit the actual behavior before approving.

Entries match only that rule, file, line and exact file hash. Any edit revokes approval. Multiple catches on one minified line share one entry, and the whole-file hash protects all those original occurrences. New files and all unmatched findings remain failures. The report retains approvals in `acceptedExceptions`; compact tool output includes `acceptedExceptionCount`. There are no directory ignores, wildcard rules or implicit comment approvals.

Malformed JSON/schema/metadata, unknown rules, duplicate entries, missing findings and stale hashes are coverage failures. Any invalid entry prevents all partial approvals. Deleting a fixed catch requires deleting its now-unused exception. The exception file is included in source freshness, so changing a rationale also requires renewed verification and review. Keep project exceptions private; they may contain source filenames or project context.
