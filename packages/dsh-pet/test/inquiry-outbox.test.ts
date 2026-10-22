/**
 * Inquiry RESULT OUTBOX value model.
 *
 * These are the pure tests: no storage, no clock, no Agent. They prove the
 * record shape, its bounded fields and its one-way status transitions.
 */
import { describe, expect, it } from 'vitest'
import {
  INQUIRY_OUTBOX_LIMITS, INQUIRY_OUTBOX_STATUSES, INQUIRY_RESULT_FAILURES,
  InquiryOutboxError,
  createInquiryResult,
  inquiryResultDedupKey, markInquiryResultDelivered, noteInquiryOutboxDiagnostic,
  parseInquiryOutboxRecord, refuseInquiryResult, retainInquiryResult,
} from '../src/host/inquiry/outbox.js'

const childA = { kind: 'child', sessionId: 'session-a', locusId: 'locus-a', generation: 2 } as const
const childB = { kind: 'child', sessionId: 'session-b', locusId: 'locus-b', generation: 1 } as const
const t0 = 1_800_000_000_000
const delivery = { kind: 'feishu-delivery', deliveryId: 'delivery-1' } as const

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
