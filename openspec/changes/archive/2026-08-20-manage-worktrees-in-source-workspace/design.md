## Context

See `proposal.md` for motivation and `specs/source-workspace-worktree-session/spec.md` for observable behavior. The existing package already owns a Client submit decorator, Host HTTP routes, recoverable Git/dependency/environment operations, durable handoff state, and safe status/promote/clean maintenance. Its current successful path calls `workspaces.create(worktreePath)`, `connectWorkspace`, copies the draft, and submits in a target Session whose immutable cwd equals the worktree.

DSH rc.7 deliberately ties Workspace membership to exact canonical `Session.header.cwd == Workspace.path`; changing that invariant or moving an existing Session to another cwd is not a public operation. However, the worktree is under the source Workspace (`<repo>/.worktrees/<slug>`), and the agent runtime exposes per-Agent scoped prompt context and tool execution policy. Dynamic runtime context is projected durably only when its fully rendered text differs from the retained snapshot, so a stable contribution does not append once per turn.

The design therefore separates three roots:

```text
source Workspace / immutable Session cwd:  <repo>
Git task checkout / managed execution root: <repo>/.worktrees/<slug>
Git common dir / durable operation state:    <git-common-dir>/ws/operations
```

The Session remains accounted under `<repo>` while Worktree Session policy treats the managed execution root as the only normal local-tool target.

## Goals / Non-Goals

**Goals:**

- Preserve one DSH Workspace per source repository for all newly created Worktree Sessions.
- Keep the existing recoverable Git, lean/mutable, environment, exactly-once admission, promote and clean safety properties.
- Make a Session binding durable, restart-safe and enforceable beyond a one-time natural-language reminder.
- Keep the model request prefix stable by separating immutable execution invariants from dynamic operation/UI state.
- Preserve old independent Workspace/Session records without destructive migration.

**Non-Goals:**

- Mutating `Session.header.cwd`, weakening DSH Workspace membership invariants, or adding a repository-group concept to DSH core.
- Transparently rewriting every tool argument or pretending the immutable Session cwd changed.
- Allowing arbitrary local paths merely because they are children of the source Workspace.
- Automatically migrating old target Sessions into source Workspaces or copying historical logs.
- Adding pnpm/Rush/generic repository adapters, remote fetch behavior, or squash-merge proof in this change.

## Decisions

### D1: Replace cross-Workspace handoff with an in-place submit transaction

The Client keeps decorating the source blank Session's `SessionInput.submit`, but the success path becomes:

```text
snapshot draft
  → start/replay Host operation
  → bind-source(operationId, sourceSessionId)
  → install/confirm Host scoped policy
  → durable claim-submit(sourceSessionId)
  → call the source facade's original submit once
  → observe source Session admission
  → mark admitted or uncertain
```

No successful new-flow code calls `workspaces.create`, `connectWorkspace`, `sessions.open`, or transfers draft/images. The source input remains untouched until preparation and binding succeed. The operation claim keeps the existing fail-closed rule: a claimed but unconfirmed submission is `uncertain` and is never automatically submitted again.

The source Session must still be blank when binding is committed. `bind-source` verifies the request's source Session exists, its canonical cwd equals the operation repo root, and no other active operation owns it. The Host, not Client state, is authoritative.

**Alternatives considered:**

- Keep the independent Workspace and only rename/sort it: preserves native cwd but does not solve archival ownership or top-level project proliferation.
- Change an existing Session cwd: no public rc.7 operation and would invalidate persistence, sandbox and Workspace accounting invariants.
- Remove the submit claim because no draft transfer remains: rejected because Host/Client crash boundaries can still otherwise double-submit a retry.

### D2: Version operation records and model source binding as durable state

Operation metadata advances to a versioned shape that can read schema v1 and write schema v2. New records add a binding discriminator rather than overloading the old target handoff:

```ts
type SessionBinding =
  | {
      mode: 'source-session'
      sourceSessionId: string
      state: 'bound' | 'submit-claimed' | 'admitted' | 'uncertain' | 'cleaned'
      updatedAt: string
    }
  | {
      mode: 'target-session-v1'
      targetSessionId: string
      state: 'target-bound' | 'submit-claimed' | 'admitted' | 'uncertain'
      updatedAt: string
    }
```

