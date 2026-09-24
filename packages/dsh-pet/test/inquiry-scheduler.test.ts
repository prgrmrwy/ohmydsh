import { describe, expect, it } from 'vitest'
import {
  InquiryScheduler,
  classifyClaim,
  type ClaimEntry,
  type SchedulerState,
} from '../src/host/inquiry/scheduler.js'
import {
  ISOLATED_QUEUED_TURN_CLAIM_NOT_PROBED,
  type IsolatedQueuedTurnClaimSupport,
} from '../src/host/inquiry/capability.js'

function clockFrom(start = 1_000) {
  let value = start
  return { now: () => (value += 1), peek: () => value }
}

/**
 * A proven runtime capability. Supplied EXPLICITLY by the suites below that
 * exercise inquiry dispatch, because the scheduler itself defaults to
 * unavailable. `test/inquiry-capability.test.ts` shows the installed runtime
 * does NOT satisfy this today; these suites describe the post-rebuild path.
 */
const CAPABLE: IsolatedQueuedTurnClaimSupport = { available: true }

function makeScheduler(
  limits?: { maxQueuedInquiries?: number; maxQueuedResults?: number },
  isolatedQueuedTurnClaim: IsolatedQueuedTurnClaimSupport = CAPABLE,
) {
  const clock = clockFrom()
  const scheduler = new InquiryScheduler({
    clock,
    isolatedQueuedTurnClaim,
    ...(limits ? { limits } : {}),
  })
  return { scheduler, clock }
}

const claim = (origin: ClaimEntry['origin'], messageId: string, ref?: string): ClaimEntry =>
  ref === undefined ? { messageId, origin } : { messageId, origin, ref }

const inquiry = (id: string, requester: string, target: string, workId?: string) =>
  workId === undefined
    ? { inquiryId: id, requesterSessionId: requester, targetSessionId: target }
    : { inquiryId: id, requesterSessionId: requester, targetSessionId: target, requesterWorkId: workId }

describe('classifyClaim', () => {
  it('reports an empty claim rather than inventing an origin', () => {
    expect(classifyClaim([])).toEqual({ kind: 'empty' })
  })

  it('accepts a single-origin claim and surfaces its one reference', () => {
    expect(classifyClaim([claim('inquiry', 'm1', 'inq-1')])).toEqual({
      kind: 'single-origin',
      origin: 'inquiry',
      ref: 'inq-1',
    })
  })

  it('accepts several ref-less local messages as one local segment', () => {
    expect(classifyClaim([claim('local', 'm1'), claim('local', 'm2')])).toEqual({
      kind: 'single-origin',
      origin: 'local',
    })
  })

  it('reports the observed runtime co-claim of GUI next-step input with a next-turn inquiry as mixed', () => {
    // Mirrors test/inquiry-runtime-probe.test.ts "CURRENT GAP" observation:
    // Inbox.claim('next-turn') returns ['gui-steer', 'inquiry'] in one claim.
    const classification = classifyClaim([claim('local', 'gui-steer'), claim('inquiry', 'inq', 'inq-1')])
    expect(classification).toMatchObject({ kind: 'mixed' })
    expect(classification.kind === 'mixed' && classification.origins).toEqual(['inquiry', 'local'])
  })

  it('reports two different references of the same origin as mixed', () => {
    expect(classifyClaim([claim('delivery', 'm1', 'd-1'), claim('delivery', 'm2', 'd-2')])).toMatchObject({
      kind: 'mixed',
      refs: ['d-1', 'd-2'],
    })
  })

  it('rejects a structurally invalid entry instead of ignoring it', () => {
    expect(classifyClaim([claim('local', '  ')])).toEqual({ kind: 'invalid' })
  })
})

