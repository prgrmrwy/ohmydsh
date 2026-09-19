import type { LocusInboxClaim, LocusTurnEnd } from '../../src/host/locus/turn-observer.js'

/**
 * Sanitized reconstruction of the three historical finish-refusal shapes.
 *
 * No raw session ids, chat/message ids, user text, timestamps, model output, or
 * platform identifiers are retained. Stable fixture labels describe only the
 * runtime ordering needed to reproduce the authorization decision.
 */
export const LOCUS_FINISH_HISTORY = Object.freeze({
  claimBeforeBind: Object.freeze({
    childSessionId: 'child-1',
    messageId: 'fixture-delivery-a',
    deliveryId: 'fixture-ledger-a',
    executionId: 'fixture-execution-a',
    turn: 1,
  }),
  isolatedBatch: Object.freeze({
    pendingNextStepId: 'fixture-gui-steer',
    queuedNextTurnId: 'fixture-delivery-b',
    deliveryId: 'fixture-ledger-b',
    executionId: 'fixture-execution-b',
    turn: 2,
  }),
  continuation: Object.freeze({
    deliveryMessageId: 'fixture-delivery-c',
    deliveryId: 'fixture-ledger-c',
    executionId: 'fixture-execution-c',
    originalTurn: 3,
    agentMessageId: 'fixture-agent-continuation',
    continuationTurn: 4,
  }),
  promotion: Object.freeze({
    expiredMessageId: 'fixture-delivery-expired',
    expiredDeliveryId: 'fixture-ledger-expired',
    expiredExecutionId: 'fixture-execution-expired',
    expiredTurn: 5,
    promotedMessageId: 'fixture-delivery-promoted',
    promotedDeliveryId: 'fixture-ledger-promoted',
    promotedExecutionId: 'fixture-execution-promoted',
    promotedTurn: 6,
  }),
  restore: Object.freeze({
    deliveryId: 'fixture-ledger-restored',
    executionId: 'fixture-execution-restored',
    originalTurn: 7,
    agentMessageId: 'fixture-agent-after-restore',
    continuationTurn: 8,
  }),
})

export type SanitizedRuntimeFact =
  | { readonly kind: 'claim'; readonly value: LocusInboxClaim }
  | { readonly kind: 'turn-end'; readonly value: LocusTurnEnd }
  | { readonly kind: 'bind'; readonly messageId: string }
  | { readonly kind: 'revoke'; readonly deliveryId: string }
  | { readonly kind: 'restore'; readonly deliveryId: string; readonly executionId: string; readonly turn: number }

/** The historical ordering, retained separately from every scenario's oracle. */
export const LOCUS_FINISH_SANITIZED_FACTS: readonly SanitizedRuntimeFact[] = Object.freeze([
  { kind: 'claim', value: { childSessionId: 'child-1', messageId: 'fixture-delivery-a', turn: 1, sourceKind: 'user' } },
  { kind: 'bind', messageId: 'fixture-delivery-a' },
  { kind: 'turn-end', value: { childSessionId: 'child-1', turn: 3, outcome: 'completed' } },
  { kind: 'claim', value: { childSessionId: 'child-1', messageId: 'fixture-agent-continuation', turn: 4, sourceKind: 'agent-message' } },
  { kind: 'revoke', deliveryId: 'fixture-ledger-expired' },
  { kind: 'restore', deliveryId: 'fixture-ledger-restored', executionId: 'fixture-execution-restored', turn: 7 },
  { kind: 'claim', value: { childSessionId: 'child-1', messageId: 'fixture-agent-after-restore', turn: 8, sourceKind: 'agent-message' } },
])
