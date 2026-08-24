## Context

See proposal.md — Why, for the motivation and failure mode.

Constraints that shape the approach:

- `packages/worktree-session/package.json` declares `"type": "module"`, `"bin": {"dsh-ws": "./lib/cli.js"}`, and `"engines": {"node": ">=22.19"}`.
- `src/cli.ts` exports `main(argv)` and is also the `bin` target, so entrypoint detection must distinguish "run as a program" from "imported for its export". `test/cli.test.ts` depends on importing `main` without side effects.
- npm materializes `bin` as a symlink (`node_modules/.bin/dsh-ws -> ../dsh-worktree-session/lib/cli.js`). Node resolves the ESM module specifier to the realpath, while `process.argv[1]` retains the symlink path, so the current `import.meta.url === pathToFileURL(process.argv[1]).href` guard is always false through `bin`.
- The same symlink shape exists in deployed profiles (`~/.dsh/profiles/web/node_modules/.bin/dsh-ws`), so this is not a workspace-only artifact.
- `skills/ws/scripts/ws.sh` prefers a `PATH` `dsh-ws` but otherwise execs `node <repo>/packages/worktree-session/lib/cli.js` directly. That fallback bypasses the symlink and is why the skill surface kept working while `bin` was dead — a masking effect the fix must not rely on.

Measured behavior of the current guard (probe, Node v24.12.0), where MATCH is the guard's value:

| Invocation | MATCH | Result today |
| --- | --- | --- |
| via `bin` symlink | `false` | silent exit 0 |
| via built-artifact realpath | `true` | runs |
| via relative path | `true` | runs |
| imported as module | `false` | correctly does not run |

## Goals / Non-Goals

**Goals:**

- Entrypoint detection that is correct for symlink, realpath, and relative invocations, and false on import.
- Make an entrypoint that cannot execute the requested command fail loudly rather than exit 0.
- Regression coverage at the process boundary, since in-process `main()` tests structurally cannot catch this class of defect.

**Non-Goals:**

- No change to maintenance logic, safety gates, output schema, or the `status`/`promote`/`clean` surface.
- No change to `skills/ws/SKILL.md`; its documented commands are correct and resolve against the skill base directory.
- Not adding new subcommands, `ws setup`, or config/trust surfaces (backlog per the skill's deferred list).

## Decisions

**Decision 1: use `import.meta.main`, with a realpath comparison as fallback.**

`import.meta.main` is the semantic answer to the exact question being asked and is symlink-correct by construction. It is available in Node `>=22.18.0` and `>=24.2.0` ([Node 24.2.0 release notes](https://raw.githubusercontent.com/nodejs/nodejs.org/refs/heads/main/apps/site/pages/en/blog/release/v24.2.0.md#1), [22.x backport](https://github.com/nodejs/node/pull/58693)), which the declared `engines: >=22.19` already guarantees. Probe results: `true` via symlink, `false` on import.

A `typeof import.meta.main === 'boolean'` check guards the fallback so the module cannot become unrunnable on an unexpectedly old runtime.

Alternatives considered:

- *Realpath comparison alone* (`import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href`). Verified correct in all four probe cases above. Kept as the fallback rather than the primary because it restates a runtime invariant that Node now answers directly, and needs its own `try/catch` for a missing or unresolvable `argv[1]`.
- *`--preserve-symlinks-main`*. Rejected: it would make the existing guard match, but it is an invocation-site flag that neither npm's `bin` shim nor an operator typing `dsh-ws` will pass. Verified: with the flag the CLI exits 1 rather than running correctly.
- *A separate thin `bin/dsh-ws.js` that imports and calls `main`.* Rejected as unnecessary indirection plus a second artifact to keep in sync; it would also change the published `bin` target and require re-verifying deployment symlinks.

**Decision 2: an unknown subcommand must exit non-zero.**

Currently an unknown command makes `result === undefined`, which throws the `Usage:` error and is reported through `wireError` — that path is already non-zero and should be preserved. The new requirement is that *no* path may combine "did not execute the safety checks" with exit code 0. This mainly means the entrypoint guard must not be able to fall through to a silent success, which Decision 1 establishes.

**Decision 3: test by spawning a symlink, not by calling `main()`.**

The regression test creates a symlink pointing at the built `lib/cli.js`, spawns it as a child process, and asserts on stdout JSON and exit code. It must fail against the current implementation and pass after the fix. A test that calls `main()` directly would pass both before and after and is therefore worthless for this defect. The test also asserts that importing the module produces no stdout, locking in the non-side-effecting import contract.

The test depends on build output existing, so it must resolve the built artifact and skip with an explicit message — never silently pass — if `lib/cli.js` is absent.

## Risks / Trade-offs

- **The fix is in a safety-critical CLI whose checks were previously being skipped entirely** → After the fix, invocations that used to be silent no-ops will start doing real work, including refusals. This is the intended correction, but it means previously "clean-looking" operator runs were never validated; re-run any relied-upon `--dry-run` results.
- **`import.meta.main` is relatively new** → Guarded by a `typeof` check plus the realpath fallback, so behavior degrades to a verified-correct comparison instead of breaking.
- **Deployed profile symlinks carry the old build** → The fix is inert until rebuild plus `node scripts/sync.mjs`; verification must include re-running through `node_modules/.bin/dsh-ws`, not just the source path.
- **Spawn-based test is slower and depends on build output** → Scoped to a couple of cases and skips loudly rather than passing vacuously when the artifact is missing.

## Migration Plan

1. Fix the guard in `src/cli.ts`; add the spawn-based regression test.
2. Confirm the new test fails before the fix and passes after.
3. Rebuild the package, run its tests plus repo `npm test` and `npm run check:artifacts`.
4. Run `node scripts/sync.mjs` to materialize into `~/.dsh`, then confirm idempotence on a second run.
5. Verify `node_modules/.bin/dsh-ws status <path>` and the deployed profile binary both emit JSON.

Rollback: revert the `cli.ts` guard. No data, metadata, or Git resources are touched by this change, so rollback carries no cleanup.
