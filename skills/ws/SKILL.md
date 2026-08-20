---
name: ws
description: Inspect, promote, or safely clean a verified ohmydsh Worktree Session binding or operation. Generic Git worktree, lean/mutable, promote, status, or clean requests are not sufficient routing evidence.
whenToUse: The calling Session has a valid Worktree Session binding, or an explicit absolute path resolves to valid Worktree Session operation metadata. An explicit /ws request still requires ownership validation before state changes.
---

# Worktree Session operations

## Ownership boundary

- This skill owns only operations proven by a valid Worktree Session binding for the calling Session, or by an explicit absolute path that resolves to valid operation metadata.
- A directory under `.worktrees`, a registered Git worktree, a `ws/*` branch, or the words `lean`, `mutable`, `promote`, `status`, or `clean` do not by themselves prove ownership.
- Before `promote` or `clean`, resolve and validate the exact operation identity, repository root, Git common directory, managed root, binding mode, and lifecycle through the trusted Host path.
- An explicit `/ws` request selects this command surface but does not waive binding, containment, lifecycle, active-Session, dirty-state, or merge checks.
- If no valid binding or operation can be proven, allow only read-only diagnostics that cannot mutate Git, dependencies, Session state, or operation metadata; otherwise stop with the exact missing invariant.
- Never adopt an unknown worktree, synthesize operation metadata, infer ownership from naming, or bypass a refusal with generic Git commands.

## Source-Workspace model

For the new schema-v2 flow, one Git repository maps to one DSH Workspace. The
existing source Session is bound in place; no target Workspace or target Session
is created. Its immutable DSH Session cwd remains the repository root, while
`<repo>/.worktrees/<task>` is the logical managed execution root. Do not treat
the immutable cwd as permission to run local tools in the main checkout.

The input-area status UI reports task branch, `lean`/`mutable`, and
`active`/`uncertain`/`cleaned`. Prefer that UI for a quick check and `ws status`
for an on-demand detailed report; dynamic status must not be presented as a
reason to mutate stable runtime context.

## Commands

For a schema-v2 bound Session, call the model-visible `ws` tool with
`action=status` or `action=promote` and omit `path`; the Host resolves the exact
calling Session binding. Agent calls must not provide `path` or operate on a
different Session. Use `action=clean` only after reviewing status and a dry run;
all live Session paths and bindings are protected.

The shell wrapper has no trustworthy Session-id environment, so use it only with
an explicit path for operator recovery and diagnostics of schema-v2 operations:

```bash
scripts/ws.sh status /absolute/worktree/path
scripts/ws.sh promote /absolute/worktree/path
scripts/ws.sh clean --dry-run /absolute/worktree/path
scripts/ws.sh clean /absolute/worktree/path
```

## Dependency and safety rules

- New Worktree Sessions are `lean` by default. Before an npm operation that may
  install, remove, update, or otherwise mutate dependencies, the Agent must run
  `promote` for the current binding, verify success, and only then perform the
  mutation.
- `promote` verifies the exact lean link, runs and validates worktree-local
  `npm ci`, and reports `mutable` only after success. It refreshes metadata/UI;
  it does not change the stable binding context.
- `status` reports operation/base/task branch, managed root, dependency
  fingerprint/mode, lifecycle, and isolated development `DSH_HOME`; it never
  prints `.env.local` values.
- Always run `clean --dry-run` first. Clean refuses the caller's current
  worktree, a live/executing source Session bound to it (even though that
  Session's immutable cwd is the repo), dirty state, in-flight operations, and
  branches not proven merged by ordinary Git ancestry. It preserves remote
  branches and shared caches.
- Never bypass a refusal with force deletion. Preserve/commit useful work and
  establish merge ancestry first.

## Recovery and cleaned history

A retry of the first Worktree submit reuses the same operation id and validates
every durable Host phase. A durable claim with unconfirmed admission is
`uncertain`; keep the source draft/history and do not resubmit automatically.
For orphaned prepared operations, run status from outside the target worktree.
Cleanup requires a valid v2 source binding or v1 target binding; missing or
malformed v2 binding fails closed and requires explicit operator repair.

Successful cleanup removes only safety-proven Git/runtime resources and marks
the binding `cleaned`. It keeps the historical source Session in the source
Workspace. If that Session is reopened, explain that its old managed execution
root no longer exists, do not execute against the removed path or main checkout,
and direct the user to create a new Worktree Session.

## Schema-v2 only

Only `schemaVersion: 2` source-session bindings are supported. A legacy
schema-v1 operation or any unknown future version is rejected with an explicit
unsupported-version diagnostic and fails closed: no worktree, branch, binding,
dependency, or operation file is created, modified, or removed, and no binding
is ever migrated or fabricated. Historical Session logs and pre-existing
Workspace/Session registrations remain untouched; never rewrite, rename, delete,
reparent, or invent a source binding for them.

## Pinned DSH contract

This Skill and package target the rc.7 DSH composition baseline and the exact
installed contracts. The audited checkout is mixed-version: AgentLoop,
subagent, and tool packages are rc.7, while installed `dsh-agent` and
`dsh-system-prompt` are rc.8. The policy depends on audited local-path schemas,
explicit Bash `workdir`, Agent-scoped guards, child setup propagation, lifecycle
hooks, and stable runtime-context projection. A future DSH upgrade requires a
fresh audit and regression tests; unknown or changed local/delegation contracts
must fail closed until reviewed.

## Deferred, not commands

`/ws setup`, per-repository config/trust, generic adapters, pnpm/Rush support,
explicit network ref refresh, and squash-merge provider proof are backlog only.
Do not claim they exist and do not synthesize hidden config files for them.
