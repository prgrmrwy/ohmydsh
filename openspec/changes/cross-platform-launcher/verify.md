## Verification Results

Post-implementation verification, 2026-10-24. This is a real failed acceptance report, not a placeholder or a claim that green launcher tests satisfy every platform gate.

### Task Completion
- [ ] All tasks marked `[x]` in tasks.md
- Remaining open tasks are explicitly retained in tasks.md: missing historical per-case RED receipts; ShellCheck unavailable; Windows real console-close and PowerShell shim; real macOS contracts/UI/full manifest; full public-manifest build×2/dump/Host; exact MCP integration prerequisite; remaining affected package checks. Implemented GREEN/REFACTOR units do not waive platform completion.
- P1 equivalent extraction, P2 shared/oracle contracts, P3 Node implementation and closure, P4 single root npm bin switch are implemented. Historical Bash product code is gone; seven-file test oracle is retained without being counted as Node coverage.

### TDD Integrity
- [x] All 47 test-plan entries resolve mechanically to a real test file and exact name (some existing public/overlay rows intentionally share one retained test).
- [ ] Every test-plan row green: Windows console-close and macOS real UI/terminal remain red; full support gates remain unaccepted.
- [x] Full available Linux root suite exits0.
- [ ] Zero skipped/pending/commented-out tests: root suite retains two pre-existing skips in the real MCP seam suite, because exact official bridge dependency is absent from root. This violates the Anvil zero-skip completion gate and is not waived. No migration-specific test was skipped to obtain green.
- [x] No test assertion weakened or deleted without REMOVED requirement. Historical structural/source-rewrite checks are retained against the frozen oracle and labeled as historical. Node shared command assertions remain; an extra post-sync git safety query changes the expected exact call trace explicitly. Fixture helper copies, Windows simulated Darwin path and explicit cmd quote boundary were repaired, not assertions removed.
- Several named wrappers added after implementation do not have a separate expected-behavior RED receipt. Those RED tasks remain unchecked; existence/final green is not fabricated TDD history.

### Evidence

- Final full-suite command including idempotence-gate regression (job bash-330):
  `npm test && npm run check:artifacts && openspec validate cross-platform-launcher --strict && git diff --check`
- Result: **578 tests, 576 pass, 0 fail, 2 pre-existing MCP integration skips**, exit0; artifact policy, strict change validation and diff check pass.
- Separate package build command: `npm run build --workspace collab-kernel && npm run build --workspace dsh-openspec` → exit0 (bash-295). Later local affected-workspace verification (bash-322) ran each existing `npm run build`, `npm run typecheck`, `npm run test` for all twelve modified workspace manifests: **36/36 command exits0**, signal:null. See checking/local-workspace-verification.md for exact package list and isolation boundaries. These are local managed-Linux-worktree results, not devbox or native Windows results.
- Independent implementation repair review: `node --test tests/launcher-{runner,process,ui,lifecycle,contract}.test.mjs` → **57/57**, zero skips. Real Linux lifecycle separately **7/7**.
- Linux true controlling-PTY close: `node --test tests/platform/launcher-terminal.test.mjs` → **1/1**, verifies HUP acknowledgement, shell exit, and same Host PID still listening. Windows own-console WM_CLOSE attempt did not make shell exit within budget; **RED**, no recursive taskkill simulation. macOS not run.
- Final native Windows fresh snapshot (bash-302, Node24.12.0/npm11.6.2/Git2.54, PATH contains neither Bash nor sh): **60/60 targeted**, **7/7 lifecycle**, zero skips. Includes real scratch-prefix offline npm link, generated cmd shim invoked from external cwd, Unicode listener identity/stop, owned timeout leader+descendant reclamation. Additional final test-driver selection **1/1**. Results are separate batches, not summed with prior snapshots.
- Native Windows workspace lifecycle: **4/4** after real RED root-ci `rm -rf` and subsequent Unicode rmSync silent-noop diagnosis. Node fs.promises.rm preserves literal package-local deletion and rejection exit status. Native full root npm ci subsequently **passes**.
- Both complete public-manifest isolated attempts now fail at **ERR_PNPM_IGNORED_BUILDS** for `@google/genai@1.52.0` / `protobufjs@7.6.6`; five final plugin additions fail. Full input unchanged, no public entries disabled, no scripts approved, no allow-all configuration. Windows final diagnostic refresh contains repaired no-default-deadline runner; earlier premature 180s termination is not misclassified as upstream native failure. Build2/doctor/dump/full-profile Host were not reached. See checking/full-manifest-evidence.md for exact roots, tools, hashes, authorization and retry reasons.
- Non-executable mechanical checks: 47-row file/name audit → 47 existing; reviewed planning diff against staged approved baseline → empty; SHA256 identities below.
- Gate-harness follow-up found by source inspection: build-2 originally checked exit code only. Added checking/full-gate-assertions.mjs and wired its no-change report assertion into full-manifest-gate.mjs. Regression first failed against an exit-only skeleton (Missing expected exception), then passed for the exact sync no-change marker and rejects nonzero, empty, change-applied and contradictory output. `node --test tests/launcher-gate.test.mjs tests/launcher-acceptance.test.mjs` →2/2; driver syntax/diff/strict checks pass. No actual full-manifest retry was performed, so this is harness correctness evidence only. The final root run above includes this new test. Goal rounds1–4 did not receive PC target/devbox connection confirmation or the separately requested exact-version script-denial authorization. Automatic work stops at those missing inputs rather than inferring consent; no full-manifest retry, remote connection or policy write was made.