describe('InquiryScheduler acceptance and bounded queues', () => {
  it('accepts an inquiry and reports a deterministic queue position', () => {
    const { scheduler } = makeScheduler()
    const first = scheduler.acceptInquiry(inquiry('i1', 'A', 'B'))
    const second = scheduler.acceptInquiry(inquiry('i2', 'A', 'B'))
    expect(first).toMatchObject({ accepted: true, inquiryId: 'i1', queuePosition: 0 })
    expect(second).toMatchObject({ accepted: true, inquiryId: 'i2', queuePosition: 1 })
    expect(scheduler.pendingInquiries('B').map(entry => entry.inquiryId)).toEqual(['i1', 'i2'])
  })

  it('is idempotent for a duplicate inquiry id and does not grow the queue', () => {
    const { scheduler } = makeScheduler()
    scheduler.acceptInquiry(inquiry('i1', 'A', 'B'))
    expect(scheduler.acceptInquiry(inquiry('i1', 'A', 'B'))).toMatchObject({
      accepted: false,
      reason: 'duplicate-inquiry',
    })
    expect(scheduler.pendingInquiries('B')).toHaveLength(1)
  })

  it('fails closed on invalid identifiers and on a self-directed inquiry', () => {
    const { scheduler } = makeScheduler()
    expect(scheduler.acceptInquiry(inquiry('', 'A', 'B'))).toMatchObject({ reason: 'invalid-input' })
    expect(scheduler.acceptInquiry(inquiry('i1', 'A', ' '))).toMatchObject({ reason: 'invalid-input' })
    expect(scheduler.acceptInquiry(inquiry('i1', 'A', 'A'))).toMatchObject({ reason: 'self-target' })
    expect(scheduler.pendingInquiries('B')).toEqual([])
  })

  it('overflows deterministically by rejecting the newest and leaving the queue intact', () => {
    const { scheduler } = makeScheduler({ maxQueuedInquiries: 2 })
    scheduler.acceptInquiry(inquiry('i1', 'A', 'B'))
    scheduler.acceptInquiry(inquiry('i2', 'A', 'B'))
    const overflow = scheduler.acceptInquiry(inquiry('i3', 'A', 'B'))
    expect(overflow).toEqual({ accepted: false, inquiryId: 'i3', reason: 'queue-overflow', limit: 2 })
    expect(scheduler.pendingInquiries('B').map(entry => entry.inquiryId)).toEqual(['i1', 'i2'])
    // The bound is per target session, not global.
    expect(scheduler.acceptInquiry(inquiry('i4', 'A', 'C'))).toMatchObject({ accepted: true })
  })

  it('reproduces the same overflow decision from a restored state snapshot', () => {
    const { scheduler } = makeScheduler({ maxQueuedInquiries: 2 })
    scheduler.acceptInquiry(inquiry('i1', 'A', 'B'))
    scheduler.acceptInquiry(inquiry('i2', 'A', 'B'))
    const state: SchedulerState = scheduler.toState()
    const restored = new InquiryScheduler({ clock: clockFrom(), limits: { maxQueuedInquiries: 2 }, state })
    expect(restored.pendingInquiries('B').map(entry => entry.inquiryId)).toEqual(['i1', 'i2'])
    expect(restored.acceptInquiry(inquiry('i3', 'A', 'B'))).toMatchObject({ reason: 'queue-overflow' })
  })
})

