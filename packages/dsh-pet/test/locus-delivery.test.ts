import { describe, expect, it } from 'vitest'
import {
  acceptDelivery,
  createDeliveryLedger,
  feedbackTargetForDelivery,
  findOldestPendingDelivery,
  getDelivery,
  getDeliveryByMessageId,
  queueDelivery,
  settleDelivery,
  settleNextDelivery,
  startDelivery,
  bindDeliveryTurn,
  bindQueued,
  bindTurn,
  settleByTurn,
  type DeliveryCorrelation,
  type DeliveryLedgerState,
  type DeliveryRecord,
} from '../src/host/locus/delivery.js'

const ENDPOINT = { chatId: 'chat-project', threadId: 'thread-a' } as const
const LOCUS = 'locus-project-thread-a'
const CHILD = 'child-project-thread-a'
const EXECUTION = 'execution-project-thread-a'
const TURN = 'turn-project-thread-a'

function correlation(
  overrides: Partial<DeliveryCorrelation> = {},
): DeliveryCorrelation {
  return {
    endpoint: ENDPOINT,
    locusId: LOCUS,
    generation: 1,
    childSessionId: CHILD,
    ...overrides,
  }
}

function accept(
  state: DeliveryLedgerState,
  messageId: string,
  overrides: Partial<DeliveryCorrelation> = {},
): { state: DeliveryLedgerState; record: DeliveryRecord } {
  const result = acceptDelivery(state, {
    ...correlation(overrides),
    messageId,
  })
  return { state: result.state, record: result.record }
}

