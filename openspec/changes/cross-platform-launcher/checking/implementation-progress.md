# Implementation progress — cross-platform-launcher

## 2026-10-24 / Execution authorization

User authorized Agent Team implementation and a persisted goal toward acceptance. Goal `goal-eff9f41d-56a4-4d12-8ab8-85abb6ff2199` is active. No production deployment/restart, merge, or worktree cleanup authorized.

- `ws promote` succeeded for exact current binding, dependency mode mutable.
- `npm ci`: exit 0, 387 packages installed. npm reported 3 existing audit vulnerabilities (1 moderate, 2 high) and blocked an unapproved koffi install script; no audit fix or script approval performed.
- First restored `npm test`: 447 tests; 436 pass, 9 fail, 2 skip. Five failures import absent root dsh-openspec/lib outputs, four governance failures read old archive paths from unchanged Git index. Both are test preparation, not launcher regression. Existing CI builds dsh-openspec first; do the same locally. Stage only known archive/spec planning changes so index-based governance checks reflect the authorized rename; no commit.

## Ownership

- Lead: dependencies, global task/test ledger, package/lock, structural repo-facade/dsh-host-runtime-upgrade readers, root baseline and integration.
- launcher-refactor: P1 bin/dsh, temporary scripts/launcher/*.sh and authorized launcher tests. Preserve behavior, defer fixes to P3.
- contract-preflight: read-only P2 contract/subprocess closure preflight; no code writes until assigned.

## Baseline preparation resolved

- Root dsh-openspec build completed exit 0; authorized archive/planning paths staged (no commit). Second root run now passes all former 9 preparation failures: 450 tests, 445 pass, 3 fail, 2 skip. The 3 failures were the concurrently authored P1 source-only harness/module RED; teammate diagnosed trap quoting and reports its repair. This run is not an all-green P1 claim; re-run after extraction stabilizes.
- Existing two MCP integration skips require exact official bridge package, not a launcher skip. Final verification must report/run their integration prerequisite rather than hide them.
- Read-only preflight confirms CJS/ESM resolver must be synchronous and reusable from compat-run.cjs. Preserve bounded JSON wire and policy injection seam; resolver belongs at real execution boundary.

## P1 frozen regression

After teammate froze all P1 edits, root regression run with exact pre-existing suite plus module purity test (new P2/P3 files explicitly excluded only for this phase): 451 tests, 449 pass, 0 fail, 2 pre-existing MCP integration skips, exit 0. Launcher-focused final run 35/35. Structural facade/runtime-upgrade reader re-run 17/17. ShellCheck executable unavailable; bash -n passed. P1 code is frozen and P2 contract work started in disjoint test scopes. No source bug was repaired as part of extraction.

## P2 new-behavior RED evidence

Lead authored tests/launcher-env-local.test.mjs against existing parseEnvLocal optional strictLauncher API. Exact run `node --test tests/launcher-env-local.test.mjs`: 7 tests, 1 pass, 6 fail, exit 1. Failures are expected assertion “Missing expected exception”: existing compatibility parser returns problem entries/tolerates unrelated Shell syntax instead of full-file strict rejection. Double/single backslash positive values already agree; malformed trailing text is not yet thrown. No parser implementation changed during P1. These tests remain deliberately red until P3.

`node --test tests/package-manager.test.mjs`: 8 tests, 1 pass (real Node argv metacharacter oracle), 7 fail (shared resolver capability not yet present). Layout fixtures specify verified npm/npx beside Node, validated npm_execpath fallback, native pnpm.exe precedence, pnpm/Corepack JS, cmd/bat/ps1 refusal, sync CJS/ESM reuse. A bare missing-module failure is only initial evidence; repeat with skeleton resolver returning errors to prove each positive layout case fails for the expected behavior before implementing resolution.

`node --test tests/launcher-bootstrap.test.mjs`: 4 fail before Node bootstrap exists. Tests specify minimum/recommendation separation and builtin-only imports. Must supplement integration (no dependencies installed, repeat no install, failure no global link) and docs/wrapper missing-Node check before ledger green. New RED files are never final-suite exclusions.

## P3 integration results (Linux)

- Exact zx@8.8.5 installed after promote; registry metadata/version/license/integrity verified (Apache-2.0, Node>=12.17). Root lock diff adds only zx and reorders existing workspace link records; no floating update policy added.
- Shared strict/allowlist parser implementation: `node --test tests/launcher-env-local.test.mjs tests/sync-env-local.test.mjs` 18/18 GREEN, prior RED six expected exceptions resolved; bare caller-first compatibility remains.
- Shared command assertions switched via fixture execution adapter to runLauncher Node implementation; 23/23 GREEN including all approved argument validation RED. One fixture defect fixed narrowly: `exit.git=7` caused status query to fail too, but the test intended commit-only failure. New `gitCommitExit=7` gives that exact failure, assertions unchanged. Node fail-closed git-status handling is not weakened to mimic swallowed Bash status errors.
- Integrated resolver/bootstrap/process/UI/env/CLI suite 83/83 GREEN, zero skip/todo (`bash-163`). Includes real isolated POSIX listener identity/stop and shell-free Git values.
- New real isolated launcher lifecycle `node --test tests/launcher-lifecycle.test.mjs`: 4/4 GREEN, verifies background launcher returns while owned Host lives, repeat start no second record, foreign listener unaffected, early exit rejected, replacement prepare failure retains old PID, foreground exit9 propagated. Only fixture homes/ports touched; no production Host.
- Package-manager resolution now wired into lib/dsh-cli bounded execution and official CLI resolver; explicit managed JS uses current Node and POSIX caller executable remains direct. Teammate owns remaining sync/prereq/plugin/compat closure; not yet complete.

## Native Windows verification route discovered

Host exposes system powershell.exe plus native Node `C:\\nvm4w\\nodejs\\node.exe` v24.12.0 (`process.platform=win32`), npm11.6.2, Git `D:\\Software\\Git\\cmd\\git.exe`. Read-only discovery succeeded. npm invoked from the WSL UNC cwd warns CMD cannot use that cwd; real acceptance must copy the candidate into an isolated Windows-local temp directory, use native npm/node, sanitized PATH without Git Bash, isolated prefix/home and logs. Native discovery is not full test completion; console-close and full manifest gate still pending.

## P4 single entry and native evidence

- Product bin now root npm bin `bin/dsh.mjs`; old `bin/dsh` is a thin Node exec wrapper. Five temporary Bash modules + runtime shell helper removed after absolute-target validation; seven-file historical test oracle remains unchanged. Existing source-rewrite fixtures are explicitly historical, not claimed as Node coverage; current Node same-contract tests run separately.
- Linux full root `npm test` after switch: 563 tests, 561 pass, 0 fail, 2 pre-existing MCP integration skips, exit0 (`bash-206`). Node test driver replaces POSIX env-prefix syntax and preserves overlay-isolation tests.
- Native Windows (Node24.12/npm11.6/Git2.54, no bash/sh PATH): 54 targeted tests +4 real lifecycle tests passed, zero skip. Self-owned Unicode listener and bounded timeout parent/descendant reclaim passed. Native defect reproduced RED then fixed: PowerShell5 codepage corrupted Chinese process paths; fixed explicit UTF8 output, regression permanent.
- README pair and CI now distinguish launcher contracts from full-support gates; Windows targeted lane added, macOS/Linux full root lane retained. CI not remotely run.
- Self-review found missing post-sync autoUpdate worktree guard. New maintenance test RED (missing rejection) then guard checks status before commit; one command-call contract expected trace updated to include additional safety query (no weakened assertion). Follow-up 24/24 pass.
- Full public gate first attempts (isolated public snapshots, no production): Windows root npm ci fails local workspace `clean: rm -rf lib`; same-root Linux npm ci passes but build1 fails, initially log not exposed by runner. Both stopped before Host, no support claim. Task12 repairs shared local clean/copy/chmod lifecycle root cause with Node builtins; task11 collecting Linux first error from an explicitly approved diagnostic re-run with output tail. No unrelated manifest entries disabled.

## Phase gates

P1 extraction and all existing relevant assertions must pass before P2 baseline is frozen. P2 records same-contract assertions and approved new-behavior RED before P3 implementation. Final cross-platform rows remain red until the corresponding real platform tests execute; Linux unit tests are not Windows evidence.
