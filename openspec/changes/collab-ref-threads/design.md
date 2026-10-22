## Context

The current kernel is `packages/collab-kernel`, as of `dsh-collab-member-trust`.

- **Ledger.** Each space is an append-only JSONL log of commits, one seq per commit. State is a pure fold (`reduce`) over the commits. Messages are stored as a flat array `{id, actor, to, body, needsReply}`, where `id` is the seq. Items are keyed by `itemId`; nothing records the seq at which they were created.
- **Breaker.** `Member.wakeCount` goes up on every `wake` `dispatch/intended`, and `breaker/reset{member}` sets it back to zero. `decideDispatch` skips a recipient once it has 6 wakes, except when the commit carries `decision/decided`. At that point the member's `presence` reads `paused`. Only `internal('breaker-reset')` can reset a member, and no host code does so. Agent-only spaces therefore stay paused forever, and the sender is never told its wake was dropped.
- **Observed failure.** In real use, ordinary unrelated work in one space paused a member at 6/6.

### User decisions (proposal)

- Count per task by chain length derived from an optional `ref`, without tracking who woke whom.
- The limit is 20 links per chain.
- Reject over-limit commands explicitly instead of dropping wakes silently. The agent stops and reports to its user.
- Add no global backstop and no human reset.
- Reject an invalid `ref`.
- Apply one unified model: item activity extends chains, and a leader change no longer wakes anyone.

### Constraints

- Old logs must replay without migration.
- The previous kernel should still be able to load new logs, so a rollback is safe.
- Published convention texts are immutable.
- The tool schema budget is 4200 characters. It currently measures 4002, with the same computation as the real header test.

### Review round 1

Round 1 returned REVISE with five Moderate findings against the previous per-thread-counter design. This design replaces that one. The Rebuttals section of review.md maps each finding to how it is resolved.

## Goals / Non-Goals

**Goals:**
- Loop protection per chain, with a new task starting at length 1.
- Every wake path is bounded by a chain or cannot loop.
- Over-limit is a visible command error and never a silent drop.
- The flat log is kept. Event changes are limited to optional fields.
- No new event types and no removed event shapes, so a rollback still loads.
- Paused members in existing spaces recover simply by loading under the new kernel.

**Non-Goals:**
- No thread entity, title, close or listing UI.
- No global per-member rate limit and no reset entry (user decision).
- No change to `needsReply` reply detection in `collab_status`.
- No change to item escalation (`ESCALATE_AFTER`).

## Decisions

### D1. `ref` is a seq; only messages and item creations can be referenced

A message's identity is already its seq. An item's creation seq follows from the log, so no new event field is needed. Allowing only these two kinds keeps "continue what?" meaningful. The target must already exist, so `ref < seq` and cycles are impossible.

Validation:
- `ref` must be a safe positive integer with no coercion. `null`, `"5"` and `1.5` are all rejected.
- It is checked after the existing business validation, which gives multi-fault inputs one deterministic error, and before the chain-limit check.
- `ref` is part of `payloadHash`, because the hash covers all input. Replaying with a different `ref` therefore returns `COLLAB_CMD_CONFLICT`.

**Rejected:**
- *Referencing by itemId.* That creates two namespaces. Agents get the seq instead from `overview.itemSeq` and from `collab_status` `requests[].seq`.
- *Caller-chosen thread names.* These can be forged and can collide.

### D2. Chain length is derived in `reduce`

`SpaceState` gains two derived maps, maintained incrementally while `reduce` folds the log:
- `chain: Record<seq, {length, thread}>`: one entry per message and per item creation. An item's entry sits under its creation seq and is updated in place when the item grows.
- `itemSeq: Record<itemId, seq>`.

The overview exposes these under the names in the spec. `chainLength: {seq: length}` is a projection of `chain`; `itemSeq` is exposed as is. `chain` is internal state. `Member.wakeCount` is still folded for old logs but is labelled legacy: nothing reads it, and the overview omits it.

A message stores the item length **at the time it is created**. A later reference to the same item reads the item's length as it is then. For example, a message that references item R at length 3 has length 4 and keeps it after R grows to 5. A new reference made after that point gets 6.

Item ids are written with own-property semantics (`Object.defineProperty`), the same way `reduce` already handles `items`. A `__proto__` item id therefore still resolves.

**Messages.** Each `message/sent` gets `{length: ref ? chain[ref].length + 1 : 1, thread: ref ? chain[ref].thread : seq}`.

