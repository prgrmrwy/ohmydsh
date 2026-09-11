import { describe, expect, it, vi } from 'vitest'
import { asLocusContextRepository } from '../src/host/locus/context-repository.js'
import {
  createLocusTurnObserver,
  type LocusInboxClaim,
  type LocusTurnEnd,
} from '../src/host/locus/turn-observer.js'

const record = {
  id: 'locus-1',
  generation: 2,
  endpoint: { chatId: 'oc-1', threadId: 'omt-1' },
  parentSessionId: 'session-parent',
  childSessionId: 'session-child',
  workspaceId: 'workspace-1',
  source: 'explicit' as const,
  state: 'active' as const,
  busy: true,
  permission: {
    desired: 'read' as const,
    effective: 'read' as const,
    verifiedAt: 10,
  },
  createdAt: 1,
  updatedAt: 2,
}

function aggregate() {
  return {
    findByChildSession: (id: string) => id === 'session-child' ? record : undefined,
    findCurrentDelivery: (input: {
      childSessionId: string
      locusId: string
      generation: number
      executionId?: string
      turnId?: string
    }) => input.executionId === 'execution-1' && input.turnId === 'session-child#3'
      ? {
          deliveryId: 'delivery-1',
          messageId: 'om-1',
          endpoint: record.endpoint,
          locusId: record.id,
          generation: record.generation,
          childSessionId: record.childSessionId,
          senderOpenId: 'ou-user',
          text: 'request',
          replyToMessageId: 'om-question',
          replyTarget: {
            chatId: 'oc-1',
            threadId: 'omt-1',
            messageId: 'om-1',
          },
        }
      : undefined,
  }
}

describe('caller-bound locus context repository', () => {
  it('projects the current Delivery only with an exact active turn proof', () => {
    const repository = asLocusContextRepository(
      aggregate(),
      child => child === 'session-child'
        ? { executionId: 'execution-1', turnId: 'session-child#3' }
        : undefined,
    )
    expect(repository.findByChildSessionId('session-child')[0]?.currentDelivery).toMatchObject({
      deliveryId: 'delivery-1',
      messageId: 'om-1',
      replyToMessageId: 'om-question',
      replyTarget: { chatId: 'oc-1', threadId: 'omt-1', messageId: 'om-1' },
    })
  })

  it('never exposes a prior reply target to a GUI or initialization turn', () => {
    const repository = asLocusContextRepository(aggregate(), () => undefined)
    expect(repository.findByChildSessionId('session-child')[0]).not.toHaveProperty('currentDelivery')
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
                  endpoint: record.endpoint,
                  locusId: record.id,
                  generation: record.generation,
                  childSessionId: record.childSessionId,
                },
              }
            : undefined,
        },
      })
      const backing = aggregate()
      const repository = asLocusContextRepository(
        {
          ...backing,
          findCurrentDelivery: input => input.executionId === 'execution-1' &&
            input.turnId === `${record.childSessionId}#4`
            ? backing.findCurrentDelivery({ ...input, turnId: `${record.childSessionId}#3` })
            : undefined,
        },
        childSessionId => observer.currentForChild?.(childSessionId),
      )
      const claim = (value: LocusInboxClaim) => claimListeners.forEach(listener => listener(value))

      claim({ childSessionId: record.childSessionId, messageId: 'delivery-message', turn: 4 })
      expect(repository.findByChildSessionId(record.childSessionId)[0]).toHaveProperty(
        'currentDelivery.deliveryId',
        'delivery-1',
      )

      claim({ childSessionId: record.childSessionId, messageId: 'gui-steer', turn: 4 })
      expect(repository.findByChildSessionId(record.childSessionId)[0]).not.toHaveProperty('currentDelivery')
      await vi.runAllTimersAsync()
      expect(repository.findByChildSessionId(record.childSessionId)[0]).not.toHaveProperty('currentDelivery')

      endListeners.forEach(listener => listener({
        childSessionId: record.childSessionId,
        turn: 4,
        outcome: 'completed',
      }))
      expect(repository.findByChildSessionId(record.childSessionId)[0]).not.toHaveProperty('currentDelivery')
      observer.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
