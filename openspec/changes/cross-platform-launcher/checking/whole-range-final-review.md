# Whole-range local implementation review — cross-platform-launcher

## Scope and identity

Reviewer: current executor, local review, not an independent fresh-context review. Reviewed the complete migration range from immutable branch baseline `c439726e6a166fc3fb80aa95ba34e693423a03fa` through HEAD `90de15a4263cf71f8afb000b91522b75971fe1fa` plus current uncommitted repairs and new safety helpers/tests. Not HEAD~1. Current source snapshot: **103 existing code/config/test paths**, aggregate SHA256 **c7fb2efdc440707f5048c0de65d6a8244d538e71b717f4fb3f055f0a486a9788** (sorted relative paths; hash path + NUL + raw bytes + NUL for each). Raw reproducible list is in ignored round13-source-snapshot.json; reports/docs are not included in this code hash.

The broader Git range also contains the already-existing runtime-upgrade archive/current-spec changes. Those were inventoried as inherited material, not newly implemented or re-accepted by this launcher review. No production deployment/merge/archive/cleanup is authorized by this report. No `.spec-superflow.yaml` workflow is active; no unrelated SSF receipt/state was created. The controlling workflow remains Anvil and its original planning review plus explicitly accepted D8 amendment.

## Requirements and connected scope

Read original review, current D8 design/spec requirements and prior implementation/focused repair reviews. Traced:

- P1/P2: frozen Bash oracle and independent subprocess recorder, shared contract command/priority assertions, historical RED receipts versus missing receipts. Frozen oracle remains a test fixture, not a second product implementation.
- P3: parser and official forwarding; strict versus allowlist env parser modes; caller DSH_BIN and npm-registry attribution; native argv resolver; no implicit timeout for interactive operations; auto-update dirty/rollback/commit fence; ownership/readiness/stop; UI suppression and platform dispatch.
- P4: root npm bin and lock metadata, builtin-only bootstrap health/engines checks, unknown-bin legacy install guard and thin wrappers, twelve workspace lifecycle changes, root platform test selection, actual external-cwd cmd/PowerShell installation tests, bilingual support caveats and CI matrix.
- D8: exact allowScripts schema/environment/CLI flags and cache fingerprint; shared preparer/compat lock/supervisor/nested-builder chain; final physical bin/version/fingerprint reads under lock; rollback publisher identity/target guards, canonical macOS path aliases, residual recovery gate and deliberate generation retention.

Existing fresh reviews provide narrow adversarial evidence for publication pointer identity and final-read lock mutations. Native observations cover the Darwn UTF8 ps query fix; this review did not infer macOS behavior solely from Linux mocks.

## Findings resolved during this review

### R13-1 — Important: failed Windows readiness could leave launcher alive

The Windows readiness failure path invoked taskkill but did not unref its detached child (unlike POSIX). If taskkill failed or was unavailable, the Node child handle could keep the launcher running after its nominal failure return. Prior rereview R1 had recorded this as low severity; the normative bounded-start requirement makes it a correctness gap.

RED: injected an inert ChildProcess and failing taskkill while using a fixture-owned listener only. Test failed at `released === true`, not syntax/import/timeout. No process with the synthetic PID was signaled. Repair: release this child reference in finally; warn with the exact owned PID when taskkill reports failure. No additional kill authority is introduced. System refusal can still leave the owned child running: diagnostic/manual inspection is required, never false cleanup success. Fresh native Windows and macOS lifecycle suites8/8 each; Linux connected contract/process/UI/lifecycle suite57/57.

### R13-2 — Important test gap: D8 omitted from persistent native Windows lane

Manual Windows acceptance had run D8 safety suites, but the root Windows allowlist and duplicated CI command omitted them. A regression in publication policy/preparation could therefore pass normal Windows CI.

RED: extended test-driver assertion fails because compat-launcher-policy absent. Repair: root Windows driver includes policy/publication/preparation; CI delegates to that same driver instead of maintaining another list. Fresh actual Windows root-driver run96/96, zero skips. This run used ordinary native PATH; earlier separate no-Bash receipts still stand, but are not mislabeled as rerun no-Bash96/96. CI retains its explicit no-Bash PATH guard and matrix Node22/24.

## Final review result

**SOURCE_REVIEW: PASS after the two focused repairs.** No remaining merge-blocking source defect identified in the reviewed migration and accepted D8 scope. This is a bounded implementation judgment, not proof of every timing/filesystem behavior or independent platform certification.

**ACCEPTANCE: FAIL / NOT READY TO ARCHIVE.** Reasons remain:

1. Actual interaction with an existing external dsh-cockpit PWA and target-port Chrome tabs is unrun/not authorized. User clarified ownership; no PWA created, sibling source inspected or desktop permission inferred. Changing/removing this criterion needs an explicit scope decision and reviewed artifact amendment, not unilateral checkoff.
2. Historical per-case RED receipts remain missing; cannot manufacture a TDD history now. Root command still skips2 existing MCP tests despite standalone exact bridge2/2 success. Affected Pet package retains8 opt-in runtime skips. No zero-skip claim.
3. ShellCheck is unavailable locally; configured CI not executed here. Node22/24 GitHub matrix is configured, not observed running.
4. At this review snapshot full-manifest/real Host receipts predated cleanup-only source repairs. Round14 follow-up now reran latest Windows fullchain and Mac build/Host/process-only-stop successfully; actual macOS CLI/UI cleanup integration remains unaccepted. See desktop-boundary-correction.md for prior unintended AppleScript attempt disclosure.
5. Current specs have not been synced/archived, commits/merge/worktree cleanup are not authorized. This review does not approve those operations.

Residual operational limits are intentional: Windows stop is forceful; no generation GC causes disk growth; ownership is fail-closed best-effort under same-user process races, not a malicious same-user security boundary; POSIX argv recovery on Darwin is conservative and rejects ambiguity. A POSIX descendant that ignores TERM after its Host leader exits can require separate cleanup; no stale/reused PID kill is added for this theoretical residual. Full general subprocess-tree supervision is outside this launcher migration.

## Fresh evidence

- bash-608: connected lifecycle/contract/process/UI57/57; root598/596pass/0fail/2existing skips.
- bash-612: native Windows lifecycle8/8.
- bash-617: isolated macOS lifecycle8/8.
- bash-616: native Windows updated root driver96/96,0skip.
- bash-618: final Linux root598/596pass/0fail/2existing skips; artifacts, strict OpenSpec and diff checks all0.
- Previous round12 source token repairs: Linux/macOS safety23/23, Windows22/22; Linux/macOS root597/595/0/2; Pet typecheck/build/test exit0 with3432pass/8skip.

No new install, execution grant, actual Host lifecycle, desktop operation, merge or production mutation was performed in round13. All relevant background jobs were collected.
