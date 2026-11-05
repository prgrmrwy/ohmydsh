/**
 * Durable locus resolution for the unified Feishu channel.
 *
 * The channel controller asks two different questions, and they must not be
 * collapsed:
 *
 * - `resolveCurrent` — which locus, if any, currently serves this endpoint;
 * - `ensureForDelivery` — establish one when the endpoint has none.
 *
 * This adapter answers the first from Pet's own store, and answers the second
 * ONLY by delegating to an injected provisioning seam. That split is the whole
 * point: establishing a locus creates external resources (a main session, a
 * dedicated child, sometimes a Feishu group), and a store cannot do that. When
 * no provisioning seam is composed, an endpoint without a locus is reported as
 * unavailable rather than silently auto-created.
 *
 * A stopped, invalid, or retired generation is never revived here. Those rows
 * stay addressable so an ordinary message can be refused with an explicit
 * "needs an owner rebuild" diagnosis, which is exactly what the durable stop
 * marker exists for.
 *
 * Three-tier reading of a row: its parent is a locus main, and the locus main
 * is paired with the work session the owner archives or keeps. Every stored
 * row has that pairing; one without it is invalid data and is refused.
 * A row whose locus main cannot serve is replaced by an establishing @, one level up.
 * A `not-created` row serves, but has no child yet: the dispatcher creates it.
 */

import {
  LOCUS_SAFE_CHILD_COMPOSITION,
  LocusError,
  type LocusChildComposition,
  type LocusEndpoint,
  type LocusRecord,
} from './aggregate.js'
import { dispositionOf } from './serviceability.js'
import { classifyEndpointRetirement, type RetiredAssociationStore } from './retirement.js'

/**
 * A locus row the channel may serve, in the controller's vocabulary.
 *
 * `active` has its child; `not-created` has none yet and the dispatcher creates
 * it from the first deliverable message. `parentSessionId` is the locus main.
 */
export interface ResolvedActiveLocus {
  readonly id: string
  readonly endpoint: LocusEndpoint
  readonly generation: number
  readonly parentSessionId: string
  /** The work session behind the locus main, when the row has a pairing. */
  readonly workSessionId?: string
  /** Present exactly when `state` is `active`. */
  readonly childSessionId?: string
  /**
   * The id the child will have (and, once created, has). Deliveries on a
   * `not-created` generation correlate on it before the child exists.
   */
  readonly reservedChildSessionId?: string
  /** Optional in the structural port; every returned/accepted active row is checked. */
  readonly childComposition?: LocusChildComposition
  readonly toolTier?: LocusRecord['toolTier']
  readonly workspaceId: string
  readonly state: 'active' | 'not-created'
  readonly permission: LocusRecord['permission']
  readonly contextAnchor?: NonNullable<LocusRecord['contextAnchor']>
  /** Owner-visible note to relay with the receipt (e.g. an entry moved onto a new locus main). */
  readonly notice?: string
}

/** What the resolver needs to know about a locus main pairing. */
export interface LocusMainLookup {
  /** The pairing whose locus main is this session, if it is one. */
  find(parentSessionId: string): { readonly workSessionId: string; readonly status: 'active' | 'retired' } | undefined
}

/** The durable reads this adapter needs. */
export interface LocusResolutionStore {
  /**
   * The endpoint's current generation, including an unavailable marker.
   *
   * Returning a stopped/invalid row is required, not incidental: it is how the
   * caller distinguishes "explicitly stopped, needs a rebuild" from "never
   * established".
   */
  getCurrentLocus(endpoint: LocusEndpoint): LocusRecord | undefined
  hasFirstDeliveryRecoveryDebt?(locusId: string): boolean
}

