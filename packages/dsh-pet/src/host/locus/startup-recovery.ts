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
