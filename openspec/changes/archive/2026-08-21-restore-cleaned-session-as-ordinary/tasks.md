## 1. Persisted lifecycle and lookup semantics

- [x] 1.1 Extend `packages/worktree-session/src/wire.ts` schema-v2 source binding parsing/types with explicit archive-lifecycle metadata and monotonic internal `cleaned-archived` / `released` terminal states while keeping `schemaVersion: 2` and the existing public lifecycle vocabulary.
- [x] 1.2 Update clean tombstone writing in `src/host/maintenance.ts` to stamp the new lifecycle marker atomically with `phase: cleaned` / binding cleanup, without changing Git cleanup actions or safety gates.
- [x] 1.3 Split `src/host/operation.ts` Session lookup into current-binding and historical/audit variants: released records remain loadable by operation id/path but are excluded from bind conflict, `sessionStatus`, recovery, no-path maintenance, and active ownership.
- [x] 1.4 Add repository-locked, idempotent transitions `cleaned → cleaned-archived → released` plus one-time reconciliation of legacy cleaned tombstones; reject regressions and leave unsupported schema versions untouched.

## 2. DSH archive transition integration

- [x] 2.1 Audit and pin the installed Workspace/storage-domain archive contract, add the required package injection/dependency declarations, and parse only post-durability `domain/changed` events for the `workspace` global singleton.
- [x] 2.2 Seed the previous `archivedSessionIds` set on Host startup and process membership diffs: archive marks matching cleaned bindings observed; unarchive releases only bindings with proven prior archive observation.
- [x] 2.3 Resolve affected Session repository ownership through retained Workspace/Session headers, avoiding archive-manager imports, package-name checks, custom unarchive routes, and repository-wide scans on unrelated updates.
- [x] 2.4 Run the same locked reconciliation from startup/session recovery and status as a race-safe fallback, including migration of already-unarchived legacy cleaned tombstones such as the reported Session.

## 3. Live policy and Client teardown

- [x] 3.1 Make `rememberBind(..., undefined)` / release teardown fully symmetric in `src/host/policy.ts` and `src/host/context.ts`: remove survey ownership, dispose the live Agent guard, and unregister the named Worktree runtime-context contribution after durable release.
- [x] 3.2 Update synchronous Agent recovery and Host status handling so released history never installs cleaned context/guard or returns `bound: true`, including after Host restart and repeated archive/unarchive events.
- [x] 3.3 Update `src/client/controls.tsx` and `stage-store.ts` so an authoritative `bound: false` response clears stale persisted Worktree stage/lifecycle data for the exact Session/cwd.
- [x] 3.4 Verify a released non-blank Session renders and submits as ordinary without showing Worktree controls, arming submit decoration, creating a branch/worktree/operation, or adding a `ws start` action.

## 4. Tests and compatibility

- [x] 4.1 Add operation/maintenance tests for new tombstone markers, monotonic archive/release transitions, current-vs-history lookup behavior, schema-v2 round-trip, and unchanged unsupported-version fail-closed behavior.
- [x] 4.2 Add Host integration tests for fresh `clean → archive → unarchive`, no release on clean alone, repeated events, Host restart races, archived retention, and the one-time legacy cleaned/unarchived migration.
- [x] 4.3 Add real ToolRuntime/context tests proving release removes the cleaned deny-all guard, causes the standard runtime-context cleared projection, and never resurrects old policy after reopen/restart.
- [x] 4.4 Add Client tests proving stale `cleaned` localStorage is cleared by `bound: false`, the badge disappears, ordinary non-blank UI remains, and no Worktree start/decorator path becomes reachable.
- [x] 4.5 Assert Git worktree/branch inventories and DSH Workspace/Session/operation counts are unchanged by unarchive release; the cleaned audit tombstone remains and re-archive/unarchive is idempotent.

## 5. Documentation, build, and acceptance

- [x] 5.1 Update `packages/worktree-session/README.md`, `skills/ws/SKILL.md`, and `worktree-session-architecture.md` to document automatic cleaned→ordinary conversion on unarchive and the continued absence of non-blank `ws start`.
- [x] 5.2 Run strict OpenSpec validation, package typecheck/full Vitest suite, build generated `lib` artifacts, and `git diff --check`.
- [x] 5.3 Run `node scripts/sync.mjs` twice, require the second run to report deployment-manifest idempotence, and verify the deployed Host/client bundle contains the release lifecycle behavior.
- [x] 5.4 Restart the existing DSH Host and perform browser acceptance at `http://127.0.0.1:3080`: the reported already-unarchived cleaned Session becomes ordinary, a fresh cleaned Session stays cleaned until archive→unarchive, and release creates no Git/DSH resources.
