/**
 * Synchronous pre-publication identity staging for fresh locus children.
 *
 * DSH emits `agent/created` while `startContinuable()` is still publishing the
 * fresh child.  The durable locus row cannot be active until that call returns,
 * so a durable-only reverse lookup misses exactly the first event that must
 * install the caller-bound surface and file policy.  This registry bridges only
 * that narrow interval:
 *
 * 1. reserve a fresh, registry-generated child id and its expected composition;
 * 2. pass that exact id to `startContinuable`;
 * 3. the synchronous `agent/created` path claims the reservation once;
 * 4. publish the durable active locus, then commit the reservation; or
 * 5. abort it on every failure path before compensating the child.
 *
 * It is deliberately process-local and never a second durable truth.  Entries
 * have a hard-bounded count and lifetime, terminal handles are retained only by
 * a WeakMap, and ordinary/unreserved child ids never produce a composition.
 */

import { randomUUID } from 'node:crypto'
import type {
  LocusChildComposition,
  LocusChildPermission,
  LocusCompositionLookup,
} from './composition.js'

/** Hard limits keep configuration from turning staging into an unbounded store. */
export const LOCUS_PREPUBLICATION_DEFAULT_TTL_MS = 30_000
export const LOCUS_PREPUBLICATION_MAX_TTL_MS = 60_000
export const LOCUS_PREPUBLICATION_DEFAULT_CAPACITY = 128
export const LOCUS_PREPUBLICATION_MAX_CAPACITY = 4_096

/** Expected durable identity, before the fresh child id has been allocated. */
export interface LocusPrepublicationIdentity {
  readonly parentSessionId: string
  readonly locusId: string
  readonly generation: number
  readonly permission: LocusChildPermission
}

/** Opaque capability held by the provisioning operation. */
export interface LocusPrepublicationReservation {
  readonly reservationId: string
  readonly childSessionId: string
  readonly composition: LocusChildComposition
  readonly expiresAt: number
}

/** Observable non-authoritative state, useful to a composition adapter. */
export interface LocusPrepublicationSnapshot {
  readonly reservationId: string
  readonly composition: LocusChildComposition
  readonly state: 'reserved' | 'claimed'
  readonly expiresAt: number
}

/** Stable failure reasons for fail-closed provisioning and diagnostics. */
export type LocusPrepublicationFailure =
  | 'invalid-options'
  | 'invalid-identity'
  | 'capacity-exceeded'
  | 'child-id-conflict'
  | 'reservation-id-conflict'
  | 'reservation-unknown'
  | 'reservation-expired'
  | 'already-claimed'
  | 'claim-required'
  | 'already-committed'
  | 'already-aborted'
  | 'registry-disposed'
  | 'durable-stage-conflict'

/** Error carrying a stable fail-closed reason. */
export class LocusPrepublicationError extends Error {
  override readonly name = 'LocusPrepublicationError'

  constructor(
    readonly reason: LocusPrepublicationFailure,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

/** Deterministic seams are injectable for tests; production defaults are UUIDs. */
export interface LocusPrepublicationRegistryOptions {
  readonly ttlMs?: number
  readonly capacity?: number
  readonly now?: () => number
  readonly createChildSessionId?: () => string
  readonly createReservationId?: () => string
}

type TerminalState = 'committed' | 'aborted' | 'expired' | 'disposed'
type EntryState = LocusPrepublicationSnapshot['state'] | TerminalState

interface StagingEntry {
  readonly reservation: LocusPrepublicationReservation
  state: EntryState
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function positiveBoundedInteger(
  value: number,
  maximum: number,
  field: string,
): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new LocusPrepublicationError(
      'invalid-options',
      `${field} must be a positive integer no greater than ${maximum}`,
    )
  }
  return value
}

function assertIdentity(identity: LocusPrepublicationIdentity): void {
  if (
    !isIdentifier(identity.parentSessionId)
    || !isIdentifier(identity.locusId)
    || !Number.isSafeInteger(identity.generation)
    || identity.generation <= 0
    || (identity.permission !== 'read' && identity.permission !== 'write')
  ) {
    throw new LocusPrepublicationError(
      'invalid-identity',
      'A staging reservation requires an exact parent, locus generation, and permission',
    )
  }
}

/**
 * Process-local, one-shot registry used only before durable active publication.
 *
 * Expiration is evaluated synchronously on every operation.  `sweepExpired()`
 * is public so a Host lifecycle tick may eagerly release idle entries; even if
 * no tick is installed, `capacity` is a hard upper memory bound.
 */
export class LocusPrepublicationStagingRegistry {
  private readonly ttlMs: number
  private readonly capacity: number
  private readonly now: () => number
  private readonly createChildSessionId: () => string
  private readonly createReservationId: () => string
  private readonly byChild = new Map<string, StagingEntry>()
  private readonly activeReservationIds = new Set<string>()
  /** Weak ownership preserves repeated-transition diagnostics without leaking. */
  private readonly byHandle = new WeakMap<object, StagingEntry>()
  private disposed = false

