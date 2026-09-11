/**
 * Per-turn correlation observer for unified locus Deliveries.
 *
 * A Delivery may only settle against the exact child turn that ran it. The
 * runtime supplies two independent facts:
 *
 * - an inbox claim, which names the queued message AND the turn that took it;
 * - a session turn end, which names the turn and how it finished.
 *
 * Neither alone is enough. The claim proves which message a turn is running
 * but not its outcome; the turn end proves an outcome but not which message it
 * belonged to. This module joins them on the exact `(childSessionId, turn)`
 * pair, so a settlement is reported only for a Delivery whose own turn ended.
 *
 * What it deliberately does NOT do:
 *
 * - guess by FIFO order, "the oldest pending Delivery", or child id alone;
 * - treat an activation-level end (the child session finishing) as a turn;
 * - report an outcome for a message that was discarded without running.
 *
 * The runtime seams are injected, so this module imports no Cordis or DSH.
 */

import type { DeliveryCorrelation } from './delivery.js'

/** How one observed turn ended. */
export type LocusTurnPhase = 'started' | 'completed' | 'failed'

/** One correlation event, in the shape the locus controller consumes. */
export interface LocusTurnCorrelationEvent {
  readonly phase: LocusTurnPhase
  readonly deliveryId: string
  readonly executionId: string
  readonly turnId: string
  readonly correlation: DeliveryCorrelation
  readonly reason?: string
}

/** The durable Delivery facts a claimed inbox message resolves to. */
export interface LocusClaimedDelivery {
  readonly deliveryId: string
  readonly executionId: string
  readonly correlation: DeliveryCorrelation
}

/**
 * Resolve the Delivery a claimed inbox message belongs to.
 *
 * Returning `undefined` means this message is not a locus Delivery — an
 * initialization prompt, a GUI turn, or a real parent/child message — and
 * must never consume a Feishu Delivery's feedback.
 */
export interface LocusDeliveryClaimLookup {
  find(input: {
    readonly childSessionId: string
    readonly messageId: string
  }): LocusClaimedDelivery | undefined
}

/** One inbox claim reported by the runtime. */
export interface LocusInboxClaim {
  readonly childSessionId: string
  readonly messageId: string
  /** The turn that claimed the message; a turn is per session, not global. */
  readonly turn: number
}

/** One turn end reported by the runtime. */
export interface LocusTurnEnd {
  readonly childSessionId: string
  readonly turn: number
  /** Runtime outcome; anything other than a completion settles as failed. */
  readonly outcome: 'completed' | 'aborted' | 'failed' | 'blocked'
  readonly reason?: string
}

/** Runtime subscriptions this observer needs. */
export interface LocusTurnObserverPorts {
  /** Subscribe to inbox claims; returns its disposer. */
  onClaimed(listener: (claim: LocusInboxClaim) => void): () => void
  /** Subscribe to turn ends; returns its disposer. */
  onTurnEnd(listener: (end: LocusTurnEnd) => void): () => void
  /** Resolve a claimed message to its durable Delivery. */
  readonly lookup: LocusDeliveryClaimLookup
  /**
   * Report a fact this observer refused to correlate. Diagnostics only: it
   * carries no message text and never becomes a settlement.
   */
  readonly log?: (code: LocusTurnObserverDiagnostic) => void
}

/** Stable diagnostics; no message bodies or platform identifiers. */
export type LocusTurnObserverDiagnostic =
  /** A claim named a message that is not a locus Delivery. */
  | 'claim-not-a-delivery'
  /** A claim was malformed, so no exact turn could be bound. */
  | 'claim-invalid'
  /** A turn ended with no claimed Delivery, e.g. an initialization turn. */
  | 'turn-without-delivery'
  /** A turn end was malformed and cannot prove which turn finished. */
  | 'turn-invalid'
  /** The same turn ended twice; only the first settles. */
  | 'turn-already-ended'

/** The observer the unified locus controller accepts. */
export interface LocusTurnCorrelationObserver {
  /** Marks this as a per-turn observer; activation-only ones are refused. */
  readonly perTurnCorrelation: true
  subscribe(listener: (event: LocusTurnCorrelationEvent) => void): () => void
  /**
   * Return an exact active turn proof only when this child has one claimed
   * locus Delivery. GUI/initialization turns and ambiguous overlaps return
   * undefined, so caller-bound tools cannot reuse an old Feishu target.
   */
  currentForChild?(childSessionId: string):
    | { readonly executionId: string; readonly turnId: string }
    | undefined
  /** Release the runtime subscriptions. */
  dispose(): void
}

/** One in-flight turn: the Delivery it claimed, keyed by session and turn. */
interface PendingTurn extends LocusClaimedDelivery {
  readonly turnId: string
}

