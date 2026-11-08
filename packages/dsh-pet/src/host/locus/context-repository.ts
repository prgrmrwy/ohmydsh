/**
 * Narrow seam between the caller-bound pet_context tool and the locus store.
 *
 * v20: an entry is identified by its `sessionId` (the child session it reserves
 * or runs). sessionId is unique across the loci table, so the repository returns
 * at most one entry for it and the caller-bound check never chooses between
 * rows. A non-active entry, or one whose first creation still owes recovery,
 * cannot authorize tools.
 */

import type {
  LocusChildSessionFacts,
  LocusEndpoint,
  LocusFacts,
  LocusMainSessionFacts,
  LocusReplyTarget,
  LocusWorkspaceFacts,
} from './context.js'
import type { DeliveryRecord, DeliveryStatus } from './delivery.js'
import type { DeliveryAddressingProjection } from './addressing.js'
import type { LocusCurrentCapabilityReason } from './turn-observer.js'
import type { LocusRepositoryV20 } from './persistence-v20.js'

/** The repository operations the caller-bound context check needs. */
export type LocusContextLookup = Pick<
  LocusRepositoryV20,
  'findBySessionId' | 'hasFirstDeliveryRecoveryDebt' | 'findCurrentSerializedDelivery' | 'findCurrentDelivery'
>

/** The current accepted delivery of an entry's child (sessionId-keyed). */
export interface LocusCurrentDelivery {
  readonly deliveryId: string
  readonly messageId: string
  readonly endpoint: LocusEndpoint
  readonly locusId: string
  readonly sessionId: string
  readonly status?: DeliveryStatus
  readonly queueState?: 'backlog' | 'current'
  readonly deadlineAt?: number
  readonly hardDeadlineAt?: number
  readonly revision?: number
  readonly stateRevision?: number
  readonly executionId?: string
  readonly turnId?: string
  readonly inboxMessageId?: string
  readonly feedbackTarget?: LocusReplyTarget
  readonly finishOutcome?: 'reply' | 'no-reply'
  readonly outboundResult?: 'none' | 'success' | 'failure' | 'unknown'
  readonly acceptedAt?: number
  readonly finishedAt?: number
  readonly expiredAt?: number
  readonly senderOpenId?: string
  readonly senderName?: string
  readonly text?: string
  readonly addressing?: DeliveryAddressingProjection
  /** Exact platform parent message, when the inbound message was a reply. */
  readonly replyToMessageId?: string
  readonly replyTarget?: LocusReplyTarget
}

/** One caller-bound projection of an entry: the wire mirror minus generation, permission and contextAnchor. */
export interface LocusContextRecord {
  readonly endpoint: LocusEndpoint
  readonly locus: LocusFacts
  readonly main: LocusMainSessionFacts
  readonly child: LocusChildSessionFacts
  readonly workspace: LocusWorkspaceFacts
  readonly accessMode: 'read-only' | 'danger-full-access'
  /** Present only while the entry is invalid. */
  readonly invalidReason?: string
  /** Omitted for initialization, GUI turns, and idle children. */
  readonly currentDelivery?: LocusCurrentDelivery
}

export type LocusCurrentAuthorizationResult =
  | { readonly ok: true; readonly locus: LocusContextRecord }
  | { readonly ok: false; readonly reason: LocusCurrentCapabilityReason }

/** The turn proof a caller presents for finish, wait or track. */
export interface LocusTurnProofInput {
  readonly deliveryId?: string
  readonly executionId: string
  readonly turnId: string
  readonly source: 'delivery' | 'agent-message'
  readonly locusId?: string
  /** The entry's sessionId. A mismatch is reported as `generation-mismatch` (the capability reason keeps its name). */
  readonly sessionId?: string
}

export interface LocusContextRepository {
  /** The one entry whose sessionId this is, or undefined for an ordinary session. */
  findBySessionId(sessionId: string): LocusContextRecord | undefined
  /** Read projection of the current Delivery. Never authority on its own. */
  findCurrentDelivery?(sessionId: string): LocusCurrentDelivery | undefined
  /** Full authorization inspection. Never guesses an unavailable distinction. */
  inspectCurrentDeliveryAuthorization?(input: {
    readonly childSessionId: string
    readonly operation: 'finish' | 'wait' | 'track'
    readonly proof?: LocusTurnProofInput
  }): LocusCurrentAuthorizationResult | Promise<LocusCurrentAuthorizationResult>
}

/**
 * Build the caller-bound context seam over the v20 repository. `childSessionId`
 * in the input keeps its name so context-tool callers do not churn; its value is
 * the entry's sessionId.
 */