  constructor(options: LocusPrepublicationRegistryOptions = {}) {
    this.ttlMs = positiveBoundedInteger(
      options.ttlMs ?? LOCUS_PREPUBLICATION_DEFAULT_TTL_MS,
      LOCUS_PREPUBLICATION_MAX_TTL_MS,
      'ttlMs',
    )
    this.capacity = positiveBoundedInteger(
      options.capacity ?? LOCUS_PREPUBLICATION_DEFAULT_CAPACITY,
      LOCUS_PREPUBLICATION_MAX_CAPACITY,
      'capacity',
    )
    this.now = options.now ?? Date.now
    this.createChildSessionId = options.createChildSessionId ?? (() => `session-${randomUUID()}`)
    this.createReservationId = options.createReservationId ?? (() => `locus-stage-${randomUUID()}`)
  }

  /** Number of live reserved/claimed entries after synchronous expiry cleanup. */
  get activeCount(): number {
    if (!this.disposed) this.sweepExpired()
    let count = 0
    for (const entry of this.byChild.values()) {
      if (entry.state === 'reserved' || entry.state === 'claimed') count += 1
    }
    return count
  }

  /**
   * Reserve a fresh child id and the exact identity `agent/created` must see.
   *
   * The registry allocates the child id itself so callers do not accidentally
   * stage an existing/old child.  The returned id must be passed unchanged to
   * the Host's continuable-child creation call.
   */
  reserve(identity: LocusPrepublicationIdentity): LocusPrepublicationReservation {
    this.assertUsable()
    assertIdentity(identity)
    this.sweepExpired()
    // Every live entry counts: repeated reservations must never turn this
    // process-local bridge into an unbounded allocation channel.
    if (this.byChild.size >= this.capacity) {
      throw new LocusPrepublicationError(
        'capacity-exceeded',
        `Locus pre-publication staging is full (${this.capacity} bounded entries)`,
      )
    }

    const childSessionId = this.createChildSessionId()
    const reservationId = this.createReservationId()
    if (!isIdentifier(childSessionId)) {
      throw new LocusPrepublicationError('invalid-identity', 'Child id factory returned no usable id')
    }
    if (!isIdentifier(reservationId)) {
      throw new LocusPrepublicationError('invalid-identity', 'Reservation id factory returned no usable id')
    }
    if (this.byChild.has(childSessionId)) {
      throw new LocusPrepublicationError(
        'child-id-conflict',
        `Child ${childSessionId} already has a live staging reservation`,
      )
    }
    if (this.activeReservationIds.has(reservationId)) {
      throw new LocusPrepublicationError(
        'reservation-id-conflict',
        `Reservation ${reservationId} is already live`,
      )
    }

    const composition = Object.freeze<LocusChildComposition>({
      parentSessionId: identity.parentSessionId.trim(),
      childSessionId: childSessionId.trim(),
      locusId: identity.locusId.trim(),
      generation: identity.generation,
      permission: identity.permission,
    })
    const reservation = Object.freeze<LocusPrepublicationReservation>({
      reservationId: reservationId.trim(),
      childSessionId: composition.childSessionId,
      composition,
      expiresAt: this.now() + this.ttlMs,
    })
    const entry: StagingEntry = { reservation, state: 'reserved' }
    this.byChild.set(reservation.childSessionId, entry)
    this.activeReservationIds.add(reservation.reservationId)
    this.byHandle.set(reservation as object, entry)
    return reservation
  }

