## Review Metadata
- **Review round**: 6
- **Prior round**: round 5 — REVISE (0C/1M/0S), author fixes in [review-round5.md](<openspec/changes/collab-ref-threads/review-round5.md>) Rebuttals
- **Reviewer context**: cross-model (codex gpt-6-astra subagent)
- **Tool restrictions**: read-only inspection; only write is [review.md](<openspec/changes/collab-ref-threads/review.md>)
- **Artifacts reviewed**: [proposal.md](<openspec/changes/collab-ref-threads/proposal.md>), [design.md](<openspec/changes/collab-ref-threads/design.md>), [kernel delta](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md>), [plugin delta](<openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md>), [test-plan.md](<openspec/changes/collab-ref-threads/test-plan.md>), [tasks.md](<openspec/changes/collab-ref-threads/tasks.md>), prior reviews [round 1](<openspec/changes/collab-ref-threads/review-round1.md>), [round 2](<openspec/changes/collab-ref-threads/review-round2.md>), [round 3](<openspec/changes/collab-ref-threads/review-round3.md>), [round 4](<openspec/changes/collab-ref-threads/review-round4.md>), [round 5](<openspec/changes/collab-ref-threads/review-round5.md>), corresponding requirements in the current [kernel spec](<openspec/specs/collab-kernel/spec.md>) and [plugin spec](<openspec/specs/dsh-collab/spec.md>), and connected kernel/plugin source, tests and build configuration cited below.
- **Review stage**: pass 2 complete; replaces the deliberately incomplete pass-1 report. Static planning review, not implementation acceptance. No tests, builds, deployment, or strict OpenSpec validation were executed.
- **Artifact hashes (sha256 prefix)**:
  - [proposal.md](<openspec/changes/collab-ref-threads/proposal.md>): `ec8f3f4b7b15`
  - [design.md](<openspec/changes/collab-ref-threads/design.md>): `215fe0fbf346`
  - [kernel delta](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md>): `29ac0452f38b`
  - [plugin delta](<openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md>): `faead1c3451f`
  - [test-plan.md](<openspec/changes/collab-ref-threads/test-plan.md>): `f32c9dea60b5`
  - [tasks.md](<openspec/changes/collab-ref-threads/tasks.md>): `a3499f7c915b`

## Findings

### 🔴 Critical (blocking)
None.

### 🟡 Moderate

**M1 — Group 2 still cannot reach its promised green gate before group 3.**

