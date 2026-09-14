/**
 * Inquiry RESULT OUTBOX value model and requester CONTINUATION re-verification.
 *
 * These are the pure tests: no storage, no clock, no Agent. They prove the
 * three things design D7 insists on keeping apart — an execution segment
 * ending, a request still holding an unresolved association, and an outbound
 * body actually being sent — plus the re-verification fence that decides
 * whether a queued result may resume the ORIGINAL work at all.
 *
 * The scheduler appears here as a real collaborator (not a fake) wherever the
 * claim is about queueing behaviour: an answer reaching a busy requester must
 * queue rather than interrupt, and a local/GUI origin must never acquire a
 * Feishu reply target on the way.
 */
import { describe, expect, it } from 'vitest'
import {
  applyInquiryEvent, createInquiry, inquiryMemberKey,
} from '../src/host/inquiry/ledger.js'
import { InquiryScheduler } from '../src/host/inquiry/scheduler.js'
import {
  INQUIRY_OUTBOX_LIMITS, INQUIRY_OUTBOX_STATUSES, INQUIRY_RESULT_FAILURES,
  InquiryOutboxError,
  continuationDisposition, createInquiryResult, describeRequestProgress,
  inquiryResultDedupKey, markInquiryResultDelivered, noteInquiryOutboxDiagnostic,
  parseInquiryOutboxRecord, refuseInquiryResult, retainInquiryResult,
  verifyInquiryContinuation,
} from '../src/host/inquiry/outbox.js'

const circle = 'session-main'
const main = { kind: 'main', sessionId: circle } as const
const childA = { kind: 'child', sessionId: 'session-a', locusId: 'locus-a', generation: 2 } as const
const childB = { kind: 'child', sessionId: 'session-b', locusId: 'locus-b', generation: 1 } as const
const t0 = 1_800_000_000_000
const delivery = { kind: 'feishu-delivery', deliveryId: 'delivery-1' } as const
const chat = { kind: 'feishu-chat', chatId: 'oc-example' } as const
const localOrigin = { kind: 'local' } as const
const localAudience = { kind: 'local-session', sessionId: 'session-a' } as const

/** One real queued inquiry, built through the pure ledger model. */
function queued(over: Record<string, unknown> = {}) {
  return createInquiry(
    {
      target: childB,
      question: 'Which response shape did you settle on for the status endpoint?',
      purpose: 'Answer a Feishu request about the API contract',
      declaredOrigin: null,
    },
    {
      inquiryId: 'inquiry-1', requester: childA, circleParentSessionId: circle,
      origin: delivery, audience: chat, createdAt: t0,
      parent: null, rootInquiryCount: 0, pendingCount: 0, ...over,
    },
  )
}

function answeredInquiry(over: Record<string, unknown> = {}) {
  const dispatched = applyInquiryEvent(queued(over), {
    type: 'dispatch', eventId: 'ev-dispatch', at: t0 + 1_000, reason: null,
  })
  return applyInquiryEvent(dispatched, {
    type: 'answer', eventId: 'ev-answer', at: t0 + 2_000, reason: null,
  })
}

const answerResult = { kind: 'answer', answeredAt: t0 + 2_000 } as const
const failureResult = (failure: string, at = t0 + 2_000) =>
  ({ kind: 'failure', failure, reason: 'target-unavailable', failedAt: at }) as const

const facts = (over: Record<string, unknown> = {}) => ({
  inquiryId: 'inquiry-1',
  requester: childA,
  resumeWork: delivery,
  result: answerResult,
  createdAt: t0 + 2_000,
  ...over,
})

const evidence = (over: Record<string, unknown> = {}) => ({
  now: t0 + 3_000,
  inquiry: answeredInquiry(),
  currentRequester: childA,
  work: { ref: 'delivery-1', settled: false },
  permitted: true,
  ...over,
})

