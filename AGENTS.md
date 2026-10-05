# Scar

Scar complements existing SDD + TDD; no Git, remote repository, database or CI dependency. Users install one plugin, not a collection of runtimes/services. Keep setup agent-owned and automated.

Use TDD for validators, pure logic, persistence and integration boundaries. Tests use temporary owned workspaces and always clean them in `t.after`. Integration tests must execute real subprocess/filesystem/MCP contracts.

Development: `npm ci`, `npm test`, `npm run build`, `npm run test:feature`. Windows npm/npx commands run through PowerShell. All task file operations use absolute paths. Bundle runtime dependencies into checked-in dist files; users do not run npm install. Run `git diff --check` before publication.

Never publish personal catalog records, project source snapshots, secrets or local paths. Do not claim a discovered plugin has trusted hooks, or a prepared adapter is activated. Native Nexus activation and production rollout require separate authority.

Update Tasks.md after completing its items. After a feature, apply the code-simplifier skill to its diff; independent verification is required at real integration boundaries.
