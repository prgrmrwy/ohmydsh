/**
 * Durable locus resolution for the unified Feishu channel (v20 rows).
 *
 * Two questions, never collapsed:
 *
 * - `resolveCurrent` — which row, if any, currently serves this endpoint;
 * - `ensureForDelivery` — establish or repair one when it does not serve.
 *
 * The first answers from Pet's own store. The second delegates to an injected
 * provisioning seam: establishing a locus creates external resources, which a
 * store cannot do. A `stopped` row is never revived here (only a same-W
 * `/bind` does), and an archived W is never repaired from here (only the
 * management surface rebinds). `invalid` rows and rows under an unusable M are
 * handed to provisioning, which rebuilds the row in place or migrates the W.
 *
 * A topic row carries no M or workspace: both come from the group row of the
 * same chat.
 */

import type { LocusAccessModeV20, LocusGroupRowV20, LocusRowV20 } from './contract-v20.js'
import { dispositionOf } from './serviceability.js'

export interface LocusEndpoint {
  readonly chatId: string
  readonly threadId?: string
}

/** A row the channel may serve, in the controller's vocabulary. */
export interface ResolvedActiveLocus {
  readonly locusId: string
  readonly endpoint: LocusEndpoint
  /** Reserved id while `not-created`, the created child afterwards. */
  readonly sessionId: string
  readonly state: 'active' | 'not-created'
  readonly accessMode: LocusAccessModeV20
  readonly revision: number
  readonly locusMainSessionId: string
  /** The work session (W) behind the M. */
  readonly workSessionId: string
  readonly workspaceId: string
}

/** What the resolver needs to know about an M pairing. */
export interface LocusMainLookup {
  find(locusMainSessionId: string): { readonly workSessionId: string; readonly status: 'active' | 'retired' } | undefined
}

/** The durable reads this adapter needs. */
export interface LocusResolutionStore {
  /** The row stored under the endpoint key, including stopped / invalid. */
  getRow(endpoint: LocusEndpoint): LocusRowV20 | undefined
  hasFirstDeliveryRecoveryDebt?(locusId: string): boolean
}

/** Why an endpoint cannot be served right now. */
export type LocusResolutionRefusal =
  | 'provisioning-unavailable'
  /** The work session behind this entry is archived; only a rebind moves it. */
  | 'source-archived'
  | 'endpoint-stopped'
  | 'endpoint-invalid'
  | 'locus-unusable'

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

/** Establish or repair a locus for an endpoint that cannot serve. */
export interface LocusProvisioningPort {
  ensureForDelivery(input: {
    readonly endpoint: LocusEndpoint
    readonly messageId: string
    readonly signal: AbortSignal
  }): Promise<ResolvedActiveLocus>
}

export interface LocusResolutionPorts {
  readonly store: LocusResolutionStore
  /** M pairings. A row whose pairing cannot be found is invalid data and is refused. */
  readonly mains: LocusMainLookup
  /** Whether an M can still serve; absent means "not proven", and an unproven M does not serve. */
  readonly verifyMain?: (locusMainSessionId: string) => Promise<boolean> | boolean
  /** Absent keeps establishment unavailable instead of auto-creating. */
  readonly provisioning?: LocusProvisioningPort
  readonly log?: (reason: LocusResolutionRefusal) => void
  /** Whether one exact Session is archived by its owner; absent reads as "not archived". */
  readonly isSessionArchived?: (sessionId: string) => boolean
}

interface RowFacts {
  readonly group: LocusGroupRowV20
  readonly workSessionId: string
  readonly workArchived: boolean
  readonly mainUnavailable: boolean
}

function toActive(row: LocusRowV20, facts: RowFacts): ResolvedActiveLocus {
  const disposition = dispositionOf({
    state: row.state,
    ...(row.invalidReason === undefined ? {} : { invalidReason: row.invalidReason }),
    workArchived: facts.workArchived,
    mainUnavailable: facts.mainUnavailable,
  })
  if (disposition.kind === 'terminal') {
    if (facts.workArchived) {
      throw new LocusResolutionError('source-archived', '来源会话已归档，普通 @ 不会自动恢复或换来源。可在本入口 /bind 新会话，或在管理面「改绑到其他会话」。')
    }
    throw new LocusResolutionError(
      row.state === 'stopped' ? 'endpoint-stopped' : 'locus-unusable',
      row.state === 'stopped'
        ? 'This endpoint was stopped by its owner; a same-W /bind re-enables it.'
        : `Locus ${row.locusId} cannot serve a delivery: ${disposition.reason}.`,
    )
  }
  if (disposition.kind === 'replace') {
    throw new LocusResolutionError(
      row.state === 'invalid' ? 'endpoint-invalid' : 'locus-unusable',
      `Locus ${row.locusId} cannot serve a delivery: ${disposition.reason}.`,
    )
  }
  return {
    locusId: row.locusId,
    endpoint: { ...row.endpoint },
    sessionId: row.sessionId,
    state: row.state === 'active' ? 'active' : 'not-created',
    accessMode: row.accessMode,
    revision: row.revision,
    locusMainSessionId: facts.group.locusMainSessionId,
    workSessionId: facts.workSessionId,
    workspaceId: facts.group.workspaceId,
  }
}

