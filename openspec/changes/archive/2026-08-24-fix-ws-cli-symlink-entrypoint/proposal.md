## Why

The `dsh-ws` operator CLI is unreachable through its own published `bin` entry. `packages/worktree-session/src/cli.ts` decides whether it was invoked directly by comparing `import.meta.url` with `pathToFileURL(process.argv[1])`, but npm installs `bin` targets as symlinks: Node resolves the module specifier to the symlink's realpath while `process.argv[1]` keeps the symlink path. The two URLs never match, so `main()` never runs and the process exits 0 with no output.

This fails silently in the worst possible way for a safety-critical surface: an operator running `dsh-ws clean --dry-run <path>` sees success (exit 0, no diagnostic) while no containment, dirty-state, or merge-ancestry check has actually executed. Absence of a refusal is indistinguishable from a passed safety review.

## What Changes

- Fix the entrypoint detection in `packages/worktree-session/src/cli.ts` so `dsh-ws` runs its command when invoked through an npm `bin` symlink, a realpath, or a relative path.
- Preserve the existing import-as-a-module contract: importing `cli.js` for its exported `main` MUST NOT execute a command as a side effect.
- Add regression coverage that spawns the installed `bin` symlink as a real child process, asserting on stdout/exit code rather than calling `main()` in-process. Current `test/cli.test.ts` only exercises `main()` directly, which is exactly why this defect shipped undetected.
- Add a spec requirement that the operator CLI entrypoint must be executable through every documented invocation path, and that an unusable entrypoint must fail loudly instead of exiting 0 silently.

Not in scope: `skills/ws/SKILL.md` is correct as written. Its documented `scripts/ws.sh ...` commands resolve against the skill base directory, `skills/ws/scripts/ws.sh` exists, and that wrapper works — it prefers a `dsh-ws` on `PATH` and otherwise falls back to `node <repo>/packages/worktree-session/lib/cli.js`, which bypasses the symlink and therefore masks this bug.

## Capabilities

### New Capabilities

None. This corrects behavior that the existing capability already implies.

### Modified Capabilities

- `source-workspace-worktree-session`: add a requirement that the operator maintenance CLI (`status`/`promote`/`clean`) is reachable and executes its safety checks through its published `bin` entrypoint, and that a non-executing entrypoint MUST NOT report success.

## Impact

- Code: `packages/worktree-session/src/cli.ts` (entrypoint guard), `packages/worktree-session/test/` (new spawn-based regression test).
- Behavior: `dsh-ws` gains working `status`/`promote`/`clean` through `node_modules/.bin/dsh-ws`. No change to maintenance logic, safety gates, or output schema.
- Deployment: the built artifact is symlinked into profiles (`~/.dsh/profiles/web/node_modules/.bin/dsh-ws` reproduces the silent exit 0), so the fix requires a rebuild plus `node scripts/sync.mjs` to materialize.
- Risk: low and safety-improving — the defect can only cause a check to be skipped while appearing to pass; the fix makes those checks actually run.
