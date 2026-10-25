# Corporate macOS physical-path fix — fresh focused review

VERDICT: PASS

What this change does: Publication compares the physical destinations of symbolic links instead of comparing a logical link spelling with a physical path. Preparation tests expect physical runtime entries and observe the fingerprint read using the canonical generation path. These changes preserve the approved D8 physical-generation contract; they do not approve the whole platform or change.

## Scope and requirements

This review independently inspected the frozen current source, connected callers, and tests. The focus is the macOS `/var` versus `/private/var` alias failure and the corresponding test-path corrections, not a new whole-range D8 review. Product files were not edited.

Requirements read: [manifest](</home/prgrmr/opensource/ohmydsh/.worktrees/win/dsh.yaml>), [current runtime-provisioning spec](</home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/specs/dsh-runtime-provisioning/spec.md#L87-L104>), [proposal](</home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/proposal.md>), [approved D8 design and recovery states](</home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/design.md#L78-L99>), [D8 delta requirements](</home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/specs/cross-platform-launcher/spec.md#L119-L138>), and [D8 tasks](</home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/tasks.md#L204-L210>). Earlier review history was read after source inspection; its verdict was not substituted for fresh checks.

Assumed operating boundary: cooperating concurrent publishers/preparers under the shared lock, plus explicit filesystem failures and replacement-entry detection. This fix does not establish a security boundary against an unrestricted same-user process that can mutate arbitrary generations or parent paths. The remaining terminal ownership failure is outside this focused fix.

## Findings

No must-fix or should-fix issue found within the requested path repair.

### 1. Canonical destination equality is the correct narrow repair

[The publisher comparison](</home/prgrmr/opensource/ohmydsh/.worktrees/win/packages/dsh-pet/compat/subagent/compat-publish.cjs#L27-L31>) still obtains the entry with `lstat` and requires `isSymbolicLink()`. It then compares `io.realpathSync(file)` with `io.realpathSync(expected)`. Both operands are now in the same physical namespace. A logical parent alias is not misclassified as a changed backup simply because the original target was already canonicalized by [publication-state inspection](</home/prgrmr/opensource/ohmydsh/.worktrees/win/packages/dsh-pet/compat/subagent/compat-publish.cjs#L12-L18>).

Canonical equality proves destination agreement, not ownership. The distinct ownership checks remain necessary and remain present: [backup validation](</home/prgrmr/opensource/ohmydsh/.worktrees/win/packages/dsh-pet/compat/subagent/compat-publish.cjs#L31-L40>), [published-pointer rollback](</home/prgrmr/opensource/ohmydsh/.worktrees/win/packages/dsh-pet/compat/subagent/compat-publish.cjs#L60-L73>), and [staging-pointer cleanup](</home/prgrmr/opensource/ohmydsh/.worktrees/win/packages/dsh-pet/compat/subagent/compat-publish.cjs#L75-L80>) all still require the recorded non-following identity. A distinct same-target replacement is not newly accepted for deletion. Ordinary files/directories are not accepted as pointers; missing/dangling destinations still fail rather than silently passing.

The helper's only production publisher is [the compat builder](</home/prgrmr/opensource/ohmydsh/.worktrees/win/packages/dsh-pet/compat/subagent/build-launcher.cjs#L439-L446>), inside its acquired shared lock. [Verification](</home/prgrmr/opensource/ohmydsh/.worktrees/win/packages/dsh-pet/compat/subagent/build-launcher.cjs#L114-L197>) still checks policy, fingerprint, dependency identity/provenance and behavior before returning a physical entry. POSIX backup-before-atomic-replacement, Windows backup/publish/restore, residual refusal, aggregate recovery errors, and generation retention are unchanged. No recursive pointer/target deletion was introduced.

### 2. New alias regression detects the original defect without macOS

[The symlink-parent regression](</home/prgrmr/opensource/ohmydsh/.worktrees/win/tests/compat-launcher-publish.test.mjs#L30-L44>) creates distinct logical and physical parent spellings. Its injected verification failure must restore the old pointer and report only that original rejection, rather than an aggregate backup-comparison failure. It then verifies successful publication through the same alias. This reproduces the relevant namespace mismatch on Linux without pretending to be a native macOS execution.

Existing [same-target replacement regressions](</home/prgrmr/opensource/ohmydsh/.worktrees/win/tests/compat-launcher-publish.test.mjs#L75-L113>) still pass, as do unknown/dangling/residual refusal and failed-restoration preservation. They show that fixing destination equality did not remove the independent identity safeguards.

### 3. Canonical test expectations preserve the production physical-generation contract

[The preparer](</home/prgrmr/opensource/ohmydsh/.worktrees/win/scripts/lib/dsh-host-runtime.mjs#L119-L189>) returns `realBin`, holds its own lock through path/version/fingerprint selection, explicitly supplies the acquired token to the child environment, rejects caller-token inheritance, and restores the previous token in `finally`. The test expectations now compare the probe argument and returned bin with [the actual canonical bin](</home/prgrmr/opensource/ohmydsh/.worktrees/win/tests/dsh-host-runtime.test.mjs#L145-L156>), rather than demanding a logical temporary-directory spelling.

[The deterministic fingerprint hook](</home/prgrmr/opensource/ohmydsh/.worktrees/win/tests/dsh-host-runtime.test.mjs#L198-L212>) matches the physical generation fingerprint. It still asserts lock presence and independently challenges acquisition with a competitor that must time out. It is required to fire for success and fingerprint failure; the correction does not bypass the final-read assertions. [Failure cleanup and environment restoration](</home/prgrmr/opensource/ohmydsh/.worktrees/win/tests/dsh-host-runtime.test.mjs#L226-L237>) remain asserted. [The success branch](</home/prgrmr/opensource/ohmydsh/.worktrees/win/tests/dsh-host-runtime.test.mjs#L215-L225>) still executes the returned inert physical entry after switching the mutable pointer.

Connected callers preserve this result: [server-bin selection and protocol](</home/prgrmr/opensource/ohmydsh/.worktrees/win/scripts/dsh-server-bin.mjs#L47-L84>), [the identity-preserving bin accessor](</home/prgrmr/opensource/ohmydsh/.worktrees/win/scripts/lib/dsh-cli.mjs#L77-L79>), and [launcher consumption/spawn](</home/prgrmr/opensource/ohmydsh/.worktrees/win/scripts/launcher/main.mjs#L89-L111>) do not reconstruct a mutable `.launcher` path after release.

## Independently executed checks

Environment: Linux x64, Node v24.20.0. Only isolated inert Node fixtures/supervisors were executed; temporary fixture files were created and cleaned by the existing tests. No product/test file was mutated, including during the two source-loader challenges below.

- `node --test --test-timeout=15000` on the policy unit, publication, and preparation suites, with an explicit nonexistent overlay: **21 tests, 21 pass, 0 fail, 0 skip**, approximately 1.28 seconds, successful command exit. This includes the final-read competitor and returned-path usability checks.
- **Memory-only old-comparison mutation:** A `registerHooks` data-URL loader replaced only the canonical comparison with the former `readlink`/`path.resolve` comparison. The new alias regression failed, child exit **1**, with **“Backup pointer changed; recovery required”** inside the aggregate error. The enclosing challenge asserted the expected failure and exited **0**. This confirms the regression is RED for the actual namespace defect, not merely a source-string check.
- **Memory-only early-unlock mutation:** A second loader inserted `lock.release()` immediately before the final generation/fingerprint reads. The preparation integration regression failed, child exit **1**, at the fingerprint hook's lock-presence assertion, **`false !== true`**. The enclosing challenge asserted that expected failure and exited **0**. The canonical hook correction therefore preserves detection of premature release.
- Source text was checked unchanged after each mutation. `git diff --check` and `node --check` on the publisher, publisher tests, preparation tests, and preparer all completed successfully.

Frozen reviewed SHA-256 values:

| File | SHA-256 |
|---|---|
| [Publisher](</home/prgrmr/opensource/ohmydsh/.worktrees/win/packages/dsh-pet/compat/subagent/compat-publish.cjs>) | `51db837fefbc9dd7c8547358eb6cc576bc5e0d863656939a188b8cb960353ae6` |
| [Publication tests](</home/prgrmr/opensource/ohmydsh/.worktrees/win/tests/compat-launcher-publish.test.mjs>) | `3bb7fa54bac7503404d76b2dd1d8085d222272708756d73d00418e2a51e78972` |
| [Preparation tests](</home/prgrmr/opensource/ohmydsh/.worktrees/win/tests/dsh-host-runtime.test.mjs>) | `73b860ecba665656d95bd2bb331b275f93c336d7afbe279dacbc42552b8156a6` |
| [Preparer](</home/prgrmr/opensource/ohmydsh/.worktrees/win/scripts/lib/dsh-host-runtime.mjs>) | `256a197ac6c0d7d49e90a45d3baceb7b72ea2f1dbbb35ec8826329f5e0ef164f` |

## Verdict and exclusions

**PASS for the focused physical-path fix.** No security/ownership weakening was found in that repair. No additional product change is requested by this review.

The supplied macOS results (original focused 24: 18 pass/6 fail; repaired 25: 24 pass/1 terminal failure) are parent-reported context, not independently observed native results. This review does not resolve or accept the terminal ownership failure and does not authorize unfreezing unrelated product work.

Not checked or authorized: installs, npm/offline policy probe execution, network, native macOS/Windows execution, native dependency behavior, real Host lifecycle, production deployment, full-root or whole-platform acceptance, merge, or worktree cleanup. Historical generation retention still intentionally permits disk growth until separately authorized cleanup exists.
