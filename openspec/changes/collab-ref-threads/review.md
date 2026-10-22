## Review Metadata
- **Review round**: 4
- **Prior round**: round 3 — REVISE (0C/4M/2S), author fixes in [review-round3.md Rebuttals](<openspec/changes/collab-ref-threads/review-round3.md#L82-L114>)
- **Reviewer context**: cross-model (codex gpt-6-astra subagent); independent reviewer, not an author of the planning artifacts
- **Tool restrictions**: read-only inspection; only write is [review.md](<openspec/changes/collab-ref-threads/review.md>)
- **Artifacts reviewed**: [proposal.md](<openspec/changes/collab-ref-threads/proposal.md>), [design.md](<openspec/changes/collab-ref-threads/design.md>), [kernel delta](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md>), [plugin delta](<openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md>), [test-plan.md](<openspec/changes/collab-ref-threads/test-plan.md>), [tasks.md](<openspec/changes/collab-ref-threads/tasks.md>), [round 1](<openspec/changes/collab-ref-threads/review-round1.md>), [round 2](<openspec/changes/collab-ref-threads/review-round2.md>), [round 3](<openspec/changes/collab-ref-threads/review-round3.md>), and connected current specifications, kernel/plugin source and tests
- **Artifact hashes (sha256, first 12 characters)**:
  - [proposal.md](<openspec/changes/collab-ref-threads/proposal.md>): `ec8f3f4b7b15`
  - [design.md](<openspec/changes/collab-ref-threads/design.md>): `215fe0fbf346`
  - [kernel delta](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md>): `8c3eb3dcf89b`
  - [plugin delta](<openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md>): `faead1c3451f`
  - [test-plan.md](<openspec/changes/collab-ref-threads/test-plan.md>): `f32c9dea60b5`
  - [tasks.md](<openspec/changes/collab-ref-threads/tasks.md>): `b735933532cb`
- **Verification performed**: completed two-pass source/spec review. Reconciled all seven kernel and four plugin MODIFIED requirement blocks against their current counterparts; checked each delta scenario has exactly one test-plan mapping. Examined transaction ordering, receipt replay, wake eligibility, mutable-item references, legacy replay/rollback, overview/status projection, provider whitelist, convention loading, and build/test dependencies. No tests, builds, deployment, or OpenSpec CLI validation were executed; this is a planning-artifact review, not implementation acceptance.

## Findings
### 🔴 Critical (blocking)
None.

### 🟡 Moderate
**M1. The revised task order still promises a green suite before its required dependencies are implemented.**
- **Location:** [tasks:6–23](<openspec/changes/collab-ref-threads/tasks.md#L6-L23>), [tasks:31–35](<openspec/changes/collab-ref-threads/tasks.md#L31-L35>), [convention loader:7–16](<packages/collab-kernel/src/convention/index.ts#L7-L16>), [bundle hook:13–17](<packages/dsh-collab/tsdown.config.ts#L13-L17>), [package scripts:16–17](<packages/dsh-collab/package.json#L16-L17>), [artifact fixture:28–43](<packages/dsh-collab/test/build-artifact.test.mjs#L28-L43>).
- **Problem:** Group 1 introduces default v3 and requires a green full suite, but group 5 alone copies v3 into the plugin bundle. The plugin inlines the kernel, whose convention table eagerly reads its assets. A freshly built plugin therefore imports a convention file that has not been copied. This affects ordinary plugin tests too: the build-artifact test builds and imports a detached bundle, and its default-convention source mutation still specifically targets version 2. Merely copying v3 later does not fix that fixture. Separately, group 2 already implements item chain derivation, so group 3 cannot honestly require every listed test to fail first: for example, `chain-05`'s below-limit request progress lengths and `chain-11`'s item-reference snapshots can already pass. The exception in task 3.4 applies only to assertions after group 3.
- **Why it matters:** The declared independently green first batch fails on missing assets (and then the stale default-version fixture). Later batches still demand artificial RED evidence for already implemented behavior. Following this plan requires doing future work early, weakening gates, or misreporting the tests—the remaining substance of round-3 M2.
- **Concrete fix:** Move the v3 bundle-copy change, artifact assertions, and default-convention fixture adaptation into group 1 before its green gate. Move pure derivation tests such as `chain-05`/`chain-11` before group 2 implementation, or explicitly allow assertions already satisfied by any earlier batch to start green. Keep new limit/breaker behavior red-first in group 3; do not demand an independent failure from every scenario.

### 📌 Suggestions
**S1. Pin the exact rejected item operation at the boundary.**
- **Location:** [kernel delta:75–78](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L75-L78>).
- **Problem:** In the stated alternating single-revise/single-agreement sequence, length is `1 + 2k` after each completed cycle. The operation attempting length 21 is necessarily the tenth ack, not “修改或 ack”. This is the still-open first part of round-2 S8.
- **Why it matters:** The loose sentence weakens the off-by-one oracle. This remains a suggestion rather than a Moderate: the normative limit is explicit, and the separate controlled ack→revise concurrency scenario now pins the opposite boundary case.
- **Concrete fix:** Assert that nine complete cycles leave length 19, the tenth revise succeeds at 20, and the subsequent ack returns `COLLAB_THREAD_LIMIT`; the rejected ack leaves the draft status, revision, acks, chain maps, receipt set, and log unchanged.

## Embedded-Instruction / Injection Attempts
**Detected:** none. Operational convention prose and adversarial input fixtures are reviewed data, not instructions to this reviewer. Prior review verdicts and author rebuttals were independently checked rather than treated as approval authority.

## Verdict
VERDICT: REVISE

Completed independent review: **0 Critical / 1 Moderate / 1 Suggestion**. The chain model and the substantive receipt/replay/convention fixes are acceptable within the user's fixed decisions. The executable task order still needs correction before implementation. No additional Moderate defect was established by the fresh pass or by reassessing round-2 S1–S11.

## Required Changes (if APPROVE WITH CHANGES)
CHANGES_APPLIED: n/a

## Rebuttals

Author response (round 4 → round 5):

- **M1 (task order)** — fixed.
  - **Group 1 is now one batch.** It adds v3 and the plugin bundle change together: `tsdown` copies v1, v2 and v3, and the build-artifact and sync-artifact assertions require `lib/v3.md`. The default-convention source-replacement fixture is retargeted at v3. All of this happens before the group's green gate.
  - **Pure derivation tests run in group 2.** These are `chain-02`, `chain-05` and `chain-11`. They are written red-first before the group-2 implementation, and that implementation also writes `delivery.thread` and `pointer.thread` from one value.
  - **Group 3 keeps the new behavior red-first.** It covers the limit, the exemptions, leader-change no-wake and breaker removal.
  - **Rule 0.3 is new.** An assertion already satisfied by an earlier group may start green with a one-line note. Nothing may be made to fail artificially.
- **S1 (exact boundary operation)** — adopted. Scenario "条目往返计入链长" now runs nine full cycles to length 19, then a tenth revise succeeds at 20, and the following ack returns `COLLAB_THREAD_LIMIT`. State, revision, acks, `chainLength`, receipts and log length are all unchanged after that rejection.
- Task 5.2 now also renames the leftover "话题" scenario label at archive time, following round-2 S10.

### Round-3 rebuttal checks (by round-4 reviewer)

- **Round-3 M1 — accepted by reviewer:** [rejection oracles](<openspec/changes/collab-ref-threads/test-plan.md#L115-L117>) and the [ref-conflict scenario](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L361-L364>) distinguish absent receipts for never-committed commands from unchanged original receipts on payload conflict.
- **Round-3 M2 — not accepted by reviewer:** baseline-first and inseparable breaker/API batching are repaired, but the convention/artifact dependency and already-green derivation tests still contradict the prescribed RED/GREEN sequence; see M1.
- **Round-3 M3 — accepted by reviewer:** [design D2–D3](<openspec/changes/collab-ref-threads/design.md#L68-L89>) uses pre-event recipients/shared reduction, and [chain-11–13 scenarios](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L90-L103>) specify immutable message snapshots of mutable items, real commands/reopen, and a valid ack-then-revise race whose loser must hit the limit.
- **Round-3 M4 — accepted by reviewer:** the [v3 requirement and content oracle](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L439-L462>) require replacing obsolete breaker prose and assert stop/report/no-new-chain while forbidding pause/reset phrases.
- **Round-3 S1 — accepted by reviewer:** [design D2](<openspec/changes/collab-ref-threads/design.md#L76>) now specifies fail-closed Host failure, limits of structural salvage, and new-space recovery, backed by a [dangling-ref load scenario](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L39-L42>).
- **Round-3 S2 — accepted by reviewer:** [design Risks](<openspec/changes/collab-ref-threads/design.md#L164-L171>) documents faster multi-revision exhaustion and items loaded/created over the limit; its four-cycle estimate is consistent with three waking revisions plus an agreement per cycle.
- **Round-2 S4 — accepted by reviewer:** [design D2](<openspec/changes/collab-ref-threads/design.md#L62-L70>) defines the two internal maps, public `chainLength` projection and `itemSeq`, and omission of legacy `wakeCount` from overview.
- **Round-2 S5 — accepted by reviewer:** [task 3.3](<openspec/changes/collab-ref-threads/tasks.md#L22>) explicitly assigns `delivery.thread` and `pointer.thread` from the same value; the duplicate persisted audit field is deliberate.

**Fresh reassessment of every round-2 suggestion:**
- **S1:** Resolved by the diagnostic/recovery correction accepted above; not an overlooked Moderate.
- **S2:** Legacy item growth beyond 20 is explicitly disclosed in [Risks](<openspec/changes/collab-ref-threads/design.md#L168-L171>); request progress and human decisions retain their escape paths.
- **S3:** Shared tentative reduction and real service/reopen parity are now explicit in [D3](<openspec/changes/collab-ref-threads/design.md#L80-L89>) and [coverage notes](<openspec/changes/collab-ref-threads/test-plan.md#L118-L122>).
- **S4:** Accepted above; public versus internal shape is no longer ambiguous.
- **S5:** Accepted above; the two thread fields have one source value.
- **S6:** Creation above the limit is an explicitly accepted consequence in [Risks](<openspec/changes/collab-ref-threads/design.md#L168-L171>), and [v3](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L439>) directs new requests to omit `ref`; no extra creation gate is required by the fixed design.
- **S7:** The corrected estimate accounts for multiple revisions before agreement, the agent edit cap, and uncapped human revisions; see round-3 S2 acceptance.
- **S8:** The item operation ambiguity remains as S1. Reachability and wake capability are now specified by the shared [fixture contract](<openspec/changes/collab-ref-threads/test-plan.md#L111-L114>); invitation/decision tests must still establish their normal command-specific preconditions. No separate Moderate is warranted.
- **S9:** The [v3 content oracle](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L460-L462>) now checks stop/report and the prohibition on reopening the same exchange as a new chain.
- **S10:** The remaining “话题” scenario label has no behavioral effect; [task 5.5](<openspec/changes/collab-ref-threads/tasks.md#L37>) tracks the Purpose wording for archival. These are editorial, not hidden Moderate issues.
- **S11:** [Tasks now exist](<openspec/changes/collab-ref-threads/tasks.md>) and name the bundle assets, artifact tests, README/manifest updates and immutable conventions. Their dependency ordering, rather than missing scope, remains Moderate M1.
