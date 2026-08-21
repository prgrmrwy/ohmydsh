## Context

See `proposal.md` for motivation. The current schema-v2 operation uses one `source-session` binding whose terminal state is `cleaned`. Clean removes Git/runtime resources but deliberately retains the operation file; `sessionStatus`, synchronous `agent/session-start` recovery, stable runtime context, and the tool guard all rediscover that tombstone by `sourceSessionId`.

DSH archive state is independent: `WorkspaceRegistry.archivedSessionIds` is a durable global visibility set. The installed archive manager only removes an id from that set; it does not replace the Session or notify Worktree Session directly. The DSH storage-domain contract emits ordered, post-durability `domain/changed` events for Workspace global-state writes, and archived Sessions retain their Workspace accounting slot. These are sufficient to observe archive transitions without depending on a particular archive UI plugin.

A simple predicate such as `cleaned && !currentlyArchived` is insufficient for newly cleaned operations: a Session can be cleaned before the user archives it, and must continue to show the safe terminal `cleaned` state until a real archive → unarchive transition occurs.

## Goals / Non-Goals

**Goals:**

- Persist enough lifecycle state to distinguish newly cleaned, cleaned-and-archived, and released historical operations across Host restarts.
- Release a cleaned binding exactly once after archive → unarchive and immediately remove all current-binding effects from a live Agent.
- Preserve the operation file as audit history while excluding released operations from ownership, recovery, status, UI, and maintenance targeting by Session identity.
- Reconcile pre-change cleaned tombstones deterministically.

**Non-Goals:**

- Starting Worktree mode from a non-blank Session, adding a `ws start` action, or automatically creating a replacement worktree.
- Allowing a released non-blank Session to bind another Worktree operation.
- Changing archive-manager, DSH archive UI, Session identity, Workspace accounting, or Git cleanup gates.
- Deleting historical operation files or renumbering schema-v2.

## Decisions

### 1. Extend schema-v2 source binding with monotonic terminal states

The persisted source-session binding state becomes:

```text
bound → submit-claimed → admitted/uncertain → cleaned
                                               │
                                               ▼ archive observed
                                       cleaned-archived
                                               │
                                               ▼ unarchive observed
                                           released
```

`cleaned-archived` is rendered and guarded exactly like `cleaned`; it only records that the required archive edge occurred. `released` is terminal audit history, not a current binding. The operation remains `phase: cleaned`, because no Git/runtime resource is recreated and cleanup itself remains complete.

Wire-facing lifecycle/status continues to expose only the existing active/uncertain/cleaned vocabulary. A released record produces `bound: false`, so the Client clears persisted stage data and renders ordinary Session controls/behavior. The internal states do not become new UI badges.

Alternatives considered:

- Delete the operation file or sourceSessionId on release: loses audit identity and makes migration/debugging ambiguous.
- Release whenever a cleaned Session is currently unarchived: incorrectly releases a freshly cleaned Session before it has ever been archived.
- Add a separate mutable sidecar: creates two authorities and cross-file atomicity concerns; the existing repository lock and operation record already provide the correct durable transaction boundary.

### 2. Observe the DSH Workspace domain, not archive-manager

Worktree Session adds the official Workspace registry/storage-domain contracts to its audited Host composition. It seeds the previous `archivedSessionIds` snapshot at startup and listens for post-durability `domain/changed` events for the `workspace` global singleton. For each changed Session id:

- absent → present: under the repository operation lock, transition matching `cleaned` to `cleaned-archived`;
- present → absent: transition matching `cleaned-archived` to `released`;
- all other states: no-op.

The Session's retained Workspace membership/header resolves the repository to inspect. Repeated events and Host restarts are idempotent because states move only forward.

The unarchive HTTP request does not need a Worktree-specific endpoint or cross-plugin call. Any current or future UI that durably changes the official archive set gets identical behavior.

Alternatives considered:

- Patch or import `@tangzai/dsh-ui-archive-manager`: creates optional-plugin ordering/coupling and misses other unarchive implementations.
- Infer release only when the Client opens the Session: leaves durable state dependent on browser timing and can install a cleaned guard before release.

### 3. Reconcile at startup/status as a race-safe fallback

The domain observer is the primary edge detector. Startup reconciliation initializes each legacy/current cleaned operation against the current archive set:

