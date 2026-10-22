## Context

The governing direction is `packages/dsh-collab/docs/cross-boundary-collaboration-standard.md`, agreed with the user on 2026-10-22. Agent Teams covers work inside one boundary; dsh-collab covers cooperation across boundaries. The two align on four principles:

1. State changes do not wake anyone.
2. A request's completion notifies the requester.
3. An explicit `needsReply` message wakes its recipient.
4. The ledger is the single source of truth.

This change brings the kernel and plugin in line with those principles. Locus integration and cross-machine transport are later changes.

### The kernel today (`packages/collab-kernel`, after `dsh-collab-member-trust`)

- **Wake table** (`domain/wake.ts`). It wakes on `needsReply` messages, item revisions (`requiredAcks`), agreement (author), every request progress change (author), invitation, leader change, and human decisions.
- **Breaker.**
  - `Member.wakeCount` counts every `wake` intent; at 6 the member is skipped.
  - Only `breaker/reset` lowers the count, and only `internal('breaker-reset')` or a human decision can write it. No host code does.
- **Human decisions.**
  - `requestDecision`/`confirmDecision` need a provider that supports `confirm`.
  - The only provider, dsh-collab's `SessionProvider`, binds agents with `confirm: false` and throws in `requestConfirmation` (`session-provider.ts` 90, 116). Requests therefore stay `awaitingChannel`, or are refused with `COLLAB_NO_DECIDER`.
  - An agent's fourth edit escalates an item, and only a human decision can leave `escalated`.
- **Messages and items.** Messages are a flat array whose `id` is the seq. Items are keyed by `itemId`, and their creation seq is not recorded.
- **Tool schema.** The real header of the dsh-collab tools measures 4002 of a 4200-character budget, using the header test's computation.

### History

The first version of this change planned a narrower fix: a per-chain limit that still woke on every item event. It went through seven review rounds (see `history/`). The standard replaces that plan, so this is a fresh design. The decisions that were settled earlier stay:

- the shape of `ref`;
- rejection with `COLLAB_BAD_REF` and `COLLAB_THREAD_LIMIT`;
- no global backstop and no reset entry;
- a limit of 20.

## Goals / Non-Goals

**Goals:**
- Wake only on the three triggers in the standard.
- Loop protection per topic. Over-limit sends are rejected visibly, never dropped.
- Remove mechanisms that cannot work or that the new principles make unnecessary:
  - the per-member breaker;
  - human decisions;
  - escalation.
- Keep consensus (charter + ack), now silent.
- Let members tell spaces apart: an optional `purpose`.
- Old spaces stay loadable. New logs stay loadable by the previous kernel.

**Non-Goals:**
- No task board and no Agent Teams clone. Inside-boundary work uses the official Agent Teams.
- No Locus integration, host-managed members, extension payloads or pluggable delivery policies. These are later changes, and the standard §8 lists them.
- No cross-machine transport. Addresses keep their current shape. The standard §7.3 lists the constraints.
- No `wait`-style tool. Waking stays next-turn followup.
- No change to the storage layer, locks, receipts or admission.

## Decisions

### D1. `ref` names a seq; only messages and item creations are referable

- A message's identity is already its seq. An item's creation seq follows from the log, so no new event field is needed.
- Validation:
  - `ref` must be a positive safe integer, with no coercion.
  - It must name an existing message or item creation in the same space.
  - It is checked after the existing business validation, so a command with several faults gets one deterministic error, and before the topic limit.
- `ref` is part of the payload hash. A replay that uses the same `cmdId` with a different `ref` is a `COLLAB_CMD_CONFLICT`, and the original receipt stays untouched.
- Rejected alternative: referencing items by `itemId`. It would create two namespaces. Agents get the seq from `overview.itemSeq` and from `collab_status` `requests[].seq` instead.

### D2. Topic = root of the `ref` chain; count = waking messages in the topic

- **Derivation.** `reduce` maintains three maps:
  - `topicOf[seq]`, for every message and every item creation;
  - `itemSeq[itemId]`, written as own properties, as `items` already is, so `__proto__` resolves;
  - `topicWakes[root]`, which is incremented when a commit contains a `needsReply` `message/sent` together with a `wake` intent addressed to that message's recipient.

  Counting depends only on those two events in the same commit, never on `delivery.thread`. Old logs have no `thread`, and their waking messages still count against their own (self-rooted) topic, so an old space does not get a fresh budget after upgrade. `thread` is redundant metadata for audit and for the pointer.
