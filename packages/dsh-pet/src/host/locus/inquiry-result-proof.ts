/**
 * Durable proof that a `pet-inquiry-result` inbox message belongs to the
 * original, still-pending Feishu Delivery of the child that asked.
 *
 * Pure function over injected read-only ports; it imports no DSH runtime. It
 * is fail closed: every missing, inconsistent or throwing fact yields
 * `undefined`, and a Delivery is never chosen by locus id alone or as "the
 * latest one". The chain it walks is:
 *
 *   result handoff (by message id)
 *     -> inquiry requester == handoff scope == the child's current locus/generation
 *     -> local work of that child (work id == the root user message's inbox id)
 *     -> the one Delivery whose inbox message id is that work id
 *     -> same child/locus/generation, pending, not past its deadlines
 *
 * The observer still performs its own lineage checks on the returned Delivery;
 * this proof only supplies the Host-owned durable half.
 */

import {
  isPendingDeliveryStatus,
  MAX_DELIVERY_LEASE_MS,
  type DeliveryStatus,
} from './delivery.js'
import type { LocusClaimedDelivery } from './turn-observer.js'

/** Inquiry member identity, structurally the same as the inquiry ledger's scope. */
export type ProofScope =
  | { readonly kind: 'main'; readonly sessionId: string }
  | {
    readonly kind: 'child'
    readonly sessionId: string
    readonly locusId: string
    readonly generation: number
  }

export interface ProofHandoff {
  readonly inquiryId: string
  readonly phase: string
  readonly scope: ProofScope
  readonly state: string
  readonly work:
    | { readonly kind: 'local'; readonly sessionId: string; readonly workId: string }
    | { readonly kind: string; readonly [key: string]: unknown }
}

export interface ProofInquiry {
  readonly requester: ProofScope
  readonly status: string
}

export interface ProofWork {
  readonly sessionId: string
  readonly workId: string
  readonly scopeGeneration: number
  readonly state: string
  readonly openInquiryIds: readonly string[]
}

export interface ProofDelivery {
  readonly deliveryId: string
  readonly executionId?: string
  readonly status: DeliveryStatus
  readonly endpoint: { readonly chatId: string; readonly threadId?: string }
  readonly locusId: string
  readonly generation: number
  readonly childSessionId: string
  readonly acceptedAt?: number
  readonly deadlineAt?: number
  readonly hardDeadlineAt?: number
}

/** Injected read-only ports. Every one may throw; a throw means "no proof". */
export interface InquiryResultProofPorts {
  findResultHandoff(messageId: string): ProofHandoff | undefined
  getInquiry(inquiryId: string): ProofInquiry | undefined
  getWork(sessionId: string, workId: string): ProofWork | undefined
  /** Must resolve a unique Delivery (or undefined); a duplicate must throw. */
  findDeliveryByInboxMessageId(inboxMessageId: string): ProofDelivery | undefined
  now(): number
  /** The child's current locus/generation, or undefined when it has no active locus. */
  currentScopeOf(childSessionId: string): { readonly locusId: string; readonly generation: number } | undefined
}

/**
 * Inquiry states from which a result handoff can legitimately reach a requester
 * turn. `answered` is the state when the handoff is still `intent` (the
 * observer's claim event precedes the durable pre-step claim);
 * `result-delivered` follows that claim; `unavailable` is a failure result the
 * requester must still be able to report on. `rejected`, `cancelled`,
 * `needs-review` and the non-result states are refused (fail closed).
 */
const PROVABLE_INQUIRY_STATUSES: ReadonlySet<string> = new Set(['answered', 'unavailable', 'result-delivered'])

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

/** Member identity with the same strictness as the ledger's member key. */
function sameChildScope(
  scope: ProofScope | undefined,
  expected: { readonly sessionId: string; readonly locusId: string; readonly generation: number },
): boolean {
  return scope !== undefined && scope !== null && scope.kind === 'child' &&
    scope.sessionId === expected.sessionId &&
    scope.locusId === expected.locusId &&
    scope.generation === expected.generation
}

/**
 * Build the proof function over injected ports.
 * @param ports - read-only durable facts and a clock.
 * @returns a function resolving the original Delivery, or undefined.
 */