**Items.** `item/created` is computed the same way. An item event that would wake someone adds 1 to the item's entry. "Would wake someone" is defined by the wake table *before* presence and capability filtering, so replay determines it without needing to know who was online. In code it is a `wakeRecipients(pre, [event]).size > 0` check, evaluated against the state **before** the event is applied. This matters for ack: after the agreed snapshot replaces the item, the transition to `agreed` is no longer visible. The check is a pure function of state, so it is reproducible on replay.

**A dangling `ref` on replay.** This can only come from a hand-edited log. Salvage keeps a valid prefix, and references only point backwards, so salvage cannot produce one. Load fails closed: the reducer throws on a missing `chain[ref]`, and `CollabService.open` fails, as it does today for other impossible records. The Host records `COLLAB_HOST_ERROR` and marks the space unavailable. This is not a store-corruption verdict, and the structural salvage tool cannot locate the record. Recovery is a new space. A load test covers this. The persisted `ref` is input, while length and thread are derived and never stored in business events.

`delivery.thread` is recorded on `wake` dispatch intents as an audit of which chain a wake belonged to. It is not used for counting. A sender's chain length is fully derivable from `ref` and item events alone.

### D3. The limit is checked inside the command transaction

`CollabService.command` already runs `decide` inside the per-space serial queue. After `decide` has produced the business events, `chainCheck(state, events)` does the following:
- folds a tentative record `{kind:'command', seq: lastSeq+1, events}` with the same `reduce` used on replay, so check time and replay cannot diverge;
- reads the resulting `chain` entries for the chains those events extend;
- throws `COLLAB_THREAD_LIMIT` if a limited event pushes a length beyond `CHAIN_LIMIT`.

Acceptance tests drive real service commands to the exact boundary, then close and reopen the space and compare the derived maps. A test that folds the same log twice is not enough.

This happens before `decideDispatch` and before `persist`, so nothing is written. Because the check runs inside the serial queue, concurrent commands see each other's commits. Two concurrent extensions of the same item cannot both pass.

Messages that each `ref` the same message all get the same length: N + 1 relative to that message, not a running count. That is intended. Branching off one point does not deepen the chain, and the user asked for chain length, not a fan-out count.

What is checked:
- A message is checked only when `needsReply:true` and it actually wakes its recipient. A message that wakes nobody still gets a length, so it can be referenced later, but it is never rejected.
- An item event that wakes nobody (for example an ack that does not complete agreement) does not grow the chain and is never rejected.
- `confirmDecision` and `advanceRequest` are exempt from the limit, though both still grow the chain.
  - Request progress is a DAG of at most two transitions (`open→accepted→done|rejected`). It cannot loop, and rejecting it would leave a request stuck open forever.
  - A human decision is the authoritative way out of an exhausted item (for items; request progress is covered by its own exemption). Rejecting it would trap the item.

**Rejected:**
- *Silently skipping wakes at the limit (the round-1 model).* This produced review M4: the sender is unaware and the loop continues blind. An explicit error tells the agent to stop and report, which is what the user chose.
- *Counting wakes per member or per thread.* This is the round-1 complexity of counters and resets, and it caused review M1 and M3 (event shape, multi-recipient boundary). Chain length has no counter state, needs no reset event, and charges a multi-recipient commit exactly one link.

### D4. A leader change no longer wakes anyone

`leader/changed` had the only wake that no `ref` chain covers, and it is the `transferLeader` ping-pong in review M2. A Leader change has no work attached. The new Leader learns of its role when it next reads `collab_status` or the overview, and the Leader role carries only membership-management rights, so nothing is lost.

This applies to both explicit transfers and automatic takeover on `leave`.

Invitations still wake the invitee. An address can be claimed at most once per space, so an invitation loop would need ever-new addresses, and that is bounded by the inviter's own actions. It can never be ping-pong between two agents.

**Rejected:** *Counting leader changes in a space-level chain.* This works, but it is an extra special case with no benefit, because no work depends on that wake.

### D5. Remove the per-member breaker entirely

The following are removed:
- `wakeCount` gating;
- `paused` presence;
- `BREAKER_LIMIT`;
- `resetBreaker`;
- the internal purpose `breaker-reset`.

`host-index` remains the only internal purpose.

To keep old logs replaying, `reduce` keeps folding `breaker/reset{member}` and the `wakeCount` field, but nothing reads them. `Member.wakeCount` is still written as `0` in new `member/invited` and `member/joined` events. Keeping the event shape byte-compatible lets a rolled-back kernel load new members (review S3a). Old internal-scope receipts stay in the receipt index and keep replaying.