describe('inquiry result outbox record', () => {
  it('carries the requester, the work to resume, a dedup key and a delivery status — and no answerer at all', () => {
    const record = createInquiryResult(facts())
    expect(record).toEqual({
      inquiryId: 'inquiry-1',
      requester: childA,
      resumeWork: delivery,
      result: answerResult,
      dedupKey: inquiryResultDedupKey('inquiry-1', answerResult),
      status: 'pending',
      createdAt: t0 + 2_000,
      statusAt: t0 + 2_000,
      deliveredSegmentId: null,
      appliedEventIds: [],
      diagnostics: [],
      droppedDiagnostics: 0,
    })
    expect(Object.isFrozen(record)).toBe(true)
    // The answerer is structurally absent: there is no field a caller could
    // use to create or consume a Feishu delivery for the responder.
    for (const forbidden of [
      'answeredBy', 'answerer', 'answer', 'chatId', 'messageId', 'feedbackTarget', 'text',
    ]) expect(Object.keys(record)).not.toContain(forbidden)
    expect(INQUIRY_OUTBOX_STATUSES).toEqual(['pending', 'delivered', 'refused', 'retained'])
  })

  it('refuses an unknown key, a foreign shape and any out-of-bounds field rather than dropping it', () => {
    for (const bad of [
      null, [], 'x', {},
      { ...facts(), answeredBy: childB },
      { ...facts(), requester: { kind: 'child', sessionId: 'session-a', locusId: 'locus-a' } },
      { ...facts(), resumeWork: { kind: 'feishu-delivery' } },
      { ...facts(), result: { kind: 'answer' } },
      { ...facts(), result: { kind: 'failure', failure: 'nope', reason: 'r', failedAt: t0 } },
      { ...facts(), result: { kind: 'failure', failure: 'rejected', reason: 'Not a code.', failedAt: t0 } },
      { ...facts(), createdAt: -1 },
      { ...facts(), inquiryId: ' padded ' },
    ]) expect(() => createInquiryResult(bad)).toThrow(InquiryOutboxError)
    // A getter on a caller-owned object is never invoked.
    let reads = 0
    const trap = Object.defineProperty({ ...facts() }, 'requester', { get() { reads += 1; return childA }, enumerable: true })
    expect(() => createInquiryResult(trap)).toThrow(InquiryOutboxError)
    expect(reads).toBe(0)
  })

  it.each(INQUIRY_RESULT_FAILURES)('records a %s failure result exactly like an answer result', failure => {
    const record = createInquiryResult(facts({ result: failureResult(failure) }))
    expect(record.status).toBe('pending')
    expect(record.result).toEqual(failureResult(failure))
    expect(record.dedupKey).toBe(inquiryResultDedupKey('inquiry-1', failureResult(failure)))
    // A failure is a deliverable result, not a silent drop: it queues the same way.
    expect(record.dedupKey).not.toBe(createInquiryResult(facts()).dedupKey)
  })

  it('round-trips every record through the pure parser and rejects drifted rows', () => {
    const record = createInquiryResult(facts())
    expect(parseInquiryOutboxRecord({ ...record })).toEqual(record)
    for (const corrupt of [
      { ...record, status: 'sent' },
      { ...record, statusAt: record.createdAt - 1 },
      { ...record, deliveredSegmentId: 'seg-1' },
      { ...record, dedupKey: 'forged' },
      { ...record, appliedEventIds: ['dup', 'dup'] },
      { ...record, key: record.dedupKey, dedupKey: undefined },
    ]) expect(() => parseInquiryOutboxRecord(corrupt)).toThrow(InquiryOutboxError)
  })
})