/** Why an endpoint cannot be served right now. */
export type LocusResolutionRefusal =
  /** The endpoint has no locus and this Host cannot establish one. */
  | 'provisioning-unavailable'
  /** The endpoint belongs to the retired model; it needs an owner rebuild. */
  | 'retired-endpoint'
  /** The retired store could not be consulted, so takeover is not allowed. */
  | 'retirement-unproven'
  /** The work session behind this entry is archived; only the owner can move it. */
  | 'source-archived'
  /** The owner stopped this endpoint; an ordinary message must not revive it. */
  | 'endpoint-stopped'
  /** The generation is invalid; it needs an explicit rebuild. */
  | 'endpoint-invalid'
  /** The current row cannot serve work (no child, wrong state). */
  | 'locus-unusable'

/** A refusal carrying its stable reason. */
export class LocusResolutionError extends Error {
  override readonly name = 'LocusResolutionError'

  constructor(
    readonly reason: LocusResolutionRefusal,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

/** Establish a locus for an endpoint that has none. */
export interface LocusProvisioningPort {
  /**
   * Create the main session, the dedicated child, and the durable active
   * generation, then return it. Implementations own group/topic hierarchy and
   * must publish nothing until every external resource is established.
   */
  ensureForDelivery(input: {
    readonly endpoint: LocusEndpoint
    readonly messageId: string
    readonly signal: AbortSignal
  }): Promise<ResolvedActiveLocus>
}

export interface LocusResolutionPorts {
  readonly store: LocusResolutionStore
  /**
   * Locus main pairings. Every row the store returns is paired (the persistence
   * layer carries only three-tier rows); a row whose pairing cannot be found is
   * invalid data and is refused, never served as some other model.
   */
  readonly mains: LocusMainLookup
  /**
   * Whether a locus main can still serve (resolves, not archived, right
   * preset). Consulted only on the delivery path; absent means "not proven",
   * and an unproven locus main does not serve.
   */
  readonly verifyMain?: (locusMainSessionId: string) => Promise<boolean> | boolean
  /** Absent keeps establishment unavailable instead of auto-creating. */
  readonly provisioning?: LocusProvisioningPort
  /**
   * Read-only view of the retired association model.
   *
   * Consulted before establishing anything: an endpoint the old model had
   * bound must not be taken over under a new default identity just because
   * the unified store has no row for it yet.
   */
  readonly retired?: RetiredAssociationStore
  /** Stable diagnostics; never a message body or platform identifier. */
  readonly log?: (reason: LocusResolutionRefusal) => void
  /**
   * Whether one exact Session is archived by its owner.
   *
   * Required for the delivery gate to mean anything: nothing in the runtime
   * refuses to resume an archived Session, so without this fact an endpoint
   * whose main session the owner archived would keep serving and the archival
   * would silently have no effect. Absent reads as "not archived", so a
   * composition without the fact behaves exactly as it did before.
   */
  readonly isSessionArchived?: (sessionId: string) => boolean
}

/** Facts about a row that only the resolver's ports can supply. */
interface RowFacts {
  readonly workSessionId: string
  readonly workArchived: boolean
  readonly mainUnavailable: boolean
}

/**
 * Project one durable record as a servable locus, or explain why it is not.
 *
 * Every field the channel needs must be present and consistent. A row that is
 * neither `active` with its child nor `not-created` is refused rather than
 * partially served: the controller would otherwise queue work against an
 * identity nobody can execute.
 */
function toActive(record: LocusRecord, facts: RowFacts): ResolvedActiveLocus {
  // Classify via the ONE policy module rather than restating the rules here.
  // Serving stays strict for every non-serve disposition — including
  // `replace`, whose whole point is that the CURRENT generation is never
  // resumed (it hangs under a locus main that cannot serve, or its child lacks
  // the proof; adopting it would run something nobody reviewed).
  const disposition = dispositionOf({
    ...record,
    parentArchived: facts.workArchived,
    mainUnavailable: facts.mainUnavailable,
  })
  if (disposition.kind === 'terminal') {
    // An archived work session is an OWNER action, so it reports the same
    // repair an explicit stop does — move the entry — rather than the generic
    // unusable text. Anything else would send the owner looking for a Host
    // fault that does not exist.
    if (facts.workArchived) {
      throw new LocusResolutionError(
        'source-archived',
        '来源会话已归档，普通 @ 不会自动恢复或换来源。'
          + '请恢复该会话，或在本入口用 /bind 绑定到新的干活主会话。',
      )
    }
    throw new LocusResolutionError(
      record.state === 'stopped' ? 'endpoint-stopped' : 'locus-unusable',
      record.state === 'stopped'
        ? 'This endpoint was explicitly stopped and must be rebuilt by its owner.'
        : `Locus ${record.id} cannot serve a delivery: ${disposition.reason}.`,
    )
  }
  if (disposition.kind === 'replace') {
    throw new LocusResolutionError(
      // `endpoint-invalid` stays the code for a Host-invalidated generation so
      // existing diagnostics keep their meaning; the read path refusing it is
      // the contract `ensureForDelivery` relies on.
      record.state === 'invalid' ? 'endpoint-invalid' : 'locus-unusable',
      `Locus ${record.id} cannot serve a delivery: ${disposition.reason}.`,
    )
  }
  const base = {
    id: record.id,
    endpoint: { ...record.endpoint },
    generation: record.generation,
    parentSessionId: record.parentSessionId,
    workSessionId: facts.workSessionId,
    workspaceId: record.workspaceId,
    permission: record.permission,
    ...(record.contextAnchor === undefined ? {} : { contextAnchor: record.contextAnchor }),
  }
  if (disposition.kind === 'create') {
    return {
      ...base,
      state: 'not-created',
      ...(record.reservedChildSessionId === undefined ? {} : { reservedChildSessionId: record.reservedChildSessionId }),
      ...(record.toolTier === undefined ? {} : { toolTier: record.toolTier }),
    }
  }
  return {
    ...base,
    // Proven by `dispositionOf`; not re-derived here on purpose.
    childSessionId: disposition.childSessionId,
    ...(record.reservedChildSessionId === undefined ? {} : { reservedChildSessionId: record.reservedChildSessionId }),
    childComposition: disposition.childComposition,
    ...(disposition.toolTier !== undefined ? { toolTier: disposition.toolTier } : {}),
    state: 'active',
  }
}

/**
 * Create the durable locus-resolution adapter for the unified channel.
 * @param ports - the durable store plus the optional provisioning seam.
 * @returns the resolution port the channel controller consumes.
 */
export function createLocusResolution(ports: LocusResolutionPorts): {
  resolveCurrent(endpoint: LocusEndpoint): ResolvedActiveLocus | undefined
  ensureForDelivery(input: {
    readonly endpoint: LocusEndpoint
    readonly messageId: string
    readonly signal: AbortSignal
  }): Promise<ResolvedActiveLocus>
} {
  const refuse = (error: unknown): never => {
    if (error instanceof LocusResolutionError) {
      ports.log?.(error.reason)
      throw error
    }
    throw error
  }

  const readCurrent = (endpoint: LocusEndpoint): LocusRecord | undefined => {
    try {
      const record = ports.store.getCurrentLocus(endpoint)
      if (record !== undefined && ports.store.hasFirstDeliveryRecoveryDebt?.(record.id) === true) {
        throw new LocusResolutionError('locus-unusable', 'First child creation compensation is awaiting recovery')
      }
      return record
    } catch (error) {
      // A malformed or ambiguous index is not "no locus": serving the endpoint
      // anyway could route to the wrong generation.
      if (error instanceof LocusError) {
        throw new LocusResolutionError('locus-unusable', error.message, { cause: error })
      }
      throw error
    }
  }

  /**
   * Read the archived fact without letting a broken probe become a refusal.
   *
   * A probe that throws cannot prove the session is archived, and turning
   * "cannot tell" into "stopped" would take a working endpoint out of service
   * on a diagnostic failure. The delivery also has the child/policy gates
   * behind this one, so fail-open here is not fail-open overall.
   */
  const isArchived = (sessionId: string): boolean => {
    if (ports.isSessionArchived === undefined) return false
    try {
      return ports.isSessionArchived(sessionId) === true
    } catch {
      return false
    }
  }

  const factsOf = (record: LocusRecord, mainUnavailable: boolean): RowFacts => {
    const pairing = ports.mains.find(record.parentSessionId)
    if (pairing === undefined) {
      throw new LocusResolutionError('locus-unusable', `Locus ${record.id} has no locus_mains pairing for its parent session.`)
    }
    const workArchived = isArchived(pairing.workSessionId)
    return {
      workSessionId: pairing.workSessionId,
      workArchived,
      mainUnavailable: !workArchived && (mainUnavailable || pairing.status !== 'active' || isArchived(record.parentSessionId)),
    }
  }

  /** Whether the row's locus main verifiably serves; only the delivery path asks. */
  const mainUnavailable = async (record: LocusRecord): Promise<boolean> => {
    if (ports.verifyMain === undefined) return true
    try {
      return (await ports.verifyMain(record.parentSessionId)) !== true
    } catch {
      return true
    }
  }

  return {
    resolveCurrent(endpoint) {
      let record: LocusRecord | undefined
      try {
        record = readCurrent(endpoint)
      } catch (error) {
        return refuse(error)
      }
      if (record === undefined) return undefined
      // An unavailable marker must surface as a refusal, not as "no locus":
      // the latter would let the caller establish a replacement and thereby
      // bypass the owner's explicit stop.
      try {
        return toActive(record, factsOf(record, false))
      } catch (error) {
        return refuse(error)
      }
    },

    async ensureForDelivery(input) {
      let record: LocusRecord | undefined
      try {
        record = readCurrent(input.endpoint)
      } catch (error) {
        return refuse(error)
      }
      if (record !== undefined) {
        const facts = factsOf(record, await mainUnavailable(record))
        try {
          return toActive(record, facts)
        } catch (error) {
          // Ask the ONE policy module whether this generation may be replaced
          // without the owner. `stopped`/`retired` record an owner decision
          // and stay terminal; a locus main that cannot serve, or a
          // Host-invalidated child falls through to establishment.
          //
          // `toActive` refusing it remains the point: the unavailable
          // generation's child is never adopted or cold-resumed. Only the
          // REPLACEMENT is automatic; the old row stays untouched as durable
          // history.
          const disposition = dispositionOf({
            ...record,
            parentArchived: facts.workArchived,
            mainUnavailable: facts.mainUnavailable,
          })
          if (disposition.kind !== 'replace') return refuse(error)
        }
      }
      // Before establishing anything, prove this endpoint is not a retired
      // association of the OLDEST model. Skipping this check is what would
      // silently take over an old group under a brand-new identity.
      const retirement = classifyEndpointRetirement(input.endpoint, ports.retired)
      if (retirement.kind === 'retired') {
        return refuse(new LocusResolutionError('retired-endpoint', retirement.receipt))
      }
      if (retirement.kind === 'unproven') {
        return refuse(new LocusResolutionError('retirement-unproven', retirement.diagnostic))
      }

      const provisioning = ports.provisioning
      if (provisioning === undefined) {
        return refuse(new LocusResolutionError(
          'provisioning-unavailable',
          'This Host cannot establish a locus for a new endpoint.',
        ))
      }
      const established = await provisioning.ensureForDelivery(input)
      // Trust nothing about the published row: an adapter that returns a
      // row that is neither a proven active child nor a not-created entry would
      // otherwise reach the delivery path.
      const servable = established.id.trim() !== '' && established.parentSessionId.trim() !== '' && (
        (established.state === 'active' &&
          established.childComposition === LOCUS_SAFE_CHILD_COMPOSITION &&
          (established.childSessionId ?? '').trim() !== '') ||
        (established.state === 'not-created' && established.childSessionId === undefined)
      )
      if (!servable) {
        return refuse(new LocusResolutionError(
          'locus-unusable',
          'Provisioning returned a locus that cannot serve a delivery.',
        ))
      }
      return established
    },
  }
}