describe('InquiryScheduler segment admission', () => {
  it('queues instead of steering while the target is busy with its own delivery', () => {
    const { scheduler } = makeScheduler()
    const delivery = scheduler.dispatch('B', [claim('delivery', 'd-msg', 'D1')])
    expect(delivery).toMatchObject({ dispatched: true })
    scheduler.acceptInquiry(inquiry('i1', 'A', 'B'))

    const refused = scheduler.dispatch('B', [claim('inquiry', 'inq-msg', 'i1')])
    expect(refused).toEqual({
      dispatched: false,
      reason: 'target-busy',
      inquiryId: 'i1',
      stillQueued: true,
    })
    // The running delivery segment is untouched: no inquiry was merged into it.
    const running = scheduler.runningSegment('B')
    expect(running).toMatchObject({ origin: 'delivery', ref: 'D1', claimedMessageIds: ['d-msg'] })
    expect(scheduler.pendingInquiries('B').map(entry => entry.inquiryId)).toEqual(['i1'])
  })

  it('never merges an inquiry into a running segment, even after repeated attempts', () => {
    const { scheduler } = makeScheduler()
    const started = scheduler.dispatch('B', [claim('delivery', 'd-msg', 'D1')])
    const segmentId = started.dispatched ? started.segment.segmentId : ''
    scheduler.acceptInquiry(inquiry('i1', 'A', 'B'))
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(scheduler.dispatch('B', [claim('inquiry', `inq-${attempt}`, 'i1')])).toMatchObject({
        dispatched: false,
        reason: 'target-busy',
      })
    }
    expect(scheduler.runningSegment('B')?.segmentId).toBe(segmentId)
    expect(scheduler.runningSegment('B')?.claimedMessageIds).toEqual(['d-msg'])
  })

  it('runs exactly one segment at a time per session regardless of origin', () => {
    const { scheduler } = makeScheduler()
    const first = scheduler.dispatch('B', [claim('delivery', 'd-msg', 'D1')])
    expect(first).toMatchObject({ dispatched: true })
    expect(scheduler.dispatch('B', [claim('local', 'gui-msg')])).toMatchObject({
      dispatched: false,
      reason: 'target-busy',
    })
    expect(scheduler.occupiesRunSlot('B')).toBe(true)
    // Another session is unaffected: the run slot is per session.
    expect(scheduler.dispatch('C', [claim('local', 'gui-msg-c')])).toMatchObject({ dispatched: true })

    const segmentId = first.dispatched ? first.segment.segmentId : ''
    expect(scheduler.completeSegment(segmentId)).toMatchObject({ completed: true })
    expect(scheduler.occupiesRunSlot('B')).toBe(false)
    expect(scheduler.dispatch('B', [claim('local', 'gui-msg')])).toMatchObject({ dispatched: true })
    // Completing an unknown or already-completed segment is inert, not a crash.
    expect(scheduler.completeSegment(segmentId)).toMatchObject({ completed: false, reason: 'unknown-segment' })
  })

  it('records a capability-backed inquiry dispatch as an isolated single-origin segment', () => {
    const { scheduler } = makeScheduler()
    scheduler.acceptInquiry(inquiry('i1', 'A', 'B'))
    const dispatched = scheduler.dispatch('B', [claim('inquiry', 'inq-msg', 'i1')])
    expect(dispatched).toMatchObject({ dispatched: true })
    if (!dispatched.dispatched) throw new Error('expected dispatch')
    // Single origin, single anchor, and the claim scope is recorded as proven
    // isolated rather than assumed.
    expect(dispatched.segment).toMatchObject({
      sessionId: 'B',
      origin: 'inquiry',
      ref: 'i1',
      claimedMessageIds: ['inq-msg'],
      isolatedQueuedTurnClaim: true,
    })
    expect(classifyClaim([claim('inquiry', 'inq-msg', 'i1')])).toMatchObject({ kind: 'single-origin' })
    expect(scheduler.runningSegment('B')).toEqual(dispatched.segment)
    // The recorded fact survives a state round-trip; it is not a transient flag.
    expect(scheduler.toState().segments[0]).toMatchObject({ isolatedQueuedTurnClaim: true })
  })

  it('refuses an inquiry dispatch whose claim carries foreign GUI traffic and leaves it queued', () => {
    const { scheduler } = makeScheduler()
    scheduler.acceptInquiry(inquiry('i1', 'A', 'B'))
    expect(scheduler.occupiesRunSlot('B')).toBe(false)

    const mixed = scheduler.dispatch('B', [claim('local', 'gui-steer'), claim('inquiry', 'inq', 'i1')])
    expect(mixed).toEqual({
      dispatched: false,
      reason: 'mixed-claim',
      inquiryId: 'i1',
      stillQueued: true,
    })
    expect(scheduler.occupiesRunSlot('B')).toBe(false)
    expect(scheduler.runningSegment('B')).toBeUndefined()
    expect(scheduler.pendingInquiries('B').map(entry => entry.inquiryId)).toEqual(['i1'])

    // A clean single-origin claim for the same inquiry is still dispatchable afterwards.
    expect(scheduler.dispatch('B', [claim('inquiry', 'inq', 'i1')])).toMatchObject({
      dispatched: true,
      segment: { origin: 'inquiry', ref: 'i1' },
    })
  })

  it('refuses a mixed claim of delivery and inquiry-result continuation as well', () => {
    const { scheduler } = makeScheduler()
    scheduler.acceptInquiry(inquiry('i1', 'A', 'B'))
    scheduler.dispatch('B', [claim('inquiry', 'inq', 'i1')])
    scheduler.deliverAnswer({ inquiryId: 'i1' })
    const mixed = scheduler.dispatch('A', [
      claim('delivery', 'new-feishu', 'D9'),
      claim('inquiry-result', 'result', 'i1'),
    ])
    expect(mixed).toMatchObject({ dispatched: false, reason: 'mixed-claim' })
    expect(scheduler.pendingResults('A').map(entry => entry.inquiryId)).toEqual(['i1'])
  })

  it('refuses an empty, invalid or unidentified claim instead of guessing a segment origin', () => {
    const { scheduler } = makeScheduler()
    scheduler.acceptInquiry(inquiry('i1', 'A', 'B'))
    expect(scheduler.dispatch('B', [])).toMatchObject({ dispatched: false, reason: 'empty-claim' })
    expect(scheduler.dispatch('B', [claim('inquiry', ' ', 'i1')])).toMatchObject({
      dispatched: false,
      reason: 'invalid-claim',
    })
    expect(scheduler.dispatch('B', [claim('inquiry', 'inq')])).toMatchObject({
      dispatched: false,
      reason: 'unidentified-claim',
    })
    expect(scheduler.dispatch('B', [claim('inquiry', 'inq', 'unknown-id')])).toMatchObject({
      dispatched: false,
      reason: 'not-queued',
    })
    expect(scheduler.pendingInquiries('B').map(entry => entry.inquiryId)).toEqual(['i1'])
  })

  it('refuses an out-of-order inquiry claim and keeps the deterministic head runnable', () => {
    const { scheduler } = makeScheduler()
    scheduler.acceptInquiry(inquiry('i1', 'A', 'B'))
    scheduler.acceptInquiry(inquiry('i2', 'C', 'B'))
    expect(scheduler.runnableNext('B')).toMatchObject({ kind: 'inquiry', inquiryId: 'i1' })
    expect(scheduler.dispatch('B', [claim('inquiry', 'inq', 'i2')])).toEqual({
      dispatched: false,
      reason: 'out-of-order',
      inquiryId: 'i2',
      stillQueued: true,
    })
    expect(scheduler.dispatch('B', [claim('inquiry', 'inq', 'i1')])).toMatchObject({ dispatched: true })
  })

  it('keeps accepted order stable across interleaved accepts, dispatches and cancellations', () => {
    const { scheduler } = makeScheduler()
    for (const id of ['i1', 'i2', 'i3', 'i4']) scheduler.acceptInquiry(inquiry(id, 'A', 'B'))
    expect(scheduler.pendingInquiries('B').map(entry => entry.inquiryId)).toEqual(['i1', 'i2', 'i3', 'i4'])
    expect(scheduler.cancelInquiry('i2')).toBe(true)
    expect(scheduler.cancelInquiry('i2')).toBe(false)
    const seen: string[] = []
    for (let step = 0; step < 4; step += 1) {
      const next = scheduler.runnableNext('B')
      if (!next) break
      seen.push(next.inquiryId)
      const dispatched = scheduler.dispatch('B', [claim('inquiry', `m-${step}`, next.inquiryId)])
      expect(dispatched).toMatchObject({ dispatched: true })
      if (dispatched.dispatched) scheduler.completeSegment(dispatched.segment.segmentId)
    }
    expect(seen).toEqual(['i1', 'i3', 'i4'])
    expect(scheduler.pendingInquiries('B')).toEqual([])
  })
})

