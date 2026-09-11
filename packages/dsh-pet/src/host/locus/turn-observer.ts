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

/**
 * Message-source kinds the Host itself injects into an inbox.
 *
 * These are not messages a participant sent: DSH seeds every session's first
 * step with workspace instructions, a runtime-context snapshot and the skill
 * catalog. They carry no reply target of their own and cannot redirect a
 * Delivery, so they must not count as foreign traffic sharing the turn.
 *
 * Treating them as foreign is what made the FIRST Feishu message of every
 * locus child unanswerable: the turn was marked mixed, reply authority was
 * withheld, and `pet_locus_reply` reported "no exact Delivery reply target"
 * while the child had in fact been addressed correctly.
 */
const HOST_INJECTED_SOURCE_KINDS: ReadonlySet<string> = new Set([
  'agent-instructions',
  'plugin',
  'skill-catalog',
])

/**
 * Whether a claimed message was injected by the Host rather than sent by a
 * participant.
 *
 * `user` is deliberately absent: a `user`-sourced message that resolves to no
 * Delivery is a GUI prompt or a parent steer, which CAN carry another target
 * and therefore must still poison reply authority.
 *
 * @param sourceKind - the claimed message's `source.kind`, when reported.
 * @returns whether the claim is Host-injected context.
 */
export function isHostInjectedClaim(sourceKind: string | undefined): boolean {
  return sourceKind !== undefined && HOST_INJECTED_SOURCE_KINDS.has(sourceKind)
}

/** One inbox claim reported by the runtime. */
export interface LocusInboxClaim {
  readonly childSessionId: string
  readonly messageId: string
  /** The turn that claimed the message; a turn is per session, not global. */
  readonly turn: number
  /**
   * The claimed message's `source.kind`, when the runtime reported one.
   * Absent is treated as participant traffic: an unknown source must stay
   * fail-closed rather than silently gain reply authority.
   */
  readonly sourceKind?: string
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
  /** Retention bounds evicted an unproven turn; it can no longer correlate. */
  | 'correlation-evicted'
  /** One turn exceeded its message-granular claim bound and is fail-closed. */
  | 'turn-claim-limit'
  /** Host-injected context shared the turn; ignored, not treated as foreign. */
  | 'claim-host-context'

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
  /**
   * Wake exactly one durable inbox-message lookup after `bindQueued` commits.
   * This is the event-driven half of claim-before-persistence correlation: an
   * unresolved claim is retained without a short polling deadline, then this
   * exact child/message notification retries only that claim.
   */
  deliveryAvailable?(input: {
    readonly childSessionId: string
    readonly messageId: string
  }): void
  /** Release the runtime subscriptions and all retained correlation state. */
  dispose(): void
}

/** Resource limits for retained, not-yet-provable runtime facts. */
export interface LocusTurnObserverLimits {
  /** Complete turn records retained at once, including end-before-bind turns. */
  readonly maxObservedTurns?: number
  /** Distinct message claims retained for one exact turn. */
  readonly maxClaimsPerTurn?: number
  /** Recently completed turn keys retained for duplicate-end diagnostics. */
  readonly maxEndedTurnKeys?: number
}

/** One Delivery claim resolved for an in-flight turn. */
interface PendingTurn extends LocusClaimedDelivery {
  readonly turnId: string
}

/** One claim whose durable Delivery binding may not be visible yet. */
interface UnresolvedClaim {
  readonly claim: LocusInboxClaim
}

/**
 * Every claim observed for one exact `(child, turn)` pair.
 *
 * `mixed` is a sticky fuse for PROVEN pollution: a second Delivery sharing the
 * turn, a lookup failure, or participant traffic that resolved to no Delivery.
 * A merely-unresolved claim does not brand the turn — the structural
 * queue-before-bind race makes almost every legitimate Delivery claim arrive
 * before its durable row, and reply authority is already withheld through
 * `unresolved.size !== 0` until the claim resolves one way or the other.
 */
