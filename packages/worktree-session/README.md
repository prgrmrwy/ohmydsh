# dsh-worktree-session

Worktree Session (WS) stages a base ref on a blank Git-backed DSH Session and,
when enabled, turns the first ordinary submit into a recoverable transaction:
create a unique `ws/*` task branch and nested `.worktrees/*` checkout, prepare
lean npm dependencies and an isolated development `DSH_HOME`, register the path
as a DSH Workspace, move the draft, then submit exactly once in the target.

The main checkout is never switched or reset. Base selection and the default-off
Worktree toggle are side-effect free. Failures stay fail-closed: the source draft
is preserved and is not sent from the original checkout.

## Dependency modes

- `lean`: `node_modules` is a verified symlink to a cache addressed by
  `package-lock.json`, Node major and npm major. Run `ws promote` before any
  npm command that may mutate the install.
- `mutable`: a worktree-local `npm ci` has succeeded and metadata was updated.

## Operations

The `ws` skill and `dsh-ws` CLI expose:

```text
status [path]
promote [path]
clean [--dry-run] [path]
```

Clean refuses current, dirty, in-flight, or ordinary-merge-unproven worktrees.
It never deletes remote branches or shared npm caches.

## Recovery

Operation records live at `<git-common-dir>/ws/operations/<operationId>.json`.
Retry a failed first submit with Worktree still enabled to resume validated Host
phases. For an orphaned prepared operation, inspect it with `dsh-ws status
<worktree>`, preserve or commit useful work, then run `dsh-ws clean --dry-run
<worktree>`. Clean only after the task branch is an ancestor of its recorded
base ref and no DSH Session is using it. Invalid stale Git registrations may be
pruned; live registrations are never pruned automatically.

The managed `.env.local` block affects `bin/dsh build` executed inside the
worktree only. It does not change the already-running GUI Host's process home.

## Attribution

Implementation and interaction concepts were adapted from the MIT project
[`LaoYueHanNi/dsh-git-worktree`](https://github.com/LaoYueHanNi/dsh-git-worktree).
See `NOTICE` for the reviewed commit, license grant, and exact adaptation scope.
This package has no runtime dependency on that project.

## Deferred backlog

Not implemented in the MVP: `/ws setup`, repository-local config/trust,
general pnpm/Rush adapters, an explicit network ref refresh, and provider-backed
squash-merge proof. These are intentionally not exposed as commands.