describe('InquiryScheduler requires the isolated-claim capability for an inquiry turn', () => {
  const ABSENT: IsolatedQueuedTurnClaimSupport = { available: false, reason: 'marker-absent' }

  it('dispatches nothing and leaves the queue fully intact when the capability is absent', () => {
    const { scheduler } = makeScheduler(undefined, ABSENT)
    scheduler.acceptInquiry(inquiry('i1', 'A', 'B'))
    scheduler.acceptInquiry(inquiry('i2', 'C', 'B'))
    expect(scheduler.runnableNext('B')).toMatchObject({ kind: 'inquiry', inquiryId: 'i1' })

    const refused = scheduler.dispatch('B', [claim('inquiry', 'inq-msg', 'i1')])
    // A DISTINCT reason: this is not a mixed claim, and refusing a combined claim
    // would have destroyed the user's pending GUI input.
    expect(refused).toEqual({
      dispatched: false,
      reason: 'isolated-claim-unsupported',
      inquiryId: 'i1',
      stillQueued: true,
    })
    expect(refused.dispatched === false && refused.reason).not.toBe('mixed-claim')

    // Nothing was created and nothing was consumed.
    expect(scheduler.runningSegment('B')).toBeUndefined()
    expect(scheduler.occupiesRunSlot('B')).toBe(false)
    expect(scheduler.toState().segments).toEqual([])
    expect(scheduler.pendingInquiries('B').map(entry => entry.inquiryId)).toEqual(['i1', 'i2'])
    expect(scheduler.pendingInquiries('B').every(entry => entry.phase === 'queued')).toBe(true)
    expect(scheduler.runnableNext('B')).toMatchObject({ kind: 'inquiry', inquiryId: 'i1' })
  })

  it('stays refused across repeated attempts and never drifts into a segment', () => {
    const { scheduler } = makeScheduler(undefined, ABSENT)
    scheduler.acceptInquiry(inquiry('i1', 'A', 'B'))
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(scheduler.dispatch('B', [claim('inquiry', `inq-${attempt}`, 'i1')])).toMatchObject({
        dispatched: false,
        reason: 'isolated-claim-unsupported',
        stillQueued: true,
      })
    }
    expect(scheduler.toState().segments).toEqual([])
    // Because the inquiry never executed, an answer for it is still impossible.
    expect(scheduler.deliverAnswer({ inquiryId: 'i1' })).toMatchObject({
      accepted: false,
      reason: 'inquiry-not-dispatched',
    })
  })

  it('defaults to unavailable, so a caller that never probed cannot dispatch an inquiry', () => {
    const scheduler = new InquiryScheduler({ clock: clockFrom() })
    scheduler.acceptInquiry(inquiry('i1', 'A', 'B'))
    expect(scheduler.isolatedQueuedTurnClaimSupport()).toEqual(ISOLATED_QUEUED_TURN_CLAIM_NOT_PROBED)
    expect(scheduler.dispatch('B', [claim('inquiry', 'inq-msg', 'i1')])).toMatchObject({
      dispatched: false,
      reason: 'isolated-claim-unsupported',
      stillQueued: true,
    })
  })

  it('leaves every non-inquiry origin unchanged while the capability is absent', () => {
    const { scheduler } = makeScheduler(undefined, ABSENT)
    // Delivery and local work claim no queued inquiry turn, so the seam is irrelevant.
    const delivery = scheduler.dispatch('B', [claim('delivery', 'd-msg', 'D1')])
    expect(delivery).toMatchObject({ dispatched: true, segment: { origin: 'delivery', ref: 'D1' } })
    if (delivery.dispatched) scheduler.completeSegment(delivery.segment.segmentId)
    const local = scheduler.dispatch('B', [claim('local', 'gui')])
    expect(local).toMatchObject({ dispatched: true, segment: { origin: 'local' } })
    if (local.dispatched) scheduler.completeSegment(local.segment.segmentId)

    // A non-inquiry segment does not claim an isolated scope either.
    expect(delivery.dispatched && delivery.segment.isolatedQueuedTurnClaim).toBeUndefined()

    // An inquiry-result continuation is a requester-side continuation, not a
    // target inquiry turn, so this gate does not cover it.
    const capable = makeScheduler().scheduler
    capable.acceptInquiry(inquiry('i1', 'A', 'B'))
    const turn = capable.dispatch('B', [claim('inquiry', 'inq', 'i1')])
    if (turn.dispatched) capable.completeSegment(turn.segment.segmentId)
    capable.deliverAnswer({ inquiryId: 'i1' })
    const state = capable.toState()
    const uncapable = new InquiryScheduler({
      clock: clockFrom(), state, isolatedQueuedTurnClaim: ABSENT,
    })
    expect(uncapable.dispatch('A', [claim('inquiry-result', 'res', 'i1')])).toMatchObject({
      dispatched: true,
      segment: { origin: 'inquiry-result', ref: 'i1' },
    })
  })

  it('still fails closed on a mixed claim when the capability IS present', () => {
    const { scheduler } = makeScheduler()
    expect(scheduler.isolatedQueuedTurnClaimSupport()).toEqual({ available: true })
    scheduler.acceptInquiry(inquiry('i1', 'A', 'B'))
    // Capability present, but the claim that actually arrived carries GUI input:
    // the runtime did not isolate, so this segment is still unusable.
    expect(scheduler.dispatch('B', [claim('local', 'gui-steer'), claim('inquiry', 'inq', 'i1')])).toEqual({
      dispatched: false,
      reason: 'mixed-claim',
      inquiryId: 'i1',
      stillQueued: true,
    })
    expect(scheduler.runningSegment('B')).toBeUndefined()
    expect(scheduler.pendingInquiries('B').map(entry => entry.inquiryId)).toEqual(['i1'])
  })

  it('checks the capability before the busy check so a busy target is never misreported', () => {
    const { scheduler } = makeScheduler(undefined, ABSENT)
    scheduler.dispatch('B', [claim('delivery', 'd-msg', 'D1')])
    scheduler.acceptInquiry(inquiry('i1', 'A', 'B'))
    // Both facts are true; the actionable one is that the capability is missing,
    // because waiting for the target to go idle would never help.
    expect(scheduler.dispatch('B', [claim('inquiry', 'inq', 'i1')])).toMatchObject({
      dispatched: false,
      reason: 'isolated-claim-unsupported',
      stillQueued: true,
    })
    expect(scheduler.runningSegment('B')).toMatchObject({ origin: 'delivery', claimedMessageIds: ['d-msg'] })
  })
})