describe('unified locus Delivery correlation', () => {
  it('accepts a message once and keys the record by message id', () => {
    const first = acceptDelivery(createDeliveryLedger(), {
      ...correlation(),
      messageId: 'message-1',
      acceptedAt: 10,
    })

    expect(first.duplicate).toBe(false)
    expect(first.record.status).toBe('accepted')
    expect(first.record.messageId).toBe('message-1')
    expect(first.record.endpoint).toEqual(ENDPOINT)
    expect(first.record.locusId).toBe(LOCUS)
    expect(first.record.generation).toBe(1)
    expect(first.record.childSessionId).toBe(CHILD)
    expect(getDeliveryByMessageId(first.state, 'message-1')).toBe(first.record)
    expect(getDelivery(first.state, first.record.deliveryId)).toBe(first.record)
    expect(first.record.feedbackTarget).toEqual({ ...ENDPOINT, messageId: 'message-1' })
  })

  it('returns the original record for duplicate acceptance and cannot retarget it', () => {
    const first = acceptDelivery(createDeliveryLedger(), {
      ...correlation(),
      messageId: 'message-duplicate',
      deliveryId: 'delivery-original',
    })
    const replay = acceptDelivery(first.state, {
      endpoint: { chatId: 'another-chat', threadId: 'another-thread' },
      locusId: 'another-locus',
      generation: 99,
      childSessionId: 'another-child',
      messageId: 'message-duplicate',
      deliveryId: 'delivery-attacker-chosen',
    })

    expect(replay.duplicate).toBe(true)
    expect(replay.state).toBe(first.state)
    expect(replay.record).toBe(first.record)
    expect(replay.record.feedbackTarget).toEqual({ ...ENDPOINT, messageId: 'message-duplicate' })
    expect(getDelivery(replay.state, 'delivery-attacker-chosen')).toBeUndefined()
  })

  it('fails closed when two Deliveries are assigned the same DSH inbox message id', () => {
    const first = acceptDelivery(createDeliveryLedger(), {
      ...correlation(), messageId: 'message-inbox-first',
    })
    const second = acceptDelivery(first.state, {
      ...correlation(), messageId: 'message-inbox-second',
    })
    const firstBound = bindQueued(second.state, {
      ...correlation(), deliveryId: first.record.deliveryId,
      executionId: 'execution-inbox-first', inboxMessageId: 'inbox-duplicate',
    })
    const collision = bindQueued(firstBound.state, {
      ...correlation(), deliveryId: second.record.deliveryId,
      executionId: 'execution-inbox-second', inboxMessageId: 'inbox-duplicate',
    })

    expect(collision.changed).toBe(false)
    expect(collision.reason).toBe('inbox-message-conflict')
    expect(collision.record?.status).toBe('accepted')
    expect(collision.state.byDeliveryId[first.record.deliveryId]?.status).toBe('queued')
  })

  it('tracks accepted, queued, running, and terminal states without mutating prior snapshots', () => {
    const accepted = acceptDelivery(createDeliveryLedger(), {
      ...correlation(),
      messageId: 'message-state',
    })
    const queued = bindQueued(accepted.state, {
      ...correlation(),
      deliveryId: accepted.record.deliveryId,
      executionId: EXECUTION,
      inboxMessageId: `inbox-${EXECUTION}`,
      queuedAt: 20,
    })
    const running = bindTurn(queued.state, {
      ...correlation(),
      deliveryId: accepted.record.deliveryId,
      executionId: EXECUTION,
      turnId: TURN,
      startedAt: 30,
    })
    const settled = settleByTurn(running.state, {
      deliveryId: accepted.record.deliveryId,
      outcome: 'settled',
      correlation: { ...correlation(), turnId: TURN },
      executionId: EXECUTION,
      turnId: TURN,
      settledAt: 40,
    })

    expect(accepted.record.status).toBe('accepted')
    expect(queued.record?.status).toBe('queued')
    expect(running.record?.status).toBe('running')
    expect(settled.record?.status).toBe('settled')
    expect(settled.record?.settledAt).toBe(40)
    expect(accepted.state.byMessageId['message-state']?.status).toBe('accepted')
    expect(settled.state.byMessageId['message-state']?.status).toBe('settled')
  })

  it('records failed settlement and preserves the failure diagnostic', () => {
    const accepted = acceptDelivery(createDeliveryLedger(), {
      ...correlation(),
      messageId: 'message-failed',
    })
    const queued = bindQueued(accepted.state, {
      ...correlation(),
      deliveryId: accepted.record.deliveryId,
      executionId: EXECUTION,
      inboxMessageId: `inbox-${EXECUTION}`,
    })
    const running = bindTurn(queued.state, {
      ...correlation(),
      deliveryId: accepted.record.deliveryId,
      executionId: EXECUTION,
      turnId: TURN,
    })
    const failed = settleByTurn(running.state, {
      deliveryId: accepted.record.deliveryId,
      outcome: 'failed',
      correlation: { ...correlation(), turnId: TURN },
      executionId: EXECUTION,
      turnId: TURN,
      settledAt: 50,
      failureReason: 'child turn failed',
    })

    expect(failed.changed).toBe(true)
    expect(failed.record?.status).toBe('failed')
    expect(failed.record?.failedAt).toBe(50)
    expect(failed.record?.failureReason).toBe('child turn failed')
  })

  it('settles the oldest pending delivery first within one exact endpoint and generation', () => {
    let state = createDeliveryLedger()
    const first = accept(state, 'message-first')
    state = first.state
    const second = accept(state, 'message-second')
    state = second.state

    const firstBound = bindDeliveryTurn(state, {
      ...correlation(),
      deliveryId: first.record.deliveryId,
      turnId: 'turn-first',
      executionId: 'execution-first', inboxMessageId: 'inbox-execution-first',
    })
    state = firstBound.state
    const secondBound = bindDeliveryTurn(state, {
      ...correlation(),
      deliveryId: second.record.deliveryId,
      turnId: 'turn-second',
      executionId: 'execution-second', inboxMessageId: 'inbox-execution-second',
    })
    state = secondBound.state
    const firstSettlement = settleNextDelivery(state, {
      ...correlation(),
      turnId: 'turn-first',
      executionId: 'execution-first', inboxMessageId: 'inbox-execution-first',
      outcome: 'settled',
      settledAt: 60,
    })
    const secondSettlement = settleNextDelivery(firstSettlement.state, {
      ...correlation(),
      turnId: 'turn-second',
      executionId: 'execution-second', inboxMessageId: 'inbox-execution-second',
      outcome: 'failed',
      settledAt: 70,
      failureReason: 'second failed',
    })

    expect(firstSettlement.record?.deliveryId).toBe(first.record.deliveryId)
    expect(secondSettlement.record?.deliveryId).toBe(second.record.deliveryId)
    expect(secondSettlement.state.byMessageId['message-first']?.status).toBe('settled')
    expect(secondSettlement.state.byMessageId['message-second']?.status).toBe('failed')
  })

  it('keeps FIFO queues separate for different threads even in one chat', () => {
    let state = createDeliveryLedger()
    const threadA = accept(state, 'message-thread-a')
    state = threadA.state
    const threadB = accept(state, 'message-thread-b', {
      endpoint: { chatId: ENDPOINT.chatId, threadId: 'thread-b' },
      locusId: 'locus-project-thread-b',
      childSessionId: 'child-project-thread-b',
    })
    state = threadB.state

    const threadBBound = bindDeliveryTurn(state, {
      endpoint: { chatId: ENDPOINT.chatId, threadId: 'thread-b' },
      locusId: 'locus-project-thread-b',
      generation: 1,
      childSessionId: 'child-project-thread-b',
      deliveryId: threadB.record.deliveryId,
      turnId: TURN,
      executionId: EXECUTION,
      inboxMessageId: `inbox-${EXECUTION}`,
    })
    const settledB = settleNextDelivery(threadBBound.state, {
      endpoint: { chatId: ENDPOINT.chatId, threadId: 'thread-b' },
      locusId: 'locus-project-thread-b',
      generation: 1,
      childSessionId: 'child-project-thread-b',
      turnId: TURN,
      executionId: EXECUTION,
      outcome: 'settled',
    })

    expect(settledB.record?.messageId).toBe('message-thread-b')
    expect(settledB.state.byMessageId['message-thread-a']?.status).toBe('accepted')
  })

  it('supports explicit delivery-id settlement and makes repeated settlement idempotent', () => {
    const accepted = acceptDelivery(createDeliveryLedger(), {
      ...correlation(),
      messageId: 'message-explicit-first',
    })
    const second = acceptDelivery(accepted.state, {
      ...correlation(),
      messageId: 'message-explicit-second',
    })
    const secondQueued = bindQueued(second.state, {
      ...correlation(),
      deliveryId: second.record.deliveryId,
      executionId: EXECUTION,
      inboxMessageId: `inbox-${EXECUTION}`,
    })
    const secondBound = bindTurn(secondQueued.state, {
      ...correlation(),
      deliveryId: second.record.deliveryId,
      executionId: EXECUTION,
      turnId: TURN,
    })

    const settled = settleDelivery(secondBound.state, {
      deliveryId: second.record.deliveryId,
      outcome: 'settled',
      correlation: { ...correlation(), turnId: TURN },
      executionId: EXECUTION,
      turnId: TURN,
      settledAt: 40,
    })
    const repeated = settleDelivery(settled.state, {
      deliveryId: second.record.deliveryId,
      outcome: 'settled',
      correlation: { ...correlation(), turnId: TURN },
      executionId: EXECUTION,
      turnId: TURN,
      settledAt: 40,
    })

    expect(settled.record?.messageId).toBe('message-explicit-second')
    expect(repeated.changed).toBe(false)
    expect(repeated.reason).toBe('already-in-state')
    expect(repeated.record).toBe(settled.record)
    expect(repeated.state.byMessageId['message-explicit-first']?.status).toBe('accepted')
  })

  it('does not let a late old-generation settlement consume a replacement delivery', () => {
    let state = createDeliveryLedger()
    const old = accept(state, 'message-old', {
      generation: 1,
      childSessionId: 'child-old',
    })
    state = old.state
    const replacement = accept(state, 'message-new', {
      generation: 2,
      childSessionId: 'child-new',
    })
    state = replacement.state

    const oldBound = bindDeliveryTurn(state, {
      ...correlation({ generation: 1, childSessionId: 'child-old' }),
      deliveryId: old.record.deliveryId,
      executionId: 'execution-old', inboxMessageId: 'inbox-execution-old',
      turnId: 'turn-old',
    })
    state = oldBound.state
    const newBound = bindDeliveryTurn(state, {
      ...correlation({ generation: 2, childSessionId: 'child-new' }),
      deliveryId: replacement.record.deliveryId,
      executionId: 'execution-new', inboxMessageId: 'inbox-execution-new',
      turnId: 'turn-new',
    })
    state = newBound.state

    // This event is from the old child and old locus generation. FIFO lookup is
    // exact, so it settles only the old request and cannot consume the new one.
    const oldSettlement = settleNextDelivery(state, {
      ...correlation({ generation: 1, childSessionId: 'child-old' }),
      executionId: 'execution-old', inboxMessageId: 'inbox-execution-old',
      turnId: 'turn-old',
      outcome: 'settled',
    })
    expect(oldSettlement.record?.messageId).toBe('message-old')
    expect(oldSettlement.state.byMessageId['message-new']?.status).toBe('running')

    // An explicit id cannot be used with a mismatched generation either.
    const wrongGeneration = settleDelivery(oldSettlement.state, {
      deliveryId: replacement.record.deliveryId,
      outcome: 'settled',
      executionId: 'execution-new', inboxMessageId: 'inbox-execution-new',
      turnId: 'turn-new',
      correlation: { ...correlation({ generation: 1, childSessionId: 'child-old' }), turnId: 'turn-new' },
      settledAt: 40,
    })
    expect(wrongGeneration.changed).toBe(false)
    expect(wrongGeneration.reason).toBe('correlation-mismatch')
    expect(wrongGeneration.state.byMessageId['message-new']?.status).toBe('running')
  })

  it('returns no pending delivery when an old generation has no matching record', () => {
    const accepted = acceptDelivery(createDeliveryLedger(), {
      ...correlation({ generation: 2, childSessionId: 'child-new' }),
      messageId: 'message-new-only',
    })

    const late = settleNextDelivery(accepted.state, {
      ...correlation({ generation: 1, childSessionId: 'child-old' }),
      executionId: 'execution-old', inboxMessageId: 'inbox-execution-old',
      turnId: 'turn-old',
      outcome: 'settled',
    })

    expect(late.changed).toBe(false)
    expect(late.reason).toBe('no-pending-delivery')
    expect(late.state.byMessageId['message-new-only']?.status).toBe('accepted')
  })

  it('keeps settlement pure: no parent notification or other side effect is performed', () => {
    const accepted = acceptDelivery(createDeliveryLedger(), {
      ...correlation(),
      messageId: 'message-no-parent-notify',
    })
    const queued = bindQueued(accepted.state, {
      ...correlation(),
      deliveryId: accepted.record.deliveryId,
      executionId: EXECUTION,
      inboxMessageId: `inbox-${EXECUTION}`,
    })
    const bound = bindTurn(queued.state, {
      ...correlation(),
      deliveryId: accepted.record.deliveryId,
      executionId: EXECUTION,
      turnId: TURN,
    })

    const settled = settleNextDelivery(bound.state, {
      ...correlation(),
      executionId: EXECUTION,
      turnId: TURN,
      outcome: 'settled',
    })

    expect(settled.record).not.toHaveProperty('parentSessionId')
    expect(settled.record).not.toHaveProperty('notifyParent')
    expect(accepted.state.byMessageId['message-no-parent-notify']?.status).toBe('accepted')
    expect(settled.state.byMessageId['message-no-parent-notify']?.status).toBe('settled')
  })

  it('derives the feedback target from the accepted message and returns no target for unknown ids', () => {
    const accepted = acceptDelivery(createDeliveryLedger(), {
      ...correlation(),
      messageId: 'message-feedback-target',
      rootMessageId: 'message-root',
    })

    const target = feedbackTargetForDelivery(accepted.state, accepted.record.deliveryId)
    expect(target).toEqual({ ...ENDPOINT, messageId: 'message-feedback-target', rootMessageId: 'message-root' })
    expect(target).not.toBe(accepted.record.feedbackTarget)
    expect(Object.isFrozen(target)).toBe(true)
    expect(feedbackTargetForDelivery(accepted.state, 'missing')).toBeUndefined()
  })

  it('refuses a terminal transition from a mismatched endpoint or child', () => {
    const accepted = acceptDelivery(createDeliveryLedger(), {
      ...correlation(),
      messageId: 'message-mismatch',
    })
    const mismatch = settleDelivery(accepted.state, {
      deliveryId: accepted.record.deliveryId,
      outcome: 'failed',
      executionId: EXECUTION,
      turnId: TURN,
      correlation: { ...correlation({
        endpoint: { chatId: ENDPOINT.chatId, threadId: 'other-thread' },
      }), turnId: TURN },
      settledAt: 40,
    })

    expect(mismatch.changed).toBe(false)
    expect(mismatch.reason).toBe('correlation-mismatch')
    expect(mismatch.record?.status).toBe('accepted')
  })
})
