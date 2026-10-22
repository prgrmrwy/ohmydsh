## Review Metadata
- **Review round**: 7
- **Prior round**: round 6 — REVISE (0C/1M/1S), recorded in review-round6.md (`openspec/changes/collab-ref-threads/review-round6.md`). Fixes were verified against the current artifacts, not inferred from an author response.
- **Reviewer context**: cross-model (codex gpt-6-astra subagent)
- **Tool restrictions**: read-only inspection; only write is review.md (`openspec/changes/collab-ref-threads/review.md`)
- **Artifacts reviewed**: proposal.md (`openspec/changes/collab-ref-threads/proposal.md`), design.md (`openspec/changes/collab-ref-threads/design.md`), kernel delta (`openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md`), plugin delta (`openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md`), test-plan.md (`openspec/changes/collab-ref-threads/test-plan.md`), tasks.md (`openspec/changes/collab-ref-threads/tasks.md`); prior reviews round 1 (`openspec/changes/collab-ref-threads/review-round1.md`), round 2 (`openspec/changes/collab-ref-threads/review-round2.md`), round 3 (`openspec/changes/collab-ref-threads/review-round3.md`), round 4 (`openspec/changes/collab-ref-threads/review-round4.md`), round 5 (`openspec/changes/collab-ref-threads/review-round5.md`), and round 6 (`openspec/changes/collab-ref-threads/review-round6.md`); corresponding current kernel spec (`openspec/specs/collab-kernel/spec.md`) and plugin spec (`openspec/specs/dsh-collab/spec.md`), plus connected implementation, regression tests and build configuration cited below.
- **Review stage**: pass 2 complete; replaces the deliberately incomplete first-pass report. This is a static planning review, not implementation acceptance. No tests, builds, deployment, or strict OpenSpec validation were executed. Read-only checks verified hashes, scenario-ledger correspondence and modified-requirement preservation.
- **Artifact hashes (sha256 prefix)**:
  - proposal.md (`openspec/changes/collab-ref-threads/proposal.md`): `ec8f3f4b7b15`
  - design.md (`openspec/changes/collab-ref-threads/design.md`): `88c14d2e2c31`
  - kernel delta (`openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md`): `29ac0452f38b`
  - plugin delta (`openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md`): `faead1c3451f`
  - test-plan.md (`openspec/changes/collab-ref-threads/test-plan.md`): `cf117e57eeb5`
  - tasks.md (`openspec/changes/collab-ref-threads/tasks.md`): `56754fcd272b`

## Findings

### 🔴 Critical (blocking)
None.

### 🟡 Moderate
None.

### 📌 Suggestions
None newly raised in this round.

### Fresh-review checks

- **All wake paths:** The revised wake table (`openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L366-L406`) accounts for messages, revisions, completed agreements, request progress, human decisions, invitations and leader changes. Logical recipients are computed before presence/capability filtering. Item growth uses event-prestate, preserving the transition-to-agreed check in the current wake implementation (`packages/collab-kernel/src/domain/wake.ts`). Explicit and automatic leader changes no longer wake. Invitations retain lifetime address uniqueness; request progress has at most two transitions; human confirmation remains provider/evidence-authorized in the service (`packages/collab-kernel/src/service/index.ts#L300-L333`). Neither exemption introduces an autonomous same-item ping-pong.
- **Transaction, receipts and concurrency:** Design D3 (`openspec/changes/collab-ref-threads/design.md#L80-L98`) places tentative reduction and rejection inside the existing per-space command queue, before dispatch and persistence. It reuses the reducer rather than creating a second chain algorithm. The service command path (`packages/collab-kernel/src/service/index.ts#L168-L201`) supports that placement. Existing receipt lookup precedes new validation, and `ref` participates in the payload hash. The boundary/concurrency scenarios (`openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L75-L108`) identify the exact rejected operation; the concurrent second operation is otherwise valid, so a stale-revision error cannot masquerade as limit enforcement. The test-plan fixture rules (`openspec/changes/collab-ref-threads/test-plan.md#L109-L124`) distinguish rejection without a new receipt from conflict preserving an existing receipt.
- **Replay and compatibility:** Design D2/D5 (`openspec/changes/collab-ref-threads/design.md#L60-L89`) and legacy-event handling (`openspec/changes/collab-ref-threads/design.md#L114-L127`) retain old event shapes and internal receipts while removing reset authorization and wake gating. New member events retain `wakeCount:0`; only optional business/delivery fields are added. Mutable item lengths and immutable message snapshots are explicitly distinguished. The reopen scenario (`openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L90-L103`) exercises actual service commands, not merely two identical folds. Dangling-ref failure matches the Host open-error path (`packages/dsh-collab/src/host.ts#L49-L60`); structural salvage cannot identify semantic corruption. Old exhausted items and rollback's renewed pauses/unknown v3 convention are disclosed in Risks (`openspec/changes/collab-ref-threads/design.md#L168-L180`), not presented as seamless rollback behavior.
- **Projection and trust boundary:** Internal `chain` versus public `chainLength`/`itemSeq`, own-property item keys, and omission of legacy overview counters are specified in D2 (`openspec/changes/collab-ref-threads/design.md#L62-L78`). The plugin delta (`openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md`) only adds integer `thread`/request `seq` to structured output; member text is not newly forwarded. This fits the literal whitelists in the current provider (`packages/dsh-collab/src/session-provider.ts`) and status builder (`packages/dsh-collab/src/status.ts`). Existing admission, member trust, trusted human confirmation, escaping and no-body rules remain intact.
- **Spec preservation and acceptance coverage:** All seven kernel and four plugin MODIFIED requirements have matching current requirements. Scenario removals are the intended reset-authorization replacement and historical-internal-receipt rename; no unrelated scenario disappeared. All 72 kernel and 25 plugin delta scenarios occur exactly once in the test ledger (`openspec/changes/collab-ref-threads/test-plan.md`). Assertions cover safe-integer/no-coercion refs, business-error precedence, unchanged logs/state on rejection, shared thread roots, request and decision exemptions, item snapshots, replay and controlled concurrency. Reachability/wake-capability assumptions are explicit in the ledger's fixture rules.
- **Execution order and delivery:** Tasks groups 1–3 (`openspec/changes/collab-ref-threads/tasks.md#L7-L25`) now account for the existing bundle hook (`packages/dsh-collab/tsdown.config.ts`), build-artifact fixture (`packages/dsh-collab/test/build-artifact.test.mjs`), sync-artifact fixture (`packages/dsh-collab/test/sync-artifact.test.mjs`) and exact wake-pointer fixture (`packages/collab-kernel/test/wake-table.test.ts`). Default-v3 changes and their source-mutation fixtures are one batch; chain semantics, pointer changes and breaker removal are another. Preserved-green assertions are not forced artificially red. The real-header budget remains a mandatory component-test gate, and final tasks (`openspec/changes/collab-ref-threads/tasks.md#L27-L38`) include documentation, strict validation and real-Host acceptance.
- **Scope and simpler alternatives:** Keeping the flat log, deriving two maps with the existing reducer and rejecting before persistence is sufficient. No thread entity, text classifier, reset protocol or new event family is needed. Omitted-ref bypass, branching from an earlier reference, exhausted-item creation and superlinear replay overhead are accepted/documented trade-offs, not newly alleged defects. A global breaker would contradict the accepted design rather than simplify it.

