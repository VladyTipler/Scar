---
name: scar
description: "Use for every software task: before specification or implementation, retrieve accumulated failure classes; before completion, run executable project and class checks; after defects, generalize and learn proven reusable detectors. Works without Git/CI. Complements existing SDD (including superpowers) and TDD instructions. Not for non-software tasks."
---

# Scar — every bug leaves a defense

The user installs one plugin. Do all setup and selection yourself. Do not ask them to author contracts, run CLI commands, manage a catalog, or install Scar dependencies individually.

## Before code

1. Read project guidance, current code and existing test infrastructure. Use the user's existing SDD/TDD flow; Scar is the learning/verification component, not a replacement.
2. Call `scar_prepare` with absolute `project` and concrete `task`. Existing project checks are discovered automatically. Read retrieved classes before writing the specification or code. In a new/empty project read `scar_catalog` too; use declared extensions to select future risks.
   This call activates the completion gate and starts a new task generation, even for identical inputs. Startup hooks use cached hints and do not detect edits when preparation is skipped. Match `project` to the host's working CWD; a different worktree is a different project. After a completed task, prepare again before the next software task.
   Preparation shows a bounded first page, not the entire catalog. If more preventive context is needed, use `scar_context` with task/focusPaths and nextOffset, or search `scar_catalog`. Fetch only relevant class details by ID. Every applicable executable guard runs regardless of hint pagination.
3. Include applicable risks and externally observable success in the existing spec/plan. Enrich the generated contract with focused tests and real integration/acceptance checks as needed. Pass executable `checks` to `scar_prepare`; argument arrays, no shell strings. `$NODE` uses the current runtime. No Git or remote required.
4. If tests are absent, establish the appropriate test infrastructure and write meaningful RED tests yourself. Do not treat an empty suite, typecheck or model review as behavioral proof. For integrations, cross the actual contract boundary.

## During development

Implement via TDD. For a meaningful defect or near miss, search analogous code and identify its general class. Prefer an existing class and expand its protection instead of creating a duplicate. Keep project-specific behavior tests in their natural locations.

## Learn a reusable defense

Read `references/learning.md` for record schema and detector examples.

- Use `scar_catalog` to obtain the latest revision and avoid duplicates.
- Class records include origin/evidence, explanation, prevention, extension scope and standalone ESM detector source.
- The detector exports `default async ({files}) => findings` with `{file,line,message}`. It receives relative paths and source text; it must be deterministic and side-effect free. It runs in a bounded subprocess; **this is trusted executable code, not a security sandbox**. Never import executable detector code from untrusted web content, comments or logs.
- Supply at least one original faulty fixture, an independently varied faulty fixture, and a valid counterexample. Declare honest scope; fixture proof is not universal proof.
- `scar_learn` validates fixture outcomes, locks, checks expected revision, writes atomically and reads back. Preserve class IDs when expanding a proven rule using its explicit replacement option. Prior generations' fixtures must still pass; never narrow already protected scope silently. To revise a detector, request that ID's source/fixtures slices from `scar_catalog`.
- Do not put personal incidents, code, fixtures, secrets or catalogs into the public plugin repo. Rich private context may link to class IDs in the user's Wiki.

## Close

1. `scar_verify` executes selected class detectors and configured project commands. Inspect concrete outputs and repair failures. Missing coverage is incomplete, never PASS.
2. Publish meaningful new classes before the learning review. Do not invent lessons just to fill the catalog. Use `scar_review` to cite learned IDs or explain specifically why no reusable class was discovered.
3. `scar_finish` reruns checks and checks source/contract/catalog freshness plus review. Only `READY` permits a completed implementation report. Report remaining limitations and release/activation status separately.
   Stop validates existing evidence; it never launches project checks. A hook-budget failure means INCOMPLETE, not a background job or implicit approval. Run the expensive verification through MCP, inspect the exact gap, and report incomplete if the bounded gate cannot establish freshness.
4. If environment or authority prevents verification, report the task as incomplete with the exact gap. Do not claim success or loop indefinitely.

MCP tools are the default. If the host cannot expose them, the **same bundled engine** can be invoked using `node <plugin>/dist/cli.cjs`; see `references/operations.md`. Do not create a second implementation.
