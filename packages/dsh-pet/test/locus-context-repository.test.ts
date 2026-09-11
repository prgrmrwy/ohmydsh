import { describe, expect, it } from 'vitest'
import { asLocusContextRepository } from '../src/host/locus/context-repository.js'

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
})