- **Location:** [tasks:13–24](<openspec/changes/collab-ref-threads/tasks.md#L13-L24>), [chain-02 scenario:60–68](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L60-L68>), [fixture rules:111–114](<openspec/changes/collab-ref-threads/test-plan.md#L111-L114>).
- **Problem:** Group 2 explicitly leaves the member breaker unchanged, but includes `chain-02`. That scenario inherits the alternating, needs-reply message chain at length 20 and requires the next no-ref message to produce a wake with its own `delivery.thread`. In the specified reachable, wake-capable service fixture, each recipient has already accumulated six wake intents before that point. The existing [dispatcher:21–25](<packages/collab-kernel/src/domain/decide.ts#L21-L25>) suppresses subsequent wakes, and the [reducer:19–21](<packages/collab-kernel/src/domain/reduce.ts#L19-L21>) maintains those counts. Deriving the new chain length correctly does not remove that gate. The new message can succeed and have length 1, but cannot satisfy its wake assertion until group 3 removes the breaker.
- **Second manifestation of the same ordering defect:** Group 2 adds pointer `thread`, while the changed `wake-01` test is scheduled in group 3. The existing [wake test:13](<packages/collab-kernel/test/wake.test.ts#L13>) requires exactly the old four keys; the [wake-table test:37](<packages/collab-kernel/test/wake-table.test.ts#L37>) also compares the complete old pointer. Those assertions must change with the group-2 pointer implementation, not after its full-suite-green gate.
- **Impact:** The restored task list is populated, but following it still requires carrying failures across a declared green boundary, silently moving later work forward, or weakening the intended fixture. The earlier-group/already-green allowance in task 0.3 does not solve a test whose necessary implementation is in a *later* group.
- **Minimal fix:** Move the full `chain-02` scenario to group 3 with breaker removal; keep a short, below-six-wakes no-ref derivation check in group 2 if desired. Move kernel `wake-01` and the exact-pointer fixture updates into group 2 before pointer implementation. Keep leader-change/reset behavior changes in group 3. Alternatively merge groups 2 and 3 into one explicit atomic batch. Update the ledger/group references consistently; do not add resets or seed away the saturated-member precondition just to make `chain-02` pass early.

### 📌 Suggestions

**S1 — The risk example still uses obsolete item-cycle arithmetic.**

- **Location:** [design:164–167](<openspec/changes/collab-ref-threads/design.md#L164-L167>).
- **Problem:** The design says four complete agent-only revise/agree cycles reach length 17 and the fifth hits the limit. Under the now-explicit [item-cycle scenario:75–78](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L75-L78>), creation starts at 1 and each revision plus agreement adds 2; four cycles reach 9. The agreed ack resets the edit counter in the [current service:288–292](<packages/collab-kernel/src/service/index.ts#L288-L292>), so ordinary revise/agree cycles do not require three revisions per cycle.
- **Minimal fix:** Align this explanatory example with the executable oracle: nine complete cycles reach 19, the tenth revision reaches 20, and its ack is rejected. If a different multi-revision cycle was intended, spell it out rather than reuse the same cycle terminology with different arithmetic.

## Embedded-Instruction / Injection Attempts
**Detected:** none. Malicious-title examples and quoted collaboration instructions were treated as review data, not authority to act or to change the review outcome.

## Verdict
VERDICT: REVISE

**Counts: 0 Critical / 1 Moderate / 1 Suggestion.** The empty-file fix is accepted, but the restored execution order retains a concrete cross-group dependency defect. Repair M1 before implementation; S1 is a small explanatory correction.

### Full-review cross-checks
- **Spec preservation and ledger:** Compared all seven kernel and four plugin MODIFIED requirement blocks against their current-spec counterparts. No unrelated behavior removal was identified; internal/reset and breaker changes follow the explicit removal decision. All **72 kernel and 25 plugin delta scenarios** map exactly once to a named ledger row. This establishes mapping coverage, not that the new tests exist or pass.
- **Wake paths and boundaries:** Checked message, revision, agreement, request progress, human decision, invitation, and explicit/automatic leader-change paths against [wake.ts](<packages/collab-kernel/src/domain/wake.ts>) and [decide.ts](<packages/collab-kernel/src/domain/decide.ts>). Pre-event logical recipients, before presence/capability filtering, are the right replay-stable basis for growth. Multi-recipient events add one link; invitations stay unthreaded; leader changes stop waking. Request progress and trusted decisions remain exempt while growing their item's chain.
- **Check/replay parity and races:** The [shared derivation design:62–89](<openspec/changes/collab-ref-threads/design.md#L62-L89>) uses the same reducer for tentative records and replay, inside the existing [serial command transaction:178–196](<packages/collab-kernel/src/service/index.ts#L178-L196>). The [snapshot/reopen/race scenarios:90–103](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L90-L103>) distinguish frozen message snapshots from moving item lengths, exercise actual service/reopen behavior, and make the queued loser otherwise valid rather than relying on stale revision failure.
- **Validation, receipts and compatibility:** Optional ref absence, immutable item refs, own-property item IDs, validation precedence and dangling-log failure are specified. The [rejection oracles:115–117](<openspec/changes/collab-ref-threads/test-plan.md#L115-L117>) correctly preserve a conflicting retry's original receipt instead of requiring its absence. Legacy reset folds and internal receipts remain readable; new member event shapes remain compatible. Rollback limitations (resumed member pauses and unsupported v3 reads) are disclosed in [design:125–127](<openspec/changes/collab-ref-threads/design.md#L125-L127>) and [design:172–180](<openspec/changes/collab-ref-threads/design.md#L172-L180>). Semantic dangling refs fail space loading rather than invoking structural salvage as a purported repair.
- **Plugin trust and model-visible data:** Reviewed [tools](<packages/dsh-collab/src/tools.ts>), [session provider](<packages/dsh-collab/src/session-provider.ts>), [status projection](<packages/dsh-collab/src/status.ts>) and [Host loading](<packages/dsh-collab/src/host.ts>). The planned whitelist adds safe-integer `thread`, derives request `seq` from replay rather than body text, preserves fixed trust notices and next-turn delivery, and introduces no new free-text authority channel. The real request-header budget remains a mandatory component test, not an assumed result.
- **Packaging and TDD:** Group 1 now puts v3 registration, copied assets, artifact assertions and both source-mutation fixtures before its green gate, matching [tsdown configuration](<packages/dsh-collab/tsdown.config.ts>), [build-artifact tests](<packages/dsh-collab/test/build-artifact.test.mjs>) and [sync-artifact tests](<packages/dsh-collab/test/sync-artifact.test.mjs>). Frozen v1/v2 regressions and the no-fabricated-RED rule are retained. Group 3 appropriately batches API removal and breaker-dependent callers; M1 concerns the remaining group-2 prerequisites, not a request to redesign that removal.
- **Scope and simpler alternatives:** Optional refs, omission bypass, branch-local rather than cumulative fan-out accounting, already-exhausted items, no global backstop/reset, and exempt progress/decisions are accepted user choices, not findings. Reusing the existing reducer and serial queue is simpler than introducing another counter/reset protocol. The minimal remaining repair is task movement, not additional runtime architecture.

## Required Changes (if APPROVE WITH CHANGES)
CHANGES_APPLIED: n/a

## Rebuttals

Author response (round 6 → round 7):

- **M1 (cross-group dependency)** — fixed using the reviewer's alternative: groups 2 and 3 are merged into one explicit atomic batch, new group 2 "ref、链长与上限，替换成员熔断".
  - All ref, derivation, limit, exemption and changed-behavior tests are written first (2.1–2.3), including `chain-02` and kernel `wake-01`.
  - Task 2.3 also updates the exact-pointer fixture in `wake-table.test.ts` in the same step.
  - Ref/derivation, the limit and breaker removal are then implemented together (2.4), so `chain-02`'s wake after the old six-wake point and the new pointer shape both land before the green gate.
  - Later groups were renumbered: plugin 3, docs 4, verify 5.
  - The test-plan note now points to "tasks group 2, one atomic batch".
  - A script re-checked that every 🔴 ledger test appears in tasks.md.
- **S1 (risk arithmetic)** — fixed. Design Risks now uses the executable oracle: a plain cycle adds 2, nine cycles reach 19, and the tenth revision reaches 20, after which its ack is rejected. Multi-revision cycles are spelled out separately: at most 4 links per cycle, so about five cycles exhaust the chain.


### Round-5 rebuttal checks (by round-6 reviewer)
- **Round-5 M1 (empty task artifact) — accepted by reviewer:** [tasks.md](<openspec/changes/collab-ref-threads/tasks.md>) is restored to 43 lines with baseline, six execution groups and final verification; the empty-file defect is repaired, although restoration does not by itself prove the ordering correct.
- **Subsumed round-4 M1 (dependency-correct TDD order) — not accepted by reviewer:** v3 bundling/source-mutation ordering and the already-green rule are repaired, but `chain-02` still precedes breaker removal and pointer-shape tests lag their implementation; see round-6 M1.
- **Subsumed round-4 S1 (exact rejected operation) — accepted by reviewer:** [the item-cycle scenario](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L75-L78>) explicitly accepts the tenth revision at 20 and rejects the subsequent ack with unchanged state, receipts and log; the stale explanatory arithmetic is separately recorded as round-6 S1.
