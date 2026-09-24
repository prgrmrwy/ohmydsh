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
  claimCurrentDelivery,
  completeDelivery,
  expireDelivery,
  markFinishing,
  waitDelivery,
  DEFAULT_DELIVERY_LEASE_MS,
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
      acceptedAt: 10,
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
      acceptedAt: 10,
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
    const first = acceptDelivery(state, { ...correlation(), messageId: 'message-first', acceptedAt: 1 })
    state = first.state
    const second = acceptDelivery(state, { ...correlation(), messageId: 'message-second', acceptedAt: 2 })
    state = second.state

    const firstBound = bindDeliveryTurn(state, {
      ...correlation(),
      deliveryId: first.record.deliveryId,
      turnId: 'turn-first',
      executionId: 'execution-first', inboxMessageId: 'inbox-execution-first',
      startedAt: 10,
    })
    state = firstBound.state
    const secondBound = bindDeliveryTurn(state, {
      ...correlation(),
      deliveryId: second.record.deliveryId,
      turnId: 'turn-second',
      executionId: 'execution-second', inboxMessageId: 'inbox-execution-second',
      startedAt: 20,
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
      acceptedAt: 1,
    })
    const second = acceptDelivery(accepted.state, {
      ...correlation(),
      messageId: 'message-explicit-second',
      acceptedAt: 2,
    })
    const secondQueued = bindQueued(second.state, {
      ...correlation(),
      deliveryId: second.record.deliveryId,
      executionId: EXECUTION,
      inboxMessageId: `inbox-${EXECUTION}`,
      queuedAt: 10,
    })
    const secondBound = bindTurn(secondQueued.state, {
      ...correlation(),
      deliveryId: second.record.deliveryId,
      executionId: EXECUTION,
      turnId: TURN,
      startedAt: 20,
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

  it('never lets an explicit newer delivery id leapfrog the oldest backlog row', () => {
    const first = acceptDelivery(createDeliveryLedger(), {
      ...correlation(), messageId: 'message-oldest', acceptedAt: 1_000,
    })
    const second = acceptDelivery(first.state, {
      ...correlation(), messageId: 'message-newer', acceptedAt: 1_001,
    })
    const claim = claimCurrentDelivery(second.state, {
      ...correlation(), deliveryId: second.record.deliveryId, now: 2_000,
    })
    expect(claim.changed).toBe(false)
    expect(claim.reason).toBe('not-oldest')
    expect(claim.record?.deliveryId).toBe(first.record.deliveryId)
    expect(claim.state.byDeliveryId[first.record.deliveryId]?.status).toBe('accepted')
    expect(claim.state.byDeliveryId[second.record.deliveryId]?.status).toBe('accepted')
  })

  it('promotes one FIFO backlog item to current and keeps the next item queued', () => {
    const first = acceptDelivery(createDeliveryLedger(), {
      ...correlation(), messageId: 'message-current-a', acceptedAt: 1_000,
    })
    const second = acceptDelivery(first.state, {
      ...correlation(), messageId: 'message-current-b', acceptedAt: 1_001,
    })
    const claimed = claimCurrentDelivery(second.state, {
      ...correlation(), now: 2_000,
    })

    expect(claimed.changed).toBe(true)
    expect(claimed.record?.status).toBe('current')
    expect(claimed.record?.queueState).toBe('current')
    expect(claimed.record?.revision).toBe(1)
    expect(claimed.state.byMessageId['message-current-b']?.status).toBe('accepted')

    const duplicateClaim = claimCurrentDelivery(claimed.state, {
      ...correlation(), now: 2_001,
    })
    expect(duplicateClaim.changed).toBe(false)
    expect(duplicateClaim.reason).toBe('current-occupied')
    expect(duplicateClaim.record?.messageId).toBe('message-current-a')
  })

  it('uses the fixed acceptance deadline and hard 24-hour cap for repeated waits', () => {
    const accepted = acceptDelivery(createDeliveryLedger(), {
      ...correlation(), messageId: 'message-deadline', acceptedAt: 10_000,
    })
    expect(accepted.record.deadlineAt).toBe(10_000 + 60 * 60 * 1000)
    expect(accepted.record.hardDeadlineAt).toBe(10_000 + 24 * 60 * 60 * 1000)
    const current = claimCurrentDelivery(accepted.state, {
      ...correlation(), now: 10_001,
    })
    const waited = waitDelivery(current.state, {
      ...correlation(), deliveryId: current.record!.deliveryId, now: 20_000,
      waitMinutes: 1_440, expectedRevision: current.record!.revision,
    })

    expect(waited.changed).toBe(true)
    expect(waited.record?.deadlineAt).toBe(10_000 + 24 * 60 * 60 * 1000)
    // Already pinned to the hard cap: a further wait cannot extend anything,
    // but it is SATISFIED rather than refused, and it must not be reported as
    // `deadline-expired` — the Delivery is very much alive.
    const repeated = waitDelivery(waited.state, {
      ...correlation(), deliveryId: waited.record!.deliveryId, now: 21_000,
      waitMinutes: 1_440, expectedRevision: waited.record!.revision,
    })
    expect(repeated.changed).toBe(false)
    expect(repeated.reason).toBe('deadline-already-sufficient')
    expect(repeated.record).toBe(waited.record)
  })

  it('treats a wait already covered by the live lease as satisfied, not as an expiry', () => {
    // Regression for a real acceptance failure. Right after a claim the lease
    // already runs for a full hour, so an ordinary "wait 30 more minutes" asks
    // for LESS than what is already granted. That returned `deadline-expired`,
    // which the Host surfaced as a hard tool error; the child concluded its
    // Delivery was unusable and answered `no-reply` instead of the real reply.
    const acceptedAt = 10_000
    const accepted = acceptDelivery(createDeliveryLedger(), {
      ...correlation(), messageId: 'message-wait-covered', acceptedAt,
    })
    const current = claimCurrentDelivery(accepted.state, { ...correlation(), now: acceptedAt + 1 })
    const existingDeadline = current.record!.deadlineAt

    const shorter = waitDelivery(current.state, {
      ...correlation(), deliveryId: current.record!.deliveryId, now: acceptedAt + 2,
      waitMinutes: 30, expectedRevision: current.record!.revision,
    })

    expect(shorter.reason).toBe('deadline-already-sufficient')
    expect(shorter.reason).not.toBe('deadline-expired')
    // The live deadline is reported untouched, and no revision is burned, so a
    // later CAS by the holder still matches.
    expect(shorter.record?.deadlineAt).toBe(existingDeadline)
    expect(shorter.record?.revision).toBe(current.record!.revision)

    // A genuinely longer horizon still extends normally.
    const longer = waitDelivery(current.state, {
      ...correlation(), deliveryId: current.record!.deliveryId, now: acceptedAt + 2,
      waitMinutes: 120, expectedRevision: current.record!.revision,
    })
    expect(longer.changed).toBe(true)
    expect(longer.record!.deadlineAt).toBeGreaterThan(existingDeadline!)
  })

  it('uses CAS to make finish versus expiry a one-winner race', () => {
    const acceptedAt = 100
    const dueAt = acceptedAt + DEFAULT_DELIVERY_LEASE_MS
    const accepted = acceptDelivery(createDeliveryLedger(), {
      ...correlation(), messageId: 'message-cas', acceptedAt,
    })
    const current = claimCurrentDelivery(accepted.state, { ...correlation(), now: acceptedAt + 1 })
    const finishing = markFinishing(current.state, {
      ...correlation(), deliveryId: current.record!.deliveryId, now: acceptedAt + 2,
      expectedRevision: current.record!.revision,
    })
    expect(finishing.record?.status).toBe('finishing')

    // Fork from the pre-finishing snapshot to simulate a concurrent deadline
    // expiry racing against the finish CAS above: both start from revision 1,
    // but only one mutation is ever actually persisted.
    const staleExpiry = expireDelivery(current.state, {
      ...correlation(), deliveryId: current.record!.deliveryId, now: dueAt,
      expectedRevision: current.record!.revision,
    })
    expect(staleExpiry.changed).toBe(true)
    expect(staleExpiry.record?.status).toBe('expired')
    expect(completeDelivery(staleExpiry.state, {
      ...correlation(), deliveryId: staleExpiry.record!.deliveryId, now: dueAt + 1,
      outcome: 'no-reply', reason: 'already expired', expectedRevision: staleExpiry.record!.revision,
    }).reason).toBe('already-terminal')

    const replied = completeDelivery(finishing.state, {
      ...correlation(), deliveryId: finishing.record!.deliveryId, now: acceptedAt + 3,
      outcome: 'reply', outboundResult: 'success', expectedRevision: finishing.record!.revision,
    })
    expect(replied.changed).toBe(true)
    expect(replied.record?.status).toBe('replied')
    expect(replied.record?.finishOutcome).toBe('reply')
    expect(replied.record?.outboundResult).toBe('success')
    expect(expireDelivery(replied.state, {
      ...correlation(), deliveryId: replied.record!.deliveryId, now: dueAt + 2,
    }).reason).toBe('already-terminal')
  })

  it('refuses to expire a current or backlog Delivery before its own deadline is due', () => {
    const acceptedAt = 1_000
    const accepted = acceptDelivery(createDeliveryLedger(), {
      ...correlation(), messageId: 'message-not-due', acceptedAt,
    })
    const backlogEarly = expireDelivery(accepted.state, {
      ...correlation(), deliveryId: accepted.record.deliveryId, now: acceptedAt + 1,
    })
    expect(backlogEarly.changed).toBe(false)
    expect(backlogEarly.reason).toBe('deadline-not-reached')

    const current = claimCurrentDelivery(accepted.state, { ...correlation(), now: acceptedAt + 2 })
    const currentEarly = expireDelivery(current.state, {
      ...correlation(), deliveryId: current.record!.deliveryId, now: acceptedAt + DEFAULT_DELIVERY_LEASE_MS - 1,
      expectedRevision: current.record!.revision,
    })
    expect(currentEarly.changed).toBe(false)
    expect(currentEarly.reason).toBe('deadline-not-reached')

    const currentDue = expireDelivery(current.state, {
      ...correlation(), deliveryId: current.record!.deliveryId, now: acceptedAt + DEFAULT_DELIVERY_LEASE_MS,
      expectedRevision: current.record!.revision,
    })
    expect(currentDue.changed).toBe(true)
    expect(currentDue.record?.status).toBe('expired')
  })

  it('records explicit no-reply, failed, and unknown outbound outcomes without replay', () => {
    const accepted = acceptDelivery(createDeliveryLedger(), {
      ...correlation(), messageId: 'message-outbound', acceptedAt: 100,
    })
    const current = claimCurrentDelivery(accepted.state, { ...correlation(), now: 101 })
    const noReply = completeDelivery(current.state, {
      ...correlation(), deliveryId: current.record!.deliveryId, now: 102,
      outcome: 'no-reply', reason: 'not actionable',
    })
    expect(noReply.record?.status).toBe('no-reply')
    expect(noReply.record?.outboundResult).toBe('none')

    const next = acceptDelivery(noReply.state, {
      ...correlation(), messageId: 'message-outbound-unknown', acceptedAt: 200,
    })
    const nextCurrent = claimCurrentDelivery(next.state, { ...correlation(), now: 201 })
    const finishing = markFinishing(nextCurrent.state, {
      ...correlation(), deliveryId: nextCurrent.record!.deliveryId, now: 202,
    })
    const unknown = completeDelivery(finishing.state, {
      ...correlation(), deliveryId: finishing.record!.deliveryId, now: 203,
      outcome: 'reply', outboundResult: 'unknown', outboundDiagnostic: 'confirmation lost',
      expectedRevision: finishing.record!.revision,
    })
    expect(unknown.record?.status).toBe('unknown-terminal')
    expect(unknown.record?.outboundResult).toBe('unknown')
    expect(completeDelivery(unknown.state, {
      ...correlation(), deliveryId: unknown.record!.deliveryId, now: 204,
      outcome: 'reply', outboundResult: 'success', expectedRevision: unknown.record!.revision,
    }).changed).toBe(false)
  })
})
