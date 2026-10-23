## Verification Results

### Task Completion
- [x] All tasks marked `[x]` in tasks.md, except one archive-time task
- Remaining open tasks: 4.2 (revise the `## Purpose` paragraphs of the two current specs). By its own wording it runs during archiving, after the delta specs are synced, because the Purpose paragraph is outside the delta format. It is done in the archive step that follows this verify.

### TDD Integrity
- [x] Every test-plan.md entry exists as a real test, or is a documented `N/A — non-executable` entry whose check ran green
- [x] Every test-plan.md row is flipped to 🟢 green: 165 rows green, plus 1 N/A row
- [x] Full suite passes; root `npm test` only fails on the environment baseline described below
- [x] Zero skipped, pending or commented-out tests
- [x] No test weakened or deleted without a REMOVED requirement
  - The deleted test files (`breaker`, `decisions`, `escalation`) and cases (`auth-11`, `dispatch-04`, the old `binding-02/03`, the decision rows in `wake-table`) correspond to the REMOVED requirements 按成员计数的熔断, 人类决定只能由带证据的确认产生 and agent 往返超限自动升级为待人决定, and to the removed confirm delivery.
  - Three component-suite assertions were brought in line with the current model. The asserted behavior is unchanged; see test-plan Coverage Notes.

TDD order:
- Each group wrote its failing tests first and recorded the red reasons. All were assertion or type mismatches, with no import or syntax failures (see tasks.md 实施记录).
- Five rows were green from the start: `tool-08`, `wake-06`, `trust-06`, `trust-07`, `trust-config-01`. Each is either a named split of existing coverage or behavior that already held. The reasons are documented, and no failure was faked.

### Evidence
Final runs, 2026-10-23, after the last code edit (commit `d2e7b2dca`):

| Command | Where | Result |
|---|---|---|
| `npm --workspace packages/collab-kernel test` | worktree | 38 files, 224 tests passed, 0 failed; vitest typecheck: no type errors |
| `npm --workspace packages/collab-kernel run typecheck` | worktree | exit 0 |
| `npx vitest run --root packages/dsh-collab` | worktree | 6 files, 118 passed, 0 failed |
| `npm --workspace packages/dsh-collab run typecheck` | full-deps copy `.acc/fullcopy`, collab-kernel built first | exit 0 |
| `npm --workspace packages/dsh-collab test` | full-deps copy | vitest 118 passed; build-artifact 2/2; sync-artifact 4/4 |
| `npm --workspace packages/dsh-collab run test:components` | full-deps copy, with the `spike/collab-components` fixture | component 4/4; controller 18/18; real request-header collab tools 3806 ≤ 4200 chars |
| `npm test` (root) | worktree | 447 tests: 437 pass, 8 fail (see below) |
| `openspec validate collab-ref-threads --strict` | worktree | valid |

The 8 root `npm test` failures are not caused by this change:
- They are `sync_records_authoritative_checkout…`, `dsh_openspec_clean_sync…`, `routing bundle and skill materialize…`, and five `dsh-openspec-upgrade` cases. All are isolated sync/build tests.
- The same 8 also fail on the clean base commit `553864fa6`, in a temporary detached worktree using the same lean dependencies, so they are environmental.
- Two failures this change introduced were fixed before the final run: the `dsh.yaml` note length, and repo-root links in moved review files.

The deployment build is idempotent: `dsh build` from main `6cd7fe68c` applied 2 changes, and a second run reported `dsh-collab@0.1.0 up-to-date`.

**Real-Host acceptance** (task 5.5): Host PID 94237, restarted by the user after the build. Sessions A `session-22bb0723-…` and B `session-45cfcaed-…`, space `ref-acc-1`. Every result below was checked against the JSONL ledger, not against model narration:

- **Wake triggers.**
  - The invitation woke B, and B was auto-joined.
  - These produced no `dispatch/intended`: the charter revision, B's ack (the charter became agreed), creating the request, the leader transfer, and request `accepted`.
  - Request `done` woke the author a, with `thread=7` (the request's creation seq).
- **References and topics.**
  - `ref=9999` returned `COLLAB_BAD_REF` and left no commit.
  - Topic 13: the root plus 19 `ref` messages were accepted, each wake carrying `thread=13`. The 21st waking message returned `COLLAB_THREAD_LIMIT` and left no commit.
  - A message without `ref` opened topic 53.
- **Delivery.** B received 22 wake pointers. Message pointers carry `thread`, and the invitation pointer carries `invited:true` without `thread`. The trusted wake notice uses the new "ask your own user" sentence. All deliveries `succeeded`.
- **Old space.** The original member of `trust-acc-1` (a closed space from the previous change) read its overview and its convention v2 under the new kernel. A write was refused under the closed-space rule. A non-member read returned `COLLAB_SPACE_UNAVAILABLE`.

N/A row 成员信任不放宽宿主权限: this change does not touch sandbox/approval/worktree enforcement. The real-Host result of `dsh-collab-member-trust` stands. This change only reworded the trusted notice, and its new wording was verified above.

No legacy space on this machine had a member paused by the old breaker. Resumed waking for such members is covered by `topic-11`.

### Review Integrity
- [x] `review.md` has `VERDICT: APPROVE`: round 3 of the replanned change, codex gpt-6-astra, 0 Critical / 0 Moderate / 0 Suggestions.
- [x] The verdict is not stale. `git diff 59f5c9d25..HEAD` shows no changes to `proposal.md`, `design.md` or `specs/` after the verdict.
  - Edits since the verdict touched only `tasks.md` and `test-plan.md` (ledger updates).
  - The review files changed in one way: repo-root links became plain text for the repository link checker, with content otherwise unchanged.
- [x] All findings were fixed. Round 1: 2 Critical, 3 Moderate, 2 Suggestions. Round 2: 1 Moderate. Every rebuttal was marked accepted by the reviewer in the following round. The round-2 Moderate exposed a wrong round-1 rebuttal; it was fixed and then accepted in round 3.

### Change Delivery
- Commit range: `59f5c9d25..d2e7b2dca` on `ws/collab-session-session-session-session-session`. It was merged into `main` as `6cd7fe68c` via `scripts/ws-merge.mjs`, with user approval, and is not pushed. This verify, the tasks.md acceptance record and the archive are committed afterwards.
- Implementation was split across Agent Teams teammates `conv-v3` (group 1), `kernel-core` (group 2) and `plugin-adapt` (group 3). The lead reviewed and re-ran each group, and handled docs and final verification.

## Overall Decision

DECISION: PASS
