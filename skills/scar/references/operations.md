# Operations

Normal use is via the agent and MCP. CLI is for diagnostics and hosts without MCP, not a second tool the user must install.

    node <plugin>/dist/cli.cjs prepare <absolute-project> --contract <json-file>
    node <plugin>/dist/cli.cjs verify <absolute-project>
    node <plugin>/dist/cli.cjs review <absolute-project> --reason "Concrete review and learned IDs"
    node <plugin>/dist/cli.cjs finish <absolute-project>
    node <plugin>/dist/cli.cjs learn <absolute-record-file>

Contract input: `{ "task": "Observable outcome", "checks": [{ "id": "behavior", "command": "$NODE", "args": ["--test", "tests/feature.mjs"] }] }`. Omitting checks discovers existing npm scripts, Go, Cargo and pytest configuration; the agent must add any missing feature/integration evidence. Discovery never chooses deploy scripts.

Default personal catalog: `<user-home>/.scar/catalog.json`; it survives uninstall and upgrades. `SCAR_HOME` selects a shared mounted catalog directory. This optional override is for administrators; no project configuration is required. `.scar/contract.json`, `report.json` and `review.json` are generated project evidence. Keep them private unless intentionally reviewed for publication.

Excluded scanner directories: dependency/cache folders, root generated output directories (`dist`, `build`, `coverage`, `.next`, `.nuxt`, `.output`, `target`). Nested source directories with these names are scanned. Symlinks and oversized files report coverage errors. Git ignores do not secretly remove source from checks.

Commands execute in the project, with argument arrays. Failures, timeouts, excessive output, parser errors and source changes prevent verification. Custom detectors receive a source snapshot in a subprocess capped at 10 seconds. Fixtures and detector source are private catalog data.

`scar_context` retrieves additional preventive pages; `scar_catalog` is a bounded index/search or one ID. `scar_details` retrieves paginated report entries or log slices. CLI equivalents are `catalog <absolute-project> --id <ID>` and `details <absolute-project> --check <ID> --stream stderr --offset 0`. Complete evidence remains in the generated report. A local text limit is not a limit on actual guard execution.

Optional personal `<catalog-home>/connection.json`: `{ "type": "ssh", "host": "user@example.org", "runtime": "/opt/scar/dist/cli.cjs", "home": "/data/personal-scar" }`. The agent/admin chooses a trusted accessible runtime and existing SSH authentication once. `executable` optionally pins an absolute SSH executable; ordinary calls use `ssh`. During Windows validation, Microsoft's OpenSSH returned a local closed-socket error after remote success; the existing Git OpenSSH executable completed the real RPC proof cleanly. No silent success override is used. Transport responses have a separate 64 MiB program-side budget; ordinary command logs remain capped at 1 MiB.
