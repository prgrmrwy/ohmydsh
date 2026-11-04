/**
 * Exact, read-only startup proof for one interrupted locus Delivery.
 *
 * A Host restart may happen after the child claimed its durable inbox message
 * but before Pet observed the live `agent/inbox/claimed` event. The child's log
 * (read cold through `sessionQuery.observeSession`, see
 * {@link proveStartupDeliveryFromColdRead}) still contains the append-only
 * `turn/start` and identified `user/message`. This fold accepts only one currently open turn
 * whose entered message identity equals the Delivery's durable inbox UUID.
 * It never infers by child identity, FIFO position, or message text.
 */

import { interruptedTurnClosers } from '@deepseek-ai/dsh-session'
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
 * a persisted `interrupted`, or the official live `aborted` with an explicit
 * `user`, `parent`, or `disposed` cause. Unknown or missing causes prove nothing.
 * The fold refuses malformed events, overlapping turns, missing or duplicate
 * entries, mismatched durable `turnId`, other endings, and still-open turns.
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
      const cause = reason?.['kind'] === 'aborted' ? recordOf(reason['reason'])?.['kind'] : undefined
      if (enteredTurn === openTurn && (
        reason?.['kind'] === 'interrupted' || cause === 'user' || cause === 'parent' || cause === 'disposed'
      )) {
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

// ── Evidence from the official cold read ────────────────────────────────────

/** The `sessionQuery` surface this module reads. */
export interface LocusSessionQueryLike {
  observeSession(
    sessionId: string,
    options?: { readonly signal?: AbortSignal; readonly projectionMode?: 'all' | 'none' },
  ): Promise<LocusSessionObservationLike>
}

/** The slice of an observation lease the recovery proofs use. */
export interface LocusSessionObservationLike {
  /** `live` events are as written; `prepared` (cold) ones carry fabricated tail closers. */
  readonly source: 'live' | 'prepared'
  readonly header: { readonly id?: string; readonly parentSession?: string }
  readonly events: readonly SessionEventLike[]
  [Symbol.dispose]?: () => void
}

/** Why a cold read produced no usable log. */
export type LocusColdReadFailure =
  | 'session-query-unavailable'
  | 'read-failed'
  | 'identity-mismatch'

/**
 * Remove the tail a cold read fabricated.
 *
 * `sessionQuery`'s cold path hands back the stored log followed by the closers
 * that make a crashed log balanced (`interruptedTurnClosers`): the same `time`
 * as the last stored event, the next `seq`, `reason: interrupted`, and nothing
 * marking them as synthetic. A log whose Host died mid-turn therefore ends in a
 * `turn/end interrupted` nobody wrote. Counting it as "interrupted" would settle
 * a Delivery on a conclusion the log does not contain.
 *
 * The tail is recognised the only way it can be: it is exactly what
 * `interruptedTurnClosers` produces for the events before it. A written event
 * that happens to be byte-identical is indistinguishable and is treated as
 * fabricated too — ambiguity is not evidence.
 *
 * @param events - the events a prepared observation returned.
 * @returns the events without the fabricated tail.
 */
export function withoutFabricatedClosers(events: readonly SessionEventLike[]): readonly SessionEventLike[] {
  const limit = Math.min(events.length - 1, 4096)
  for (let tail = 1; tail <= limit; tail += 1) {
    const prefix = events.slice(0, events.length - tail)
    let closers: readonly unknown[]
    try {
      closers = interruptedTurnClosers(prefix as never)
    } catch {
      return events
    }
    // Only a log that ended mid-turn can have been closed; stop at the first
    // prefix that is already balanced, since no shorter prefix can add a tail.
    if (closers.length === 0) return events
    if (closers.length !== tail) continue
    if (JSON.stringify(closers) === JSON.stringify(events.slice(events.length - tail))) return prefix
  }
  return events
}

/**
 * Read one child's log through the official cold read and return it as written.
 * @param query - `sessionQuery`, or undefined when it is not registered.
 * @param identity - the exact parent and child the evidence must belong to.
 * @param signal - optional cancellation.
 * @returns the as-written events, or why none are available.
 */
export async function readChildLog(
  query: LocusSessionQueryLike | undefined,
  identity: { readonly parentSessionId: string; readonly childSessionId: string },
  signal?: AbortSignal,
): Promise<
  | { readonly ok: true; readonly events: readonly SessionEventLike[] }
  | { readonly ok: false; readonly reason: LocusColdReadFailure }
> {
  if (query === undefined || typeof query.observeSession !== 'function') {
    return { ok: false, reason: 'session-query-unavailable' }
  }
  let observation: LocusSessionObservationLike
  try {
    observation = await query.observeSession(identity.childSessionId, {
      projectionMode: 'none',
      ...(signal === undefined ? {} : { signal }),
    })
  } catch {
    return { ok: false, reason: 'read-failed' }
  }
  try {
    if (
      observation.header.id !== identity.childSessionId
      || observation.header.parentSession !== identity.parentSessionId
    ) return { ok: false, reason: 'identity-mismatch' }
    // Copy out of the lease before releasing it: the array is only promised
    // for the lease's lifetime.
    const events = [...observation.events]
    return {
      ok: true,
      events: observation.source === 'prepared' ? withoutFabricatedClosers(events) : events,
    }
  } finally {
    try { observation[Symbol.dispose]?.() } catch { /* releasing a lease never changes the proof */ }
  }
}

/**
 * Prove what happened to an interrupted Delivery from the child's own log, read
 * cold through `sessionQuery.observeSession`.
 *
 * Reading never materializes the child: no activation slot is taken and no
 * agent is created, so a startup that must look at many children costs no
 * capacity. Without `sessionQuery`, or when the read fails, there is no
 * evidence and nothing is settled.
 *
 * @param input - the Delivery, the locus main it must belong to, and the reader.
 * @returns a proof, or undefined when the log does not prove one.
 */
export async function proveStartupDeliveryFromColdRead(input: {
  readonly delivery: DeliveryRecord
  readonly parentSessionId: string
  readonly query: LocusSessionQueryLike | undefined
  readonly log: (reason: string) => void
  readonly signal?: AbortSignal
}): Promise<LocusStartupDeliveryProof | undefined> {
  const read = await readChildLog(
    input.query,
    { parentSessionId: input.parentSessionId, childSessionId: input.delivery.childSessionId },
    input.signal,
  )
  if (!read.ok) {
    input.log(read.reason === 'identity-mismatch'
      ? 'startup-evidence-identity-mismatch'
      : 'startup-evidence-unavailable')
    return undefined
  }
  const session = { snapshotEvents: () => read.events }
  return proveLiveStartupDelivery(input.delivery, session)
    // Consulted when the open-turn proof declined: a `current` row can be one
    // whose dispatch died before hand-off (`unconsumed`), or one whose turn
    // really ended interrupted — the child's own log tells those apart.
    ?? proveInterruptedStartupDelivery(input.delivery, session)
    ?? proveUnconsumedStartupDelivery(input.delivery, session)
}