interface ObservedTurn {
  readonly childSessionId: string
  readonly turn: number
  readonly turnId: string
  readonly deliveries: Map<string, PendingTurn>
  readonly unresolved: Map<string, UnresolvedClaim>
  readonly foreign: Set<string>
  /** Delivery message ids whose terminal fact was already emitted. */
  readonly terminalEmitted: Set<string>
  /** Sticky overflow fuse; excess ids are never retained. */
  saturated: boolean
  mixed: boolean
  end?: LocusTurnEnd
}

/** Join key for one session's turn. A turn number is per session, not global. */
function turnKey(childSessionId: string, turn: number): string {
  return `${childSessionId}\u0000${String(turn)}`
}

/** A stable per-turn identity derived from the exact session and turn. */
function turnIdOf(childSessionId: string, turn: number): string {
  return `${childSessionId}#${String(turn)}`
}

/** Exact message key; inbox message ids are only unique with their child. */
function messageKey(childSessionId: string, messageId: string): string {
  return `${childSessionId}\u0000${messageId}`
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isTurn(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`)
  return value
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
  limits: LocusTurnObserverLimits = {},
): LocusTurnCorrelationObserver {
  const maxObservedTurns = positiveLimit(limits.maxObservedTurns, 1_024, 'maxObservedTurns')
  const maxClaimsPerTurn = positiveLimit(limits.maxClaimsPerTurn, 32, 'maxClaimsPerTurn')
  const maxEndedTurnKeys = positiveLimit(limits.maxEndedTurnKeys, 1_024, 'maxEndedTurnKeys')
  const listeners = new Set<(event: LocusTurnCorrelationEvent) => void>()
  /** Complete claim sets for all observed `(child, turn)` pairs, oldest first. */
  const turns = new Map<string, ObservedTurn>()
  /** Exact child/message -> turn keys awaiting durable Delivery visibility. */
  const unresolvedByMessage = new Map<string, Set<string>>()
  /** Turns already settled, oldest first, so duplicate-end memory is bounded. */
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

  const unindexClaim = (key: string, claim: LocusInboxClaim): void => {
    const indexKey = messageKey(claim.childSessionId, claim.messageId)
    const keys = unresolvedByMessage.get(indexKey)
    if (keys === undefined) return
    keys.delete(key)
    if (keys.size === 0) unresolvedByMessage.delete(indexKey)
  }

  const clearTurn = (key: string): void => {
    const observed = turns.get(key)
    if (observed !== undefined) {
      for (const unresolved of observed.unresolved.values()) unindexClaim(key, unresolved.claim)
    }
    turns.delete(key)
  }

  const rememberEnded = (key: string): void => {
    ended.add(key)
    while (ended.size > maxEndedTurnKeys) {
      const oldest = ended.values().next().value as string | undefined
      if (oldest === undefined) break
      ended.delete(oldest)
    }
  }

  const ensureTurn = (claim: LocusInboxClaim): ObservedTurn => {
    const key = turnKey(claim.childSessionId, claim.turn)
    let observed = turns.get(key)
    if (observed === undefined) {
      while (turns.size >= maxObservedTurns) {
        const oldest = turns.entries().next().value as [string, ObservedTurn] | undefined
        if (oldest === undefined) break
        clearTurn(oldest[0])
        ports.log?.('correlation-evicted')
      }
      observed = {
        childSessionId: claim.childSessionId,
        turn: claim.turn,
        turnId: turnIdOf(claim.childSessionId, claim.turn),
        deliveries: new Map(),
        unresolved: new Map(),
        foreign: new Set(),
        terminalEmitted: new Set(),
        saturated: false,
        mixed: false,
      }
      turns.set(key, observed)
    }
    return observed
  }

  const settleTurn = (key: string, observed: ObservedTurn): void => {
    const end = observed.end
    if (end === undefined) return
    // Emit each proven Delivery's terminal fact immediately, even when another
    // claim on the same turn remains unresolved/foreign. Mixedness blocks reply
    // authority, not exact settlement. A later exact wake emits started plus
    // this retained terminal once for that newly proven Delivery.
    for (const [messageId, claimed] of observed.deliveries) {
      if (observed.terminalEmitted.has(messageId)) continue
      observed.terminalEmitted.add(messageId)
      emit({
        phase: end.outcome === 'completed' ? 'completed' : 'failed',
        deliveryId: claimed.deliveryId,
        executionId: claimed.executionId,
        turnId: claimed.turnId,
        correlation: claimed.correlation,
        ...(end.outcome === 'completed'
          ? {}
          : { reason: isNonEmpty(end.reason) ? end.reason : end.outcome }),
      })
    }
    if (observed.unresolved.size > 0) return
    clearTurn(key)
    rememberEnded(key)
  }

  const resolveClaim = (key: string, messageId: string): void => {
    if (disposed) return
    const observed = turns.get(key)
    const unresolved = observed?.unresolved.get(messageId)
    if (observed === undefined || unresolved === undefined) return
    let delivery: LocusClaimedDelivery | undefined
    try {
      delivery = ports.lookup.find({
        childSessionId: unresolved.claim.childSessionId,
        messageId: unresolved.claim.messageId,
      })
    } catch {
      // Lookup failures are foreign/unproven for reply authorization. They may
      // not be retried into an apparently clean Delivery-only turn.
      observed.unresolved.delete(messageId)
      unindexClaim(key, unresolved.claim)
      observed.foreign.add(messageId)
      ports.log?.('claim-invalid')
      settleTurn(key, observed)
      return
    }
    if (delivery !== undefined) {
      observed.unresolved.delete(messageId)
      unindexClaim(key, unresolved.claim)
      const claimed = { ...delivery, turnId: observed.turnId }
      observed.deliveries.set(messageId, claimed)
      // Same proven-pollution rule as the immediate-resolve path.
      if (observed.deliveries.size > 1 || observed.foreign.size > 0) observed.mixed = true
      emit({
        phase: 'started',
        deliveryId: delivery.deliveryId,
        executionId: delivery.executionId,
        turnId: observed.turnId,
        correlation: delivery.correlation,
      })
      settleTurn(key, observed)
      return
    }
    // Absence is not proof that the message is foreign: `bindQueued` may still
    // be committing. Keep this exact message unresolved until its matching
    // deliveryAvailable notification, bounded eviction, or disposal.
  }

  const handleClaim = (claim: LocusInboxClaim): void => {
    if (disposed) return
    if (
      claim === null || typeof claim !== 'object' ||
      !isNonEmpty(claim.childSessionId) || !isNonEmpty(claim.messageId) || !isTurn(claim.turn)
    ) {
      ports.log?.('claim-invalid')
      return
    }
    const key = turnKey(claim.childSessionId, claim.turn)
    if (ended.has(key)) return
    // Host-injected context (workspace instructions, the runtime snapshot, the
    // skill catalog) shares the child's first step but is not participant
    // traffic and carries no target of its own. Ignore it entirely: retaining
    // it as unresolved/foreign marked the turn mixed and silently stripped
    // reply authority from the FIRST Feishu message of every locus child.
    // Ignoring is safe precisely because it can never become a Delivery — a
    // durable Delivery is always claimed as `user`.
    if (isHostInjectedClaim(claim.sourceKind)) {
      ports.log?.('claim-host-context')
      return
    }
    const observed = ensureTurn(claim)
    // Runtime duplicate notifications for the same message are idempotent;
    // distinct message ids are distinct claims and must never overwrite.
    if (
      observed.deliveries.has(claim.messageId) ||
      observed.unresolved.has(claim.messageId) ||
      observed.foreign.has(claim.messageId)
    ) return

    let delivery: LocusClaimedDelivery | undefined
    try {
      delivery = ports.lookup.find({
        childSessionId: claim.childSessionId,
        messageId: claim.messageId,
      })
    } catch {
      observed.foreign.add(claim.messageId)
      observed.mixed = true
      ports.log?.('claim-invalid')
      settleTurn(key, observed)
      return
    }
    if (delivery !== undefined) {
      const claimed = { ...delivery, turnId: observed.turnId }
      observed.deliveries.set(claim.messageId, claimed)
      // A coexisting unresolved claim withholds authority on its own and may
      // still be this race's OTHER ordering; only proven facts brand the turn.
      if (observed.deliveries.size > 1 || observed.foreign.size > 0) {
        observed.mixed = true
      }
      emit({
        phase: 'started',
        deliveryId: delivery.deliveryId,
        executionId: delivery.executionId,
        turnId: observed.turnId,
        correlation: delivery.correlation,
      })
      settleTurn(key, observed)
      return
    }

    // Withhold while unresolved, but do NOT brand the turn mixed yet: reply
    // authority is already withheld by `unresolved.size !== 0`, and this exact
    // race is STRUCTURAL, not exceptional — `queueChild` wakes the driver the
    // moment the prompt enters the inbox, while `bindQueued` persists the
    // inbox-message binding only after that call returns, so the claim usually
    // fires before the Delivery row is visible. Branding here made every locus
    // Delivery permanently unanswerable, because nothing ever cleared the flag
    // after `deliveryAvailable` proved the claim WAS this turn's one Delivery.
    //
    // Mixedness stays reserved for proven pollution: a second Delivery, a
    // failed lookup, or a claim that resolves to no Delivery at all (a GUI
    // prompt or parent steer simply never resolves, so it keeps the turn
    // withheld through `unresolved` until eviction — fail closed either way).
    const claimCount = observed.deliveries.size + observed.unresolved.size + observed.foreign.size
    if (claimCount >= maxClaimsPerTurn) {
      observed.saturated = true
      ports.log?.('turn-claim-limit')
      return
    }
    // No polling deadline: bindQueued will wake this exact child/message pair.
    observed.unresolved.set(claim.messageId, { claim })
    const indexKey = messageKey(claim.childSessionId, claim.messageId)
    const indexed = unresolvedByMessage.get(indexKey) ?? new Set<string>()
    indexed.add(key)
    unresolvedByMessage.set(indexKey, indexed)
  }

  const releaseClaimed = ports.onClaimed(handleClaim)

  function handleTurnEnd(end: LocusTurnEnd): void {
    if (disposed) return
    if (
      end === null || typeof end !== 'object' ||
      !isNonEmpty(end.childSessionId) || !isTurn(end.turn)
    ) {
      ports.log?.('turn-invalid')
      return
    }
    const key = turnKey(end.childSessionId, end.turn)
    const observed = turns.get(key)
    if (observed === undefined) {
      ports.log?.(ended.has(key) ? 'turn-already-ended' : 'turn-without-delivery')
      return
    }
    if (observed.end !== undefined) {
      ports.log?.('turn-already-ended')
      return
    }
    observed.end = end
    settleTurn(key, observed)
  }

  const releaseTurnEnd = ports.onTurnEnd(handleTurnEnd)

  return {
    perTurnCorrelation: true,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    currentForChild(childSessionId) {
      const active = [...turns.values()].filter(observed =>
        observed.childSessionId === childSessionId && observed.end === undefined,
      )
      // Every active claim set participates in the child-bound decision. One
      // clean Delivery turn cannot hide another mixed/unresolved active turn.
      if (active.length !== 1) return undefined
      const observed = active[0]!
      if (
        observed.mixed ||
        observed.saturated ||
        observed.deliveries.size !== 1 ||
        observed.unresolved.size !== 0 ||
        observed.foreign.size !== 0
      ) return undefined
      const claimed = observed.deliveries.values().next().value as PendingTurn | undefined
      if (claimed === undefined) return undefined
      return { executionId: claimed.executionId, turnId: claimed.turnId }
    },
    deliveryAvailable(input) {
      if (disposed || !isNonEmpty(input?.childSessionId) || !isNonEmpty(input?.messageId)) return
      // Message-granular wake-up: never scan by FIFO or choose another child.
      const keys = unresolvedByMessage.get(messageKey(input.childSessionId, input.messageId))
      if (keys === undefined) return
      for (const key of [...keys]) resolveClaim(key, input.messageId)
    },
    dispose() {
      if (disposed) return
      disposed = true
      listeners.clear()
      for (const key of [...turns.keys()]) clearTurn(key)
      unresolvedByMessage.clear()
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