describe('outbox transitions', () => {
  it('delivers exactly once: a redelivered result never starts a second continuation', () => {
    const pending = createInquiryResult(facts())
    const delivered = markInquiryResultDelivered(pending, { eventId: 'ev-1', at: t0 + 3_000, segmentId: 'seg-7' })
    expect(delivered).toMatchObject({ status: 'delivered', statusAt: t0 + 3_000, deliveredSegmentId: 'seg-7' })
    expect(delivered.appliedEventIds).toEqual(['ev-1'])
    // Same event redelivered: an equal record, nothing advanced.
    expect(markInquiryResultDelivered(delivered, { eventId: 'ev-1', at: t0 + 3_000, segmentId: 'seg-7' })).toEqual(delivered)
    // A DIFFERENT segment claiming the same result must not rebind it.
    expect(markInquiryResultDelivered(delivered, { eventId: 'ev-2', at: t0 + 9_000, segmentId: 'seg-8' })).toEqual(delivered)
    expect(delivered.deliveredSegmentId).toBe('seg-7')
  })

  it('refuses and retains from pending only, and never leaves a terminal outbox status', () => {
    const pending = createInquiryResult(facts())
    const refused = refuseInquiryResult(pending, { eventId: 'ev-r', at: t0 + 3_000, code: 'requester-rebuilt' })
    expect(refused).toMatchObject({ status: 'refused', statusAt: t0 + 3_000, deliveredSegmentId: null })
    expect(refused.diagnostics).toEqual([{ code: 'requester-rebuilt', at: t0 + 3_000, eventId: 'ev-r' }])
    const retained = retainInquiryResult(pending, { eventId: 'ev-t', at: t0 + 3_000, code: 'work-settled' })
    expect(retained).toMatchObject({ status: 'retained', deliveredSegmentId: null })
    for (const terminal of [refused, retained]) {
      expect(() => markInquiryResultDelivered(terminal, { eventId: 'ev-x', at: t0 + 4_000, segmentId: 'seg-1' }))
        .toThrow(InquiryOutboxError)
    }
    // Re-applying the same terminal event is idempotent, not an error.
    expect(refuseInquiryResult(refused, { eventId: 'ev-r', at: t0 + 3_000, code: 'requester-rebuilt' })).toEqual(refused)
    expect(() => refuseInquiryResult(retained, { eventId: 'ev-q', at: t0 + 4_000, code: 'work-settled' }))
      .toThrow(InquiryOutboxError)
  })

  it('keeps a late or duplicate result as a bounded diagnostic without changing the status', () => {
    const retained = retainInquiryResult(createInquiryResult(facts()), {
      eventId: 'ev-t', at: t0 + 3_000, code: 'work-settled',
    })
    const late = { code: 'late-result' as const, at: t0 + 4_000, eventId: 'ev-late' }
    const noted = noteInquiryOutboxDiagnostic(retained, late)
    expect(noted).toMatchObject({ status: 'retained', statusAt: retained.statusAt, deliveredSegmentId: null })
    expect(noted.diagnostics.at(-1)).toEqual(late)
    // A redelivered diagnostic is retained once.
    expect(noteInquiryOutboxDiagnostic(noted, { ...late })).toEqual(noted)
    let flooded = noted
    for (let n = 0; n < INQUIRY_OUTBOX_LIMITS.diagnostics + 4; n += 1) {
      flooded = noteInquiryOutboxDiagnostic(flooded, { code: 'late-result', at: t0 + 5_000 + n, eventId: `flood-${n}` })
    }
    expect(flooded.diagnostics).toHaveLength(INQUIRY_OUTBOX_LIMITS.diagnostics)
    expect(flooded.droppedDiagnostics).toBeGreaterThan(0)
    // The earliest evidence survives the flood.
    expect(flooded.diagnostics[0]).toEqual({ code: 'work-settled', at: t0 + 3_000, eventId: 'ev-t' })
  })
})

