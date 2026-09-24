/**
 * Per-turn correlation observer for unified locus Deliveries.
 *
 * A Delivery may only settle against the exact child turn that ran it. The
 * runtime supplies two independent facts:
 *
 * - an inbox claim, which names the queued message AND the turn that took it;
 * - a session turn end, which names the turn and how it finished.
 *
 * Neither alone is enough. The claim proves which message a turn is running;
 * the turn end only proves that this execution segment stopped. This module
 * joins claims on the exact `(childSessionId, turn)` pair and reports the
 * `started` execution fact. It deliberately does not turn `turn/end` into a
 * business Delivery outcome: a Delivery may continue in a later turn after a
 * trusted `agent-message` wake-up.
 *
 * What it deliberately does NOT do:
 *
 * - guess by FIFO order, "the oldest pending Delivery", or child id alone;
 * - treat an activation-level end (the child session finishing) as a turn;
 * - settle, expire, or otherwise mutate a Delivery from `turn/end`;
 * - report an outcome for a message that was discarded without running.
 *
 * The runtime seams are injected, so this module imports no Cordis or DSH.
 */

import {
  isPendingDeliveryStatus,
  type DeliveryCorrelation,
  type DeliveryStatus,
} from './delivery.js'

/** Observer facts emitted for a proven Delivery execution segment. */
export type LocusTurnPhase = 'started' | 'completed' | 'failed'

/** One correlation event, in the shape the locus controller consumes. */
export interface LocusTurnCorrelationEvent {
  readonly phase: LocusTurnPhase
  readonly deliveryId: string
  readonly executionId: string
  readonly turnId: string
  readonly correlation: DeliveryCorrelation
}

/** The source proof accepted for a caller-bound current capability. */
export type LocusCurrentCapabilitySource = 'delivery' | 'agent-message'

/**
 * A current capability proof for the caller-bound lifecycle tools.
 *
 * `turn/end` never creates or revokes the business capability. The proof is
 * retained only while the exact current Delivery remains represented by the
 * observer and a subsequent turn is explicitly woken by a trusted
 * `agent-message` claim. The observer has no authority to inspect or select a
 * Feishu target; that remains Host/persistence-owned.
 */
export interface LocusCurrentCapability {
  readonly deliveryId: string
  readonly executionId: string
  readonly turnId: string
  readonly correlation: DeliveryCorrelation
  readonly source: LocusCurrentCapabilitySource
}

/** Stable, non-sensitive reasons why a caller capability is unavailable. */
export type LocusCurrentCapabilityReason =
  | 'no-current'
  | 'claim-unbound'
  | 'mixed-source'
  | 'stale-delivery'
  | 'generation-mismatch'
  | 'association-unproven'
  | 'capability-unavailable'

/** Inspectable proof result; unlike the compatibility API it preserves refusal reason. */
export type LocusCurrentCapabilityInspection =
  | { readonly ok: true; readonly capability: LocusCurrentCapability }
  | { readonly ok: false; readonly reason: LocusCurrentCapabilityReason }