  /** Non-consuming synchronous query used to detect durable/staging conflicts. */
  inspect(childSessionId: string): LocusPrepublicationSnapshot | undefined {
    this.assertUsable()
    if (!isIdentifier(childSessionId)) return undefined
    const entry = this.byChild.get(childSessionId)
    if (entry === undefined) return undefined
    if (this.expireIfNeeded(entry)) return undefined
    if (entry.state !== 'reserved' && entry.state !== 'claimed') return undefined
    return Object.freeze({
      reservationId: entry.reservation.reservationId,
      composition: entry.reservation.composition,
      state: entry.state,
      expiresAt: entry.reservation.expiresAt,
    })
  }

  /**
   * Claim one exact fresh child synchronously from `agent/created`.
   *
   * `undefined` means an ordinary/unreserved child and is intentionally not an
   * error.  A second claim is an identity conflict and throws: it must veto the
   * duplicate publication rather than install the surface twice.
   */
  claim(childSessionId: string): LocusChildComposition | undefined {
    this.assertUsable()
    if (!isIdentifier(childSessionId)) return undefined
    const entry = this.byChild.get(childSessionId)
    if (entry === undefined) return undefined
    if (this.expireIfNeeded(entry)) {
      throw new LocusPrepublicationError(
        'reservation-expired',
        `Staging reservation for child ${childSessionId} expired before publication`,
      )
    }
    if (entry.state === 'claimed') {
      throw new LocusPrepublicationError(
        'already-claimed',
        `Staging reservation for child ${childSessionId} was already claimed`,
      )
    }
    if (entry.state !== 'reserved') {
      throw new LocusPrepublicationError(
        'reservation-unknown',
        `Staging reservation for child ${childSessionId} is no longer live`,
      )
    }
    entry.state = 'claimed'
    return entry.reservation.composition
  }

  /**
   * Finish the handoff after the SAME composition is durably active.
   *
   * The registry cannot prove the repository write itself; callers must publish
   * durable state first and then call this method.  Committing an unclaimed
   * reservation fails closed because no synchronous composition was observed.
   */
  commit(reservation: LocusPrepublicationReservation): void {
    const entry = this.requireOwned(reservation)
    this.requireLive(entry)
    if (entry.state === 'committed') {
      throw new LocusPrepublicationError('already-committed', 'Staging reservation was already committed')
    }
    if (entry.state === 'aborted' || entry.state === 'disposed') {
      throw new LocusPrepublicationError('already-aborted', 'Staging reservation is no longer commit-able')
    }
    if (entry.state !== 'claimed') {
      throw new LocusPrepublicationError(
        'claim-required',
        'A staging reservation must be claimed by agent/created before commit',
      )
    }
    this.removeLive(entry)
    entry.state = 'committed'
  }

  /** Drop a reservation on any creation/composition/durable-publish failure. */
  abort(reservation: LocusPrepublicationReservation): void {
    const entry = this.requireOwned(reservation)
    this.requireLive(entry)
    if (entry.state === 'committed') {
      throw new LocusPrepublicationError('already-committed', 'A committed reservation cannot be aborted')
    }
    if (entry.state === 'aborted' || entry.state === 'disposed') {
      throw new LocusPrepublicationError('already-aborted', 'Staging reservation was already aborted')
    }
    this.removeLive(entry)
    entry.state = 'aborted'
  }