export function proveInquiryResultDelivery(
  ports: InquiryResultProofPorts,
): (input: { readonly childSessionId: string; readonly messageId: string }) => LocusClaimedDelivery | undefined {
  return input => {
    try {
      if (input === null || typeof input !== 'object') return undefined
      const { childSessionId, messageId } = input
      if (!isNonEmpty(childSessionId) || !isNonEmpty(messageId)) return undefined

      const current = ports.currentScopeOf(childSessionId)
      if (current === undefined || current === null || !isNonEmpty(current.locusId) || !isInteger(current.generation)) {
        return undefined
      }
      const expected = { sessionId: childSessionId, locusId: current.locusId, generation: current.generation }

      // (a) a result handoff for exactly this message. `intent` is accepted
      // because the observer's claim event precedes the durable pre-step claim.
      const handoff = ports.findResultHandoff(messageId)
      if (handoff === undefined || handoff === null) return undefined
      if (handoff.phase !== 'result') return undefined
      if (handoff.state !== 'intent' && handoff.state !== 'claimed') return undefined

      // (b) the handoff targets this child's current locus/generation.
      if (!sameChildScope(handoff.scope, expected)) return undefined

      // (c) the inquiry was asked by this exact member and has a result to hand back.
      if (!isNonEmpty(handoff.inquiryId)) return undefined
      const inquiry = ports.getInquiry(handoff.inquiryId)
      if (inquiry === undefined || inquiry === null) return undefined
      if (!sameChildScope(inquiry.requester, expected)) return undefined
      if (!PROVABLE_INQUIRY_STATUSES.has(inquiry.status)) return undefined

      // (d) local work owned by this child.
      const handoffWork = handoff.work
      if (handoffWork === null || typeof handoffWork !== 'object' || handoffWork.kind !== 'local') return undefined
      const workRef = handoffWork as { readonly sessionId: unknown; readonly workId: unknown }
      if (workRef.sessionId !== childSessionId || !isNonEmpty(workRef.workId)) return undefined
      const workId = workRef.workId

      // (e) the work row exists, is not settled and belongs to this generation.
      // The inquiry may still be an open branch (intent) or already removed
      // (claimed); either is accepted, a settled work never is.
      const work = ports.getWork(childSessionId, workId)
      if (work === undefined || work === null) return undefined
      if (work.sessionId !== childSessionId || work.workId !== workId) return undefined
      if (work.state === 'settled') return undefined
      if (work.scopeGeneration !== current.generation) return undefined
      if (!Array.isArray(work.openInquiryIds)) return undefined

      // (f) the work id is the inbox message id of exactly one pending Delivery
      // of this child/locus/generation that has not outlived its deadlines.
      const delivery = ports.findDeliveryByInboxMessageId(workId)
      if (delivery === undefined || delivery === null) return undefined
      if (
        delivery.childSessionId !== childSessionId ||
        delivery.locusId !== current.locusId ||
        delivery.generation !== current.generation
      ) return undefined
      if (!isNonEmpty(delivery.deliveryId) || !isNonEmpty(delivery.executionId)) return undefined
      if (!isPendingDeliveryStatus(delivery.status)) return undefined
      const endpoint = delivery.endpoint
      if (endpoint === undefined || endpoint === null || !isNonEmpty(endpoint.chatId)) return undefined

      const now = ports.now()
      if (!isInteger(now)) return undefined
      if (delivery.deadlineAt !== undefined && !(now < delivery.deadlineAt)) return undefined
      const hard = delivery.hardDeadlineAt ??
        (delivery.acceptedAt === undefined ? undefined : delivery.acceptedAt + MAX_DELIVERY_LEASE_MS)
      if (hard !== undefined && !(now < hard)) return undefined

      return {
        deliveryId: delivery.deliveryId,
        executionId: delivery.executionId,
        correlation: {
          endpoint: endpoint.threadId === undefined
            ? { chatId: endpoint.chatId }
            : { chatId: endpoint.chatId, threadId: endpoint.threadId },
          locusId: delivery.locusId,
          generation: delivery.generation,
          childSessionId: delivery.childSessionId,
        },
        status: delivery.status,
      }
    } catch {
      return undefined
    }
  }
}
