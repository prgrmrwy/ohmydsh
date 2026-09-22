import { describe, expect, it } from 'vitest'
import type { DeliveryRecord } from '../src/host/locus/delivery.js'
import {
  proveLiveStartupDelivery,
  proveUnconsumedStartupDelivery,
} from '../src/host/locus/startup-recovery.js'

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

/**
 * The other half of startup: a `current` row the child never took.
 *
 * A `current` row is the physical-dispatch fence, so it survives restart by
 * identity alone — but that also covers a dispatch that died BEFORE hand-off,
 * and such a row can then only expire unanswered. The child's own inbox log is
 * the one place that distinguishes "the child took it" from "nobody ever did".
 */
describe('production startup proof for a never-handed-off Delivery', () => {
  it('proves replay when the queue accepted the message and then canceled it unrun', () => {
    expect(proveUnconsumedStartupDelivery(delivery({ status: 'current' }), session([
      // An unrelated turn that completed normally.
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { id: 'inbox-other' } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      // This Delivery was queued for the next turn...
      { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [{ id: 'inbox-1' }] } },
      // ...and then dropped unrun when the owner shut down.
      {
        type: 'agent/inbox/spliced',
        data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' },
      },
    ]))).toEqual({
      deliveryId: 'delivery-1',
      executionId: 'execution-1',
      state: 'unconsumed',
    })
  })

  it('proves replay when the dispatch died before the child ever queued it', () => {
    expect(proveUnconsumedStartupDelivery(delivery({ status: 'current' }), session([
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { id: 'inbox-other' } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ]))).toEqual({
      deliveryId: 'delivery-1',
      executionId: 'execution-1',
      state: 'unconsumed',
    })
  })

  it.each([
    {
      name: 'the message is still queued for the child',
      events: [
        { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [{ id: 'inbox-1' }] } },
      ],
    },
    {
      name: 'a turn already claimed the message',
      events: [
        { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [{ id: 'inbox-1' }] } },
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [] } },
        { type: 'user/message', data: { id: 'inbox-1' } },
        { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      ],
    },
    {
      name: 'a turn is still open',
      events: [
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'user/message', data: { id: 'inbox-other' } },
      ],
    },
    {
      name: 'the log is empty',
      events: [],
    },
    {
      name: 'a next-STEP cancel is mistaken for the next-turn queue',
      events: [
        { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [{ id: 'inbox-1' }] } },
        {
          type: 'agent/inbox/spliced',
          data: { target: 'next-step', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' },
        },
      ],
    },
    {
      name: 'a splice the fold cannot read exactly',
      events: [
        { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 'zero', inserted: [{ id: 'inbox-1' }] } },
      ],
    },
  ])('refuses to replay when $name', ({ events }) => {
    expect(proveUnconsumedStartupDelivery(delivery({ status: 'current' }), session(events))).toBeUndefined()
  })

  it('refuses without the durable inbox identity it must match', () => {
    const events = [
      { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [{ id: 'inbox-1' }] } },
      {
        type: 'agent/inbox/spliced',
        data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' },
      },
    ]
    expect(proveUnconsumedStartupDelivery(
      delivery({ status: 'current', inboxMessageId: undefined }),
      session(events),
    )).toBeUndefined()
  })
})
