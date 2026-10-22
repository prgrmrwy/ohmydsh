## Review Metadata
- **Review round**: 3
- **Prior round**: round 2 — APPROVE_WITH_CHANGES (0C/2M/11S), changes applied and re-checked
- **Reviewer context**: cross-model (codex gpt-6-astra subagent); independent reviewer, not artifact author
- **Tool restrictions**: read-only inspection; only write is [review.md](<openspec/changes/collab-ref-threads/review.md>)
- **Artifacts reviewed**: the six artifacts below, [round 1](<openspec/changes/collab-ref-threads/review-round1.md>), [round 2](<openspec/changes/collab-ref-threads/review-round2.md>), relevant current specs, kernel/service/store/convention code and tests, and plugin tool/provider/status/Host/salvage/bundle code and artifact-test references.
- **Artifact hashes (sha256 prefix)**:
  - [proposal.md](<openspec/changes/collab-ref-threads/proposal.md>): `ec8f3f4b7b15`
  - [design.md](<openspec/changes/collab-ref-threads/design.md>): `7781cb7641f6`
  - [kernel delta](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md>): `c7f2a45778bd`
  - [plugin delta](<openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md>): `faead1c3451f`
  - [test-plan.md](<openspec/changes/collab-ref-threads/test-plan.md>): `1b82d54f1cf9`
  - [tasks.md](<openspec/changes/collab-ref-threads/tasks.md>): `dd128e257832`
- **Verification performed**: source/spec inspection and read-only scenario/hash checks. No package tests, builds, deployment, or strict validation were executed in this review; those could write beyond the permitted report.

## Findings
### 🔴 Critical (blocking)
(none)