describe('continuation re-verification (design D7)', () => {
  it('admits a result whose delivery, requester, inquiry, deadline and permission all still hold', () => {
    const verdict = verifyInquiryContinuation(createInquiryResult(facts()), evidence())
    expect(verdict).toEqual({ ok: true, resume: delivery })
    expect(continuationDisposition(verdict)).toBe('deliver')
  })

  it('refuses when the requester was rebuilt to a NEW GENERATION between accept and result', () => {
    const rebuilt = { ...childA, generation: childA.generation + 1 }
    expect(inquiryMemberKey(rebuilt)).not.toBe(inquiryMemberKey(childA))
    const verdict = verifyInquiryContinuation(createInquiryResult(facts()), evidence({ currentRequester: rebuilt }))
    expect(verdict).toEqual({ ok: false, code: 'requester-rebuilt' })
    expect(continuationDisposition(verdict)).toBe('refuse')
    // The refusal does NOT expose the successor: the resume work is unchanged
    // and no new-generation work is proposed anywhere in the verdict.
    expect(JSON.stringify(verdict)).not.toContain('locus-a')
    // A member that is simply gone is the same fail-closed family.
    expect(verifyInquiryContinuation(createInquiryResult(facts()), evidence({ currentRequester: null })))
      .toEqual({ ok: false, code: 'requester-absent' })
  })

  it('refuses an already-settled original Delivery and never rebinds to the most recent one', () => {
    const record = createInquiryResult(facts())
    const settled = verifyInquiryContinuation(record, evidence({ work: { ref: 'delivery-1', settled: true } }))
    expect(settled).toEqual({ ok: false, code: 'work-settled' })
    // A settled original request is diagnostics-only, never a fresh delivery.
    expect(continuationDisposition(settled)).toBe('retain')
    // A DIFFERENT (more recent) delivery id is a mismatch, not a substitute.
    expect(verifyInquiryContinuation(record, evidence({ work: { ref: 'delivery-9', settled: false } })))
      .toEqual({ ok: false, code: 'work-mismatch' })
    // An unprovable anchor stays closed rather than defaulting to the latest.
    expect(verifyInquiryContinuation(record, evidence({ work: null })))
      .toEqual({ ok: false, code: 'work-unknown' })
  })

  it('refuses an expired answer, read from the inquiry deadline rather than recomputed', () => {
    const record = createInquiryResult(facts())
    const inquiry = answeredInquiry()
    expect(verifyInquiryContinuation(record, evidence({ now: inquiry.deadlineAt })))
      .toEqual({ ok: false, code: 'answer-expired' })
    expect(verifyInquiryContinuation(record, evidence({ now: inquiry.deadlineAt - 1 })))
      .toMatchObject({ ok: true })
  })

  it('still delivers the EXPIRED failure result past the deadline, so the work is not stranded', () => {
    const expiredLedger = applyInquiryEvent(
      applyInquiryEvent(queued(), { type: 'dispatch', eventId: 'd', at: t0 + 1_000, reason: null }),
      { type: 'expire', eventId: 'f', at: t0 + 300_000, reason: 'deadline-reached' },
    )
    const record = createInquiryResult(facts({
      result: failureResult('expired', t0 + 300_000), createdAt: t0 + 300_000,
    }))
    // The deadline check bounds an ANSWER; the timeout FAILURE is exactly the
    // correlatable result the requester is promised, so it still lands.
    expect(verifyInquiryContinuation(record, evidence({ inquiry: expiredLedger, now: t0 + 300_001 })))
      .toEqual({ ok: true, resume: delivery })
    // An ANSWER at the same moment is refused.
    expect(verifyInquiryContinuation(createInquiryResult(facts()), evidence({ now: t0 + 300_001 })))
      .toEqual({ ok: false, code: 'answer-expired' })
  })

  it('refuses a mismatched inquiry, a mismatched result kind and a revoked permission', () => {
    const record = createInquiryResult(facts())
    expect(verifyInquiryContinuation(record, evidence({ inquiry: answeredInquiry({ inquiryId: 'inquiry-9' }) })))
      .toEqual({ ok: false, code: 'inquiry-mismatch' })
    expect(verifyInquiryContinuation(record, evidence({ inquiry: answeredInquiry({ requester: main }) })))
      .toEqual({ ok: false, code: 'inquiry-mismatch' })
    // An ANSWER result whose ledger row never reached `answered`.
    expect(verifyInquiryContinuation(record, evidence({
      inquiry: applyInquiryEvent(queued(), { type: 'dispatch', eventId: 'd', at: t0 + 1_000, reason: null }),
    }))).toEqual({ ok: false, code: 'inquiry-mismatch' })
    expect(verifyInquiryContinuation(record, evidence({ permitted: false })))
      .toEqual({ ok: false, code: 'permission-revoked' })
    // A record that already left `pending` can never be verified into a
    // second continuation, whatever the evidence says.
    const delivered = markInquiryResultDelivered(record, { eventId: 'ev', at: t0 + 3_000, segmentId: 'seg-1' })
    expect(verifyInquiryContinuation(delivered, evidence())).toEqual({ ok: false, code: 'result-not-pending' })
  })

  it.each(['rejected', 'unavailable', 'expired'] as const)('verifies a %s failure result against its own ledger status', failure => {
    // The ledger EVENT name differs from the resulting status for `rejected`.
    const eventType = { rejected: 'reject', unavailable: 'unavailable', expired: 'expire' }[failure]
    const failedLedger = applyInquiryEvent(
      applyInquiryEvent(queued(), { type: 'dispatch', eventId: 'd', at: t0 + 1_000, reason: null }),
      { type: eventType, eventId: 'f', at: t0 + (failure === 'expired' ? 300_000 : 2_000), reason: 'host-observed-fact' },
    )
    const record = createInquiryResult(facts({ result: failureResult(failure) }))
    const verdict = verifyInquiryContinuation(record, evidence({ inquiry: failedLedger, now: t0 + 2_500 }))
    expect(verdict).toEqual({ ok: true, resume: delivery })
    // The failure result of a DIFFERENT failure is not interchangeable.
    expect(verifyInquiryContinuation(
      createInquiryResult(facts({ result: failureResult(failure === 'rejected' ? 'cancelled' : 'rejected') })),
      evidence({ inquiry: failedLedger, now: t0 + 2_500 }),
    )).toEqual({ ok: false, code: 'inquiry-mismatch' })
  })

  it('resumes local/GUI work with a null anchor and never yields a Feishu target', () => {
    const localInquiry = applyInquiryEvent(
      applyInquiryEvent(
        queued({ origin: localOrigin, audience: localAudience }),
        { type: 'dispatch', eventId: 'd', at: t0 + 1_000, reason: null },
      ),
      { type: 'answer', eventId: 'a', at: t0 + 2_000, reason: null },
    )
    const record = createInquiryResult(facts({ resumeWork: localOrigin }))
    const verdict = verifyInquiryContinuation(record, evidence({
      inquiry: localInquiry, work: { ref: null, settled: false },
    }))
    expect(verdict).toEqual({ ok: true, resume: { kind: 'local' } })
    expect(JSON.stringify(verdict)).not.toContain('delivery')
    expect(JSON.stringify(record)).not.toContain('oc-example')
    // A local record cannot be verified against a Feishu anchor.
    expect(verifyInquiryContinuation(record, evidence({ inquiry: localInquiry })))
      .toEqual({ ok: false, code: 'work-mismatch' })
  })

  it('resumes a parent inquiry for a nested chain without minting a new root', () => {
    const parent = answeredInquiry()
    const nested = applyInquiryEvent(
      applyInquiryEvent(
        createInquiry(
          { target: main, question: 'Does the parent own this decision?', purpose: 'Continue a nested chain', declaredOrigin: null },
          {
            inquiryId: 'inquiry-2', requester: childB, circleParentSessionId: circle,
            origin: { kind: 'inquiry', parentInquiryId: 'inquiry-1' }, audience: chat,
            createdAt: t0 + 2_500, parent, rootInquiryCount: 1, pendingCount: 0,
          },
        ),
        { type: 'dispatch', eventId: 'd2', at: t0 + 3_000, reason: null },
      ),
      { type: 'answer', eventId: 'a2', at: t0 + 3_500, reason: null },
    )
    const record = createInquiryResult(facts({
      inquiryId: 'inquiry-2', requester: childB,
      resumeWork: { kind: 'inquiry', parentInquiryId: 'inquiry-1' },
      result: { kind: 'answer', answeredAt: t0 + 3_500 }, createdAt: t0 + 3_500,
    }))
    expect(verifyInquiryContinuation(record, {
      now: t0 + 4_000, inquiry: nested, currentRequester: childB,
      work: { ref: 'inquiry-1', settled: false }, permitted: true,
    })).toEqual({ ok: true, resume: { kind: 'inquiry', parentInquiryId: 'inquiry-1' } })
  })
})

