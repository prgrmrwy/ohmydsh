## Verification Results

### Task Completion
- [x] All tasks marked `[x]` in tasks.md
- Remaining open tasks: none. The two Workflow follow-up bullets are not tracked tasks and both are done:
  - `dsh-collab` was archived first, as `2026-10-20-dsh-collab`.
  - The temporary acceptance patch was removed and dsh-collab moved to the formal configuration in commit 9a559e512.

### TDD Integrity
- [x] Every test-plan.md entry exists as a real test (96 rows; no `N/A — non-executable` rows).
- [x] Every test-plan.md row flipped to 🟢 green. There are 96 rows and 96 `#### Scenario` entries in specs/; the only two 🔴 occurrences are in the explanatory note, not in table rows.
- [x] Full suite passes.
- [x] Zero skipped/pending/commented-out tests in this change's suites. The root suite has 2 skips that predate this change and are unrelated to it; see Evidence.
- [x] No test weakened or deleted without a REMOVED requirement. `test/maintenance.test.ts` was deleted together with `dsh-collab-unlock`. The requirement it covered, "残留锁只在死亡证明后解除", was MODIFIED rather than removed, and its unlock behaviour is now covered by lock-01 through lock-07 (startup death-proof cleanup).
- RED evidence for each test group is recorded in implementation-log.md. These tests passed on their first run and are recorded honestly as regression guards rather than given a fabricated RED: auth-17, admit-02/03, cold-05/06, lock-06, salvage-06, surface-03, claim-07/08 and wake-04. The last three were added during the scenario-name alignment before archive.

### Evidence

- Final full-suite commands (Lead, 2026-10-20, same working tree; the root suite was rerun after the archive moves were staged):
  - `npm --workspace packages/collab-kernel test` → 38 files, 212 passed, 0 failed, 0 skipped; `run typecheck` → exit 0.
  - `npm --workspace packages/dsh-collab run typecheck` → exit 0. This needs `npm --workspace packages/collab-kernel run build` first, because the kernel's `lib/` is git-ignored; that was already true before this change.
  - `npm --workspace packages/dsh-collab test` → vitest 97 passed, plus node --test 2 passed; 0 failed, 0 skipped.
  - `npm --workspace packages/dsh-collab run test:components` → 4/4 and 17/17 passed, 0 skipped. The 12 collab tools measured 4002 characters in a real request header, against a budget of 4200.
  - `npm --workspace packages/dsh-collab run test:host` → all 8 cases passed: normal, budget and kill under the official 0.2.0-rc.2 bin, plus lock-01 for the budget and kill modes (the next startup clears the lock and replays the ledger), accept-02, accept-03 and official-direct-composition.
  - `npm test` (repo root) → 445 tests: 443 passed, 0 failed, 2 skipped. Both skips predate this change: `@deepseek-ai/dsh-mcp-client` is only installed in the managed profile, and the test itself states this as its skip reason.
  - `npm run check:artifacts` → exit 0.
  - `npx openspec validate dsh-collab-invite-admission --strict` → valid.
- Live checks (non-unit, recorded in implementation-log.md):
  - 9.3 on the LumeVM daily Host: session C, which is not in any configuration, went through invite → `collab_status` → join → ack with no config change.
  - Formal acceptance after enabling for daily use: sessions P and Q, space formal-1, seq 1–11. Inviting a denied Pet session returned `COLLAB_ADDRESS_UNCLAIMED`. Q waited for user authorization before joining and before acking. P was woken by the ack; Q's reply with needsReply=false did not wake P again. P closed the space.

### Review Integrity
- [x] review.md `VERDICT: APPROVE_WITH_CHANGES` with `CHANGES_APPLIED: yes` (round 4; rounds 1–3 were REVISE and are kept as review-round1..3.md).
- [x] Verdict not stale. After the verdict, the only edits to specs/ were:
  - the two non-blocking corrections the reviewer's re-check asked for;
  - archive-validation-driven scenario-name alignment: five scenarios renamed back to the baseline names that `openspec/specs/dsh-collab/spec.md` still carries, and three baseline scenarios restored with the new rules.
  
  No requirement semantics changed. The alignment is logged in implementation-log.md ("归档前的规格对齐"). proposal.md and design.md were not changed after the verdict.
- [x] All findings were fixed or rebutted: the round-4 re-check table covers RC1–8 and Suggestions 9–14.

### Change Delivery

- Commit range (if committed): `24c015ea5..9a559e512` in ohmydsh, plus private overlay commit `781ff78` in inner-ohmydsh. The archive move, the post-archive scenario alignment and this verify.md are staged and will be committed together with the archive of this change.

## Overall Decision

DECISION: PASS

✅ PASS
