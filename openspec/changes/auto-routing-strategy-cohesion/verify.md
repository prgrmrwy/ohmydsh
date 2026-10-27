## Verification Results

Verified 2026-10-28 in Worktree Session `ws/openspec-apply-change-auto-routing-strategy-cohe` (Node v24.16.0, macOS arm64). Detailed per-section notes are in [implementation-log.md](implementation-log.md).

### Task Completion
- [ ] All tasks marked `[x]` in tasks.md
- Remaining open tasks:
  - **8.3** (merge, then `dsh build` twice from the main checkout; the user decides when to restart the Host). Requires the user's approval. Not done.
  - **9.2** (rewrite the main-spec Purpose paragraphs after the delta specs are merged). Happens during archive. Not done.
  - **9.3** (archive). Requires the user's authorization. Not done.
  - 9.1 is this file.

### TDD Integrity
- [x] Every test-plan.md entry exists as a real test (or documented `N/A — non-executable` with its check run green): all 104 rows map to a named test. [check-ledger.py](check-ledger.py) checks that each name appears exactly once in its file and that the test passed (every case, for `it.each`/`describe`): **104/104**. Three rows had their file column corrected to where the test actually lives; the names did not change (see implementation-log §5–6).
- [x] Every test-plan.md row flipped to 🟢 green: 104 🟢, 0 🔴.
- [ ] Full suite passes: **not fully.** The only failures also fail on the unmodified base commit and are environmental, not caused by this change:
  - package `usage-report.test.ts` › "keeps incomplete ends inconclusive and legacy exposure unknown" and "keeps complete frames when only the tail is incomplete". Under Node v24.16.0, `zstdDecompressSync` of a frame truncated by 1–10 bytes returns an empty buffer instead of throwing, so `tail-incomplete` is never counted. Probed directly; the same 2 failures occur at baseline (implementation-log §0.4).
  - root `tests/jev-readiness.test.mjs` › "readiness prefers v4 session file and falls back to v3". There is no `zstd` CLI on this machine (`spawnSync('zstd')` → ENOENT). Also fails at baseline.
- [x] Zero skipped/pending/commented-out tests introduced: the package has 0 skipped. Root has 4 skipped (2 × "exact @deepseek-ai/dsh-mcp-client is installed only in the managed DSH profile", 2 × "zstd unavailable"); this is the same count as the baseline, and none are in files this change touches.
- [x] No test weakened or deleted without a REMOVED requirement: deleted tests cover only the removed legacy chain (REMOVED requirements 默认新策略与显式回滚, 级别与 effort 映射, 子会话决策工具与 skill, 判档记录与人工标注, 回复操作栏档位按钮, Jev 判断档位 and the legacy parts of 设置页). Default-chain tests were renamed or moved to the default harness with unchanged expected values. The only assertions removed are `policy` / version-field assertions, which the spec now forbids. Deleted test files and the reason for each are listed in implementation-log §3.

### Evidence

- Final full-suite command (package): `cd packages/auto-model-routing && npx vitest run`
- Result summary: **234 passed, 2 failed, 0 skipped** of 236 (29 files). The 2 failures are the baseline zstd-truncation tests above.
- Final full-suite command (root): `npm test`
- Result summary: **634 tests: 629 pass, 1 fail, 4 skipped.** The failure is the baseline `jev-readiness` zstd-CLI test.
- Other checks run:
  - `npm run build` (package) exit 0; dirty-output build verified by `test/package-output.test.ts` and by hand.
  - `npm run typecheck` (package, src + tests) exit 0.
  - `npm pack --dry-run --json` (package) → `dsh-auto-model-routing@0.5.0`, 91 files, without `lib/router.js`, `lib/judgements.js`, `lib/policy-v2.js`, `lib/policy-v2-rubric.json`, `scripts/label-report.mjs`.
  - `npm run check:artifacts` (root) exit 0.
  - `node --test tests/auto-model-routing-sync.test.mjs`: 2/2 pass. `tests/agent-instructions-dispatch.test.mjs`: pass, unmodified.
  - `python3 openspec/changes/auto-routing-strategy-cohesion/check-ledger.py` exit 0 (104 rows).
  - `openspec validate auto-routing-strategy-cohesion` exit 0. `openspec validate auto-routing-strategy-cohesion --strict` **exit 0** ("is valid", 0 warnings). Earlier review rounds reported strict exit 1 from requirement-length warnings; with the current CLI the strict run exits 0, and this is the actual result.
  - `src/rubric.json` sha256 `e3eff1719550acf167ba43ddcb14a6b910835b17263eab185ca7f6808e3a2b63` equals the pre-change `policy-v2-rubric.json` (fixture `test/fixtures/routing-oracle-0.4.2.json`).
  - Isolated preview acceptance (task 8.2): two isolated `dsh build` runs (the second printed `no changes`); preview on 127.0.0.1:3262; all four required GUI checks observed, plus one real Jev + Claude Haiku turn. Details and the two environment workarounds (private-registry `.npmrc`, mirrored `allowBuilds`, reused reviewed compat launcher via `DSH_BIN`) are in implementation-log §8. The daily GUI on 3080 was not touched.

### Review Integrity
- [x] review.md: round 2 `VERDICT: APPROVE_WITH_CHANGES` with `CHANGES_APPLIED: yes`; round 2b (post-drift) `VERDICT: APPROVE_WITH_CHANGES` with `CHANGES_APPLIED: yes`.
- [x] Verdict not stale: after round 2b, proposal.md / design.md / specs/ changed only by applying its one required change (R2b-M1, spec.md:61 provider ID). The round-2 verdict was re-reviewed (round 2b) after the user-approved drift correction (`dsh-magpie` → `dsh-magpie-connector`; baseline/rollback 0.4.1 → 0.4.2). After that, test-plan.md changed only in the Initial State column and three file-column corrections, and review.md changed only by turning repo-root links into file-relative links. The review text is unchanged; one link to the deleted `src/policy-v2.ts` is pinned to the base commit.
- [x] All findings fixed or rebutted: round-1 C1–C4, M1–M5, S1–S2 and round-2 R2-M1–M4, R2-S1–S2 were resolved in the artifacts before apply (round-2 re-check section). R2b-M1 was applied. No rebuttals were needed.

### Change Delivery

- Commit range (if committed): `42c1419df..628bc4841` on branch `ws/openspec-apply-change-auto-routing-strategy-cohe` (base `3ba705c0a`; not merged). Merging into main and the production `dsh build` (task 8.3) wait for the user's approval.

## Overall Decision

DECISION: PASS_WITH_WARNINGS

⚠️ PASS WITH WARNINGS:
1. Three pre-existing, environment-caused test failures remain (2 zstd-truncation tests in the package under Node v24.16.0, and 1 root test needing the `zstd` CLI). They fail identically on the unmodified base commit and are not caused by this change; they still keep the suite from being fully green.
2. Tasks 8.3, 9.2 and 9.3 are intentionally open: they need user approval (merge/deploy, archive) or run during archive.
3. The isolated preview needed environment workarounds (implementation-log §8). Only the auto-model-routing package code under test came from this branch; the Host runtime was the existing reviewed compat build.