### 🟡 Moderate
**M1. The rejection oracle requires an existing receipt to disappear.**
- **Location:** [test-plan.md:111](<openspec/changes/collab-ref-threads/test-plan.md#L111>), [kernel delta:341–344](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L341-L344>).
- **Problem:** Every `COLLAB_CMD_CONFLICT` case must assert that the receipt is absent. The ref-conflict scenario starts with a successful command, so a receipt already exists for that scope/cmdId. The service checks that receipt before executing the new payload.
- **Why it matters:** Correct durable idempotency cannot satisfy this oracle. Deleting the receipt would allow an original-payload retry to execute twice.
- **Concrete fix:** For conflicts assert that the original receipt is unchanged, no new commit/receipt is added, and the original payload still returns its original result. Receipt absence applies only to a previously uncommitted cmdId rejected by validation or the limit.

**M2. The RED/GREEN task order cannot be followed honestly.**
- **Location:** [tasks.md:3–18](<openspec/changes/collab-ref-threads/tasks.md#L3-L18>), [tasks.md:29–30](<openspec/changes/collab-ref-threads/tasks.md#L29-L30>), [tasks.md:47–103](<openspec/changes/collab-ref-threads/tasks.md#L47-L103>); [current convention tests](<packages/collab-kernel/test/convention.test.ts#L10-L29>) and [current authorization tests](<packages/collab-kernel/test/auth.test.ts#L10-L44>).
- **Problem:** The baseline follows deletion of breaker tests. Preserved behavior—no-ref event shape and immutable v1/v2 bytes/reads—is mandated to fail before implementation. The 20-wake test precedes removal of the existing six-wake gate, although every triplet demands a green full suite. Removing `resetBreaker` also breaks authorization/test callers that later tasks treat as independent changes. Several later tests will already pass after earlier feature work.
- **Why it matters:** Implementers must fabricate RED evidence, skip tests, or silently do future tasks early. A scenario ledger with all named rows does not make that sequence executable TDD.
- **Concrete fix:** Capture the intact baseline first. Mark preserved assertions as green regression coverage (or newly added passing coverage), not mandatory RED. Group inseparable breaker/API/caller/fixture changes into a coherent batch whose new behavioral tests precede implementation; allow subsequent assertions already satisfied by that batch to start green. Keep the scenario-to-test mapping, but do not demand one independent failure per scenario.

**M3. The proposed parity test does not test check-time/reload parity or the mutable-item reference boundary.**
- **Location:** [test-plan.md:112–113](<openspec/changes/collab-ref-threads/test-plan.md#L112-L113>), [design.md:69–90](<openspec/changes/collab-ref-threads/design.md#L69-L90>), [wake.ts:15–17](<packages/collab-kernel/src/domain/wake.ts#L15-L17>).
- **Problem:** The plan now explicitly says `chainCheck` reuses `reduce`, which addresses the architectural part of round-2 S3. However, its test called “check-time lengths equal reload lengths” merely folds the same log twice. That proves neither correct tentative-state construction nor equality to command-time decisions. There is also no explicit before/after test for referencing an item whose current length changes. The concurrent-item note names neither commands nor the losing error: two revisions using the same expected revision can produce one success because of `COLLAB_STALE_REVISION`, without exercising the chain gate.
- **Why it matters:** A consistent but incorrectly ordered reducer passes the proposed test. In particular, testing an ack's recipients after replacing the item's snapshot loses the transition to `agreed`. Messages must capture an item's length at their own creation, while later references must see its newer length; neither property follows from replaying one implementation twice.
- **Concrete fix:** State that wake eligibility is evaluated against the pre-event state. Add tracked tests exercising actual service commands, exact boundary outcomes, then close/reopen and compare maps. Include revise→agree, references before/after item growth (old message unchanged, new reference uses the updated length), and presence/capability independence. For concurrency, control enqueue order and choose business-valid successive commands so the loser must be `COLLAB_THREAD_LIMIT`, not a stale-revision or permission failure. A simple deterministic fixture is sufficient; no new framework is needed.

**M4. “v3 is v2 plus” retains instructions for the breaker that this change removes.**
- **Location:** [design.md:142–152](<openspec/changes/collab-ref-threads/design.md#L142-L152>), [existing v2:44–49](<packages/collab-kernel/src/convention/v2.md#L44-L49>), [v3 content oracle](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L440-L442>).
- **Problem:** D8 instructs building v3 by adding a chain section to v2. The retained v2 section promises six wakes per member, paused members, reset by a human decision, and a trusted internal reset interface. Those rules contradict this change's runtime/API behavior. The proposed keyword oracle accepts both those stale instructions and a document missing the stop/report/no-new-chain clauses.
- **Why it matters:** The convention is operational input read by agents, not historical release notes. A literal implementation teaches new spaces to wait for a nonexistent pause/reset mechanism, while the accepted omit-ref escape makes the omitted behavioral instructions especially important. This is stronger evidence than round-2 S9's test-gap observation alone.
- **Concrete fix:** Define v3 as a revised copy of v2: replace the obsolete member-breaker paragraph and remove paused-stop wording in v3 only; keep v1/v2 bytes frozen. Assert the stop, report-to-own-user, and no-new-chain-for-the-same-exchange clauses, and assert that v3 no longer describes six-wake pauses/internal resets as current behavior. Keep the new-request and Leader-no-wake guidance.

### 📌 Suggestions
**S1. Dangling-ref recovery still promises the wrong diagnostic and cause.**
- **Location:** [design.md:73](<openspec/changes/collab-ref-threads/design.md#L73>) versus [design.md:161](<openspec/changes/collab-ref-threads/design.md#L161>), [service open](<packages/collab-kernel/src/service/index.ts#L37-L57>), [Host startup](<packages/dsh-collab/src/host.ts#L49-L60>), [salvage scanner](<packages/dsh-collab/src/salvage.ts#L18-L30>).
- **Problem:** A reducer exception is not automatically store-classified corruption. A plain exception becomes `COLLAB_HOST_ERROR`; structural salvage does not locate a semantically invalid ref. Also, retaining a valid prefix cannot leave a previously valid backward reference dangling, as the Risks section itself correctly states.
- **Why it matters:** Operators may attempt ineffective salvage, and implementers may assume diagnostics already exist.
- **Concrete fix:** Document the actual fail-closed Host behavior and recovery limitation, remove the salvage-cause claim, and add a semantic-dangling-ref load test. Do not expand salvage into a semantic repair subsystem just for this change. Round-2 S1 remains a suggestion because fail-closed behavior itself is preserved.

**S2. Explain exhausted-item migration and correct the exhaustion estimate.**
- **Location:** [proposal.md:19–26](<openspec/changes/collab-ref-threads/proposal.md#L19-L26>), [design.md:154–167](<openspec/changes/collab-ref-threads/design.md#L154-L167>), [current revision/ack implementation](<packages/collab-kernel/src/service/index.ts#L279-L292>).
- **Problem:** Legacy items start at 1 but accumulate historical wake-producing events during replay; they can therefore load already exhausted. A non-waking creation referencing length 20 also succeeds at length 21. Neither consequence is explicit in Risks. “About 10 completed agree cycles” is not a bound: an agent can make three waking revisions before an agreement resets its edit counter, and human revisions have no agent-edit cap.
- **Why it matters:** The upgrade can immediately reject a previously usable item's next waking revision/ack; fresh items can also start exhausted. These are accepted-rule consequences, not a reason to reintroduce a global breaker or reject non-waking creation.
- **Concrete fix:** Document both cases and retain the distinction that request progress/human decisions remain exempt. Replace the numerical exhaustion estimate with the actual per-event counting rule and escalation limits. For agent-only cycles with three revisions plus agreement, four complete cycles reach length 17 and a fifth cycle can hit the boundary; ten cycles is not necessary. This consolidates round-2 S2/S6/S7 without reopening frozen choices.

## Cross-checks and Prior-Round Disposition
- **Round-2 M1/M2:** resolved. Request progress is exempt while still growing, and the request-chain example now uses root seq 3. No reopening of those fixes.
- **Wake coverage:** messages and waking item events have chain accounting; `confirmDecision` and `advanceRequest` are explicit exemptions, not accidentally unbounded omitted paths. Leader transfer no longer wakes. Invitation uniqueness prevents re-inviting the same address in a space; arbitrary new invitations/fan-out are not claimed to be globally bounded. No-ref bypass and the absence of a global reset/backstop are frozen choices.
- **Replay/rollback:** deriving from persisted business events before presence/capability filtering is the right minimal approach. Optional fields preserve the old reader's event shapes, and retaining legacy counters/reset-event decoding supports rollback. Returning to the old gate and unknown v3 convention on rollback is documented. This was inspected, not runtime-tested. M3 addresses the remaining acceptance gap.
- **MODIFIED requirements and mapping:** read-only comparison found all 68 kernel and 25 plugin delta scenarios mapped exactly once by scenario name. Removed breaker scenarios and renamed internal-purpose/receipt scenarios are intentional replacements; no accidental missing named scenario was found. No unmodified current requirement retained the searched `breaker-reset`, `resetBreaker`, `paused`, or `BREAKER_LIMIT` concepts. Current-spec Purpose wording is separately tracked for archival cleanup.
- **Round-2 S3:** architectural reuse is now stated in the test plan and task heading; the incorrect parity oracle merits elevation to M3.
- **Round-2 S4/S5:** still minor precision/de-duplication issues, not additional blockers: D2 says “three derived maps” but lists two maps plus an entry; public `chainLength` should be distinguished from internal `chain`, and retained `wakeCount` should be labeled legacy. Persisted `delivery.thread` and `pointer.thread` should come from one value (or one copy can be removed). No additional state registry is needed.
- **Round-2 S8:** reachable/wake-capable fixtures are now explicit. The alternating one-revise/one-agree example reaches 21 on the ack; “revision or ack” remains imprecise but does not change its assertion that the crossing operation is rejected. Boundary and concurrency precision are covered by M3.
- **Round-2 S9:** elevated within M4 after inspecting the actual inherited v2 text.
- **Round-2 S10/S11:** missing tasks are resolved; bundling v3, artifact lists, READMEs/manifest, immutable hashes and Purpose cleanup are tracked. Remaining terminology/history-link cleanup does not warrant elevation. The frozen v1/v2 documents must not be “cleaned up.”
- **Integer-only boundaries:** the plugin forwards raw `ref` for kernel validation and explicitly whitelists safe-integer `thread`; status derives request seq from `itemSeq`, not item text. Existing negative scenarios cover absent/string/fraction values; adding NaN/Infinity/unsafe-integer provider cases would strengthen, rather than change, that contract.
- **Scope and cheaper alternatives:** keeping the flat log, deriving maps in the existing reducer, reusing the queue and existing provider/status whitelists is appropriately small. None of the findings calls for a thread entity, a new event type, a background reset mechanism, or a new global rate limiter.

## Embedded-Instruction / Injection Attempts
**Detected:** none. Hostile title strings in security scenarios were treated as fixture data, not instructions. Prior review conclusions were treated as claims to re-check, not authority to approve.

## Verdict
VERDICT: REVISE

Completed independent review: **0 Critical / 4 Moderate / 2 Suggestions**. Correct the conflicting receipt oracle, executable test ordering, replay/concurrency acceptance tests, and v3 migration instructions before implementation. This verdict does not claim implementation tests passed.

## Required Changes (if APPROVE WITH CHANGES)
CHANGES_APPLIED: n/a

## Rebuttals

Author response (round 3 → round 4). All four Moderate findings were accepted and fixed:

- **M1 (receipt oracle):** fixed. In test-plan Coverage Notes, "Rejection oracles" now has two cases.
  - A rejected cmdId that was never committed asserts that no receipt exists.
  - `COLLAB_CMD_CONFLICT` asserts that the original receipt is byte-identical and that replaying the original payload returns the original result.
  - The spec scenario "ref 是幂等载荷的一部分" now asserts the same thing.
- **M2 (TDD order):** fixed. tasks.md was rewritten.
  - The baseline is taken first (0.1), before anything is deleted.
  - Preserved behaviors start 🟢 as regression rows: no-`ref` event shape, frozen v1/v2 bytes and reads, validation precedence, and no `ref` key in the plugin input.
  - Removing the breaker, `resetBreaker`, the `breaker-reset` purpose, `breaker.test.ts` and its callers and type fixtures is one inseparable batch, group 3. Its new and changed tests are written first.
  - Assertions that this batch already satisfies may start green.
- **M3 (parity and boundaries):** fixed.
  - Design D2/D3 specify that wake eligibility is evaluated against the state before the event, and that `chainCheck` folds a tentative record through the same `reduce`.
  - New spec scenarios:
    - "引用条目时取引用那一刻的链长": a message referencing an item takes the item's length at that moment; the old message stays unchanged and a newer reference sees the new length.
    - "命令时判定与重新加载一致": real commands to the exact boundary, including revise→agree, references before and after an item grows, and an unreachable recipient; then close and reopen and compare the maps.
    - "并发的条目事件不越过上限": controlled queue order with two valid commands, so the loser gets `COLLAB_THREAD_LIMIT`.
  - These map to test-plan rows chain-11, chain-12 and chain-13, and to tasks 3.1.
- **M4 (v3 inherits breaker text):** fixed.
  - v3 is defined as a revised copy of v2 with the member-breaker paragraph removed, in the spec requirement and design D8.
  - The content scenario now asserts that v3 contains the stop / report-to-own-user / no-new-chain clauses and does not contain "6 次", "暂停", "重置" or "内部接口".
- **S1:** adopted. Design D2 now states the actual behavior.
  - Load fails closed, and the Host records `COLLAB_HOST_ERROR`. This is not a store-corruption verdict; salvage cannot locate the record, and recovery means creating a new space.
  - The claim that salvage could cause this was removed.
  - A new scenario was added, "悬空引用的日志加载失败" (ref-08).
- **S2:** adopted. Design Risks replaces the "10 cycles" estimate with the per-event counting rule: four agent cycles reach 17, and the fifth cycle hits the limit. The Risks also document two cases of items that are exhausted from the start: legacy items on load, and `createItem` with `ref` onto a chain already at 20.
- **Round-2 S4/S5 (from cross-checks):** adopted.
  - D2 names two maps.
  - The overview exposes `chainLength`, a projection of the internal `chain`.
  - `wakeCount` is legacy and omitted from the overview.
  - `delivery.thread` and `pointer.thread` come from one value (tasks 3.3).