- **Why topics and not chain length.** With chain length, many messages that all `ref` the same point each stay at length 2. Referencing a task or the first message, which is the natural thing to do, would then defeat the limit. A topic count is independent of where in the topic a message points.
- **Why it was rejected before, and why it holds now.** Earlier rounds rejected topic counting because item events also woke people, which raised three problems:
  - multi-recipient boundaries;
  - rollback crashes on new reset events;
  - silent drops.

  Under the new wake table, only one message per command can be counted, it wakes exactly one recipient, an over-limit send is refused rather than dropped, and there is no reset event.
- **What is not counted.**
  - Messages that wake nobody: `needsReply:false`, an unreachable recipient, or a binding that does not support wake. A rejection would protect nothing, and the message stays referable.
  - Completion notices. Each request has at most one, because terminal progress is irreversible.
  - Invitations, because addresses are unique per space.
- **Where the check runs.** `CollabService.command` calls `decide` inside the per-space serial queue. A helper folds the tentative record through the same `reduce` and compares the topic count before the commit, against the presence sample used by `decideDispatch`. Check and replay therefore share one derivation, and concurrent sends cannot both pass the boundary.

### D3. The wake table shrinks to three triggers

The new `wakeRecipients` handles three cases:

- `message/sent` with `needsReply`: wake the recipient.
- `member/invited`: wake the invitee.
- `request/progressed` to `done` or `rejected`: wake the item author, unless the author is the actor.

Everything else returns an empty set.

- **Why completion notifies.** It is the cross-boundary counterpart of the DSH runtime's settlement notice from child to parent, which is what lets Agent Teams keep its board silent. There is no parent/child relation across boundaries, so the kernel provides the notice itself.
- **Why `accepted` does not notify.** It is an intermediate state. The assignee sends a message if it wants a reply.
- **Leader change does not wake.** Leader is a space-administration role, and the new leader sees the change in its status.

### D4. Remove the breaker, human decisions and escalation

**What is removed:**
- `requestDecision`, `confirmDecision`, `resetBreaker`;
- the `requestConfirmation` SPI method, `deciders`, `awaitingChannel`;
- `BREAKER_LIMIT`, `ESCALATE_AFTER`, `agentEditCount` and `wakeCount` as gates;
- internal purpose `breaker-reset`;
- the authorization-table rows for the removed commands.

Validation splits caller input from persisted state:

- A caller-supplied `deciders` in `createItem` or `reviseItem.changes` is `COLLAB_BAD_ITEM` (field `deciders`), checked after receipt lookup.
- Validation of the resulting item only covers active fields (`title`, `body`, `requiredAcks`, `kind`, `assignee`). Inert `deciders`/`agentEditCount` on an old snapshot are carried through unchanged and never cause a rejection. A title-only revision of an old `draft` or `agreed` item therefore succeeds.

**Historical locked items.** `escalated`/`decided` items, which only exist in old logs, reject `reviseItem`, `ackItem` and `advanceRequest` with their existing status errors, checked after receipt lookup. Today `advanceRequest` ignores item status, and the `requests-01` test even asserts that locked requests progress. That test changes. Status excludes locked requests from actionable work, and the projection shows them as history.

**Human members.** The kernel's member model allowed `kind:'human'` through provider-claimed creation and invitation. New members must be `agent` (`COLLAB_BAD_KIND`, checked after receipt lookup, so old successful commands still replay). Historical human members replay as ordinary members with no special authority. The `human-provider` authorization rule disappears together with `confirmDecision`.

**Rationale:**
- The breaker is replaced by topics.
- Human decisions never had a channel. Per the standard, people are not ledger members: a root asks its own user and writes the conclusion back.
- Escalation existed to stop agents wearing each other down through edit wakes. Edits no longer wake anyone, and an escalated item could only be released by the removed human decision.

**Persistence compatibility:**
- The reducer keeps folding `breaker/reset`, `decision/*`, `confirm` intents and completions, `escalated`/`decided` items and `wakeCount`, unchanged. Nothing reads them for authorization, waking or counting.
- `reviseItem` and `ackItem` keep rejecting old `escalated`/`decided` items with their existing errors, so history stays read-only.
- New member events still carry `wakeCount: 0` and `supports.confirm`, so the previous kernel can load new logs.
- The projection lists old escalated/decided items under "历史条目".

### D5. Consensus stays, silently

- `charter` with `requiredAcks` and `agreed` is unchanged except that it no longer wakes anyone.
- The convention tells whoever revises to send a `needsReply` message when it needs acks. That message is counted under the topic of the item if it `ref`s the item.

### D6. Space `purpose`

- `space/created` gains an optional `purpose`: a trimmed string of 1–200 characters with no control characters. It is immutable, and the overview returns it.
- In the projection, `purpose` goes through the same plain-text escaping as titles and status text (control characters removed, CommonMark punctuation escaped).
- `collab_status` is otherwise a free-text-free whitelist. `purpose` is the single exception:
  - it is creator-supplied text, sanitized and truncated;
  - it is emitted only under the fixed `source` notice.

  It is needed because a member in several spaces must pick where to write.
