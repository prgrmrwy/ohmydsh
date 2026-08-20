# dsh-worktree-session

Worktree Session (WS) keeps **one Git repository in one DSH Workspace**. On the
first submit from a blank Git-backed source Session, the opt-in flow creates a
unique `ws/*` task branch and a nested `.worktrees/<task>` checkout, then binds
the existing source Session to that checkout and submits the first message once
through the source Session's ordinary submit path.

The new flow creates **no target Workspace and no target Session**. The source
Session stays in its source Workspace, and its immutable DSH cwd remains the
repository root. WS separately treats `<repo>/.worktrees/<task>` as the logical
**managed execution root** for local files, searches, commands, and inherited
Agent execution. The main checkout is never switched, reset, or used as the
managed task root.

Preparation and admission are recoverable and fail closed. If preparation or
binding fails, the source draft and images remain intact and are not submitted
from the repository checkout. A claimed but unconfirmed admission becomes
`uncertain` and is not automatically submitted again.

## Dependency modes and promote

New Worktree Sessions are **lean by default**:

- `lean`: `node_modules` is a verified link to a cache addressed by
  `package-lock.json`, Node major, and npm major. Before any install, removal,
  update, or other dependency mutation, the Agent must run `ws promote` for the
  current bound Session.
- `mutable`: worktree-local `npm ci` has succeeded and operation metadata has
  been updated. Only then may the Agent perform dependency mutations.

Promotion is Agent-driven and preserves the Session binding. It updates
metadata and UI status, but does not change the stable model runtime context.

## Status and maintenance

The input-area status UI persistently shows the bound task branch, dependency
mode (`lean` or `mutable`), and lifecycle (`active`, `uncertain`, or `cleaned`).
Dynamic status is not repeatedly injected into conversation context.

Clicking the bound task branch asks the local editor to open that Session's
managed worktree directory, via a `vscode://file/<path>` deep link by default
the open action is configurable). Cleaned or unbound sessions do not offer the
open action, and the target path always comes from the persistent binding.

The model-visible `ws` tool resolves schema-v2 maintenance from the exact
calling `ToolExecution.agent.session`; Agent calls cannot supply a path or
operate on another Session's binding. Operator recovery and diagnostics remain
available through the explicit path-oriented CLI/Host surface below.

The `dsh-ws` CLI and Skill shell wrapper do not receive a trustworthy Session-id
environment. Their interface remains explicitly path-oriented:

```text
status /absolute/worktree/path
promote /absolute/worktree/path
clean [--dry-run] /absolute/worktree/path
```

Explicit paths remain available for operator recovery and diagnostics of
schema-v2 operations. Always dry-run cleanup first. Clean refuses a
current, dirty, in-flight, active-bound, or ordinary-merge-unproven worktree and
never deletes remote branches or shared npm caches.

Successful cleanup removes only safety-proven worktree/branch runtime resources
and retains a compact `cleaned` tombstone. The historical Session is not deleted
or moved: it remains under the source Workspace. Reopening it shows that the old
execution root has been cleaned, denies reuse of that removed path, and directs
the user to create a new Worktree Session.

## Recovery and persisted binding

Operation records live at `<git-common-dir>/ws/operations/<operationId>.json`.
They persist the source Session binding, canonical repository, managed worktree,
task branch, admission state, and dependency metadata. Host restart or Session
resume revalidates the same binding before local execution continues. Repeated
first-submit retries reuse the operation id and prepared resources.

For an orphaned operation, inspect it with `dsh-ws status <worktree>` and
preserve or commit useful work. Destructive cleanup requires a valid schema-v2
source-session binding; an unbound or malformed schema-v2 record fails closed
and requires explicit operator repair.
Never force cleanup past a safety refusal.

The managed `.env.local` block affects `bin/dsh build` executed inside the
worktree only. It does not change the already-running GUI Host's process home.

## Schema v2 only

Only `schemaVersion: 2` source-session bindings are supported. The legacy
schema-v1 target-handoff flow has been retired. A schema-v1 operation or any
unknown future version is rejected at read time with an explicit
unsupported-version diagnostic and fails closed: no worktree, branch, binding,
dependency, or operation file is created, modified, or removed, and no binding
is ever migrated or fabricated.

Historical Session logs and pre-existing Workspace/Session registrations remain
independent and untouched. Cleaning safe Git resources never implies deleting or
reparenting the historical DSH Workspace/Session registry or history.

## Exact DSH runtime assumptions and upgrade review

This integration targets the **rc.7 DSH composition baseline** and the exact
installed contracts, not a generic or forward-compatible abstraction. The
audited checkout is mixed-version: `dsh-agent-loop`, subagent, and tool packages
are rc.7, while the installed `dsh-agent` and `dsh-system-prompt` packages are
rc.8. It assumes the tested contracts for model-visible local-path tools, Bash
`workdir`, file/search path arguments, child Agent creation/inheritance,
Agent-scoped pre-execution guards, Session lifecycle hooks, and deterministic
runtime-context projection/deduplication.

Continuable child Agents use the public transactional `setup(agentCtx)` seam,
which guarantees policy installation before publication and their first step.
For a bound Worktree Session, audited continuable `subagent` calls are allowed;
one-shot providers such as the current `subagent_fork` and `subagent_codex`
composition are denied because pre-first-step inheritance cannot be proven.
This plugin does not own top-level source Agent creation; recovery therefore
uses the currently synchronous `agent/session-start` seam (plus already-live
rescue) before prompt assembly. A future DSH API proxy that composes top-level
`create/resume({ setup })` should replace that compatibility seam when exposed.

The stable context contains only durable invariants: repository root, managed
worktree root, task branch, main-checkout prohibition, explicit-path rule, and
promote-before-dependency-mutation guidance. Branch status, dirty state,
timestamps, lifecycle phase, diagnostics, and lean/mutable mode belong in
metadata/UI or on-demand status output.

**Every DSH upgrade requires a fresh regression audit** of the installed tool
inventory and argument schemas (the tool contract), child-context propagation,
Agent/Session lifecycle seams, and runtime-context projection/deduplication.
Unknown or drifted local-capability contracts must be treated as unsupported
until reviewed and covered by tests; do not assume a newer DSH preserves rc.7
behavior.

## Attribution

Implementation and interaction concepts were adapted from the MIT project
[`LaoYueHanNi/dsh-git-worktree`](https://github.com/LaoYueHanNi/dsh-git-worktree).
See `NOTICE` for the reviewed commit, license grant, and exact adaptation scope.
This package has no runtime dependency on that project.

## Deferred backlog

Not implemented in the MVP: `/ws setup`, repository-local config/trust,
general pnpm/Rush adapters, an explicit network ref refresh, and provider-backed
squash-merge proof. These are intentionally not exposed as commands.
