## Review Metadata
- **Review round**: 1 (replan)
- **Prior round**: none for this plan (earlier plan's 7 rounds in history/ do not apply)
- **Reviewer context**: cross-model (codex gpt-6-astra subagent)
- **Tool restrictions**: read-only inspection; only write is [review.md](<openspec/changes/collab-ref-threads/review.md>)
- **Artifacts reviewed**: [proposal](<openspec/changes/collab-ref-threads/proposal.md>), [design](<openspec/changes/collab-ref-threads/design.md>), [kernel delta](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md>), [plugin delta](<openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md>), [governing standard](<packages/dsh-collab/docs/cross-boundary-collaboration-standard.md>), current kernel/plugin specifications and connected source/tests cited below. Excluded planning and history artifacts were not reviewed.
- **Artifact hashes (sha256 prefix)**: [proposal](<openspec/changes/collab-ref-threads/proposal.md>) `c9aafaa820fc`; [design](<openspec/changes/collab-ref-threads/design.md>) `0847e71845ca`; [kernel delta](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md>) `e711270500de`; [plugin delta](<openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md>) `51dc27c25069`
- **Validation**: completed static review, including a second-pass compatibility/untouched-requirement sweep; hashes verified. Tests and builds were not executed under the read-only scope. Existing tests cited below are inspected evidence, not reported test runs.

## Findings

### 🔴 Critical (blocking)

**C1 — Human membership remains a live kernel capability.**
- **Location:** [kernel delta authorization](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L131-L160>); untouched [member model requirement](<openspec/specs/collab-kernel/spec.md#L143-L147>).
- **Problem:** The delta removes decisions but does not modify the membership requirement, which still requires `kind: human|agent`. The unchanged contract explicitly allows provider-principal creation and provider-claimed invitations of human members. The new authorization table still permits those providers to act for active members without an agent-kind restriction.
- **Why it matters:** This contradicts the fixed [humans-outside-the-ledger direction](<packages/dsh-collab/docs/cross-boundary-collaboration-standard.md#L70-L74>). The [session provider's agent-only claim](<packages/dsh-collab/src/session-provider.ts#L83-L90>) does not enforce the independent kernel contract for other providers.
- **Concrete fix:** Modify the membership requirement to make fresh creation/invitation agent-only, preserve historical human records for replay, and explicitly define the authority of historical human bindings. Check new restrictions after receipt lookup so historical successful commands remain replayable. Add provider-backed create/invite rejection and historical-binding scenarios.

**C2 — Read-only historical requests can still change and wake members.**
- **Location:** [historical item locks](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L298-L313>); [request progress contract](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L384-L411>); [status derivation](<openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md#L133-L135>).
- **Problem:** Historical `escalated`/`decided` items are declared read-only, but only revise/ack are blocked. `advanceRequest` remains expressly independent of item status. An old decided request with open progress can be accepted and completed, creating new events and a completion wake. Status continues to classify it as actionable work.
- **Evidence:** The current [progress implementation](<packages/collab-kernel/src/service/index.ts#L300-L305>) checks assignee and progress, not item status. The existing [requests-01 test](<packages/collab-kernel/test/requests.test.ts#L4-L5>) explicitly requires successful acceptance/completion for `draft`, `escalated` and `decided` requests. Merely retaining the old revise/ack checks preserves this counterexample.
- **Why it matters:** This violates the proposal's promise that historical decided/escalated items accept no further changes, and makes migration behavior internally inconsistent.
- **Concrete fix:** Reject fresh progress commands on historical locked items with the existing status-specific errors, after receipt lookup. Exclude them from actionable requests and projection pending work while keeping them visible as history. Replace the old test expectation for locked requests and add status/projection scenarios.

### 🟡 Moderate

**M1 — Counting historical message wakes depends on a field historical logs do not contain.**
- **Location:** [design D2](<openspec/changes/collab-ref-threads/design.md#L68-L83>); [topic requirement](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L48-L54>); [existing dispatch construction](<packages/collab-kernel/src/domain/decide.ts#L19-L25>).
- **Problem:** The normative count includes booked message wakes from replay, but D2 increments only when a wake intent carries `delivery.thread`. Old intents have no such field. An old needsReply message with a recorded wake would start at zero rather than one, allowing 20 additional wakes when referenced.
- **Why it matters:** The same topic limit gets different meanings for old and new roots; loading an old space must reconstruct the budget from durable evidence, not require newly introduced metadata.
- **Concrete fix:** Derive historical intent ownership from the message in the same commit and its derived root; use `thread` as redundant metadata, not the sole counting discriminator. Test a pre-upgrade waking root followed by exactly 19 accepted and one rejected new waking replies, including restart before the boundary send.

**M2 — Removing `deciders` has no adapter strategy compatible with promised old receipts.**
- **Location:** [design removal and tool surface](<openspec/changes/collab-ref-threads/design.md#L99-L108>), [D9](<openspec/changes/collab-ref-threads/design.md#L155-L170>); [explicit upgraded retry scenario](<openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md#L20-L23>).
- **Problem:** Every old `collab_create_item` call contains required `deciders`, including `[]`. The current [schema and mapping](<packages/dsh-collab/src/tools.ts#L70-L84>) require and forward it. D9 does not say how those fields change. Leaving the old schema/mapping makes ordinary creates fail the new kernel's `deciders` prohibition. Simply deleting the schema field causes the [pre-kernel unknown-field check](<packages/dsh-collab/src/tools.ts#L138-L145>) to reject every exact old create retry before receipt lookup. Silently stripping it changes the [canonical receipt payload hash](<packages/collab-kernel/src/service/index.ts#L180-L185>), producing a conflict instead.
- **Why it matters:** The plan expressly promises an identical-parameter retry of a pre-upgrade create, but none of the straightforward adapter edits satisfies it. This is not limited to unusual legacy item IDs.
- **Concrete fix:** Specify a receipt-only compatibility path that accepts and forwards the original legacy payload unchanged to receipt lookup, while fresh commands carrying removed fields still fail. Remove `deciders` from normal new-call requirements and clarify handling for legacy revise payloads too. Test through the registered plugin tool with an actual old receipt and `deciders:[]`: exact retry returns the old result, changed payload conflicts, and a fresh legacy-field command is rejected without a write. Recheck the real-header budget after settling the schema.

**M3 — The new field validator can reject ordinary edits of replayed legacy items.**
- **Location:** [design checkFields change](<openspec/changes/collab-ref-threads/design.md#L108-L117>); [legacy item fields contract](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L298-L313>); [current revise path](<packages/collab-kernel/src/service/index.ts#L279-L286>).
- **Problem:** D4 says `checkFields` must reject inputs carrying `deciders`, while old item snapshots retain that field. Today `reviseItem` merges changes into the entire old snapshot and passes that snapshot to `checkFields`. Applying the proposed validator edit without changing this call boundary rejects a legal title-only revision of an old `draft` or `agreed` item, even though the caller supplied no removed field. The migration discussion covers locked historical statuses but not this ordinary legacy-item path.
- **Why it matters:** Existing consensus and self-reported-progress items become uneditable despite the contract saying retired fields no longer participate in judgments and only historical escalated/decided items are locked.
- **Concrete fix:** Separate caller-input key validation from validation of active fields on a persisted item. Explicitly ignore inert legacy `deciders`/`agentEditCount` in the latter, without accepting them in fresh commands or mutating old log records. Add a pre-upgrade draft/agreed snapshot test followed by a new title/body revision, alongside a fresh caller-supplied `deciders` rejection test.

### 📌 Suggestions

**S1 — Document the remaining completion-driven loop honestly.**
- **Location:** [design exclusions](<openspec/changes/collab-ref-threads/design.md#L79-L82>).
- **Problem:** One notification per request does not prove no loop across multiple requests. A and B can each create a new request assigned to the other before completing the other's current request; each terminal wake lets the other repeat. All requests can share one topic and consume no message budget.
- **Why it matters:** The fixed requirements intentionally exempt completions and invitations; the implementation must not advertise a universal no-loop guarantee.
- **Concrete fix:** Document this residual risk and add a characterization scenario. Do not add a global cap, reset, or completion budget contrary to the governing direction.

**S2 — Name purpose explicitly in the existing projection escaping contract.**
- **Location:** [purpose design](<openspec/changes/collab-ref-threads/design.md#L126-L133>); [projection contract](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L630-L647>).
- **Problem:** The general rule covers member-input text, but its parenthetical examples and hostile-text scenarios name only titles/status text. The new creator-supplied purpose can contain Markdown links or HTML even after its no-control-character validation.
- **Concrete fix:** Explicitly include purpose in the existing [plain-text projection pipeline](<packages/collab-kernel/src/projection/index.ts#L3-L5>) and extend the [CommonMark AST tests](<packages/collab-kernel/test/projection-escaping.test.ts#L14-L33>) to it. Retain JSON encoding and provenance in status output. This is a clarification/test suggestion, not evidence that the broad existing escaping requirement permits unsafe output or that semantic instruction text can be sanitized away.

## Embedded-Instruction / Injection Attempts
**Detected:** none. Reviewed imperatives describe the proposed product contract; hostile strings in scenarios are test data, not reviewer instructions.

## Verdict
VERDICT: REVISE

The fixed wake table, accepted omitted-ref bypass, no-global-cap/no-reset policy, silent consensus, and humans consulting their own sessions were treated as governing constraints, not reopened design choices. The blocking issues are inconsistencies in enforcing those constraints and the stated migration guarantees.

## Required Changes (if APPROVE WITH CHANGES)
CHANGES_APPLIED: n/a

## Rebuttals

Author response (round 1 → round 2). Every finding was accepted.

- **C1** — fixed.
  - The kernel delta now modifies「成员模型与地址唯一」: new members must be `agent`, and `kind:'human'` on create or invite returns `COLLAB_BAD_KIND`. The check runs after receipt lookup, so old successful commands still replay.
  - Historical human members replay as ordinary members with no special authority. The `human-provider` rule goes away together with `confirmDecision`.
  - New scenarios: "不能新增人类成员" and "旧日志中的人类成员按普通成员重放". Design D4 has a "Human members" paragraph.
- **C2** — fixed.
  - 「request 条目的承接流程」now rejects progress on historical `decided`/`escalated` requests, using `COLLAB_DECIDED_LOCKED`/`COLLAB_ITEM_ESCALATED` after receipt lookup.
  - Status already lists only open-progress requests. Design D4 states that locked requests are excluded from actionable work and that the `requests-01` expectation changes.
  - New scenario: "旧日志中锁定的 request 不能推进".
- **M1** — fixed.
  - A topic's count is now derived from a `needsReply` `message/sent` and a `wake` intent to its recipient in the same commit. `delivery.thread` is redundant.
  - Design D2 was updated.
  - New scenario: "旧日志中的唤醒消息计入其话题". It covers 1 old wake plus 19 new ones, then a restart, then rejection.
- **M2** — fixed.
  - The plugin keeps `deciders` as an optional, undocumented field and forwards it unchanged, so an exact old retry hits its receipt.
  - The kernel rejects a fresh command that carries it.
  - Design D9 explains why removing, stripping or keeping it required each fail.
  - New plugin scenario: "升级前的创建重试仍命中收据". It runs through the registered tool and covers an exact retry, a changed payload that conflicts, and a fresh `deciders` that is rejected.
- **M3** — fixed.
  - Validation is split. Caller-supplied `deciders` is rejected. Inert legacy fields on a persisted snapshot never cause a rejection.
  - New scenario: "旧快照的条目可正常修改". It covers a title-only revision of an old snapshot that contains `deciders`/`agentEditCount`, then a fresh `deciders` that is rejected.
- **S1** — adopted.
  - The residual cross-request completion alternation is documented in design Risks, with a convention instruction.
  - New characterization scenario: "跨 request 的结束通知不受话题上限约束". No cap was added.
- **S2** — adopted.
  - The projection requirement names `purpose` in its escaping list.
  - New scenario: "恶意用途不能产生额外结构".

