## Why

A cleaned Worktree Session keeps a durable source-session tombstone so that reopening historical context fails closed. Today, canceling that Session's archive status only restores its visibility: the same tombstone is recovered again, leaving the input bar in `cleaned` state and preventing the restored Session from behaving as an ordinary source-Workspace Session. The intended user lifecycle is simpler: once a cleaned historical Session is unarchived, it returns automatically as an ordinary Session.

## What Changes

- Treat the archive → unarchive transition of a cleaned source Session as an automatic release of its current Worktree Session binding.
- Preserve the cleaned operation as historical/audit metadata while marking its source-session relation released, so recovery, status UI, runtime context, and tool guards no longer treat it as a current binding.
- Restore the unarchived Session's ordinary source-Workspace behavior without creating a branch, worktree, Workspace, Session, or new operation.
- Handle cleaned tombstones created before this change so an already-unarchived cleaned Session becomes ordinary after upgrade/reopen.
- Keep archive visibility management independent of `@tangzai/dsh-ui-archive-manager`; Worktree Session observes the DSH Workspace registry contract rather than importing or naming a specific archive UI plugin.
- Keep Worktree Session startup restricted to blank Sessions. This change does not add `ws start`, non-blank startup, binding reuse, or automatic creation of a replacement worktree.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `source-workspace-worktree-session`: Change cleaned historical reopening so that an archived cleaned Session becomes an ordinary Session when unarchived, while retaining a released audit tombstone and preserving blank-only Worktree startup.

## Impact

- `packages/worktree-session` Host recovery, operation lookup/state, Workspace archive-state integration, Session status endpoint, Agent runtime policy teardown, and Client status hydration.
- Worktree Session operation metadata gains a terminal released-history representation compatible with existing schema-v2 cleaned tombstones; schema version remains 2.
- Tests and documentation for clean → archive → unarchive, Host restart/reopen, pre-change tombstone compatibility, no resource creation, and ordinary Session behavior.
- No change to the archive-manager package, Git branch/worktree creation flow, `ws` tool actions, or DSH Workspace/Session ownership.