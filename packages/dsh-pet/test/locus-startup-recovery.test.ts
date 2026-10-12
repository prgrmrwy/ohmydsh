import { describe, expect, it } from 'vitest'
import type { DeliveryRecord } from '../src/host/locus/delivery.js'
import {
  proveInterruptedStartupDelivery,
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

/**
 * The third startup proof: the turn that took the message is already over.
 *
 * A restart between "the child started the turn" and "the child finished the
 * Delivery" leaves a `current` row whose owner no longer exists. Left alone it
 * holds the serialized slot until its lease expires (measured live: one hour of
 * silence, with the next message stuck in backlog), so the exact end reason in
 * the child's own log is what turns "wait an hour" into a decision.
 */
describe('production startup proof for an interrupted bound turn', () => {
  const interrupted = (patch: Partial<DeliveryRecord> = {}) => delivery({
    status: 'current',
    queueState: 'current',
    turnId: 'child-1#7',
    startedAt: 3,
    ...patch,
  })

  it('proves an interrupted bound turn and never a still-open one', () => {
    expect(proveInterruptedStartupDelivery(interrupted(), session([
      { type: 'turn/start', data: { turn: 7 } },
      { type: 'user/message', data: { id: 'inbox-1' } },
      { type: 'turn/end', data: { turn: 7, reason: { kind: 'interrupted' } } },
    ]))).toEqual({
      deliveryId: 'delivery-1',
      executionId: 'execution-1',
      turnId: 'child-1#7',
      state: 'interrupted',
    })

    // The open turn is the `running` case; a process killed without a graceful
    // end event is indistinguishable from a live turn here, so it must refuse.
    expect(proveInterruptedStartupDelivery(interrupted(), session([
      { type: 'turn/start', data: { turn: 7 } },
      { type: 'user/message', data: { id: 'inbox-1' } },
    ]))).toBeUndefined()
  })

  it.each([
    {
      name: 'the turn completed normally',
      events: [
        { type: 'turn/start', data: { turn: 7 } },
        { type: 'user/message', data: { id: 'inbox-1' } },
        { type: 'turn/end', data: { turn: 7, reason: { kind: 'completed' } } },
      ],
    },
    {
      name: 'the turn ended with an error',
      events: [
        { type: 'turn/start', data: { turn: 7 } },
        { type: 'user/message', data: { id: 'inbox-1' } },
        { type: 'turn/end', data: { turn: 7, reason: { kind: 'error', error: { message: 'x' } } } },
      ],
    },
    {
      name: 'no turn ever entered the message',
      events: [
        { type: 'turn/start', data: { turn: 7 } },
        { type: 'user/message', data: { id: 'inbox-other' } },
        { type: 'turn/end', data: { turn: 7, reason: { kind: 'interrupted' } } },
      ],
    },
    {
      name: 'the message entered two turns',
      events: [
        { type: 'turn/start', data: { turn: 6 } },
        { type: 'user/message', data: { id: 'inbox-1' } },
        { type: 'turn/end', data: { turn: 6, reason: { kind: 'interrupted' } } },
        { type: 'turn/start', data: { turn: 7 } },
        { type: 'user/message', data: { id: 'inbox-1' } },
        { type: 'turn/end', data: { turn: 7, reason: { kind: 'interrupted' } } },
      ],
    },
    {
      name: 'the durable turn id does not match the log',
      events: [
        { type: 'turn/start', data: { turn: 7 } },
        { type: 'user/message', data: { id: 'inbox-1' } },
        { type: 'turn/end', data: { turn: 7, reason: { kind: 'interrupted' } } },
      ],
      delivery: interrupted({ turnId: 'child-1#6' }),
    },
    {
      name: 'the log is malformed',
      events: [null, { type: 'turn/start', data: { turn: 7 } }],
    },
  ])('refuses to prove when $name', ({ events, delivery: patched }) => {
    expect(
      proveInterruptedStartupDelivery(patched ?? interrupted(), session(events)),
    ).toBeUndefined()
  })

  it('refuses an empty log and a session without events', () => {
    expect(proveInterruptedStartupDelivery(interrupted(), session([]))).toBeUndefined()
    expect(proveInterruptedStartupDelivery(interrupted(), {})).toBeUndefined()
  })

  it('proves an interrupted turn even when the durable turn id was never bound', () => {
    // The process can die after the child started the turn but before
    // `bindTurn` persisted it; the child's own log still proves the outcome.
    const proof = proveInterruptedStartupDelivery(
      interrupted({ turnId: undefined }),
      session([
        { type: 'turn/start', data: { turn: 7 } },
        { type: 'user/message', data: { id: 'inbox-1' } },
        { type: 'turn/end', data: { turn: 7, reason: { kind: 'interrupted' } } },
      ]),
    )

    expect(proof?.state).toBe('interrupted')
  })
})