### Review Integrity
- [x] Planning review.md has canonical `VERDICT: APPROVE_WITH_CHANGES` and `CHANGES_APPLIED: yes`.
- [x] Proposal/design/specs unchanged since approved staged planning baseline; `git diff --exit-code -- <five planning paths>` exits0.
- [x] Independent implementation review's C1/C2/M1–M5 are repaired and accepted by focused independent reviewer (checking/implementation-rereview.md). macOS evidence is explicitly unit-only. Low residuals are recorded, not represented as platform proof.

Approved planning SHA256:
- proposal.md: 9669bb4ded70ec51f7ddc1503e852a7ad85f11d1744c92f7fc16cfcd1ed8cada
- design.md: 5353a6ce8513ae29c4cf022623a15ac2324924f1097e15f9ffae4d1e7b1f44a9
- specs/cross-platform-launcher/spec.md: 1c00f3e308c1ce09f46cefd05615f8def7e38de08a03e9039b1159099504a91c
- specs/repo-layout/spec.md: 66673a03e6da3785e3614f6534128ab9a4b1647609ffbc2e45437ffa57412a9a
- specs/startup-autoupdate/spec.md: dd66f9ddc2ff0f3e9ba694332d9bbf5b26eb9acb75c8ea8de31d54b6b5a9c031

### Change Delivery

- User subsequently authorized main integration before ordinary PC/WSL local testing. Pre-existing main lock reordering was preserved separately as85ea1f42 after explicit confirmation and parsed-JSON equality check. Migration committed as4a729275; controlled ws-merge succeeded at main merge5b84475f. No push or worktree cleanup. Follow-up evidence corrections remain in the managed worktree until separately committed/merged; planning acceptance remains FAIL.
- No production Host restart or port3080 Host change, user global installation, actual env/credential/private overlay mutation. User authorized nonisolated local testing, but the actual postmerge build bash-354 targeted the managed Worktree Session DSH home and failed (five pnpm policy errors plus unmanaged schema refusal); this is not ordinary local-profile success. Main dependency bootstrap was not attempted outside the allowed binding. No upstream package source patched or disabled to obtain green.
- Current main specs are not synchronized with this unaccepted delta, and this change is not archived. Full Windows support is not advertised in README.

## Overall Decision

DECISION: FAIL

Implementation is available for review, but Anvil acceptance is **not complete**. Continuing full gate needs a reviewed build-script policy for the two exact transitive dependencies, not automatic approve-builds. User subsequently authorized read-only script review (no execution); checking/dependency-script-review.md and checking/pnpm-script-policy-review.md record that follow-up. Proposed exact-version denial still requires separate user confirmation before any isolated gate experiment. Windows real console-close and macOS real runner evidence, missing integration prerequisites and remaining tasks also require closure. Any reduced-scope acceptance must come explicitly from the user; the Agent has not granted it.