/** The durable Delivery facts a claimed inbox message resolves to. */
export interface LocusClaimedDelivery {
  readonly deliveryId: string
  readonly executionId: string
  readonly correlation: DeliveryCorrelation
  /** Optional durable status; explicit terminal rows never gain capability. */
  readonly status?: DeliveryStatus
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
 * @param sourceKind - the claimed message's `source.kind`, when reported.
 * @returns whether the claim is Host-injected context.
 */
export function isHostInjectedClaim(sourceKind: string | undefined): boolean {
  return sourceKind !== undefined && HOST_INJECTED_SOURCE_KINDS.has(sourceKind)
}

/**
 * Whether a claimed message is context-only and has no routing semantics.
 *
 * Agent-to-agent relays are context-only: `send_message` delivers them at the
 * target's nearest step boundary, but they do not carry a Feishu reply target
 * of their own and cannot redirect a Delivery already running in that turn.
 * `user` is deliberately absent: a user-sourced message that resolves to no
 * Delivery is GUI traffic or a parent steer and must remain fail-closed.
 */
export function isNonRoutingContextClaim(sourceKind: string | undefined): boolean {
  return isHostInjectedClaim(sourceKind) || sourceKind === 'agent-message'
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
  /** A turn end was observed after the turn had already ended. */
  | 'turn-already-ended'
  /** A turn ended; this is diagnostic evidence, not business settlement. */
  | 'turn-ended'
  /** Retention bounds evicted an unproven turn; it can no longer correlate. */
  | 'correlation-evicted'
  /** One turn exceeded its message-granular claim bound and is fail-closed. */
  | 'turn-claim-limit'
  /** Host-injected context shared the turn; ignored, not treated as foreign. */
  | 'claim-host-context'
  /** Agent-to-agent context shared the turn; ignored, not treated as foreign. */
  | 'claim-agent-context'

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
   * Return a caller-bound current capability with explicit source lineage.
   * The original Delivery turn is accepted while active; after it ends, only
   * a later exact turn containing a trusted `agent-message` claim is accepted.
   * Arbitrary later turns never inherit the proof.
   */
  currentCapabilityForChild?(childSessionId: string): LocusCurrentCapability | undefined
  /** Discriminated inspection underlying `currentCapabilityForChild`. */
  inspectCurrentCapabilityForChild?(childSessionId: string): LocusCurrentCapabilityInspection
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
  /**
   * Restore one durable current lineage after Host startup. This restores only
   * the exact prior execution/turn identity; it does not itself authorize a
   * new arbitrary turn. A same-turn runtime claim or a later trusted
   * `agent-message` is still required before `currentCapabilityForChild`
   * returns proof.
   */
  restoreCurrentCapability?(input: {
    readonly delivery: LocusClaimedDelivery & { readonly turnId: string }
  }): void
  /** Revoke one retained lineage after durable finish/expiry or successor claim. */
  revokeCurrentCapability?(input: { readonly childSessionId: string; readonly deliveryId?: string }): void
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
  /** Maximum ended Delivery lineages retained for trusted agent-message continuation. */
  readonly maxRetainedCurrents?: number
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
  /** Trusted agent-message claims admitted to continue retained lineage. */
  readonly agentMessages: Set<string>
  /** Sticky overflow fuse; excess ids are never retained. */
  saturated: boolean
  mixed: boolean
  /** A segment end is retained only to distinguish duplicate claims/ends. */
  end?: LocusTurnEnd
}

/**
 * One exact current Delivery lineage retained across execution segments.
 *
 * This is deliberately separate from `ObservedTurn`: ended turns are no longer
 * active turns, but a current Delivery may still be consumed by a later,
 * source-proven context turn. No status/terminal fact is stored here because
 * turn endings are not business endings.
 */
interface RetainedCurrent {
  readonly delivery: PendingTurn
  /** The original Delivery segment's exact numeric turn. */
  readonly originalTurn: number
  /** The latest execution segment admitted by a trusted agent-message. */
  continuationTurnId?: string
  /** Latest segment number seen for this retained lineage. */
  lastTurn: number
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
  const maxRetainedCurrents = positiveLimit(limits.maxRetainedCurrents, 1_024, 'maxRetainedCurrents')
  const listeners = new Set<(event: LocusTurnCorrelationEvent) => void>()
  /** Complete claim sets for all observed `(child, turn)` pairs, oldest first. */
  const turns = new Map<string, ObservedTurn>()
  /** Exact child/message -> turn keys awaiting durable Delivery visibility. */
  const unresolvedByMessage = new Map<string, Set<string>>()
  /** Turns already settled, oldest first, so duplicate-end memory is bounded. */
  const ended = new Set<string>()
  /** Ended Delivery lineages, bounded and keyed by exact ended turn. */
  const retained = new Map<string, RetainedCurrent>()
  /** A retained current may have at most one admitted continuation turn. */
  const continuationByChild = new Map<string, string>()
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

  const clearRetained = (childSessionId: string): void => {
    const currentKey = continuationByChild.get(childSessionId)
    if (currentKey !== undefined) {
      retained.delete(currentKey)
      continuationByChild.delete(childSessionId)
    }
  }