**Consequence.** A rolled-back kernel would again count all thread-tagged `wake` intents per member, since it reads `delivery.member`. Busy spaces may then come back paused after a rollback. That is the old behavior, not a crash, and it is documented.

### D6. Pointer and status fields are integers only

- The kernel pointer gains `thread` (integer).
- The dsh-session provider copies it only when `Number.isSafeInteger`, so the forwarded JSON stays free of text even if a future kernel bug passes something else.
- `collab_status` `pending.requests[]` gains `seq`, read from the reduced `itemSeq` and never from item text.
- The `itemSeq` and `chainLength` maps appear in the `overview` (`collab_read`). They are integers keyed by seq or itemId. ItemIds are already present in the overview, so nothing new is exposed.

### D7. Tool surface and budget

The measured size is 4002 of 4200, using the header-test computation.

Additions:
- `ref` on two tools, `{type:'integer'}`: about 40 characters, written into both tools.
- One description sentence on `collab_send_message`: about 30 characters.

That is roughly 80 characters, which leaves margin. The spec makes the `collab_send_message` sentence mandatory, and there is no fallback. Rules beyond that sentence (the limit, what to do on `COLLAB_THREAD_LIMIT`) live in convention v3, because the spec does not require them in tool text.

The existing size test is extended with a scenario that keeps the budget under 4200 after the change.

### D8. Convention v3

v3 is a revised copy of v2. The paragraph in v2's "唤醒与停止" section that describes the member breaker (six wakes, pause, human or internal reset, and "被暂停时停止空转") is replaced. The rest of v2 is kept. A "链与往返上限" section is added:
- Continue the same task with `ref` pointing at the other side's message or item seq.
- Start a new task without `ref`.
- When creating a new request, omit `ref` and name its origin in the body, so the request gets a fresh chain (review S11).
- A chain allows at most 20 links.
- On `COLLAB_THREAD_LIMIT`, stop this exchange and report to your own user. Do not open a new chain to continue the same exchange.
- A Leader change does not wake anyone.

v1 and v2 stay pinned by sha256 tests. The bundle hook and the artifact tests list v1, v2 and v3.

## Risks / Trade-offs

- **Agents omit `ref` to dodge the limit.** Accepted by the user. The convention forbids it, and each new chain is still capped.
- **Agents forget `ref` on genuine follow-ups.** Chains then fragment. This is safe, because protection only weakens and nothing breaks. The convention and tool description prompt for `ref`, and status exposes request seqs.
- **A member deliberately exhausts another's item chain** with item revisions.
  - Each waking revision and each completed agreement add one link. An agent can make three waking revisions before its fourth escalates (escalation wakes no agents), and an agreement resets the edit counter.
  - In agent-only revise/agree cycles, four complete cycles reach length 17, and the fifth cycle hits the limit. Human revisions have no edit cap.
  - Request progress and human decisions stay exempt, so a request can still be finished and an item can still be decided.
- **Items that are already exhausted when loaded or created.**
  - Old items start at 1 but replay their historical waking events, so a long-lived item can load at 20 or more. Its next waking revision or ack is then rejected.
  - `createItem` with `ref` onto a chain of length 20 succeeds, because creation wakes nobody, and gives a new item of length 21.
  - Both are accepted consequences of the rule. Convention v3 tells agents to start a new request without `ref`.
- **Rollback to the previous kernel.** New logs load, because only optional fields were added and there are no new event types. The old per-member counting resumes and may pause busy members. v3 spaces return `COLLAB_CONVENTION_UNKNOWN` for `readConvention('3')` on the old kernel. Both effects are documented.
- **Replay cost.** `reduce` already deep-clones state per record, so replay is already superlinear. The new maps add one small entry per message or item. Spaces are batch-scoped, so this is acceptable.
- **Salvage reuses seqs.** A seq an agent remembers may name a different record after a salvage. A dangling `ref` in a salvaged prefix cannot occur, because salvage keeps only a valid prefix and references point backwards.

## Migration Plan

1. Ship the kernel and plugin together; the plugin inlines kernel source.
2. Run `dsh build` and restart. Existing spaces replay, members that were paused recover, and new spaces record convention v3.
3. **Rollback:** revert and rebuild. Logs still load. Per-member counting resumes. Spaces that are busy, or that are on v3, may need a new space.

## Open Questions

(none)
