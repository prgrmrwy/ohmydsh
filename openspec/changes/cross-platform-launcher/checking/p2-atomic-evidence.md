# P2 Bash atomic capability evidence

Scope: tests only against the frozen P1 Bash oracle through the shared fixture. No production implementation, snapshot, manifest, lock, or shared helper edits were made by the atomic-test task. Baseline platform: Linux/POSIX Bash; this is not native Windows or macOS lifecycle acceptance.

## Method

`tests/launcher-atomic.test.mjs` uses `createLauncherFixture` from `tests/helpers/launcher-fixture.mjs`. Each test sources the unchanged frozen environment/args/runtime-server/UI/maintenance modules and explicitly calls functions under `set -euo pipefail`. Independent Node subprocess recorders observe argv/env/cwd/exit status; filesystem observations read only fixture-owned paths. Test-only Bash function replacements model ownership/query/UI effects, without changing production source text or adding product environment seams. No real Host, network, npm install, production home, or real local configuration is used.

Negative controls run the same observations against deliberately wrong test-only functions: missing npm stripping leaks six npm variables; wrong parser loses port/host boundaries; wrong UI policy opens despite no-open. Every deliberately incorrect observation is rejected by the corresponding assertion. P1 source-only mutation coverage remains in `tests/launcher-modules.test.mjs`.

The first atomic execution failed one observer assertion: `wait_for_port` deliberately redirects nc stdout/stderr to `/dev/null`, so a stdout probe could not see polling calls. Root cause was the observation channel, not launcher behavior. Replacing that test-only observer with an append to a fixture-owned file exposes three probe/sleep pairs without changing production code or expected polling budget. Subsequent complete atomic runs pass.

## Exact runs

1. `node --test tests/launcher-atomic.test.mjs` after the initial sixteen cases: **15 passed / 1 failed** (the redirected-readiness-observer issue above).
2. Same command after observer correction: **16 passed / 0 failed**.
3. `node --test tests/launcher-atomic.test.mjs && git diff --check` after full coverage: **21 passed / 0 failed / 0 skipped**, exit 0, approximately 0.94 s.
4. `node --test tests/launcher-atomic.test.mjs tests/launcher-contract.test.mjs tests/launcher-modules.test.mjs && git diff --check`: **48 tests / 42 passed / 6 failed**, exit 1. All 21 atomic and all 4 module tests passed. The six failures are the command contract's explicitly new `test_invalid_arguments_have_no_effects` parent plus five child failures: missing `--port` and `--host` produce unbound-variable messages rather than actionable parameter diagnostics; ports `0`, `65536`, and `not-a-number` are accepted. These remain genuine P3 RED cases, not baseline regressions and not skips.
5. `node --test tests/launcher-atomic.test.mjs tests/launcher-modules.test.mjs`: **25 passed / 0 failed / 0 skipped**, exit 0, approximately 0.92 s. A subsequent attempted command-suite negative-name filter did not exclude the RED parent and re-observed the same five child failures; no passing command-suite claim is based on that filter.

Lead independently reported atomic **21/21** passing. Root-wide tests and platform acceptance remain separately lead-owned.

## Atomic tests frozen GREEN

| Test | Observable contract |
| --- | --- |
| atomic args preserve defaults, consumed web alias, port and host argument boundaries | Consumed launcher flags do not enter passthrough; metacharacter host remains one argv |
| atomic official invocation detector distinguishes plugin-update and preserves top-level priority | Official-only options take priority; plugin-update remains local |
| atomic unknown arguments and orphan check reject before command effects | Both old rejection cases exit 1 with no calls |
| atomic registry injection is one-call only and explicit caller registry wins | Repo registry applies to one child only; explicit registry survives |
| atomic npm strip observer detects leaked variables and ignores ordinary environment | Six implicit npm variables removed; ordinary environment retained; mutant rejected |
| atomic runtime preparation accepts tagged metadata after installer noise | Exactly one resolver call; exact last-tagged bin and four metadata fields |
| atomic runtime resolver failure is nonzero and does not start a Host | Nonzero resolver rejects preparation before Host dispatch |
| atomic stop cleans UI independently for every server outcome and never provisions | Return statuses 0..4; PWA then tabs independently cleaned; no external provision |
| atomic readiness polling has a finite budget and detects owned child early exit | Three attempts mean three checks/sleeps; vanished child returns 2 before probe |
| atomic restart refuses a still-busy port after successful stop | Stop precedes release check; busy port exits nonzero |
| atomic UI no-open beats open and manifest without calling an opener | no-open > open > manifest, with expected manifest call count |
| atomic PWA discovery accepts one installed app and rejects ambiguity | One app selected, multiple matches yield no selection |
| atomic history returns only the last twenty records | Exact records 6..25, no calls |
| atomic prerequisite failure is warned and logged but never blocks caller | Exit 19 recorded; doctor guidance; caller continues |
| atomic autoupdate disabled, offline, dirty, and clean-update branches stay distinct | Disabled no mutation; offline warns; dirty skips; clean invokes upgrade |
| atomic autoupgrade sync failure restores manifest and never commits | Original bytes restored, backup removed, no git/Host call |
| atomic autoupgrade success preserves rewrite sync commit event ordering | rewrite → sync → git add → git commit, exact argv/event and once-updated marker |
| atomic autoupgrade commit failure exits without claiming update or logging success | Nonzero, changed manifest retained, no false success event |
| atomic opener URL stays loopback and suppressed UI has no opener effect | host/trusted-host never enter URL; suppressed opener count zero |
| atomic argument and UI observers reject deliberately broken test-only functions | Parser and policy mutations rejected by observations |
| atomic autoupdate parser does not evaluate shell metacharacters in JSON fields | Dollar/backtick/quote/backslash payload remains data |

## Frozen dispatch and side-effect order

Observed product dispatch priority, also covered by the shared command suite: environment setup → official CLI detection (any official-only option or first positional `plugin`) → local parse/check validation → stop → history → doctor → reset → plugin-update → preflight for build/-b/restart/cold-start → build-only → optional build → restart → reuse existing Host or start once. Thus `build -b restart` is build-only; `stop --profile web` is official passthrough. no-open beats open; explicit caller DSH_BIN survives file normalization.

Preflight is autoUpdate first, then nonblocking prerequisites. Runtime replacement preparation precedes restart stop (a healthy Host is retained if preparation fails). Stop itself never resolves or provisions. Upgrade ordering is rewrite/backup → sync → commit → event; sync failure restores bytes and exits, commit failure exits with upgraded manifest retained. Tagged runtime output is not confused with installer chatter. npm registry injection is scoped to individual launcher commands; implicit npm environment is stripped before Host spawn.

## Explicit boundaries for P3

Do not turn defects into compatibility promises: strict non-executable configuration, actionable missing-value errors, port validation, foreground failure propagation, ownership-first start, case-insensitive npm cleanup, non-macOS browser cleanup restrictions, and truthful opener-failure reporting remain approved changes requiring their own RED→GREEN evidence. Tests here avoid asserting the defective behavior as desired behavior. The current startup spec's stop-before-resolve sentence differs from both baseline and reviewed delta/design; P1/P2 preserve preparation-before-stop and record the discrepancy rather than modifying planning artifacts.

Future Node tests must preserve these observations/assertions and replace the capability execution adapter. The existing function-call adapter is Bash-specific; it is not itself evidence that a Node adapter already exists. Frozen Bash is an oracle during migration, not a second supported product path.