  /** Eagerly remove every expired live reservation. */
  sweepExpired(): number {
    if (this.disposed) return 0
    const now = this.now()
    let removed = 0
    for (const entry of this.byChild.values()) {
      // TTL protects reservations whose child was never published. Once
      // agent/created claims the identity, expiring it during a slow external
      // group/DB operation would remove the only pre-publication proof and can
      // leave an already-composed idle child paired with an uncommittable row.
      // Claimed entries remain bounded by capacity and plugin disposal until
      // the provisioning owner commits or aborts them.
      if (entry.state !== 'reserved' || now < entry.reservation.expiresAt) continue
      this.removeLive(entry)
      entry.state = 'expired'
      removed += 1
    }
    return removed
  }

  /** Clear all process-local state; safe to call repeatedly during Host stop. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const entry of this.byChild.values()) entry.state = 'disposed'
    this.byChild.clear()
    this.activeReservationIds.clear()
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new LocusPrepublicationError('registry-disposed', 'Locus pre-publication staging is disposed')
    }
  }

  private requireOwned(reservation: LocusPrepublicationReservation): StagingEntry {
    this.assertUsable()
    if (reservation === null || typeof reservation !== 'object') {
      throw new LocusPrepublicationError('reservation-unknown', 'Unknown staging reservation handle')
    }
    const entry = this.byHandle.get(reservation as object)
    if (entry === undefined || entry.reservation !== reservation) {
      throw new LocusPrepublicationError('reservation-unknown', 'Unknown staging reservation handle')
    }
    return entry
  }

  private requireLive(entry: StagingEntry): void {
    if (entry.state === 'committed') {
      throw new LocusPrepublicationError('already-committed', 'Staging reservation was already committed')
    }
    if (entry.state === 'aborted' || entry.state === 'disposed') {
      throw new LocusPrepublicationError('already-aborted', 'Staging reservation is no longer live')
    }
    if (entry.state === 'expired' || this.expireIfNeeded(entry)) {
      throw new LocusPrepublicationError('reservation-expired', 'Staging reservation has expired')
    }
  }

  private expireIfNeeded(entry: StagingEntry): boolean {
    if (entry.state === 'expired') return true
    // A claimed entry has crossed the synchronous publication boundary and is
    // owned by an in-flight provisioning transaction; only that owner (or Host
    // disposal) may remove it.
    if (entry.state === 'claimed') return false
    if (entry.state !== 'reserved') return false
    if (this.now() < entry.reservation.expiresAt) return false
    this.removeLive(entry)
    entry.state = 'expired'
    return true
  }

  private removeLive(entry: StagingEntry): void {
    if (this.byChild.get(entry.reservation.childSessionId) === entry) {
      this.byChild.delete(entry.reservation.childSessionId)
    }
    this.activeReservationIds.delete(entry.reservation.reservationId)
  }
}

/** Ports for a durable-first lookup with a one-shot staging fallback. */
export interface LocusPrepublicationCompositionLookupPorts {
  readonly durable: LocusCompositionLookup
  readonly staging: LocusPrepublicationStagingRegistry
}

/**
 * Adapt durable and pre-publication identity to `composeLocusChild`'s lookup.
 *
 * Call `composeLocusChild` exactly once for each `agent/created` candidate.  Do
 * not call this adapter as a preliminary "is locus?" probe: a staging lookup is
 * a claim, and a second call correctly fails as a duplicate publication.
 */
export function createPrepublicationCompositionLookup(
  ports: LocusPrepublicationCompositionLookupPorts,
): LocusCompositionLookup {
  return {
    find(childSessionId: string): LocusChildComposition | undefined {
      // Read durable first so a store failure cannot consume the one-shot claim.
      const durable = ports.durable.find(childSessionId)
      const staged = ports.staging.inspect(childSessionId)
      if (durable !== undefined && staged !== undefined) {
        throw new LocusPrepublicationError(
          'durable-stage-conflict',
          `Child ${childSessionId} is present in durable and pre-publication identity`,
        )
      }
      if (durable !== undefined) return durable
      if (staged === undefined) return undefined
      return ports.staging.claim(childSessionId)
    },
  }
}