describe('three separated facts: segment end, unresolved association, outbound send (design D7)', () => {
  it('never shows a first segment that ended with a pending inquiry as completed', () => {
    const view = describeRequestProgress({
      segmentEnded: true, pendingInquiries: 1, pendingResults: 0, outbound: 'none',
    })
    expect(view).toEqual({
      segmentEnded: true, unresolvedAssociation: true, outbound: 'none',
      display: 'in-progress', completed: false,
    })
    // A queued RESULT is just as unresolved as a queued inquiry.
    expect(describeRequestProgress({ segmentEnded: true, pendingInquiries: 0, pendingResults: 1, outbound: 'none' }))
      .toMatchObject({ display: 'in-progress', completed: false })
    // Even an already-sent interim body does not close the request.
    expect(describeRequestProgress({ segmentEnded: true, pendingInquiries: 1, pendingResults: 0, outbound: 'sent' }))
      .toMatchObject({ display: 'in-progress', completed: false })
  })

  it.each([
    ['sent', 'completed', true],
    ['none', 'unanswered', false],
    ['failed', 'failed', false],
    ['unknown', 'needs-review', false],
  ] as const)('maps a settled segment with no association and %s outbound to %s', (outbound, display, completed) => {
    expect(describeRequestProgress({ segmentEnded: true, pendingInquiries: 0, pendingResults: 0, outbound }))
      .toEqual({ segmentEnded: true, unresolvedAssociation: false, outbound, display, completed })
  })

  it('reports a running segment as in-progress regardless of what was already sent', () => {
    for (const outbound of ['sent', 'none', 'failed', 'unknown'] as const) {
      expect(describeRequestProgress({ segmentEnded: false, pendingInquiries: 0, pendingResults: 0, outbound }))
        .toMatchObject({ display: 'in-progress', completed: false })
    }
  })

  it('rejects malformed progress input instead of guessing a display', () => {
    for (const bad of [
      null, {}, { segmentEnded: true, pendingInquiries: 0, pendingResults: 0 },
      { segmentEnded: true, pendingInquiries: -1, pendingResults: 0, outbound: 'sent' },
      { segmentEnded: true, pendingInquiries: 0, pendingResults: 0, outbound: 'delivered' },
      { segmentEnded: 'yes', pendingInquiries: 0, pendingResults: 0, outbound: 'sent' },
    ]) expect(() => describeRequestProgress(bad)).toThrow(InquiryOutboxError)
  })
})