The exact serialized shape may keep the legacy `handoff` field for compatibility, but parsing and behavior must distinguish the two modes explicitly. A repository-level lookup index is optional; correctness must not depend on it. Atomic operation files remain the source of truth, and all binding transitions occur under the existing repository lock.

On `agent/session-start`, the Host resolves an active source-session binding by Session id, revalidates the operation facts, and installs scoped policy before the first prompt assembly. A newly bound already-live Agent receives the same installation synchronously before the Client is allowed to claim submission. Registration is idempotent per exact live Agent and is disposed with its Agent scope.

**Alternatives considered:**

- Client-local mapping only: lost on refresh/restart and unavailable to Host tools/guards.
- Put mapping in Session title or message text: not authoritative, user-editable and unsuitable for locking.
- Rewrite all v1 files eagerly: risks damaging existing target Workspace history; lazy compatible reads are safer.

### D3: Use one stable runtime-context snapshot, not a changing system prompt

Each active source-session binding registers one Agent-scoped runtime context with deterministic text derived only from:

- canonical source repository path;
- canonical managed worktree path;
- immutable task branch;
- the rules to use explicit worktree paths/workdirs, avoid the main checkout, and promote before dependency mutation.

It deliberately excludes operation phase, `updatedAt`, current HEAD, dirty status, diagnostics, dependency mode and other changing values. Ordering and whitespace are fixed so restart produces byte-identical text. DSH's retained runtime-context projection then appends it on first binding, emits nothing while unchanged, and reprojects only when the prior snapshot has left the active surface after clear/compaction.

A cleaned binding contributes a distinct stable terminal snapshot only when that historical Session is live again. It states that the old path no longer exists and local execution is denied; it does not stream maintenance changes.

Dynamic data lives elsewhere:

```text
operation JSON: authoritative phase/mode/fingerprint
Web status:      branch + lean/mutable + lifecycle badge
/ws status:      on-demand detailed report
model history:   stable binding invariant only
```

**Alternatives considered:**

- Agent-scoped system-prompt section: stable within one Session but moves per-task paths into the system prefix and reduces cross-Session prefix sharing.
- Update context on every lean/mutable/dirty transition: unnecessary history churn and cache disruption.
- One-time ordinary user message only: survives history but is harder to restore safely after context replacement and has no named runtime provenance.

### D4: Add scoped fail-closed tool policy using an audited rc.7 tool contract

Natural-language context guides the model; enforcement uses the Agent scope. The Host injects `agents`, `tools` and `systemPrompt`, then installs policy through the bound live Agent's `agent.ctx`.

Policy classifies the rc.7 tool surface:

1. **Path-bearing local tools** (`bash`, read/write/edit, glob/grep and other audited filesystem tools): normalize every relevant path. Bash must provide a workdir inside the managed root. Relative file/search arguments are interpreted against the immutable Session cwd by native tools, so they are rejected; the Agent must retry with an absolute managed-root path. For a not-yet-existing write target, canonicalize the nearest existing ancestor and verify the lexical remainder cannot escape. Symlinked ancestors are resolved before containment.
2. **Local execution creators** (subagent/fork/background mechanisms): propagate the same binding into the child Agent scope using the supported Agent/subagent lifecycle seam. If a provider cannot be proven to inherit the binding before its first step, the parent call is denied rather than allowing execution with the source cwd.
3. **Explicit maintenance tools** owned by Worktree Session: resolve the target from the calling Session binding and apply their existing operation-specific checks.
4. **Non-local tools** (web, messaging, image generation, goal state, etc.): remain unaffected unless their audited schema contains a local path/execution capability.
5. **Unknown or schema-drifted local-capability tools**: fail closed for a bound Session and emit a diagnostic that identifies the unsupported tool contract.

The implementation maintains a tested table of tool names and path fields for the pinned DSH rc.7 surface. Guards do not silently rewrite frozen arguments. Existing sandbox/approval policy still runs independently; Worktree policy can only add denial, never grant access.

**Alternatives considered:**

- Trust instructions as `sw` does: simpler but one omitted `workdir` can mutate the main checkout.
- Silently rewrite tool arguments: hides model mistakes, is incompatible with frozen arguments, and risks changing command meaning.
- Intercept only Bash: file mutation/search and delegated Agents would remain escape paths.

