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

Only this batch's two helper surfaces are unified; arbitrary user shell commands and OS adapters retain their own contracts. Deployment to daily profiles requires the owner's later normal build. Existing worktree and Windows backups retained. New change remains active with the disclosed root baseline issue; no automatic zero-skip acceptance or archive is asserted.
