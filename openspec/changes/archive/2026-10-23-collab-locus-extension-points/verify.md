## Verification Results

### Task Completion
- [x] All tasks marked `[x]` in tasks.md
- Remaining open tasks: none

### TDD Integrity
- [x] Every test-plan.md entry exists as a real test (149 rows; no `N/A — non-executable` rows)
- [x] Every test-plan.md row flipped to 🟢 green (no row left 🔴 red)
- [x] Full suite passes (kernel, dsh-collab vitest/artifacts/components; root failures equal the baseline, see Evidence)
- [x] Zero skipped/pending/commented-out tests: a grep for `.skip` / `.only` / `.todo` / `it.fails` in both packages' tests returns nothing
- [x] No test weakened or deleted without a REMOVED requirement. The test diff since base is 1470 insertions and 17 deletions. The deletions are existing assertions extended in place, as the test plan requires:
  - `members-05` now also covers `previousBindings`;
  - `admit-05` uses an attached integrator that claims nobody;
  - `tool-06` checks the four `collab_space` actions;
  - the two enumeration tests in `auth.test.ts` list the five new commands;
  - two unit assertions follow the new return shape of `caller()`.

  Red-first evidence for every group is in tasks.md under "## 实施记录".

### Evidence
- **Final full-suite commands and results:**

  | Command | Where | Result |
  |---|---|---|
  | `npm --workspace packages/collab-kernel test` | worktree | 44 files, 272 passed, 0 failed |
  | `npm --workspace packages/collab-kernel run typecheck` | worktree | exit 0 |
  | `npx vitest run` in `packages/dsh-collab` | worktree | 9 files, 152 passed, 0 failed |
  | `npm run typecheck` in `packages/dsh-collab` | full-deps copy `spike/fullcopy`, kernel built first | exit 0 |
  | `npm test` in `packages/dsh-collab` | full-deps copy | vitest 152 passed; build-artifact 2/2; sync-artifact 4/4 |
  | `npm run test:components` in `packages/dsh-collab` | full-deps copy | component 4/4; controller 18/18; request-header collab tools 3927 ≤ 4200 |
  | `npm test` (root) | worktree | 447 tests: 437 pass, 8 fail |
  | `npm run check:artifacts` | worktree | pass |
  | `openspec validate collab-locus-extension-points --strict` | worktree | valid |

- **Root `npm test` failures.** The same 8 tests fail on base `d9be6f1e3`, run in a temporary detached worktree with the same lean dependencies. The sorted failure lists diffed identical, so no failures are new:
  - sync / dsh-openspec-upgrade / routing materialization tests;
  - all are lean-dependency environment issues.

  One failure this change introduced was fixed before the final run: absolute-path links that reviewers wrote into `review*.md` broke the repo's markdown link check. They are now plain text; the content is unchanged.
- **Implementation review (gpt-6-astra, read-only) on `f92ab4c79`: FIX_THEN_SHIP.**
  - 🔴 `project()` did not re-check the guard after its own `await`.
  - 🟡 A non-serializable `ext` threw a raw error instead of `COLLAB_BAD_EXT`.

  Both were fixed red-first in `b637163ef`. A re-gate by the same model returned **SHIP**.
- **Real Host acceptance (task 6.5).** Main `3fe3ab9ba` was deployed with `dsh build`, and the user restarted the Host (PID 79662). Sessions: A, the lead session, and B, `session-e8c58c9f-…` created through Host `/api`. Space `ext-acc-1`. Evidence comes from the ledger JSONL and from B's session log decoded frame by frame:
  - **Integrator grants.** `allow_manager` for an undeclared channel (`pet-locus`) and for `dsh-session` returned `COLLAB_BAD_CHANNEL`; so did `revoke_manager` for a channel that was never granted. None of these wrote to the ledger.
  - **Ordinary flow unchanged.**
    - The invite woke B and auto-joined it.
    - Creating the request and its `accepted` step woke nobody.
    - The needs-reply message with `ref:5` woke B with `thread=5`.
    - `done` woke the author with `thread=5`.
    - Both of B's wakes arrived as `next-turn` inbox splices.
  - **Tool surface.** The tools rejected `ext` with `COLLAB_BAD_ARGUMENTS`. B's real request header carries 11 `collab_*` tools totalling 3927 characters.
  - **Not covered on the real Host.** The managed-member and mode paths need a real integrator; they belong to the Locus integration change and are covered here by component tests with a scripted adapter.
- **Non-executable checks run:** none.

### Review Integrity
- [x] review.md `VERDICT: APPROVE` (round 3, gpt-6-astra). Rounds 1 and 2 were REVISE; after round 2 the human chose to keep scope.
- [x] Verdict not stale. After the verdict only design.md changed, one line, applying the reviewer's S2 wording (`git diff da57bf3b6 HEAD -- proposal.md specs/ design.md`). specs/ and proposal.md are unchanged.
- [x] All findings fixed or rebutted. Rounds 1 and 2 have rebuttals recorded in `review-round1.md` and `review-round2.md`, and the next round accepted each of them.

### Change Delivery
- Commit range: `f910dc4c6..3e0176549` on `ws/packages-dsh-collab-docs-cross-boundary-collabor`. It was merged into main as `3fe3ab9ba` through `scripts/ws-merge.mjs --yes`, with user approval. This verify.md and the archive commit follow on the same branch.

### Overall Decision

✅ PASS

DECISION: PASS
