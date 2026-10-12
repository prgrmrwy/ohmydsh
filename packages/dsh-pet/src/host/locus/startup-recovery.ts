/**
 * Exact, read-only startup proof for one interrupted locus Delivery.
 *
 * A Host restart may happen after the child claimed its durable inbox message
 * but before Pet observed the live `agent/inbox/claimed` event. The exact live
 * continuation-owned Session still contains the append-only `turn/start` and
 * identified `user/message`. This fold accepts only one currently open turn
 * whose entered message identity equals the Delivery's durable inbox UUID.
 * It never infers by child identity, FIFO position, or message text.
 */

import type { DeliveryRecord } from './delivery.js'
import type { LocusStartupDeliveryProof } from './persistence.js'

interface SessionEventLike {
  readonly type?: unknown
  readonly data?: unknown
}

interface SessionLike {
  snapshotEvents(): readonly SessionEventLike[]
}

function positiveTurn(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
    ? value
    : undefined
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Prove an interrupted Delivery is the exact currently open child turn.
 * Returns undefined for a balanced/corrupt/ambiguous log or mismatched UUID.
 */
export function proveLiveStartupDelivery(
  delivery: DeliveryRecord,
  session: unknown,
): LocusStartupDeliveryProof | undefined {
  if (
    delivery.executionId === undefined ||
    delivery.inboxMessageId === undefined ||
    session === null ||
    typeof session !== 'object' ||
    typeof (session as Partial<SessionLike>).snapshotEvents !== 'function'
  ) return undefined

  let events: readonly SessionEventLike[]
  try {
    events = (session as SessionLike).snapshotEvents()
  } catch {
    return undefined
  }
  if (!Array.isArray(events)) return undefined

  let openTurn: number | undefined
  let exactMessages = 0
  for (const event of events) {
    if (event === null || typeof event !== 'object') return undefined
    const data = recordOf(event.data)
    if (event.type === 'turn/start') {
      const turn = positiveTurn(data?.['turn'])
      if (turn === undefined || openTurn !== undefined) return undefined
      openTurn = turn
      exactMessages = 0
      continue
    }
    if (event.type === 'turn/end') {
      const turn = positiveTurn(data?.['turn'])
      if (turn === undefined || openTurn === undefined || turn !== openTurn) return undefined
      openTurn = undefined
      exactMessages = 0
      continue
    }
    if (event.type === 'user/message' && openTurn !== undefined) {
      if (data?.['id'] === delivery.inboxMessageId) exactMessages += 1
    }
  }
  if (openTurn === undefined || exactMessages !== 1) return undefined

  const turnId = `${delivery.childSessionId}#${String(openTurn)}`
  if (delivery.turnId !== undefined && delivery.turnId !== turnId) return undefined
  return {
    deliveryId: delivery.deliveryId,
    executionId: delivery.executionId,
    turnId,
    state: 'running',
  }
}

interface InboxItemLike {
  readonly id?: unknown
}

/**
 * Prove an interrupted Delivery was never handed to the child's work queue.
 *
 * The Delivery row alone cannot answer this. A `current` row means "claimed for
 * dispatch", which covers both a message the child accepted and one whose
 * hand-off died with the process — so retaining it can only arm a deadline that
 * eventually expires an unanswered message. The missing fact lives in the
 * child's own log: the inbox records every mutation as `agent/inbox/spliced`
 * carrying the item's `id` (exactly the Delivery's durable `inboxMessageId`)
 * and marks a cancellation with `outcome: 'canceled'`.
 *
 * Folding those mutations separates the two cases exactly. Replay is proven only
 * when no turn ever entered this message AND the child no longer queues it: a
 * message still sitting in `next-turn` would be delivered twice, and one a turn
 * already claimed is not ours to re-dispatch.
 *
 * @param delivery - the interrupted Delivery to prove.
 * @param session - the exact live child Session.
 * @returns the `unconsumed` proof, or undefined when replay is not proven.
 */
export function proveUnconsumedStartupDelivery(
  delivery: DeliveryRecord,
  session: unknown,
): LocusStartupDeliveryProof | undefined {
  if (
    delivery.executionId === undefined ||
    delivery.inboxMessageId === undefined ||
    session === null ||
    typeof session !== 'object' ||
    typeof (session as Partial<SessionLike>).snapshotEvents !== 'function'
  ) return undefined

  let events: readonly SessionEventLike[]
  try {
    events = (session as SessionLike).snapshotEvents()
  } catch {
    return undefined
  }
  // An empty log proves nothing: it is indistinguishable from a session whose
  // history was never flushed, and replaying on that would risk a duplicate.
  if (!Array.isArray(events) || events.length === 0) return undefined

  let openTurn = false
  let enteredTurn = false
  const queued: InboxItemLike[] = []
  for (const event of events) {
    if (event === null || typeof event !== 'object') return undefined
    const data = recordOf(event.data)
    if (event.type === 'turn/start') {
      openTurn = true
      continue
    }
    if (event.type === 'turn/end') {
      openTurn = false
      continue
    }
    if (event.type === 'user/message') {
      if (openTurn && data?.['id'] === delivery.inboxMessageId) enteredTurn = true
      continue
    }
    if (event.type !== 'agent/inbox/spliced' || data?.['target'] !== 'next-turn') continue
    // A splice this fold cannot read exactly leaves the queue unknown, so the
    // whole proof must refuse rather than guess at what is still pending.
    const start = data['start'] === undefined ? 0 : nonNegativeInteger(data['start'])
    const removed = data['removedCount'] === undefined ? 0 : nonNegativeInteger(data['removedCount'])
    const rawInserted = data['inserted'] === undefined ? [] : data['inserted']
    if (start === undefined || removed === undefined || !Array.isArray(rawInserted)) return undefined
    if (start > queued.length) return undefined
    if (rawInserted.some(item => item === null || typeof item !== 'object')) return undefined
    queued.splice(start, removed, ...rawInserted as InboxItemLike[])
  }

  // A turn still open is the `running` case, not this one.
  if (openTurn || enteredTurn) return undefined
  if (queued.some(item => item.id === delivery.inboxMessageId)) return undefined
  return {
    deliveryId: delivery.deliveryId,
    executionId: delivery.executionId,
    state: 'unconsumed',
  }
}

/**
 * Prove an interrupted Delivery's bound child turn is over and never settled it.
 *
 * A Host restart can land between "the child claimed the inbox message and
 * started a turn" and "the child called `pet_locus_finish`". The durable row
 * still looks `current`, but the process that owned that turn is gone and the
 * child never wrote a later turn, so nothing will ever settle it — meanwhile it
 * holds the Serialized current slot and blocks the whole entrance behind it.
 *
 * The evidence is exact and already persisted: the child's own log shows the
 * turn that entered this Delivery's `inboxMessageId` closing with
 * `turn/end { reason: { kind: 'interrupted' } }`. The fold is deliberately as
 * conservative as the `running`/`unconsumed` proofs — any malformed event, turn
 * overlap, missing or duplicate entry, mismatched durable `turnId`, a closed
 * turn whose reason is NOT `interrupted`, or a still-open turn refuses.
 *
 * @param delivery - the `current` Delivery to prove.
 * @param session - the exact live child Session.
 * @returns the `interrupted` proof, or undefined when it is not proven.
 */
export function proveInterruptedStartupDelivery(
  delivery: DeliveryRecord,
  session: unknown,
): LocusStartupDeliveryProof | undefined {
  if (
    delivery.executionId === undefined ||
    delivery.inboxMessageId === undefined ||
    session === null ||
    typeof session !== 'object' ||
    typeof (session as Partial<SessionLike>).snapshotEvents !== 'function'
  ) return undefined

  let events: readonly SessionEventLike[]
  try {
    events = (session as SessionLike).snapshotEvents()
  } catch {
    return undefined
  }
  // An unreadable/empty log proves nothing about how the turn ended.
  if (!Array.isArray(events) || events.length === 0) return undefined

  let openTurn: number | undefined
  let enteredTurn: number | undefined
  let entries = 0
  let interruptedTurn: number | undefined
  for (const event of events) {
    if (event === null || typeof event !== 'object') return undefined
    const data = recordOf(event.data)
    if (event.type === 'turn/start') {
      const turn = positiveTurn(data?.['turn'])
      if (turn === undefined || openTurn !== undefined) return undefined
      openTurn = turn
      continue
    }
    if (event.type === 'turn/end') {
      const turn = positiveTurn(data?.['turn'])
      if (turn === undefined || openTurn === undefined || turn !== openTurn) return undefined
      const reason = recordOf(data?.['reason'])
      if (enteredTurn === openTurn && reason?.['kind'] === 'interrupted') {
        interruptedTurn = openTurn
      }
      openTurn = undefined
      continue
    }
    if (event.type === 'user/message' && openTurn !== undefined) {
      if (data?.['id'] === delivery.inboxMessageId) {
        entries += 1
        enteredTurn = openTurn
      }
    }
  }

  // A still-open turn belongs to the `running` proof, not this one: it may
  // genuinely still be executing (a killed process without a graceful end
  // event is indistinguishable from a live one here).
  if (openTurn !== undefined) return undefined
  if (entries !== 1 || enteredTurn === undefined || interruptedTurn === undefined) return undefined

  const turnId = `${delivery.childSessionId}#${String(interruptedTurn)}`
  if (delivery.turnId !== undefined && delivery.turnId !== turnId) return undefined
  return {
    deliveryId: delivery.deliveryId,
    executionId: delivery.executionId,
    turnId,
    state: 'interrupted',
  }
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined
}