- Rejected alternative: a leader-editable description. That adds a command and its conflict rules for little gain. A new space can be created when the purpose changes.

### D7. Pointer `thread`

- The pointer whitelist gains `thread`, the topic root as an integer, on message and completion wakes.
- The dsh-session provider copies it only when `Number.isSafeInteger`.
- `counts.decision` stays in the shape, always 0, so the forwarded JSON stays stable.

### D8. Convention v3

- v3 is a revised copy of v2. It deletes the paragraphs on the breaker, escalation and human decisions.
- It adds:
  - the four principles;
  - `ref` and topics;
  - the limit, and what to do on `COLLAB_THREAD_LIMIT` (stop, report to your own user, do not open a new topic for the same exchange);
  - self-reported progress (an `other` item with no acks, updated by its author);
  - silent consensus;
  - space routing (purpose; reply where the pointer points; bridge members post summaries);
  - asking your own user for decisions.
- v1 and v2 bytes stay pinned by sha256. The bundle hook copies `v3.md`, and the artifact tests list all three.

### D9. Tool surface

Tool changes:
- Remove `collab_request_decision`.
- Add optional `ref` (integer) to `collab_send_message` and `collab_create_item`.
- Add optional `purpose` to `collab_space` create.
- Add one description sentence about `ref` to `collab_send_message`.

`collab_status` changes:
- `escalated` and its `next` kind are dropped.
- `requests[].seq` is added.
- `spaces[].purpose` is added.

Wake-notice text: the `requestDecision` clause is replaced with "ask your own user".

**Legacy `deciders` in the plugin tools.** Every pre-upgrade `collab_create_item` call carried a required `deciders`, often `[]`. Three straightforward options break the promise that an identical retry returns the original result:

- Keeping it required makes new creates fail the kernel prohibition.
- Deleting it from the schema makes the plugin's unknown-field check reject old retries before receipt lookup.
- Stripping it changes the canonical payload hash, so the retry conflicts.

So `deciders` stays as an optional, undocumented schema field, forwarded unchanged:

- an exact old retry hits its receipt;
- a fresh command carrying it is rejected by the kernel.

`collab_revise_item.changes.deciders` is handled the same way.

**Budget.** Removing one tool (about 230 characters) offsets the additions (about 150), and keeping `deciders` optional costs nothing new. The real-header budget test stays the gate.

### D10. Self-reported progress needs no new type

Agent Teams expresses "I am working on X" as a claimed task whose description its owner updates. The cross-boundary counterpart is an `other` item with no `requiredAcks`, revised by its author. The kernel already supports this. Only the convention changes.

## Risks / Trade-offs

- **[Agents omit `ref` to dodge the limit]** Accepted by the user. The convention forbids it, and each new topic is still capped.
- **[Completion notices across requests can still alternate]** One notice per request does not bound a chain of requests. A and B can each create a new request for the other and complete the previous one, and every completion wakes the other side, with no message budget consumed. This is a residual, accepted risk: the standard forbids a global cap and a reset, and each step needs a fresh `createItem` plus progress commands, which is far more deliberate than a reply loop. The convention tells members not to answer a completion with a new request for the same work.
- **[Agents forget `ref` on genuine follow-ups]** Topics fragment. This only weakens protection; nothing breaks. The tool description and convention prompt for `ref`.
- **[Lost features: formal escalation and verifiable human decisions]** Disputes now rely on the topic limit and each side asking its own user. A human's "approval" written by a root cannot be verified by the kernel. On one machine every root normally serves the same person, so the standard accepts this. Cross-machine work must redesign it.
- **[A long-lived space accumulates topics]** One integer per message and one per topic root. Spaces are batch-scoped. Replay already clones state per record, so it is already superlinear; the extra maps are small.
- **[Rollback to the previous kernel]**
  - New logs load: only optional fields were added, and no new event types.
  - The old kernel resumes per-member counting and may pause busy members.
  - It cannot read convention v3.
  - Spaces created with a `purpose` load, and the field is ignored.
- **[Dangling `ref` in a hand-edited log]** The reducer throws, and the space fails to open. The Host logs this as `COLLAB_HOST_ERROR`, not as store corruption, and salvage cannot locate the record. Recovery is a new space. Salvage keeps a valid prefix and refs point backwards, so salvage never produces this.

## Migration Plan

1. Ship the kernel and plugin together; the plugin inlines kernel source.
2. Run `dsh build` and restart.
   - Existing spaces replay.
   - Paused members wake normally again.
   - Pending decision requests become read-only history.
   - New spaces record convention v3.
3. Rollback: revert and rebuild. Logs still load; the old breaker resumes.

## Open Questions

(none)