/** Create the durable locus-resolution adapter for the unified channel. */
export function createLocusResolution(ports: LocusResolutionPorts): {
  resolveCurrent(endpoint: LocusEndpoint): ResolvedActiveLocus | undefined
  ensureForDelivery(input: {
    readonly endpoint: LocusEndpoint
    readonly messageId: string
    readonly signal: AbortSignal
  }): Promise<ResolvedActiveLocus>
} {
  const refuse = (error: unknown): never => {
    if (error instanceof LocusResolutionError) ports.log?.(error.reason)
    throw error
  }

  const readCurrent = (endpoint: LocusEndpoint): LocusRowV20 | undefined => {
    const row = ports.store.getRow(endpoint)
    if (row !== undefined && ports.store.hasFirstDeliveryRecoveryDebt?.(row.locusId) === true) {
      throw new LocusResolutionError('locus-unusable', 'First child creation compensation is awaiting recovery')
    }
    return row
  }

  /** A probe that throws cannot prove "archived"; failing open here keeps a serving entry serving. */
  const isArchived = (sessionId: string): boolean => {
    if (ports.isSessionArchived === undefined) return false
    try {
      return ports.isSessionArchived(sessionId) === true
    } catch {
      return false
    }
  }

  const groupOf = (row: LocusRowV20): LocusGroupRowV20 => {
    if (!('threadId' in row.endpoint)) return row as LocusGroupRowV20
    const group = ports.store.getRow({ chatId: row.endpoint.chatId })
    if (group === undefined || 'threadId' in group.endpoint) {
      throw new LocusResolutionError('locus-unusable', `Locus ${row.locusId} is a topic row without a group row.`)
    }
    return group as LocusGroupRowV20
  }

  const factsOf = (row: LocusRowV20, mainUnavailable: boolean): RowFacts => {
    const group = groupOf(row)
    const pairing = ports.mains.find(group.locusMainSessionId)
    if (pairing === undefined) {
      throw new LocusResolutionError('locus-unusable', `Locus ${row.locusId} has no locus_mains pairing for its M.`)
    }
    const workArchived = isArchived(pairing.workSessionId)
    return {
      group,
      workSessionId: pairing.workSessionId,
      workArchived,
      mainUnavailable: !workArchived && (mainUnavailable || pairing.status !== 'active' || isArchived(group.locusMainSessionId)),
    }
  }

  const mainUnavailable = async (row: LocusRowV20): Promise<boolean> => {
    if (ports.verifyMain === undefined) return true
    try {
      return (await ports.verifyMain(groupOf(row).locusMainSessionId)) !== true
    } catch {
      return true
    }
  }

  return {
    resolveCurrent(endpoint) {
      try {
        const row = readCurrent(endpoint)
        if (row === undefined) return undefined
        // An unavailable marker surfaces as a refusal, not as "no locus".
        return toActive(row, factsOf(row, false))
      } catch (error) {
        return refuse(error)
      }
    },

    async ensureForDelivery(input) {
      let row: LocusRowV20 | undefined
      try {
        row = readCurrent(input.endpoint)
      } catch (error) {
        return refuse(error)
      }
      if (row !== undefined) {
        try {
          const facts = factsOf(row, await mainUnavailable(row))
          try {
            return toActive(row, facts)
          } catch (error) {
            // Only a repairable disposition falls through to provisioning;
            // stopped and archived-W stay terminal.
            const disposition = dispositionOf({
              state: row.state,
              ...(row.invalidReason === undefined ? {} : { invalidReason: row.invalidReason }),
              workArchived: facts.workArchived,
              mainUnavailable: facts.mainUnavailable,
            })
            if (disposition.kind !== 'replace') return refuse(error)
          }
        } catch (error) {
          return refuse(error)
        }
      }

      const provisioning = ports.provisioning
      if (provisioning === undefined) {
        return refuse(new LocusResolutionError('provisioning-unavailable', 'This Host cannot establish a locus for a new endpoint.'))
      }
      const established = await provisioning.ensureForDelivery(input)
      // Trust nothing about the published row.
      const servable = established.locusId.trim() !== '' && established.locusMainSessionId.trim() !== '' &&
        established.sessionId.trim() !== '' && (established.state === 'active' || established.state === 'not-created')
      if (!servable) {
        return refuse(new LocusResolutionError('locus-unusable', 'Provisioning returned a locus that cannot serve a delivery.'))
      }
      return established
    },
  }
}
