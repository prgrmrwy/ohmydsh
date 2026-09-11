import { describe, expect, it } from 'vitest'
import type { DeliveryRecord } from '../src/host/locus/delivery.js'
import { proveLiveStartupDelivery } from '../src/host/locus/startup-recovery.js'

const delivery = (patch: Partial<DeliveryRecord> = {}): DeliveryRecord => ({
  deliveryId: 'delivery-1',
  messageId: 'om-1',
  sequence: 1,
  endpoint: { chatId: 'oc-1' },
  locusId: 'locus-1',
  generation: 1,
  childSessionId: 'child-1',
  feedbackTarget: { chatId: 'oc-1', messageId: 'om-1' },
  senderOpenId: 'ou-1',
  status: 'queued',
  acceptedAt: 1,
  queuedAt: 2,
  executionId: 'execution-1',
  inboxMessageId: 'inbox-1',
  ...patch,
})

const session = (events: readonly unknown[]) => ({ snapshotEvents: () => events })

describe('production startup Delivery proof', () => {
  it('proves only the exact inbox UUID in the currently open turn', () => {
    expect(proveLiveStartupDelivery(delivery(), session([
      { type: 'turn/start', data: { turn: 7 } },
      { type: 'user/message', data: { id: 'inbox-1', role: 'user' } },
    ]))).toEqual({
      deliveryId: 'delivery-1',
      executionId: 'execution-1',
      turnId: 'child-1#7',
      state: 'running',
    })
  })

  it.each([
    {
      name: 'a different inbox message',
      events: [
        { type: 'turn/start', data: { turn: 7 } },
        { type: 'user/message', data: { id: 'inbox-other' } },
      ],
    },
    {
      name: 'a balanced terminal turn',
      events: [
        { type: 'turn/start', data: { turn: 7 } },
        { type: 'user/message', data: { id: 'inbox-1' } },
        { type: 'turn/end', data: { turn: 7, reason: { kind: 'completed' } } },
      ],
    },
    {
      name: 'multiple matching messages',
      events: [
        { type: 'turn/start', data: { turn: 7 } },
        { type: 'user/message', data: { id: 'inbox-1' } },
        { type: 'user/message', data: { id: 'inbox-1' } },
      ],
    },
  ])('rejects $name instead of inferring execution', ({ events }) => {
    expect(proveLiveStartupDelivery(delivery(), session(events))).toBeUndefined()
  })

  it('rejects a durable turn-id mismatch', () => {
    expect(proveLiveStartupDelivery(delivery({ status: 'running', turnId: 'child-1#6' }), session([
      { type: 'turn/start', data: { turn: 7 } },
      { type: 'user/message', data: { id: 'inbox-1' } },
    ]))).toBeUndefined()
  })
})
