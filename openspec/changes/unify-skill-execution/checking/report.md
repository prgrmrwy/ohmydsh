# Cross-platform skill execution — implementation review

## Scope and disposition

Executor whole-range review: main baseline `79cfc74b5242b1f7813c45a5eee55414dff478b7` through implementation `87072050ab5caa8da59b60875391ac939b84641b`. Scoped implementation review PASS; repository-wide regression is NOT all green. This is a local executor review, not independent review or a complete platform certification.

Archive replay preserves the owner's explicit warning acceptance and synchronizes the earlier launcher specs. Main had replaced old checking reports/drivers with a redacted summary and moved the active assertion to tests/helpers; conflict resolution preserves both decisions. No deleted operational driver or private evidence restored. Owner closure is folded into the allowed summary; historical111/169 and strict FAIL stay intact.

## Behavior reviewed

- ws and report helpers are builtins-only standalone Node files. Per-skill deployment does not require another skill or repo module. The previously existing ws.mjs PATH-only stub now shares shell wrapper fallback behavior.
- Discovery preserves PATH priority, memex deployed profiles and Git checkout fallback. Supported Windows npm shims resolve to a matching package's real contained JS bin; unknown layouts fail, no Shell evaluation or install. Native exe supported; POSIX executable PATH behavior preserved.
- Every variable command argument stays in a shell:false array; caller cwd/env inherited and failure status retained. ws helper does not authorize operations or alter guarded CLI semantics.
- Memex ignores hidden entries as prior Bash glob did, defaults to ordinary cards libraries, excludes eval-* with a count, and continues after individual failures. Explicit --lib/--lib= and help bypass enumeration. No production library queried by tests.
- Old sh files contain forwarding only. Skill docs use Node and native paths. Windows driver explicitly includes the new suite; its contract prevents omission.

No Critical/Important implementation finding remains in the reviewed scope. Discovery deliberately rejects unsupported shim-only layouts; this limitation is documented rather than hidden by Shell fallback. Package lookup is intentionally small and self-contained in each independently deployed skill.

## Verification

- Initial regression RED: memex Node entry absent and ws existing stub could not satisfy standalone fixture discovery. Failure captured before implementation; no backfilled historical RED.
- Linux focused final:8 helper contracts +1driver contract,9pass/0skip. Covers literal argv including empty/quotes/Unicode/metacharacters, caller cwd, nonzero propagation, profile and PATH precedence, checkout fallback, invalid package/unknown shim, missing CLI, multi-library continuation/eval/hidden exclusion and explicit lib/help.
- Native Windows final:8helper contracts +1driver contract, allpass/0skip. PATH reduced to Node and Git cmd directories; explicit Get-Command check found no bash/sh. Tests loaded directly with native Node (UNC test-glob parsing rejected an earlier --test invocation; that harness failure was not a product regression). No Windows source checkout/config changed.
- Linux final root:704tests/695pass/4fail/5skip. Four failures are unchanged historical notes-governance tests: retired target is absent from its referenced historical commit. The same failure existed in the first latest-main run before final test additions; test and disposition source are byte-identical to main. No source history, retention index, assertions or skips changed to obtain green. This remains a separate baseline defect, not a passing full regression.
- Strict unify-skill-execution and synchronized cross-platform-launcher spec validations pass. Artifact policy and git diff checks pass. Both sh forwarders pass bash -n.
- No macOS native rerun, no new production build/restart, no full new three-platform lifecycle claim. CI matrix is configured, not observed completing in this task.

## Delivery boundary

Only this batch's two helper surfaces are unified; arbitrary user shell commands and OS adapters retain their own contracts. Deployment to daily profiles requires the owner's later normal build. Existing worktree and Windows backups retained. New change remains active; no automatic zero-skip acceptance or archive is asserted. The initial baseline issue below was repaired by a parallel main branch and is superseded by the final integrated result. Controlled main fast-forward and normal push succeeded at `2916b92a`, including the prior owner-approved launcher archive and this helper batch. Production profile was not rebuilt; these are source changes awaiting the owner's normal deployment.

## Final integrated result (2026-10-30)

While delivery records were merging, parallel main commit `b0ebbb28` repaired the historical notes index. Controlled merge `b34bd2b9` retained both branches; every reviewed helper, driver and new contract file is byte-identical to the tested implementation. Task worktree then fast-forwarded to that main.

A fresh complete npm test on `b34bd2b9` succeeded: **704tests/699pass/0fail/5existing skips**, exit0. This supersedes the four initial baseline failures, without relabeling earlier runs. No test assertion was weakened by this helper change. Windows native8+1 focused results remain valid because those files are unchanged; no fresh macOS run or zero-skip whole-platform claim is implied.

## Native follow-up whole-range review (2026-10-30)

Owner-requested native full-flow acceptance is now complete on identical implementation `93f01405d434c0bf758dfe8a85f25b2f0ca69834`; the historical limits above describe earlier runs, not this result. Review base is recorded snapshot `6911c253`, covering both repair commits and all recommendation/driver/documentation changes, plus the final report/task/README status update. Main before integration is `4aa1f748`, whose tree is byte-identical to that baseline despite parallel merge history. No Critical/Important implementation finding remains after local whole-range review.

- Git cleanup changes only one argv-level configuration: core.longpaths=true for the existing guarded cache clean. Stamp invalidation/reuse, tracked files and error propagation remain intact. Real native Windows old/new regression is 5/6 then6/6, with local config explicitly false and unchanged.
- The model-display test glob normalizes filesystem separators, retains all four source contract files and all24 assertions. Actual Windows Vitest list changes from timeout to four expected files; all24 pass. Fingerprint already covers this config, so stale compiled generations are not silently reused.
- Node recommendation becomes24.20.0 after fresh24.12/24.20 ASCII/Unicode controls and full Windows execution. Engine floors and advisory-version semantics remain unchanged. No global Node/Git switch, script permission expansion or production fallback is introduced.
- All three isolated environments pass final-source bootstrap/repeat, prefix link/external-cwd invocation, full manifest build pair/no-change, doctor/dump, owned Host start/authenticated HTML+boot marker/restart with PID change/stop. Independent post-run audits confirm exact HEAD, clean tracked source, final-snapshot stage ordering, empty ports and removed scratch links. Native contracts118/118 on each; complete repository705/700pass/0fail/5existing skips.
- Early summary-only Jev review while Windows was incomplete returned low-confidence escalation without a concrete defect. It is retained as uncertainty, not treated as execution evidence or automatic approval. Local review uses actual source and the completed native evidence; terminal-close/desktop/full-plugin certification remains explicitly outside this conclusion.

See [the lightweight acceptance record](summary.md) for versions, actual earlier failures and remaining limits. No raw evidence restored, auto archive, worktree cleanup or daily profile deployment.