/** Join key for one session's turn. A turn number is per session, not global. */
function turnKey(childSessionId: string, turn: number): string {
  return `${childSessionId}\u0000${String(turn)}`
}

/** A stable per-turn identity derived from the exact session and turn. */
function turnIdOf(childSessionId: string, turn: number): string {
  return `${childSessionId}#${String(turn)}`
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isTurn(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

/**
 * Create the per-turn correlation observer.
 *
 * Subscribe to the runtime BEFORE any Delivery is queued: a claim can be
 * reported before the queueing call returns, and a claim observed with no
 * listener attached would leave that Delivery unable to settle.
 * @param ports - runtime subscriptions plus the durable Delivery lookup.
 * @returns the observer, ready to be handed to the locus controller.
 */
export function createLocusTurnObserver(
  ports: LocusTurnObserverPorts,
): LocusTurnCorrelationObserver {
  const listeners = new Set<(event: LocusTurnCorrelationEvent) => void>()
  /** Turns that claimed a Delivery and have not ended yet. */
  const pending = new Map<string, PendingTurn>()
  /** Turns already settled, so a duplicate end cannot settle twice. */
  const ended = new Set<string>()
  let disposed = false

  const emit = (event: LocusTurnCorrelationEvent): void => {
    for (const listener of [...listeners]) {
      try {
        listener(event)
      } catch {
        // A failing consumer must not stop the remaining ones, and must not
        // turn an observed fact into a lost settlement for other Deliveries.
      }
    }
  }

  const releaseClaimed = ports.onClaimed((claim) => {
    if (disposed) return
    if (
      claim === null || typeof claim !== 'object' ||
      !isNonEmpty(claim.childSessionId) || !isNonEmpty(claim.messageId) || !isTurn(claim.turn)
    ) {
      ports.log?.('claim-invalid')
      return
    }
    let delivery: LocusClaimedDelivery | undefined
    try {
      delivery = ports.lookup.find({
        childSessionId: claim.childSessionId,
        messageId: claim.messageId,
      })
    } catch {
      // An unusable lookup cannot prove this message is a Delivery, and a
      // guessed binding would settle the wrong Feishu message.
      ports.log?.('claim-invalid')
      return
    }
    if (delivery === undefined) {
      // Initialization, a GUI turn, or a genuine parent/child message: it must
      // not consume any Delivery's pending feedback.
      ports.log?.('claim-not-a-delivery')
      return
    }
    const key = turnKey(claim.childSessionId, claim.turn)
    const turnId = turnIdOf(claim.childSessionId, claim.turn)
    pending.set(key, { ...delivery, turnId })
    emit({
      phase: 'started',
      deliveryId: delivery.deliveryId,
      executionId: delivery.executionId,
      turnId,
      correlation: delivery.correlation,
    })
  })

  const releaseTurnEnd = ports.onTurnEnd((end) => {
    if (disposed) return
    if (
      end === null || typeof end !== 'object' ||
      !isNonEmpty(end.childSessionId) || !isTurn(end.turn)
    ) {
      ports.log?.('turn-invalid')
      return
    }
    const key = turnKey(end.childSessionId, end.turn)
    const claimed = pending.get(key)
    if (claimed === undefined) {
      // Either this turn ran no Delivery, or its end was already reported.
      ports.log?.(ended.has(key) ? 'turn-already-ended' : 'turn-without-delivery')
      return
    }
    // Consume the pending entry FIRST: a duplicate end must not settle twice,
    // and a late end for a replaced generation must not find a live binding.
    pending.delete(key)
    ended.add(key)
    emit({
      phase: end.outcome === 'completed' ? 'completed' : 'failed',
      deliveryId: claimed.deliveryId,
      executionId: claimed.executionId,
      turnId: claimed.turnId,
      correlation: claimed.correlation,
      // Only a non-completion carries a reason; a completed turn has none.
      ...(end.outcome === 'completed'
        ? {}
        : { reason: isNonEmpty(end.reason) ? end.reason : end.outcome }),
    })
  })

  return {
    perTurnCorrelation: true,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    currentForChild(childSessionId) {
      const matches = [...pending.values()].filter(item =>
        item.correlation.childSessionId === childSessionId,
      )
      if (matches.length !== 1) return undefined
      return {
        executionId: matches[0]!.executionId,
        turnId: matches[0]!.turnId,
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      listeners.clear()
      pending.clear()
      ended.clear()
      try {
        releaseClaimed()
      } catch {
        // Disposal is best effort; a failing runtime disposer must not leave
        // the other subscription attached.
      }
      try {
        releaseTurnEnd()
      } catch {
        // Same containment as above.
      }
    },
  }
}
