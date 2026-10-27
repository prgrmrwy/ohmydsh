# Cross-platform launcher — redacted historical summary

## Retention boundary (2026-10-27)

This is a concise retention summary, not new acceptance evidence. The former checking reports and one-shot operational drivers were removed under the repository's no-grandfather checking-artifact policy. Their detailed historical contents remain available in Git revision `120f9140` under this change's former checking paths (`git show 120f9140:<repository-relative-path>`). Removed source line numbers, raw receipts, machine paths, process identities and execution scripts are not reproduced here. Nothing was rerun on Windows, macOS, a deployed profile or a real Host for this cleanup.

The actively imported pure second-build assertion was retained byte-for-byte as `tests/helpers/full-gate-assertions.mjs`; its root regression test now imports that source helper. The machine-specific preparation/recovery/console drivers are historical procedures, not current authorized commands, and were not executed during cleanup.

## Implementation and review history

- P1 preserved a frozen seven-file Bash test oracle; P2 established command and atomic observations; P3 implemented the Node command closure; P4 retired product Bash dispatch while retaining thin POSIX wrappers. Historical Bash fixture results are not Node/platform proof.
- Independent implementation review initially found implicit timeouts/orphan handling, macOS identity, readiness cleanup, opener handoff, observability and concurrent-start defects. Focused repair review accepted those repairs. Later native observations drove physical-path alias and UTF-8 ownership corrections.
- D8 planning initially required revision; its focused follow-up approved the revised lock inheritance, interrupted-publication/recovery and authoritative exact-script-policy contracts. D8 implementation review also initially required revision; focused follow-ups accepted pointer-identity/backup and final-read-lock repairs. Neither focused approval was whole-platform acceptance.
- Script-source review distinguished exact denials from grants. The user later explicitly approved only the reviewed subprocess helper, koffi and node-pty exact versions, with native/build fallback risks disclosed; no blanket approval was inferred. Token environment case variants and restoration-on-release-error were separately repaired.
- Final whole-range local source review reported PASS after Windows readiness-handle and persistent native-test-lane repairs. It was a local bounded review, not independent platform certification.

## Historical verification snapshots

These are previously reported, distinct runs, not one combined suite and not fresh cleanup results:

- Final Linux launcher-era root: 598 tests / 596 pass / 0 fail / 2 existing MCP skips. Twelve affected workspace build/typecheck/test checks previously completed 36/36 command exits successfully.
- Native Windows updated root lane reached 96/96 and, after later main synchronization, 97/97 with ordinary PATH. Earlier no-Bash results are separate and must not be relabeled as a no-Bash rerun of those larger lanes.
- Windows ordinary-profile build/idempotence/doctor/dump and owned non-production Host lifecycle were reported successful. Human-assisted actual console close proved event delivery, original shell exit and same Host survival; earlier unsupported pseudo-console automation remained failed, not retroactively green.
- Native macOS root reached 597/595/0/2 before a later Windows-only cleanup repair; final focused lifecycle was 8/8. Isolated full-manifest build pair, exact no-change assertion, doctor/dump and same-Host survival with process-only stop were reported successful. Existing checkout and ordinary Host were outside that isolated scope.
- Exact standalone MCP bridge integration passed 2/2 with complete already-installed peers. This does not convert the root invocation's two skips into passes. Pet's reported 3432 passes / 8 opt-in skips likewise does not satisfy a zero-skip criterion.
- After controlled main/Windows synchronization, the first Windows build pair failed the exact no-change assertion because four path strings converged only on an extra pass. A later consecutive pair passed; the initial failure remains a disclosed convergence limitation, not an immediate-idempotence success.

## Unresolved acceptance and authority boundaries

**Whole-change acceptance remains FAIL / NOT READY TO ARCHIVE**, consistent with the existing verify decision. Actual external macOS PWA and target-port Chrome interaction remains unrun/unaccepted; historical per-case RED receipts are incomplete; root/package skips remain disclosed; ShellCheck and the configured Node 22/24 CI matrix were not observed completing in those records. This cleanup neither waives requirements nor authorizes spec synchronization, archive, deployment, restart, commit, merge or worktree cleanup.

Earlier macOS CLI-stop/lifecycle tests could invoke same-port Chrome AppleScript even with `--no-open` and an isolated HOME. A successful cleanup diagnostic did not establish that tabs existed or closed; actual desktop effects remain unknown. Later Host cleanup used process-layer stop only and is not full CLI/UI acceptance. Do not repeat operational drivers without a new scoped authorization and current identity checks.

Historical detailed reports can be inspected at the Git revision above when exact source snapshots, receipt sequence or review findings matter; this summary is deliberately not an equivalent detailed evidence artifact.
