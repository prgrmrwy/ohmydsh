# Phase 1 implementation evidence

Date: 2026-09-23

## Materialization

`node scripts/sync.mjs` installed the exact manifest pins into the active DSH profile:

- `spec-superflow@2.0.1`
- `@deepseek-ai/dsh-skill-filesystem@0.1.5-rc.2`
- `@jkudish/jev-mcp@0.6.0`
- `@deepseek-ai/dsh-mcp-client@0.1.5-rc.2`

The generated profile row mounts the full upstream `spec-superflow/skills` directory through a dedicated provider with `includeDefaultRoots: false` and `watch: false`. All nine expected `SKILL.md` files and the package's `scripts/spec-superflow.mjs` CLI entry were found. No hook or phase guard is installed, and sync does not invoke `ssf isolate` or `ssf finish`.

The Jev bridge row is dynamically disabled when `TYPESAFE_API_KEY` is absent, uses `process.execPath`, and points to the owned launcher. The launcher ledger hash matched the deployed file. The actual Jev child receives only `TYPESAFE_API_KEY` and fixed `JEV_PROVIDER=typesafe`; no parent-environment spread is used.

A third consecutive sync reported:

```text
[sync] third-party schema anvil up-to-date
[sync] managed launcher jev up-to-date
...
[sync] patches up-to-date
[sync] no changes — deployment already matches manifest
```

## Anvil

The pinned Anvil selected tree was materialized in OpenSpec's official user schema directory (default `~/.local/share/openspec/schemas/anvil`); the managed tree hash is `61250a6741799df17fe74c41ed23a95e2910ea3190fff2f6c0e8f66004a63767`. `openspec schema validate anvil --verbose` passed. `openspec schema which anvil` resolved `Source: user`, while `openspec schema which spec-driven` still resolves the package schema. The current worktree has no `openspec/schemas/anvil` copy and `openspec/config.yaml` remains `schema: spec-driven`. OpenSpec 1.9.0's audited resolver checks project, user, then package locations and does not walk parent directories.

## Tests and validation

- `node --test tests/third-party-resources.test.mjs`: 9 passed.
- `node --test tests/jev-workflow-routing-fixtures.test.mjs`: 16 passed.
- `npm test`: 178 tests, 176 passed, 2 intentionally skipped because the exact MCP bridge is profile-installed rather than a repository dependency, 0 failed (re-run 2026-09-24).
- An earlier explicit exact-package MCP probe passed both real ToolRuntime discovery/typed dispatch and dispose-unregister tests; see `mcp-mock-probe.md`.
- `npm run check:artifacts`: passed.
- `openspec validate bootstrap-jev-workflow-routing --strict`: passed.
- `git diff --check`: passed.

Two consecutive final `node scripts/sync.mjs` runs each reported `no changes — deployment already matches manifest`; `npm run check:artifacts`, this change's strict validation, and `git diff --check` also passed on 2026-09-24.

Full-repository `openspec validate --all --strict` is not green because the unrelated existing change `pet-locus-independent-agent-inquiries` fails validation. It reported 32 passing items and that one failure; this unrelated result is recorded separately rather than being attributed to this change.

## Remaining evidence

No live TypeSafe decision was run because the current apply process has no `TYPESAFE_API_KEY`. After restart, the Host remained healthy with the bridge dynamically disabled; explicit standard/Anvil entry probes, isolated spec-superflow provider discovery, failure/privacy probes, and the full disable/restore rollback drill are recorded in sibling evidence files. Real ordinary-Agent Jev request-header/call evidence and a measured real-sample shadow report remain pending.