  const retainRestoredCurrent = (delivery: PendingTurn): void => {
    const key = turnKey(delivery.correlation.childSessionId, Number(delivery.turnId.slice(delivery.turnId.lastIndexOf('#') + 1)))
    const originalTurn = Number(delivery.turnId.slice(delivery.turnId.lastIndexOf('#') + 1))
    if (!Number.isSafeInteger(originalTurn) || originalTurn < 1) return
    const childSessionId = delivery.correlation.childSessionId
    const existingKey = continuationByChild.get(childSessionId)
    if (existingKey !== undefined && existingKey !== key) return
    retained.set(key, { delivery, originalTurn, lastTurn: originalTurn })
    continuationByChild.set(childSessionId, key)
    while (retained.size > maxRetainedCurrents) {
      const oldest = retained.keys().next().value as string | undefined
      if (oldest === undefined) break
      const oldestEntry = retained.get(oldest)
      retained.delete(oldest)
      if (oldestEntry !== undefined && continuationByChild.get(oldestEntry.delivery.correlation.childSessionId) === oldest) {
        continuationByChild.delete(oldestEntry.delivery.correlation.childSessionId)
      }
    }
  }

  const retainCurrent = (key: string, delivery: PendingTurn): void => {
    // There is one current Delivery per child in the product model. Replacing
    // an existing entry would hide an ambiguity, so refuse to retain another
    // lineage until the old one is explicitly removed by the Host lifecycle.
    const childSessionId = delivery.correlation.childSessionId
    const existingKey = continuationByChild.get(childSessionId)
    if (existingKey !== undefined && existingKey !== key) return
    const originalTurn = Number(delivery.turnId.slice(delivery.turnId.lastIndexOf('#') + 1))
    if (!Number.isSafeInteger(originalTurn) || originalTurn < 1) return
    retained.set(key, { delivery, originalTurn, lastTurn: originalTurn })
    continuationByChild.set(childSessionId, key)
    while (retained.size > maxRetainedCurrents) {
      const oldest = retained.keys().next().value as string | undefined
      if (oldest === undefined) break
      const oldestEntry = retained.get(oldest)
      retained.delete(oldest)
      if (oldestEntry !== undefined && continuationByChild.get(oldestEntry.delivery.correlation.childSessionId) === oldest) {
        continuationByChild.delete(oldestEntry.delivery.correlation.childSessionId)
      }
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
        agentMessages: new Set(),
        saturated: false,
        mixed: false,
      }
      turns.set(key, observed)
    }
    return observed
  }

