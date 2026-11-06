import { describe, expect, it, vi } from 'vitest'
import { asLocusContextRepository, type LocusContextLookup } from '../src/host/locus/context-repository.js'
import {
  createLocusTurnObserver,
  type LocusInboxClaim,
  type LocusTurnEnd,
} from '../src/host/locus/turn-observer.js'

/** The v20 entry row of the topic under test, and its group's M and workspace. */
const row = {
  endpoint: { chatId: 'oc-1', threadId: 'omt-1' },
  locusId: 'locus-1',
  sessionId: 'session-child',
  state: 'active' as const,
  accessMode: 'read-only' as const,
  revision: 3,
  createdAt: 1,
  updatedAt: 2,
}

const current = {
  deliveryId: 'delivery-1',
  messageId: 'om-1',
  endpoint: row.endpoint,
  locusId: row.locusId,
  sessionId: row.sessionId,
  status: 'current' as const,
  queueState: 'current' as const,
  senderOpenId: 'ou-user',
  text: 'request',
  replyToMessageId: 'om-question',
  replyTarget: { chatId: 'oc-1', threadId: 'omt-1', messageId: 'om-1' },
}

function lookup(overrides: Partial<LocusContextLookup> = {}): LocusContextLookup {
  return {
    findBySessionId: (id: string) => id === 'session-child'
      ? { row, locusMainSessionId: 'session-parent', workspaceId: 'workspace-1' } as never
      : undefined,
    hasFirstDeliveryRecoveryDebt: () => false,
    findCurrentSerializedDelivery: () => undefined,
    findCurrentDelivery: input => input.executionId === 'execution-1' && input.turnId === 'session-child#3'
      ? current as never
      : undefined,
    ...overrides,
  } as LocusContextLookup
}

describe('caller-bound locus context repository', () => {
  it('projects the current Delivery only with an exact active turn proof', () => {
    const repository = asLocusContextRepository(
      lookup({ findCurrentSerializedDelivery: () => current as never }),
      child => child === 'session-child'
        ? { executionId: 'execution-1', turnId: 'session-child#3' }
        : undefined,
    )
    expect(repository.findBySessionId('session-child')?.currentDelivery).toMatchObject({
      deliveryId: 'delivery-1',
      messageId: 'om-1',
      replyToMessageId: 'om-question',
      replyTarget: { chatId: 'oc-1', threadId: 'omt-1', messageId: 'om-1' },
    })
  })

  it('inspects durable mismatches without inventing observer-only reasons', () => {
    const proof = {
      deliveryId: 'delivery-1', executionId: 'execution-1', turnId: 'session-child#3',
      source: 'delivery' as const, locusId: 'locus-1',
    }
    const turnProof = () => ({ executionId: proof.executionId, turnId: proof.turnId })
    const repository = asLocusContextRepository(lookup({ findCurrentSerializedDelivery: () => current as never }), turnProof)

    expect(repository.inspectCurrentDeliveryAuthorization?.({
      childSessionId: row.sessionId, operation: 'finish', proof,
    })).toMatchObject({ ok: true, locus: { currentDelivery: current } })

    const sessionMismatch = asLocusContextRepository(lookup({ findCurrentSerializedDelivery: () => current as never }), turnProof)
    expect(sessionMismatch.inspectCurrentDeliveryAuthorization?.({
      childSessionId: row.sessionId, operation: 'wait', proof: { ...proof, sessionId: 'session-other' },
    })).toEqual({ ok: false, reason: 'generation-mismatch' })

    const stale = asLocusContextRepository(lookup({
      findCurrentSerializedDelivery: () => ({ ...current, deliveryId: 'delivery-2' }) as never,
    }), turnProof)
    expect(stale.inspectCurrentDeliveryAuthorization?.({
      childSessionId: row.sessionId, operation: 'track', proof,
    })).toEqual({ ok: false, reason: 'stale-delivery' })
  })

  it('never exposes a prior reply target to a GUI or initialization turn', () => {
    const repository = asLocusContextRepository(lookup({ findCurrentSerializedDelivery: () => current as never }), () => undefined)
    expect(repository.findBySessionId('session-child')).not.toHaveProperty('currentDelivery')
  })

  it('never projects a Delivery after the current turn also claims a GUI steer', async () => {
    vi.useFakeTimers()
    try {
      const claimListeners: Array<(claim: LocusInboxClaim) => void> = []
      const endListeners: Array<(end: LocusTurnEnd) => void> = []
      const observer = createLocusTurnObserver({
        onClaimed: listener => { claimListeners.push(listener); return () => {} },
        onTurnEnd: listener => { endListeners.push(listener); return () => {} },
        lookup: {
          find: ({ messageId }) => messageId === 'delivery-message'
            ? {
                deliveryId: 'delivery-1',
                executionId: 'execution-1',
                correlation: {
                  endpoint: row.endpoint,
                  locusId: row.locusId,
                  sessionId: row.sessionId,
                },
              }
            : undefined,
        },
      } as never)
      const repository = asLocusContextRepository(
        lookup({
          findCurrentSerializedDelivery: () => current as never,
          findCurrentDelivery: input => input.executionId === 'execution-1' && input.turnId === 'session-child#4'
            ? current as never
            : undefined,
        }),
        childSessionId => observer.currentForChild?.(childSessionId),
      )
      const claim = (value: LocusInboxClaim) => claimListeners.forEach(listener => listener(value))

      claim({ childSessionId: row.sessionId, messageId: 'delivery-message', turn: 4, sourceKind: 'user' } as never)
      expect(repository.findBySessionId(row.sessionId)).toHaveProperty('currentDelivery.deliveryId', 'delivery-1')

      claim({ childSessionId: row.sessionId, messageId: 'gui-steer', turn: 4, sourceKind: 'gui' } as never)
      expect(repository.findBySessionId(row.sessionId)).not.toHaveProperty('currentDelivery')
      await vi.runAllTimersAsync()
      expect(repository.findBySessionId(row.sessionId)).not.toHaveProperty('currentDelivery')

      endListeners.forEach(listener => listener({ childSessionId: row.sessionId, turn: 4, outcome: 'completed' } as never))
      expect(repository.findBySessionId(row.sessionId)).not.toHaveProperty('currentDelivery')
      observer.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