### D5: Resolve status and maintenance from the calling Session binding

The Host API adds a Session status lookup keyed by `{sessionId, repoPath}` with same-origin, strict-body and no-store protections. Client UI queries it after refresh and renders a compact badge for bound Sessions even after they are no longer blank. The base selector/toggle remains available only before binding.

`ws status` and `ws promote` prefer the calling Session identity supplied by the DSH tool execution context. The shell wrapper remains as a compatibility/debug entry and can still accept a path, but normal conversational use requires no path. Promote updates only metadata/UI; it does not alter stable runtime context.

Clean derives active protection from both native Session cwd values and source-session bindings. A live or executing Agent bound to the target worktree protects it even though its immutable cwd is the repo root. Clean marks the binding `cleaned` instead of deleting the operation file, preserving the minimal relation needed to explain a reopened historical Session. Secret values remain absent.

**Alternatives considered:**

- Delete operation metadata after clean: loses the only reliable historical association and cannot present safe terminal context.
- Treat every source Workspace Session as active for every worktree: safe but makes cleanup impractically broad.
- Continue requiring a filesystem path: contradicts the Session-oriented UX and invites targeting mistakes.

### D6: Preserve v1 Workspace/Session entities without automatic migration

Existing schema-v1 operations and their target Sessions remain in target-session mode. Status/promote/clean continue to accept their path-based records under current safety rules. The Client never creates new v1 target Workspaces after deployment, but it does not rename, detach, delete or reparent old ones.

This avoids an impossible faithful migration: DSH Workspace membership requires exact cwd, and deleting an old Workspace would place its Session in “未分组”. Users may clean old worktree resources when safe; their DSH registry/history remains untouched.

## Risks / Trade-offs

- [Immutable Session cwd still names the source repo] → Stable context states the managed root truthfully, all audited local tools fail closed outside it, and UI labels the Session as managed rather than claiming native cwd changed.
- [Tool schema/name drift can bypass or over-block policy] → Pin an explicit audited table, cover every installed local-capability tool in an inventory test, and fail closed on unknown local-capability contracts after DSH upgrades.
- [Symlink or non-existent output paths evade lexical containment] → Resolve real paths for existing ancestors, reject `..` escape, and reuse the same canonical containment utility across guards.
- [Subagent providers differ in lifecycle behavior] → Prove pre-first-step propagation in tests for built-in subagent paths; deny unsupported providers until an audited setup seam exists.
- [Runtime-context content changes accidentally and appends history] → Centralize deterministic rendering, snapshot-test exact bytes, and assert repeated turns/restart produce no new system-prompt-owned user event.
- [In-place submission is claimed but browser crashes before dispatch] → Preserve `uncertain`, keep the draft, navigate nowhere, and require user inspection/retry choice rather than automatic resubmission.
- [Cleaning an operation while its source Session is live] → Resolve active bound Session ids through the Host Agent/Session registries and refuse while execution or unarchived live use remains.
- [Operation files accumulate after clean] → Retain a compact cleaned tombstone needed for history; a future explicit history-retention policy may garbage-collect only after Session deletion is independently proven.
- [The source Workspace sandbox permits other descendants] → Worktree policy narrows normal tool execution to one managed subtree; it never relies on the broader sandbox permission as the isolation mechanism.

## Migration Plan

1. Add schema-v2 parsing/writing and source-session binding APIs while retaining all schema-v1 readers and maintenance behavior.
2. Implement deterministic context rendering, live-Agent installation/recovery and audited path policy behind tests before changing Client submission.
3. Change Client handoff to bind and submit in place; add persistent bound/cleaned status UI and remove new-flow Workspace/Session creation calls.
4. Update `ws` Skill and maintenance resolution to prefer calling Session identity, then exercise lean → mutable and safe clean in a real source Workspace.
5. Run package typecheck/tests/build, sync tests, isolated `DSH_HOME` composition and browser acceptance. Verify Workspace count does not increase and repeated turns do not append duplicate runtime-context events.
6. Enable through the existing package version/build path and ask the user to restart DSH; do not stop the active Host automatically.

Rollback disables the new source-session flow while preserving schema-v2 operation files. Compatible readers must continue to report and safely maintain already-created worktrees. Rollback MUST NOT recreate target Workspaces automatically or delete source Session history.