describe('InquiryScheduler waiting does not hold the run slot', () => {
  it('separates the run slot from in-flight work for a waiting requester', () => {
    const { scheduler } = makeScheduler()
    scheduler.openWork('A', 'D1')
    const segment = scheduler.dispatch('A', [claim('delivery', 'd-msg', 'D1')])
    scheduler.acceptInquiry(inquiry('i1', 'A', 'B', 'D1'))
    expect(segment.dispatched && scheduler.completeSegment(segment.segment.segmentId)).toMatchObject({
      completed: true,
    })

    // Two distinct predicates: the run slot is free, the original work is still in flight.
    expect(scheduler.occupiesRunSlot('A')).toBe(false)
    expect(scheduler.hasWorkInFlight('A')).toBe(true)
    const busy = scheduler.busyForLocking('A')
    expect(busy.busy).toBe(true)
    expect(busy.reasons).toContain('open-work')
    expect(busy.reasons).toContain('awaiting-inquiry-answer')
    expect(busy.reasons).not.toContain('running-segment')
  })

  it('lets a waiting requester run other runnable segments', () => {
    const { scheduler } = makeScheduler()
    scheduler.openWork('A', 'D1')
    const own = scheduler.dispatch('A', [claim('delivery', 'd-msg', 'D1')])
    scheduler.acceptInquiry(inquiry('i1', 'A', 'B', 'D1'))
    if (own.dispatched) scheduler.completeSegment(own.segment.segmentId)

    // Local work while waiting.
    const local = scheduler.dispatch('A', [claim('local', 'gui')])
    expect(local).toMatchObject({ dispatched: true, segment: { origin: 'local' } })
    if (local.dispatched) scheduler.completeSegment(local.segment.segmentId)

    // An inbound inquiry from a third party while waiting.
    scheduler.acceptInquiry(inquiry('i2', 'C', 'A'))
    expect(scheduler.dispatch('A', [claim('inquiry', 'inq', 'i2')])).toMatchObject({
      dispatched: true,
      segment: { origin: 'inquiry' },
    })
    expect(scheduler.hasWorkInFlight('A')).toBe(true)
  })

  it('lets two roots that wait on each other both keep making progress', () => {
    const { scheduler } = makeScheduler()
    scheduler.openWork('A', 'DA')
    scheduler.openWork('B', 'DB')
    const startA = scheduler.dispatch('A', [claim('delivery', 'da', 'DA')])
    const startB = scheduler.dispatch('B', [claim('delivery', 'db', 'DB')])
    scheduler.acceptInquiry(inquiry('a2b', 'A', 'B', 'DA'))
    scheduler.acceptInquiry(inquiry('b2a', 'B', 'A', 'DB'))
    if (startA.dispatched) scheduler.completeSegment(startA.segment.segmentId)
    if (startB.dispatched) scheduler.completeSegment(startB.segment.segmentId)

    // Both roots still have in-flight work and both run slots are free: no deadlock.
    expect([scheduler.hasWorkInFlight('A'), scheduler.hasWorkInFlight('B')]).toEqual([true, true])
    expect([scheduler.occupiesRunSlot('A'), scheduler.occupiesRunSlot('B')]).toEqual([false, false])

    // Drive the whole mutual exchange to completion with a bounded scheduler loop.
    let steps = 0
    while (steps < 32) {
      let progressed = false
      for (const session of ['A', 'B'] as const) {
        if (scheduler.occupiesRunSlot(session)) continue
        const next = scheduler.runnableNext(session)
        if (!next) continue
        const origin = next.kind === 'inquiry' ? 'inquiry' : 'inquiry-result'
        const dispatched = scheduler.dispatch(session, [claim(origin, `m-${steps}`, next.inquiryId)])
        expect(dispatched).toMatchObject({ dispatched: true })
        if (!dispatched.dispatched) break
        if (next.kind === 'inquiry') {
          expect(scheduler.deliverAnswer({ inquiryId: next.inquiryId })).toMatchObject({ accepted: true })
        } else {
          scheduler.settleWork(next.inquiryId === 'a2b' ? 'DA' : 'DB')
        }
        scheduler.completeSegment(dispatched.segment.segmentId)
        progressed = true
      }
      steps += 1
      if (!progressed) break
    }

    expect(scheduler.pendingInquiries('A')).toEqual([])
    expect(scheduler.pendingInquiries('B')).toEqual([])
    expect(scheduler.pendingResults('A')).toEqual([])
    expect(scheduler.pendingResults('B')).toEqual([])
    expect(scheduler.hasWorkInFlight('A')).toBe(false)
    expect(scheduler.hasWorkInFlight('B')).toBe(false)
  })
})

