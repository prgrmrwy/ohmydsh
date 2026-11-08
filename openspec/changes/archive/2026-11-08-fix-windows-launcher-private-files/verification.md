# Verification

## Scope and invariants

The dependency upgrade is semver 7.8.6 / tsdown 0.23.5 / Vitest 5.1.0 with its expected locked tool closure. The repair uses actual Windows SID/DACL creation and inspection for launcher patch/stop files and independently published Pet descriptors. Public descriptor fields, exported publisher signatures, authentication and freeze/drain/resume remain unchanged. Pet is 0.2.16 with the manifest and root lock aligned. No running deployment was altered.

## Local verification

- Node 24.22.1 / npm 12.2.1: clean `npm ci`; all initial workspace builds and typechecks passed.
- Launcher/private-file/lifecycle/package-manager/test-driver selection: 101 tests passed with inherited DSH profile/session variables cleared from the test subprocess. Original POSIX chmod, UID, symlink and missing-descriptor negatives remain active.
- Pet: full build including client-bundle verifier, typecheck and three focused state-machine/filesystem/real-launcher-contract files passed (24 tests). New filesystem tests cover unsafe existing modes, symlink/hardlink/size rejection, replacement-boot preservation and release-before-read checks.
- Built Pet and launcher fixed PowerShell source compared byte-for-byte equal. Both helpers ship independently without a repository runtime import.
- Manifest note/version checks: 7 tests passed; artifact policy, syntax checks, diff checks and strict OpenSpec change validation passed. The synchronized current spec validates normally. Full-spec strict mode reports the same three pre-existing long-requirement warnings as the original spec (requirements 2, 3 and 5); direct comparison confirms no new validation issue.
- Latest main was merged while retaining its new dependencies and this PR's tooling versions. Clean installation plus the updated sidebar workspace build/typecheck/test passed.
- Independent read-only security review found no actionable defect; native execution below supplied the required compatibility evidence.

## Native and full CI

[Actions run 42456963805](https://github.com/prgrmrwy/ohmydsh/actions/runs/42456963805) verified implementation head `d4635828eda164ae9a1cabe53ed7cfdef84e5c1a`. All eight checks passed: recommended/latest Node 24 on Linux, macOS and native Windows, ShellCheck and tracked artifact policy.

The Windows lanes used recommended Node 24.20.0 / npm 11.19.0 and latest Node 24.22.2 / npm 11.19.1. Each ran 104 tests: 103 passed, zero failed, one pre-existing skip. The logs explicitly show:

- Both noPet and independently initialized Pet publish a private descriptor that the launcher reads through its authenticated prepare/status/resume flow.
- Real Everyone/AuthenticatedUsers explicit/inherited read ACEs and run write/delete/ChangePermissions ACEs are rejected before HTTP authentication or stop actions, with ACLs unchanged. Unsafe publication is rejected and best-effort cleanup leaves the file untouched.
- Safe inherited ACLs are accepted; junction targets remain untouched; a missing permission tool fails without creating a directory.
- Unicode/metacharacter patch paths, replacement-boot retention and existing native lifecycle/ownership contracts pass.

The final native fixture uses actual .NET ACL mutation/snapshot APIs rather than PowerShell Security module autoload, and changes the helper lookup only after its isolated Node child starts. This preserves every negative assertion without increasing default timeouts. One artifact job remained alive after npm printed its completed-install summary; cancellation and a single targeted rerun restored the original check without policy or code changes.

## Specification and boundaries

The three private-filesystem requirements are synchronized into the current cross-platform-launcher specification and this completed change is archived. The subsequent documentation-only revision is subject to the PR's normal CI before merge.

Existing unsafe Windows ACLs are refused, not automatically tightened. These checks establish the private-file repair and selected native launcher contracts; they do not establish complete default-public-manifest Windows build×2/dump/isolated-Host acceptance. No deployed Host was started, stopped or restarted, and no raw session/log artifacts or credentials are committed.
