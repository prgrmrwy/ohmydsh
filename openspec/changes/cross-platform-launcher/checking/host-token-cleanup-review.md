# Host preparation token cleanup review

## Scope

Follow-up to accepted D8 ownership/explicit-env contracts. Inspected the shared caller, lock helper, supervisor, publication helper, npm script policy and exact-version cache validation. This is a focused repair review, not the missing whole-change final acceptance. No new script grant, dependency install, Host start or desktop operation was needed for the repair tests.

## Findings and RED evidence

1. **Important: case-variant caller tokens remained in explicit child environment.** `prepareDeclaredHostRuntime` overlaid uppercase token without removing lowercase/mixed-case keys. Windows child environments are case insensitive; duplicate-key selection can suppress the newly owned token. Original code failed the new test with actual keys `[dsh_pet_compat_build_token, Dsh_Pet_Compat_Build_Token, DSH_PET_COMPAT_BUILD_TOKEN]`, expected only canonical owned key. Caller environment must not be mutated.
2. **Important: release exception bypassed prior-token restoration.** Existing finally called `lock.release()` then restored process.env. A throwing release skipped restoration. Fault injection called the real release then threw; original test observed undefined rather than `prior-token-to-restore`. The same control-flow defect also applies when filesystem cleanup itself throws. Errors remain visible; no forced removal/recovery is introduced.

Both focused tests were run before implementation and failed for the intended assertion, not import/syntax failure (`node --test --test-name-pattern='case-variant inherited|release reports failure' tests/dsh-host-runtime.test.mjs`,2tests/0pass/2fail).

## Minimal repair

Shared preparer removes all case variants from the copied child env before inserting its owned token. A nested finally restores prior process token even when release throws. No change to shared-lock lifetime, explicit token inheritance, physical generation, strict script policy, release failure propagation or unknown-entry preservation.

Fresh tests:

- Linux safety suites bash-592:23/23, zero skips;
- native Windows bash-593:22/22, zero skips (POSIX-only scenario not enumerated);
- isolated native macOS bash-596:23/23, zero skips;
- Linux whole root bash-595:597/595pass/0fail/2existing MCP skips.

Native candidate refreshes changed only the shared preparer and test after checking old exact SHA256. Windows helper no-install suites and Mac isolated home were used; no actual Host or UI was involved. Existing real build/Host acceptance predates this repair and is not falsely reported as rerun against these bytes.

## Focused verdict

PASS for the two token cleanup repairs. Whole-range final review, root zero-skip condition, ShellCheck and actual external PWA/tab integration remain separate. No commit/merge/archive/deployment/cleanup authorized or performed.
