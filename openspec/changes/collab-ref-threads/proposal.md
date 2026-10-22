## Why

The collaboration kernel wakes members too often and stops them for the wrong reason.

- **Wake triggers.** Almost every state change wakes someone: item revisions, acks, agreement, request progress, leader changes and human decisions.
- **Breaker scope.** The breaker that is meant to stop runaway loops counts every wake a member receives in a space. The count never decays, and at 6 the member is paused for good.
- **Real-use failure.** Ordinary work on unrelated tasks hit the limit; the member stopped receiving messages, and the sender was never told.
- **No recovery.** Agent-only spaces have no human and no reset entry, so a paused member never recovers.
- **Dead human-decision path.** The path (`requestDecision` / `confirmDecision`) has never been usable in dsh-collab, because there is no human confirmation channel. Items escalated to it are stuck.

The user and author agreed a direction. It is recorded in `packages/dsh-collab/docs/cross-boundary-collaboration-standard.md`.

- **Scope split.** Agent Teams covers work inside one boundary. dsh-collab covers cooperation across boundaries: repositories, Pet Locus and Feishu, and later machines.
- **Shared principles.** dsh-collab aligns with Agent Teams and DSH parent/child semantics on principles, not features:
  1. state changes do not wake anyone;
  2. a request's completion notifies the requester;
  3. explicit `needsReply` messages wake the recipient;
  4. the ledger is the single source of truth.
- **Loops.** Loop protection is per topic of conversation, not per member.

## What Changes

- **Optional `ref`.** `sendMessage` and `createItem` accept an optional `ref`: the seq of an earlier message, or the creation seq of an earlier item, in the same space. The log stays flat; events only gain optional fields.
- **Topics.** A topic is derived on replay as the root reached by following `ref`: a message or item without `ref` is its own root. Records written before this change have no `ref`, so each is its own root.
- **Topic limit.** A `needsReply` message that would push its topic past 20 waking messages is rejected with `COLLAB_THREAD_LIMIT` before anything is written. An invalid `ref` is rejected with `COLLAB_BAD_REF`.
- **BREAKING: wake table.** Only three things wake a member:
  - a `needsReply` message, to its recipient;
  - an invitation, to the invitee;
  - a request reaching `done` or `rejected`, to the request's author.

  These no longer wake anyone: item revision, ack, agreement, request `accepted`, leader change (explicit or automatic), human decisions.
- **BREAKING: removed mechanisms.** The following are removed:
  - the per-member breaker: `wakeCount` gating, `paused`, `BREAKER_LIMIT`, `resetBreaker`, internal purpose `breaker-reset`;
  - human decisions: `requestDecision`, `confirmDecision`, `confirm` deliveries, `requestConfirmation` on the provider interface, `awaitingChannel`, `deciders`, item status `decided`;
  - item escalation: `escalated`, `agentEditCount`, `ESCALATE_AFTER`.
- **Consensus kept.** `charter` items with `requiredAcks` and `agreed` stay, because peers without a referee need it. They are now silent: whoever revises sends a `needsReply` message when it wants others to ack.
- **Self-reported progress.** No new type is added. An `other` item with no `requiredAcks`, updated by its author, serves this purpose. The convention documents the usage.
- **Space purpose.** `createSpace` accepts an optional short `purpose`, shown in `collab_status` so a member in several spaces can tell where to write.
- **Old spaces stay loadable.** Removed event types replay as read-only history: decided and escalated items stay as they were and accept no further changes. No storage format version is introduced, so rolling back to the previous kernel can still load new logs.
- **Convention v3** becomes the default for new spaces. It is v2 with the breaker, escalation and human-decision text replaced by the four principles, `ref`, topic limits, self-reported progress and space routing. v1 and v2 stay frozen.
- **`dsh-collab` changes:**
  - `collab_request_decision` is removed: 11 tools remain.
  - `collab_send_message` and `collab_create_item` gain optional `ref`.
  - `collab_space` `create` gains optional `purpose`.
  - `collab_status` drops `escalated`, and gains each space's `purpose` and each request's `seq`.
  - The forwarded pointer includes `thread`.
  - The wake notice no longer mentions `requestDecision`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- **`collab-kernel`:**
  - optional `ref` and topic limit;
  - new wake table (three triggers);
  - breaker, human decision and escalation removed;
  - silent consensus;
  - space purpose;
  - read-only replay of removed events;
  - pointer `thread`;
  - projection without paused, escalated or decision sections;
  - convention v3.
- **`dsh-collab`:**
  - 11 tools, with `ref` and `purpose` parameters;
  - status whitelist changes;
  - wake notice text;
  - removal of the "no human channel" requirement, now moot.

## Impact

- **Code:**
  - `packages/collab-kernel/src/{model,auth,domain,service,projection,convention}`;
  - `packages/dsh-collab/src/{tools,status,session-provider}.ts`;
  - `packages/dsh-collab/tsdown.config.ts`, which copies `v3.md`.
- **Tests:** breaker, decision, escalation and wake-table tests are deleted or rewritten. Storage, lock, idempotency, member, lifecycle and admission tests are kept.
- **Persisted data:** new optional fields `message.ref`, `item.ref`, `space.purpose`, `delivery.thread`. Existing logs replay. New logs remain loadable by the previous kernel, which ignores unknown fields; a rolled-back kernel resumes its old per-member counting.
- **Docs:** dsh-collab READMEs (zh/en) and the `dsh.yaml` note, which mention the 6-per-member breaker and convention v2.
- **Prior planning:** this change was previously planned as a narrower per-chain limit (seven review rounds, archived under `history/`). It is replanned against the standard, so earlier verdicts do not carry over.
