## Why

The wake breaker counts per member per space: every ordinary wake a member receives in a space increments one counter that never decays, and at 6 the member is paused for good. The breaker exists to stop runaway back-and-forth on one piece of work, but the counter mixes all of a member's work together.

A member doing ordinary collaboration on several unrelated tasks hits the limit and goes silent. In an agent-only space nobody can reset the counter: there is no human member, and `resetBreaker` is internal only. The space is effectively dead. This was hit in real use: a member reached 6/6 and stopped receiving messages, and the sender was never told.

The user decided:

- Loop protection should be per single task, measured as **chain length**. Starting a new task restarts at length 1.
- The ledger stays a flat log. Chains come from an optional `ref`; nobody needs to know who woke whom.
- The limit is 20.
- Nothing silently drops a wake. An over-limit command is rejected, and the agent stops and reports to its user.
- There is no global backstop and no human reset entry.
- Invalid references are rejected.

## What Changes

- `sendMessage` and `createItem` accept an optional `ref`. It is the seq of an earlier message, or the creation seq of an earlier item, in the same space. The flat log is kept; events only gain optional fields.
- **Chain length.** Each message and each item has a chain length derived on replay:
  - A message without `ref` has length 1. A message with `ref` has the referenced record's current length + 1.
  - An item starts at 1, or at the referenced length + 1 when created with `ref`. It grows by 1 on each item event that wakes someone: a revision that wakes required ackers, the ack that makes it agreed, a request progress change, or a human decision.
  - Records written before this change have no `ref`; each starts at 1. Old logs replay without migration.
- **BREAKING (kernel).**
  - A command whose wake-producing event would push a chain beyond 20 is rejected with `COLLAB_THREAD_LIMIT`, before anything is written.
  - Commands that wake nobody are never limited: messages with `needsReply:false`, acks that do not complete agreement, and status updates.
  - The per-member breaker is removed: the `wakeCount` gate, `paused` presence, `resetBreaker`, and the `breaker-reset` internal purpose. Old `breaker/reset` events and old per-member wake counts replay but no longer gate anything, so currently paused members recover on load.
- **BREAKING (kernel).** A leader change no longer wakes the new Leader. This removes the only wake that no chain could bound. The new Leader sees the change in `collab_status`/overview. Invitations still wake the invitee: an address can be invited at most once per space, so invitations cannot loop.
- `ref`, chain lengths and item creation seqs are integers. The overview exposes `itemSeq` and `chainLength` maps. Wake pointers carry `thread`, the chain's start seq, when the wake comes from a message or item.
- `dsh-collab`:
  - `collab_send_message` and `collab_create_item` gain optional `ref`.
  - `collab_status` request entries gain the item's `seq`.
  - The forwarded pointer includes `thread`.
- Collaboration convention v3 becomes the default for new spaces. It explains `ref` for continuing the same task, a new chain for new work, the limit of 20, and the rule on `COLLAB_THREAD_LIMIT`: stop and report to your user, and do not open a new chain to continue the same exchange. v1 and v2 stay frozen.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `collab-kernel`:
  - optional `ref` with chain-length derivation, `COLLAB_BAD_REF`, and the chain limit with `COLLAB_THREAD_LIMIT`;
  - removal of the per-member breaker, `resetBreaker` and the `breaker-reset` purpose;
  - leader change no longer wakes;
  - pointer whitelist gains `thread`;
  - the projection drops `paused`;
  - convention v3.
- `dsh-collab`:
  - tool parameters gain `ref`;
  - status request entries gain `seq`;
  - the forwarded pointer includes `thread`.

## Impact

- **Code:**
  - `packages/collab-kernel/src/{model,auth,domain/reduce,domain/decide,domain/wake,service,projection,convention}`
  - `packages/dsh-collab/src/{tools,status,session-provider}.ts`
  - `tsdown.config.ts`
- **Persisted data:**
  - New optional fields: `message.ref` on `message/sent`, `item.ref` on `item/created`, and `delivery.thread` on `dispatch/intended`.
  - No event type is removed from the reader. No new event type is introduced.
  - New logs remain loadable by the previous kernel. It ignores the unknown fields, and nothing new is written in a shape it rejects.
- **Public kernel API:**
  - `BREAKER_LIMIT` is replaced by `CHAIN_LIMIT` (20).
  - `resetBreaker` and `InternalPurpose 'breaker-reset'` are removed.
  - `Overview.presence` no longer contains `paused`.
  - `Overview` gains `itemSeq` and `chainLength`.
  - The only in-repo consumer is `dsh-collab`.
- **Tool schema size:** currently 4002 of the 4200-character budget. The additions are kept short and measured.
- **Docs:** dsh-collab READMEs (zh/en) and the `dsh.yaml` note (which mention "6 per member" and "约定v2") are updated.
