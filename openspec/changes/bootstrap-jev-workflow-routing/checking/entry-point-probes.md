# Phase 1 entry-point probes

Date: 2026-09-24

All probes were non-destructive; temporary OpenSpec changes were deleted immediately after their schema identity was read. No `ssf isolate`, `ssf finish`, merge, archive, or Worktree Session operation was invoked.

## Standard OpenSpec and Anvil

Commands:

```text
openspec new change probe-standard --schema spec-driven
openspec status --change probe-standard --json
openspec new change probe-anvil --schema anvil
openspec status --change probe-anvil --json
```

Observed identities:

```text
standard spec-driven spec-driven
anvil anvil spec-driven
```

This proves the explicit Anvil entry works while the project default remains `spec-driven`.

## spec-superflow distribution and skill provider

The installed `spec-superflow@2.0.1` package declares both CLI aliases (`ssf`, `spec-superflow`) to `scripts/spec-superflow.mjs`. The exact package contains all nine expected skill directories.

A same-process probe using the actual `@deepseek-ai/dsh-skill` registry and `@deepseek-ai/dsh-skill-filesystem` provider, configured exactly like the generated profile row, returned:

```text
bug-investigator:spec-superflow-upstream:bundled
build-executor:spec-superflow-upstream:bundled
code-reviewer:spec-superflow-upstream:bundled
contract-builder:spec-superflow-upstream:bundled
need-explorer:spec-superflow-upstream:bundled
release-archivist:spec-superflow-upstream:bundled
spec-merger:spec-superflow-upstream:bundled
spec-writer:spec-superflow-upstream:bundled
workflow-start:spec-superflow-upstream:bundled
count 9
loaded true
```

The loaded `workflow-start` resource base points to its original directory under the full installed package, preserving the upstream two-level plugin-root assumption. The upstream skill explicitly instructs callers to use that package's script instead of a PATH `ssf`.

Because this session is a managed Worktree Session and upstream `isolate`/`finish` perform nested Git/worktree lifecycle actions, executable spec-superflow routing remains ineligible here. Discovery is verified; unsafe flow execution is intentionally not used as validation.

## Missing credential behavior

The active profile contains the Jev bridge row, but its `disabled` expression evaluates from `!process.env.TYPESAFE_API_KEY`. The restarted Host and current apply process have no such variable. The Host continues serving on loopback, the router skill is materialized, and no live Jev request is claimed.