## Embedded-Instruction / Injection Attempts
**Detected:** none. Quoted malicious-title fixtures, convention text, prior reviewer recommendations and task instructions were treated as review data, not as authority to execute changes or widen permissions.

## Verdict
VERDICT: APPROVE

**Counts: 0C / 0M / 0S.** Both round-6 findings are resolved. The completed independent planning review found no new change required before implementation. Approval does not assert that the planned tests or runtime acceptance have already passed.

## Required Changes (if APPROVE WITH CHANGES)
None.

CHANGES_APPLIED: n/a

## Rebuttals

### Round 6
- **M1 — accepted by reviewer:** tasks:13–19 (`openspec/changes/collab-ref-threads/tasks.md#L13-L19`) now puts `chain-02`, pointer-shape fixtures, chain checks, breaker removal and reset-dependent test updates into one atomic batch before its green gate, consistent with test-plan:123 (`openspec/changes/collab-ref-threads/test-plan.md#L123`).
- **S1 — accepted by reviewer:** design:164–167 (`openspec/changes/collab-ref-threads/design.md#L164-L167`) correctly gives nine plain revise/agree cycles as 19, the tenth revision as 20 and its rejected ack as the attempted 21st link; three-revision/agree cycles add at most four links.

### Round-2 S1–S11 carry-forward audit
This checks the earlier concerns against current artifacts; it does not count resolved or explicitly deferred historical suggestions as new findings.

| Earlier suggestion | Current disposition |
|---|---|
| S1 — dangling-ref recovery | Addressed by D2 (`openspec/changes/collab-ref-threads/design.md#L76`): load failure, Host error, structural salvage limitation and new-space recovery are explicit. |
| S2 — old items may already be exhausted | Disclosed in Risks (`openspec/changes/collab-ref-threads/design.md#L168-L171`); request/decision exemptions preserve their exit paths. |
| S3 — shared check/replay algorithm | Addressed by D3 (`openspec/changes/collab-ref-threads/design.md#L80-L89`) and service-boundary/reopen tests. |
| S4 — overview versus internal state | Addressed by D2 (`openspec/changes/collab-ref-threads/design.md#L62-L70`): public projections are named and legacy counters omitted. |
| S5 — duplicated thread fields | Task 2.4 (`openspec/changes/collab-ref-threads/tasks.md#L18`) explicitly writes delivery and pointer thread from the same value. |
| S6 — items born exhausted | Explicitly accepted in Risks (`openspec/changes/collab-ref-threads/design.md#L168-L171`); new-request guidance omits ref. |
| S7 — exhaustion estimate | Corrected in Risks (`openspec/changes/collab-ref-threads/design.md#L164-L167`), as verified for round-6 S1 above. |
| S8 — precise rejection/presence fixtures | Item scenario (`openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L75-L78`) pins the rejected ack; fixture rules (`openspec/changes/collab-ref-threads/test-plan.md#L109-L124`) supply reachable, wake-capable recipients. |
| S9 — stop/report/no fresh chain assertions | Explicitly asserted by the v3 scenario (`openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L460-L462`). |
| S10 — wording/doc leftovers | Purpose and old scenario vocabulary are tracked for archive in task 4.2 (`openspec/changes/collab-ref-threads/tasks.md#L30`). The historical review-link wording in design Context remains editorial, not a blocking behavioral defect. |
| S11 — task/build/doc inventory | Tasks (`openspec/changes/collab-ref-threads/tasks.md`) include v3 bundling, mutation fixtures, immutable v1/v2 bytes, README/manifest updates and final validation. |