describe('InquiryScheduler answer delivery', () => {
  it('queues an answer while the requester is busy and never interrupts its segment', () => {
    const { scheduler } = makeScheduler()
    scheduler.acceptInquiry(inquiry('i1', 'A', 'B'))
    const inquiryTurn = scheduler.dispatch('B', [claim('inquiry', 'inq', 'i1')])
    if (inquiryTurn.dispatched) scheduler.completeSegment(inquiryTurn.segment.segmentId)

    const busySegment = scheduler.dispatch('A', [claim('local', 'gui')])
    const segmentId = busySegment.dispatched ? busySegment.segment.segmentId : ''
    const answer = scheduler.deliverAnswer({ inquiryId: 'i1' })
    expect(answer).toMatchObject({ accepted: true, inquiryId: 'i1', queuedBecause: 'requester-busy' })
    expect(scheduler.runningSegment('A')?.segmentId).toBe(segmentId)
    expect(scheduler.runningSegment('A')?.origin).toBe('local')
    expect(scheduler.runningSegment('A')?.claimedMessageIds).toEqual(['gui'])
    expect(scheduler.pendingResults('A').map(entry => entry.inquiryId)).toEqual(['i1'])

    scheduler.completeSegment(segmentId)
    expect(scheduler.runnableNext('A')).toMatchObject({ kind: 'inquiry-result', inquiryId: 'i1' })
  })

  it('queues an answer for an idle requester too, as a segment rather than a wake-up', () => {
    const { scheduler } = makeScheduler()
    scheduler.acceptInquiry(inquiry('i1', 'A', 'B'))
    scheduler.dispatch('B', [claim('inquiry', 'inq', 'i1')])
    expect(scheduler.deliverAnswer({ inquiryId: 'i1' })).toMatchObject({
      accepted: true,
      queuedBecause: 'requester-idle',
    })
    expect(scheduler.occupiesRunSlot('A')).toBe(false)
    expect(scheduler.pendingResults('A').map(entry => entry.inquiryId)).toEqual(['i1'])
  })

  it('rejects an unknown, duplicate or never-dispatched answer', () => {
    const { scheduler } = makeScheduler()
    expect(scheduler.deliverAnswer({ inquiryId: 'nope' })).toMatchObject({ reason: 'unknown-inquiry' })
    scheduler.acceptInquiry(inquiry('i1', 'A', 'B'))
    expect(scheduler.deliverAnswer({ inquiryId: 'i1' })).toMatchObject({ reason: 'inquiry-not-dispatched' })
    scheduler.dispatch('B', [claim('inquiry', 'inq', 'i1')])
    expect(scheduler.deliverAnswer({ inquiryId: 'i1' })).toMatchObject({ accepted: true })
    expect(scheduler.deliverAnswer({ inquiryId: 'i1' })).toMatchObject({ reason: 'duplicate-answer' })
    expect(scheduler.pendingResults('A')).toHaveLength(1)
  })

  it('bounds the result queue deterministically', () => {
    const { scheduler } = makeScheduler({ maxQueuedResults: 1 })
    for (const id of ['i1', 'i2']) {
      scheduler.acceptInquiry(inquiry(id, 'A', 'B'))
      const dispatched = scheduler.dispatch('B', [claim('inquiry', `m-${id}`, id)])
      if (dispatched.dispatched) scheduler.completeSegment(dispatched.segment.segmentId)
    }
    expect(scheduler.deliverAnswer({ inquiryId: 'i1' })).toMatchObject({ accepted: true })
    expect(scheduler.deliverAnswer({ inquiryId: 'i2' })).toEqual({
      accepted: false,
      inquiryId: 'i2',
      reason: 'queue-overflow',
      limit: 1,
    })
    expect(scheduler.pendingResults('A').map(entry => entry.inquiryId)).toEqual(['i1'])
  })
})