export function asLocusContextRepository(
  repository: LocusContextLookup,
  currentTurnProof?: (sessionId: string) => { readonly executionId: string; readonly turnId: string } | undefined,
): LocusContextRepository {
  const inspectCurrentDeliveryAuthorization = (input: Parameters<NonNullable<LocusContextRepository['inspectCurrentDeliveryAuthorization']>>[0]): LocusCurrentAuthorizationResult => {
    const sessionId = input.childSessionId
    if (sessionId.trim() === '') return { ok: false, reason: 'capability-unavailable' }
    const proof = input.proof
    if (proof === undefined || proof.source !== 'delivery' && proof.source !== 'agent-message') {
      return { ok: false, reason: 'association-unproven' }
    }
    const currentProof = currentTurnProof?.(sessionId)
    if (currentProof === undefined || currentProof.executionId !== proof.executionId || currentProof.turnId !== proof.turnId) {
      return { ok: false, reason: 'association-unproven' }
    }
    const resolved = repository.findBySessionId(sessionId)
    if (resolved === undefined) return { ok: false, reason: 'association-unproven' }
    const row = resolved.row
    if (row.state !== 'active' || row.sessionId !== sessionId) return { ok: false, reason: 'association-unproven' }
    if (repository.hasFirstDeliveryRecoveryDebt(row.locusId)) return { ok: false, reason: 'association-unproven' }
    const current = repository.findCurrentSerializedDelivery({ locusId: row.locusId, sessionId })
    if (current === undefined) return { ok: false, reason: 'no-current' }
    if (current.status !== 'current' && current.status !== 'finishing' || current.queueState !== 'current') {
      return { ok: false, reason: 'stale-delivery' }
    }
    if (current.sessionId !== sessionId || current.locusId !== row.locusId) {
      return { ok: false, reason: 'association-unproven' }
    }
    if (proof.sessionId !== undefined && proof.sessionId !== sessionId) {
      return { ok: false, reason: 'generation-mismatch' }
    }
    if (proof.locusId !== undefined && proof.locusId !== row.locusId) {
      return { ok: false, reason: 'association-unproven' }
    }
    if (proof.deliveryId !== undefined && current.deliveryId !== proof.deliveryId) {
      return { ok: false, reason: 'stale-delivery' }
    }
    return { ok: true, locus: { ...projectRecord(resolved, repository, currentProof), currentDelivery: toCurrentDelivery(current) } }
  }
  return {
    findBySessionId(sessionId) {
      const resolved = repository.findBySessionId(sessionId)
      return resolved === undefined ? undefined : projectRecord(resolved, repository, currentTurnProof?.(sessionId))
    },
    findCurrentDelivery(sessionId) {
      const resolved = repository.findBySessionId(sessionId)
      if (resolved === undefined) return undefined
      const current = repository.findCurrentSerializedDelivery({ locusId: resolved.row.locusId, sessionId })
      return current === undefined ? undefined : toCurrentDelivery(current)
    },
    inspectCurrentDeliveryAuthorization,
  }
}

/** Map a ledger record to the caller-bound current Delivery projection. */
function toCurrentDelivery(record: DeliveryRecord): LocusCurrentDelivery {
  return { ...record, endpoint: { ...record.endpoint } } as unknown as LocusCurrentDelivery
}

/** Project one resolved entry into the caller-bound record, with its current Delivery when one applies. */
function projectRecord(
  resolved: NonNullable<ReturnType<LocusContextLookup['findBySessionId']>>,
  repository: LocusContextLookup,
  turnProof?: { readonly executionId: string; readonly turnId: string },
): LocusContextRecord {
  const row = resolved.row
  // Without an exact turn proof (initialization, GUI, idle) no current Delivery is projected.
  const current = turnProof === undefined
    ? undefined
    : repository.findCurrentDelivery({ locusId: row.locusId, sessionId: row.sessionId, executionId: turnProof.executionId, turnId: turnProof.turnId })
      ?? repository.findCurrentSerializedDelivery({ locusId: row.locusId, sessionId: row.sessionId })
  return {
    endpoint: { ...row.endpoint },
    locus: { locusId: row.locusId, state: row.state, revision: row.revision },
    main: { sessionId: resolved.locusMainSessionId },
    child: { sessionId: row.sessionId },
    workspace: { workspaceId: resolved.workspaceId },
    accessMode: row.accessMode,
    ...(row.invalidReason === undefined ? {} : { invalidReason: row.invalidReason }),
    ...(current === undefined ? {} : { currentDelivery: toCurrentDelivery(current) }),
  }
}