  const settleTurn = (key: string, observed: ObservedTurn): void => {
    // A segment end is diagnostic only. It never emits a terminal business
    // event and never clears the current Delivery lineage; a later trusted
    // agent-message may continue the same current request.
    if (observed.end === undefined) return
    if (observed.unresolved.size > 0) return
    const claimed = observed.deliveries.size === 1 && !observed.mixed && !observed.saturated
      ? observed.deliveries.values().next().value as PendingTurn | undefined
      : undefined
    if (claimed !== undefined && (claimed.status === undefined || isPendingDeliveryStatus(claimed.status))) {
      retainCurrent(key, claimed)
    }
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

  const admitAgentContinuation = (claim: LocusInboxClaim): void => {
    if (
      claim === null || typeof claim !== 'object' ||
      !isNonEmpty(claim.childSessionId) || !isNonEmpty(claim.messageId) || !isTurn(claim.turn)
    ) {
      ports.log?.('claim-invalid')
      return
    }
    const currentKey = continuationByChild.get(claim.childSessionId)
    if (currentKey === undefined) {
      ports.log?.('claim-agent-context')
      return
    }
    const retainedCurrent = retained.get(currentKey)
    if (retainedCurrent === undefined) {
      continuationByChild.delete(claim.childSessionId)
      ports.log?.('claim-agent-context')
      return
    }
    const key = turnKey(claim.childSessionId, claim.turn)
    if (key === currentKey || ended.has(key)) return
    // A continuation must be a strictly later execution segment. This rejects
    // stale/old agent relays and prevents a claimed relay from authorizing an
    // arbitrary turn that reuses or precedes the original turn number.
    if (retainedCurrent.lastTurn < 1 || claim.turn <= retainedCurrent.lastTurn) {
      ports.log?.('claim-agent-context')
      return
    }
    if (retainedCurrent.continuationTurnId !== undefined && retainedCurrent.continuationTurnId !== turnIdOf(claim.childSessionId, claim.turn)) {
      ports.log?.('claim-agent-context')
      return
    }
    const observed = ensureTurn(claim)
    if (observed.agentMessages.has(claim.messageId)) return
    observed.agentMessages.add(claim.messageId)
    retainedCurrent.continuationTurnId = observed.turnId
    retainedCurrent.lastTurn = claim.turn
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
    // Host-injected context and agent-to-agent relays share the child's turn
    // but have no Feishu routing target of their own. Ignore them entirely:
    // retaining either as unresolved/foreign would mark the turn mixed and
    // strip reply authority from an otherwise valid Delivery. Ignoring is safe
    // because a durable Feishu Delivery is always claimed as `user`.
    if (isNonRoutingContextClaim(claim.sourceKind)) {
      ports.log?.(claim.sourceKind === 'agent-message' ? 'claim-agent-context' : 'claim-host-context')
      return
    }
    // A Delivery claim must carry the explicit participant source. Missing or
    // unknown source metadata is not proof of a Feishu/user message and must
    // never be upgraded by a matching inbox id into lifecycle authority.
    if (claim.sourceKind !== 'user') {
      const observed = ensureTurn(claim)
      observed.foreign.add(claim.messageId)
      observed.mixed = true
      ports.log?.('claim-invalid')
      settleTurn(key, observed)
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

  const releaseClaimed = ports.onClaimed((claim: LocusInboxClaim) => {
    if (claim !== null && typeof claim === 'object' && claim.sourceKind === 'agent-message') {
      admitAgentContinuation(claim)
      return
    }
    handleClaim(claim)
  })

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
    ports.log?.('turn-ended')
    settleTurn(key, observed)
  }

  const releaseTurnEnd = ports.onTurnEnd(handleTurnEnd)

  const inspectCurrentCapabilityForChild = (childSessionId: string): LocusCurrentCapabilityInspection => {
    if (disposed || !isNonEmpty(childSessionId)) return { ok: false, reason: 'capability-unavailable' }
    const active = [...turns.values()].filter(observed =>
      observed.childSessionId === childSessionId && observed.end === undefined,
    )
    if (active.length > 1) return { ok: false, reason: 'mixed-source' }
    if (active.length === 1) {
      const observed = active[0]!
      if (observed.mixed || observed.saturated || observed.foreign.size > 0 || observed.deliveries.size > 1) {
        return { ok: false, reason: 'mixed-source' }
      }
      if (observed.unresolved.size > 0) return { ok: false, reason: 'claim-unbound' }
      if (observed.deliveries.size === 1) {
        const claimed = observed.deliveries.values().next().value as PendingTurn | undefined
        if (claimed === undefined) return { ok: false, reason: 'association-unproven' }
        if (claimed.status !== undefined && !isPendingDeliveryStatus(claimed.status)) {
          return { ok: false, reason: 'stale-delivery' }
        }
        return {
          ok: true,
          capability: {
            deliveryId: claimed.deliveryId,
            executionId: claimed.executionId,
            turnId: claimed.turnId,
            correlation: claimed.correlation,
            source: 'delivery',
          },
        }
      }
    }

    const currentKey = continuationByChild.get(childSessionId)
    if (currentKey === undefined) {
      return { ok: false, reason: active.length === 0 ? 'no-current' : 'association-unproven' }
    }
    const retainedCurrent = retained.get(currentKey)
    if (retainedCurrent === undefined) return { ok: false, reason: 'association-unproven' }
    if (retainedCurrent.delivery.status !== undefined && !isPendingDeliveryStatus(retainedCurrent.delivery.status)) {
      return { ok: false, reason: 'stale-delivery' }
    }
    if (retainedCurrent.continuationTurnId === undefined) {
      return { ok: false, reason: 'association-unproven' }
    }
    if (active.length !== 1) return { ok: false, reason: 'association-unproven' }
    const continuation = active[0]!
    if (continuation.turnId !== retainedCurrent.continuationTurnId) {
      return { ok: false, reason: 'association-unproven' }
    }
    if (continuation.mixed || continuation.saturated || continuation.deliveries.size !== 0 ||
        continuation.foreign.size !== 0) return { ok: false, reason: 'mixed-source' }
    if (continuation.unresolved.size !== 0) return { ok: false, reason: 'claim-unbound' }
    if (continuation.agentMessages.size === 0) return { ok: false, reason: 'association-unproven' }
    return {
      ok: true,
      capability: {
        deliveryId: retainedCurrent.delivery.deliveryId,
        executionId: retainedCurrent.delivery.executionId,
        turnId: retainedCurrent.continuationTurnId,
        correlation: retainedCurrent.delivery.correlation,
        source: 'agent-message',
      },
    }
  }

  return {
    perTurnCorrelation: true,
    restoreCurrentCapability(input) {
      if (disposed || input === null || typeof input !== 'object') return
      const delivery = input.delivery
      if (delivery === null || typeof delivery !== 'object' ||
          !isNonEmpty(delivery.deliveryId) || !isNonEmpty(delivery.executionId) ||
          !isNonEmpty(delivery.turnId) || delivery.status !== undefined && !isPendingDeliveryStatus(delivery.status)) return
      const turnPrefix = `${delivery.correlation.childSessionId}#`
      if (!delivery.turnId.startsWith(turnPrefix)) return
      const turn = Number(delivery.turnId.slice(turnPrefix.length))
      if (!Number.isSafeInteger(turn) || turn < 1) return
      retainRestoredCurrent({ ...delivery, turnId: delivery.turnId })
    },
    inspectCurrentCapabilityForChild,
    currentCapabilityForChild(childSessionId) {
      const inspection = inspectCurrentCapabilityForChild(childSessionId)
      return inspection.ok ? inspection.capability : undefined
    },
    revokeCurrentCapability(input) {
      if (!isNonEmpty(input?.childSessionId)) return
      for (const [key, observed] of [...turns.entries()]) {
        if (observed.childSessionId !== input.childSessionId) continue
        const ownsDelivery = input.deliveryId === undefined ||
          [...observed.deliveries.values()].some(delivery => delivery.deliveryId === input.deliveryId)
        if (!ownsDelivery) continue
        // Expiry/finish revokes the ACTIVE segment too, not just an ended
        // retained lineage. Otherwise an expired A could remain the observer's
        // current proof while the Host promotes B. Remember the turn key so a
        // late duplicate claim from A cannot recreate authority.
        clearTurn(key)
        rememberEnded(key)
      }
      const currentKey = continuationByChild.get(input.childSessionId)
      if (currentKey !== undefined) {
        const retainedCurrent = retained.get(currentKey)
        if (input.deliveryId === undefined || retainedCurrent?.delivery.deliveryId === input.deliveryId) {
          clearRetained(input.childSessionId)
        }
      }
    },
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
      if (active.length === 1) {
        const observed = active[0]!
        if (
          !observed.mixed &&
          !observed.saturated &&
          observed.deliveries.size === 1 &&
          observed.unresolved.size === 0 &&
          observed.foreign.size === 0
        ) {
          const claimed = observed.deliveries.values().next().value as PendingTurn | undefined
          if (claimed !== undefined) return { executionId: claimed.executionId, turnId: claimed.turnId }
        }
      }
      // An ended segment has no caller capability until a trusted agent-message
      // explicitly admits the next turn. Never reuse the original turn proof for
      // an arbitrary later GUI/user/initialization turn.
      const currentKey = continuationByChild.get(childSessionId)
      const current = currentKey === undefined ? undefined : retained.get(currentKey)
      if (current?.continuationTurnId === undefined) return undefined
      const activeForChild = [...turns.values()].filter(observed =>
        observed.childSessionId === childSessionId && observed.end === undefined,
      )
      if (activeForChild.length !== 1) return undefined
      const continuation = activeForChild.find(observed => observed.turnId === current.continuationTurnId)
      if (continuation === undefined || continuation.mixed || continuation.saturated || continuation.deliveries.size !== 0 || continuation.unresolved.size !== 0 || continuation.foreign.size !== 0 || continuation.agentMessages.size === 0) return undefined
      return { executionId: current.delivery.executionId, turnId: current.continuationTurnId }
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
      retained.clear()
      continuationByChild.clear()
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