describe('delivery to the requester never interrupts and never touches the answerer channel', () => {
  const clock = { now: () => t0 + 3_000 }

  function scheduler() {
    const s = new InquiryScheduler({ clock, isolatedQueuedTurnClaim: { available: true } })
    s.openWork('session-a', 'delivery-1')
    s.acceptInquiry({
      inquiryId: 'inquiry-1', requesterSessionId: 'session-a',
      targetSessionId: 'session-b', requesterWorkId: 'delivery-1',
    })
    s.dispatch('session-b', [{ messageId: 'm-1', origin: 'inquiry', ref: 'inquiry-1' }])
    return s
  }

  it('queues the result for an IDLE requester as a future segment, not an immediate run', () => {
    const s = scheduler()
    const outcome = s.deliverAnswer({ inquiryId: 'inquiry-1' })
    expect(outcome).toMatchObject({ accepted: true, queuedBecause: 'requester-idle' })
    expect(s.occupiesRunSlot('session-a')).toBe(false)
    expect(s.runnableNext('session-a')).toMatchObject({ kind: 'inquiry-result', inquiryId: 'inquiry-1' })
    const record = createInquiryResult(facts())
    expect(record.status).toBe('pending')
    // The answerer's own segment is untouched by delivering the result.
    expect(s.runningSegment('session-b')).toMatchObject({ origin: 'inquiry', ref: 'inquiry-1' })
  })

  it('queues the result for a BUSY requester without steering its live segment', () => {
    const s = scheduler()
    s.dispatch('session-a', [{ messageId: 'm-2', origin: 'delivery', ref: 'delivery-1' }])
    const live = s.runningSegment('session-a')
    expect(live).toMatchObject({ origin: 'delivery', ref: 'delivery-1' })
    expect(s.deliverAnswer({ inquiryId: 'inquiry-1' })).toMatchObject({
      accepted: true, queuedBecause: 'requester-busy',
    })
    // Same segment, same claimed messages: nothing was merged in.
    expect(s.runningSegment('session-a')).toEqual(live)
    expect(s.runnableNext('session-a')).toBeUndefined()
    expect(s.busyForLocking('session-a').reasons).toContain('pending-inquiry-result')
  })

  it('delivers a duplicate result exactly once even when the scheduler is asked twice', () => {
    const s = scheduler()
    expect(s.deliverAnswer({ inquiryId: 'inquiry-1' })).toMatchObject({ accepted: true })
    expect(s.deliverAnswer({ inquiryId: 'inquiry-1' })).toMatchObject({ accepted: false, reason: 'duplicate-answer' })
    expect(s.pendingResults('session-a')).toHaveLength(1)
    const delivered = markInquiryResultDelivered(createInquiryResult(facts()), {
      eventId: 'ev-1', at: t0 + 3_000, segmentId: 'seg-1',
    })
    expect(markInquiryResultDelivered(delivered, { eventId: 'ev-2', at: t0 + 4_000, segmentId: 'seg-2' }))
      .toEqual(delivered)
  })

  it('keeps a local/GUI requester entirely inside local work', () => {
    const s = new InquiryScheduler({ clock, isolatedQueuedTurnClaim: { available: true } })
    s.acceptInquiry({ inquiryId: 'inquiry-1', requesterSessionId: circle, targetSessionId: 'session-b' })
    s.dispatch('session-b', [{ messageId: 'm-1', origin: 'inquiry', ref: 'inquiry-1' }])
    expect(s.deliverAnswer({ inquiryId: 'inquiry-1' })).toMatchObject({ accepted: true })
    const queuedResult = s.pendingResults(circle)[0]!
    // No work anchor at all: a local result carries no Feishu delivery id.
    expect(queuedResult.requesterWorkId).toBeUndefined()
    const record = createInquiryResult(facts({ requester: main, resumeWork: localOrigin }))
    expect(record.resumeWork).toEqual({ kind: 'local' })
    expect(JSON.stringify(record)).not.toContain('delivery')
  })
})
