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
 */

import { LocusError, type LocusEndpoint, type LocusRecord } from './aggregate.js'
import { classifyEndpointRetirement, type RetiredAssociationStore } from './retirement.js'

/** A locus row the channel may serve, in the controller's vocabulary. */
export interface ResolvedActiveLocus {
  readonly id: string
  readonly endpoint: LocusEndpoint
  readonly generation: number
  readonly parentSessionId: string
  readonly childSessionId: string
  readonly workspaceId: string
  readonly state: 'active'
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
}

/** Why an endpoint cannot be served right now. */
export type LocusResolutionRefusal =
  /** The endpoint has no locus and this Host cannot establish one. */
  | 'provisioning-unavailable'
  /** The endpoint belongs to the retired model; it needs an owner rebuild. */
  | 'retired-endpoint'
  /** The retired store could not be consulted, so takeover is not allowed. */
  | 'retirement-unproven'
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
}

/**
 * Project one durable record as a servable locus, or explain why it is not.
 *
 * Every field the channel needs must be present and consistent. A row without
 * a child session, or one whose state is not active, is refused rather than
 * partially served: the controller would otherwise queue work against an
 * identity nobody can execute.
 */
function toActive(record: LocusRecord): ResolvedActiveLocus {
  if (record.state === 'stopped') {
    throw new LocusResolutionError(
      'endpoint-stopped',
      'This endpoint was explicitly stopped and must be rebuilt by its owner.',
    )
  }
  if (record.state === 'invalid') {
    throw new LocusResolutionError(
      'endpoint-invalid',
      `This locus is invalid${record.invalidReason === undefined ? '' : ` (${record.invalidReason})`} and must be rebuilt.`,
    )
  }
  if (record.state !== 'active' || record.childSessionId === undefined) {
    throw new LocusResolutionError(
      'locus-unusable',
      `Locus ${record.id} is ${record.state} and cannot serve a delivery.`,
    )
  }
  return {
    id: record.id,
    endpoint: { ...record.endpoint },
    generation: record.generation,
    parentSessionId: record.parentSessionId,
    childSessionId: record.childSessionId,
    workspaceId: record.workspaceId,
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
      return ports.store.getCurrentLocus(endpoint)
    } catch (error) {
      // A malformed or ambiguous index is not "no locus": serving the endpoint
      // anyway could route to the wrong generation.
      if (error instanceof LocusError) {
        throw new LocusResolutionError('locus-unusable', error.message, { cause: error })
      }
      throw error
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
        return toActive(record)
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
        try {
          return toActive(record)
        } catch (error) {
          return refuse(error)
        }
      }
      // Before establishing anything, prove this endpoint is not a retired
      // association. Skipping this check is what would silently take over an
      // old group under a brand-new identity.
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
      // non-active or childless locus would otherwise reach the delivery path.
      if (
        established.state !== 'active' ||
        established.childSessionId.trim() === '' ||
        established.parentSessionId.trim() === '' ||
        established.id.trim() === ''
      ) {
        return refuse(new LocusResolutionError(
          'locus-unusable',
          'Provisioning returned a locus that cannot serve a delivery.',
        ))
      }
      return established
    },
  }
}