- a pre-change cleaned tombstone with no archive-observation state and an archived Session becomes `cleaned-archived`;
- a pre-change cleaned tombstone with no archive-observation state and an unarchived Session becomes `released` (one-time compatibility rule for already-restored sessions such as the reported case);
- records written by the new version retain their explicit state and are never inferred backward.

Session status and synchronous recovery call the same reconciliation boundary before deciding whether a current binding exists. This closes ordering races where the user unarchives and opens immediately or the Host starts after the archive change was committed.

To distinguish a new-version `cleaned` record from a legacy record, cleanup writes an explicit archive-lifecycle version/marker at the same time as the cleaned tombstone. This avoids applying the legacy compatibility rule to freshly cleaned Sessions.

### 4. Separate current binding lookup from historical lookup

Current ownership lookup ignores `released`; audit/history lookup may still find it. All callers are classified explicitly:

- bind conflict, `sessionStatus`, Agent recovery, `ws` no-path maintenance, active-session protection, context/guard installation: current lookup only;
- migration, archive lifecycle reconciliation, diagnostics by operation id/path: historical lookup allowed.

This prevents a released tombstone from blocking ordinary UI or being resurrected after Host restart, while retaining explicit path/id diagnostics if ever needed.

### 5. Release live policy atomically after durable state

After saving `released`, Worktree Session removes the Session id from its in-memory binding survey, disposes the Agent's Worktree tool guard, and unregisters the named runtime-context contribution. On the next model step, AgentLoop's existing runtime-context projection emits its standard cleared snapshot, making earlier Worktree snapshots non-authoritative.

The release helper must be symmetric for `operation` and `undefined`; the current `rememberBind(undefined)` only deletes the survey entry and is insufficient because it leaves live guard/context registrations installed.

Durability happens first. If live teardown fails, recovery sees `released` and retries teardown rather than restoring the cleaned guard. Release never grants a new Worktree root; it only returns the Session to ordinary source-Workspace policy.

### 6. Client treats an unbound response as authoritative

When `sessionStatus` returns `bound: false`, the Client resets any local persisted Worktree stage for that exact Session/cwd before applying ordinary blank/non-blank rendering rules. This is required because localStorage can retain `lifecycle: cleaned` from before release.

A restored Session is non-blank, so after reset it shows no Worktree startup controls and cannot arm the blank-only submit decorator. This preserves the explicit non-goal: no mid-Session Worktree start.

## Risks / Trade-offs

- [A pre-change cleaned, unarchived tombstone might never actually have been archived] → The one-time compatibility rule intentionally favors the requested post-upgrade ordinary behavior; it mutates only binding history and creates/deletes no Git or DSH entities.
- [Archive domain events race with Session opening] → Reconcile through the same locked helper from event handling, status, and synchronous recovery; states are monotonic and idempotent.
- [Released Session regains ordinary main-checkout capability] → Release occurs only after an explicit archive → unarchive user lifecycle (or documented legacy migration), clears the terminal context authoritatively, and never happens on clean alone in new records.
- [Workspace/storage-domain contract changes in a future DSH version] → Pin and test the exact domain name/schema/event shape; fail closed by retaining cleaned state if the transition cannot be proven.
- [Operation scan cost grows] → Resolve only Session ids whose archive membership changed and use their retained Workspace membership; do not rescan every repository on every ordinary status update.

## Migration Plan

1. Extend schema-v2 parsing with explicit archive-lifecycle metadata and monotonic `cleaned-archived`/`released` internal binding states; do not change `schemaVersion`.
2. Deploy current/historical lookup separation, release teardown, and Client unbound reset before enabling the archive observer.
3. Enable Workspace domain transition observation and startup/status/recovery reconciliation.
4. On first startup, migrate legacy cleaned tombstones under repository locks according to current archive membership. Existing active bindings and unsupported schema versions remain untouched.
5. Verify the reported already-unarchived Session becomes ordinary without Git/Workspace/Session creation, then exercise a fresh clean → archive → unarchive flow.

Rollback: old code may not parse the new internal states. Therefore rollback requires restoring the previous package and retaining operation files for forward recovery; released Sessions remain ordinary only on the new version. No Git resources need rollback because release creates or removes none.