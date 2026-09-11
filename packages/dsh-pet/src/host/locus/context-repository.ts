/**
 * Narrow seam between the caller-bound pet_context tool and the locus store.
 *
 * The durable locus repository is still being integrated.  It must expose a
 * reverse lookup by the *actual* child session id and return every matching
 * generation, including invalid/retired rows.  Returning all rows is
 * intentional: the tool must distinguish "not a locus child" from a stale or
 * ambiguous identity and fail closed instead of selecting a convenient row.
 */

import type {
  LocusChildSessionFacts,
  LocusContextAnchorFacts,
  LocusEndpoint,
  LocusFacts,
  LocusMainSessionFacts,
  LocusPermissionFacts,
  LocusReplyTarget,
  LocusWorkspaceFacts,
} from './context.js'
import type { DeliveryStatus } from './delivery.js'
import type { LocusRecord } from './aggregate.js'

/** Aggregate rows may carry a richer anchor once the durable schema is wired. */
type LocusRecordWithContext = LocusRecord & {
  readonly contextAnchor?: LocusContextAnchorFacts
}

/** The current accepted delivery, when this child is processing one. */
export interface LocusCurrentDelivery {
  readonly deliveryId: string
  readonly messageId: string
  readonly endpoint: LocusEndpoint
  readonly locusId: string
  readonly generation: number
  readonly childSessionId: string
  readonly status?: DeliveryStatus
  readonly senderOpenId?: string
  readonly senderName?: string
  readonly text?: string
  /** Exact platform parent message, when the inbound message was a reply. */
  readonly replyToMessageId?: string
  readonly replyTarget?: LocusReplyTarget
}

/** One caller-bound context projection for an active or historical locus. */
export interface LocusContextRecord {
  readonly endpoint: LocusEndpoint
  readonly locus: LocusFacts
  readonly main: LocusMainSessionFacts
  readonly child: LocusChildSessionFacts
  readonly workspace: LocusWorkspaceFacts
  readonly permission: LocusPermissionFacts
  readonly contextAnchor: LocusContextAnchorFacts
  /** Omitted for initialization, GUI turns, and idle children. */
  readonly currentDelivery?: LocusCurrentDelivery
  /** Optional integration marker; legacy rows are never eligible. */
  readonly legacy?: boolean
  /** Optional durable diagnostic explaining why an unavailable locus stopped. */
  readonly invalidReason?: string
  /** Optional discriminator used by adapters while the durable schema migrates. */
  readonly source?: 'locus' | 'legacy'
}

/**
 * The only repository operation needed by the scoped context tool.
 *
 * A repository implementation may return an empty list for an ordinary session,
 * one row for a valid locus child, or multiple rows when corruption/legacy
 * generations make identity ambiguous.  It must not collapse historical and
 * active rows before this caller-bound check runs.
 */
export interface LocusContextRepository {
  findByChildSessionId(childSessionId: string): readonly LocusContextRecord[]
}

/**
 * Minimal shape exposed by the current in-memory/durable locus repository.
 *
 * This adapter is deliberately conservative: aggregate records prove
 * endpoint/main/child/workspace and permission; optional seams provide the
 * independently confirmed anchor and exact current Delivery when available.
 * Missing optional facts remain unknown/absent rather than being guessed.
 */
export interface LocusAggregateLookup {
  findByChildSession(childSessionId: string): LocusRecordWithContext | undefined
  /** Optional lossless lookup; when absent the adapter uses the single-row API. */
  findAllByChildSession?(childSessionId: string): readonly LocusRecordWithContext[]
  /** Optional exact caller-bound lookup; child/generation alone is not proof. */
  findCurrentDelivery?(input: {
    readonly childSessionId: string
    readonly locusId: string
    readonly generation: number
    readonly executionId?: string
    readonly turnId?: string
  }): LocusCurrentDelivery | undefined
  /** Resolve the persisted anchor separately from aggregate identity. */
  findContextAnchor?(input: {
    readonly childSessionId: string
    readonly locusId: string
    readonly generation: number
  }): LocusContextAnchorFacts | undefined
}

/**
 * Adapt the current locus repository to the context-tool seam.
 *
 * This is the integration point for `LocusRepository` today.  A future durable
 * implementation should implement `LocusContextRepository` directly so it can
 * provide confirmed anchors and the current Delivery without changing the
 * caller-bound tool API.
 */
export function asLocusContextRepository(
  repository: LocusAggregateLookup,
  currentTurnProof?: (childSessionId: string) =>
    | { readonly executionId: string; readonly turnId: string }
    | undefined,
): LocusContextRepository {
  return {
    findByChildSessionId(childSessionId) {
      const records = repository.findAllByChildSession?.(childSessionId) ?? (() => {
        const record = repository.findByChildSession(childSessionId)
        return record === undefined ? [] : [record]
      })()
      return records.map(record => projectAggregateRecord(
        record,
        repository,
        currentTurnProof?.(childSessionId),
      ))
    },
  }
}

function projectAggregateRecord(
  record: LocusRecordWithContext,
  repository: LocusAggregateLookup,
  turnProof?: { readonly executionId: string; readonly turnId: string },
): LocusContextRecord {
  const currentDelivery = turnProof === undefined || record.childSessionId === undefined
    ? undefined
    : repository.findCurrentDelivery?.({
      childSessionId: record.childSessionId,
      locusId: record.id,
      generation: record.generation,
      executionId: turnProof.executionId,
      turnId: turnProof.turnId,
    })
  const state =
    record.state === 'provisioning' ||
        record.state === 'active' ||
        record.state === 'switching' ||
        record.state === 'invalid' ||
        record.state === 'stopped' ||
        record.state === 'retired'
      ? record.state
      : undefined

  return {
    endpoint: { ...record.endpoint },
    locus: {
      locusId: record.id,
      generation: record.generation,
      ...(state !== undefined ? { state } : {}),
    },
    main: { sessionId: record.parentSessionId },
    child: {
      // An active aggregate record always has a child.  If a malformed
      // historical row reaches this adapter, retain an empty value so the
      // caller-bound validator rejects it rather than inventing an id.
      sessionId: record.childSessionId ?? '',
    },
    workspace: { workspaceId: record.workspaceId },
    permission: {
      effective: record.permission.effective,
      desired: record.permission.desired,
      ...(record.permission.verifiedAt !== undefined
        ? { verifiedAt: record.permission.verifiedAt }
        : {}),
      ...(record.permission.grantedBy !== undefined
        ? { grantedBy: record.permission.grantedBy }
        : {}),
    },
    contextAnchor: record.contextAnchor ?? repository.findContextAnchor?.({
      childSessionId: record.childSessionId ?? '',
      locusId: record.id,
      generation: record.generation,
    }) ?? { status: 'unknown' },
    ...(record.invalidReason === undefined ? {} : { invalidReason: record.invalidReason }),
    ...(currentDelivery === undefined ? {} : { currentDelivery }),
  }
}
