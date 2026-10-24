# P2 command contract evidence

## Scope and frozen oracle

P1 task-1 froze before this work. Seven files were copied byte-for-byte into `tests/fixtures/launcher-bash-baseline/`: `bin/dsh`, `scripts/lib/dsh-runtime.sh`, and the five capability modules. These are a historical test oracle, not a second product branch. No product source or planning requirements were changed here.

The helper `tests/helpers/launcher-fixture.mjs` copies that oracle unchanged into a temporary path containing spaces and Unicode. Explicit subprocess entrypoints (sync, prerequisites, version check, plugin update, official CLI, Host resolution, inventory) are replaced with independent Node recorders. There is no production-source substitution. The Node recorder writes JSONL `{command,argv,cwd,env}`; env includes only selected fixture fields. Test tools refuse real npm/npx/pnpm/Corepack execution. All homes, config, manifests and logs are synthetic. Cleanup removes only the fixture-created root; this command suite launches no listening Host.

The historical Bash tool executables use POSIX Node shebangs. They are **not** native Windows fixtures. The later Node adapter must use real executables or test effects, not generate cmd/shell wrappers. The helper currently uses a dependency symlink/junction; it does not copy or read production local configuration.

## Public helper seam

- `createLauncherFixture(t,{scenario={},manifest}={})` returns `{root,repo,home,tools,userCwd,scenarioFile,logFile,env,run,bash,configure,read,write,exists}`.
- `run(argv,{env,cwd=userCwd,timeoutMs=5000}={})` invokes the real frozen Bash entrypoint.
- `bash(script,args=[],options={})` sets `REPO`, then sources/calls capabilities as specified by the atomic test script.
- Both return `{status,signal,stdout,stderr,error,calls}`. Calls retain individual argv, actual cwd and selected env.
- `configure(patch)` shallow-merges the test-only scenario JSON. `exit` maps recorder names to statuses; `update` supplies version-check JSON; `dirty` controls Git status; `portUp` controls the oracle nc tool. `resolveNoise` prepends unrelated installer stdout to Host metadata.
- Host metadata defaults: `scripts/runtime.mjs`, kind `fixture`, owner `fixture-owner`, compat `fixture-compat`, fingerprint `fixture-fingerprint`.

P3 should change only execution adaptation, preserving the command suite's observed call contract and assertions. The synthetic package-manager/process tools are not ownership or native-platform acceptance evidence.

## Mutation controls

`contract assertion rejects wrong route, argv, unexpected side effects and lost exit status mutations` checks four deliberately corrupted observations and requires each shared assertion to reject them.

`command contract catches a mutated sandbox subprocess rather than only a model result` replaces the isolated sync subprocess recorder with one reporting an unexpected Host action. The unchanged real launcher executes it; the normal shared command assertion rejects it. Production files and frozen oracle bytes remain untouched.

## Fresh GREEN baseline

Command (workdir: managed win worktree):

```sh
node --test --test-name-pattern='contract assertion|command contract catches|test_route_local|test_stop_is|history returns|reset preserves|command combinations|doctor failure|autoUpdate|already running|restart replacement|unknown arguments' tests/launcher-contract.test.mjs
```

Result: exit 0; **15 tests passed, 0 failed, 0 skipped, 0 todo**.

Covered existing semantics:

1. Mutation assertion battery and executed subprocess mutation control.
2. `test_route_local_and_official_commands`: build, doctor/check, plugin-update/dry-run/yes, plugin/profile and dump/patch forwarding; argv including spaces/Unicode/metacharacters; caller cwd/env; per-call registry; failure status propagation.
3. `test_stop_is_local_only`: no CLI resolution, installs, registry, build or Host action.
4. History last twenty lines, no subprocess actions.
5. Reset once, no auto-update, manifest unchanged.
6. Official detection and local command combination precedence.
7. Strict manual doctor failure versus best-effort automatic prerequisites and failure log.
8. Auto-update offline/dirty: no rewrite/commit, pin retained, build proceeds, events logged.
9. Successful upgrade: rewrite, sync and commit once; duplicate build omitted; backup retired.
10. Sync upgrade failure: manifest restored, no commit/Host.
11. Existing server reuse avoids update/resolution; explicit -b builds once.
12. Failed replacement preparation never enters stop or starts replacement.
13. Commit failure blocks subsequent prerequisites/Host, preserving upgraded manifest for manual action.
14. Unknown args and orphan --check already reject without command effects.

The positive test-name pattern is a **phase-only selection**, not final acceptance or permission to exclude unfinished scenarios. An earlier negative-lookahead name selection unexpectedly ran the RED parent too; it was not recorded as a GREEN baseline. A too-narrow diagnostic matcher initially rejected the already-correct orphan --check message; it was corrected to accept the explicit --check usage diagnostic before recording product RED evidence.

## Approved behavior RED

```sh
node --test --test-name-pattern='^test_invalid_arguments_have_no_effects$' tests/launcher-contract.test.mjs
```

Result: exit 1; 8 reported tests including parent; **2 pass, 6 fail, 0 skipped, 0 todo**. The parent fails because five child scenarios are RED:

| Input | Observed correct failure cause |
|---|---|
| `--unknown` | GREEN: bounded rejection and no subprocess effects |
| `--check` | GREEN: explicit doctor-only diagnostic and no effects |
| `--port` | RED: shell `$2: unbound variable`, not actionable required-value diagnostic |
| `--host` | RED: shell `$2: unbound variable`, not actionable required-value diagnostic |
| `--port=0` | RED: exit 0 rather than rejecting; maintenance/resolution/runtime recorders execute |
| `--port=65536` | RED: exit 0 rather than rejecting; maintenance/resolution/runtime recorders execute |
| `--port=not-a-number` | RED: exit 0 rather than rejecting; maintenance/resolution/runtime recorders execute |

These are ordinary registered tests: no skip, todo, environment switch or conditional registration. P3 must make the **same** assertions GREEN. This suite intentionally leaves the complete root test set RED during the migration; final acceptance must include it unfiltered.

## Integrity and review checks

`node --check tests/helpers/launcher-fixture.mjs` and `node --check tests/launcher-contract.test.mjs` passed. A Node byte comparison confirmed all seven frozen oracle files exactly match final P1 product bytes. `git diff --check` passed.

A TypeSafe Jev review of the change summary/test logs returned `escalate` (safe-to-apply 0.29, correctness confidence 0.10), without a concrete finding. This summary-only judgment is not code review approval; lead must inspect the actual fixture/test files before integration. No weakened assertions or changed product semantics were made in response.

## Boundaries

This is command/atomic observation, not a real-network lifecycle or process-ownership proof. It does not claim `test_same_contract_across_bash_and_node` passed: the Node adapter does not exist yet. No native Windows/macOS runs, link/unlink, terminal-close test, full public manifest build or production deploy/restart was performed for this task. Lead separately owns adapter integration and platform evidence. Global tasks/test-plan checkboxes remain lead-owned.
