/**
 * Inquiry-result CONTINUATION binding (design D7).
 *
 * The constraint this module exists to respect, verified directly against
 * `turn-observer.ts` before any of this was designed: `currentForChild()`
 * grants a reply target ONLY when a child has exactly one active turn that
 * claimed exactly one Feishu Delivery. A continuation turn does NOT claim the
 * original message — the first segment consumed it — so under those rules a
 * continuation segment correctly has NO reply authority, and that check is not
 * weakened here.
 *
 * So reply authority for a continuation segment cannot come from the turn
 * observer, and it must never come from a general agent/parent message being
 * "upgraded". It is derived instead from two Host-PROVEN facts re-verified at
 * the moment of use: the durable outbox record (which fixes the anchor at
 * accept time and can never be rebound) and the durable Delivery row that
 * anchor names. Model input contributes nothing.
 *
 * Time is deliberately absent. Under the approved no-deadline design elapsed
 * wall time never refuses an answer or a continuation; only proven facts do.
 */
import { describe, expect, it } from 'vitest'
import {
  applyInquiryEvent, createInquiry, isTerminalInquiryStatus,
} from '../src/host/inquiry/ledger.js'
import {
  INQUIRY_OUTBOX_DIAGNOSTIC_CODES,
  createInquiryResult, markInquiryResultDelivered, verifyInquiryContinuation,
} from '../src/host/inquiry/outbox.js'
import {
  CONTINUATION_OUTCOME_KINDS, CONTINUATION_REFUSAL_CODES,
  ContinuationError,
  describeContinuationProgress, openInquiryContinuation,
} from '../src/host/inquiry/continuation.js'

const circle = 'session-main'
const main = { kind: 'main', sessionId: circle } as const
const childA = { kind: 'child', sessionId: 'session-a', locusId: 'locus-a', generation: 2 } as const
const childB = { kind: 'child', sessionId: 'session-b', locusId: 'locus-b', generation: 1 } as const
const t0 = 1_800_000_000_000

const delivery = { kind: 'feishu-delivery', deliveryId: 'delivery-1' } as const
const localOrigin = { kind: 'local' } as const
const chat = { kind: 'feishu-chat', chatId: 'oc-project' } as const
const localAudience = { kind: 'local-session', sessionId: circle } as const

/** The durable Delivery row, in the exact shape the locus ledger stores. */
const anchor = (over: Record<string, unknown> = {}) => ({
  deliveryId: 'delivery-1',
  messageId: 'om-original',
  status: 'running',
  endpoint: { chatId: 'oc-project', threadId: 'omt-topic' },
  locusId: 'locus-a',
  generation: 2,
  childSessionId: 'session-a',
  sequence: 1,
  feedbackTarget: { chatId: 'oc-project', threadId: 'omt-topic', messageId: 'om-original' },
  ...over,
})

/** A SECOND, more recent Delivery for the same child. Never a valid rebind. */
const otherAnchor = () => anchor({
  deliveryId: 'delivery-2',
  messageId: 'om-newer',
  sequence: 2,
  feedbackTarget: { chatId: 'oc-project', threadId: 'omt-topic', messageId: 'om-newer' },
})

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

function cancelledInquiry(over: Record<string, unknown> = {}) {
  return applyInquiryEvent(answeredInquiry(over), {
    type: 'cancel', eventId: 'ev-cancel', at: t0 + 2_500, reason: 'requester-completed',
  })
}

const answerResult = { kind: 'answer', answeredAt: t0 + 2_000 } as const
const cancelledResult = { kind: 'failure', failure: 'cancelled', reason: 'requester-completed', failedAt: t0 + 2_500 } as const
const reviewResult = { kind: 'failure', failure: 'needs-review', reason: 'dispatch-outcome-unknown', failedAt: t0 + 2_500 } as const

const facts = (over: Record<string, unknown> = {}) => ({
  inquiryId: 'inquiry-1',
  requester: childA,
  resumeWork: delivery,
  result: answerResult,
  createdAt: t0 + 2_000,
  ...over,
})

const evidence = (over: Record<string, unknown> = {}) => ({
  inquiry: answeredInquiry(),
  currentRequester: childA,
  work: { ref: 'delivery-1', settled: false },
  permitted: true,
  ...over,
})

const event = (over: Record<string, unknown> = {}) => ({
  eventId: 'ev-continue-1', at: t0 + 3_000, segmentId: 'seg-continue-1', ...over,
})

/** The canonical happy-path call: an answer resuming its own Feishu delivery. */
const open = (over: Record<string, unknown> = {}) => openInquiryContinuation({
  record: createInquiryResult(facts()),
  evidence: evidence(),
  delivery: anchor(),
  event: event(),
  ...over,
})

describe('an answer resumes the ORIGINAL delivery and yields exactly that target', () => {
  it('opens one continuation segment whose reply target is the original delivery own', () => {
    const outcome = open()
    expect(outcome.kind).toBe('opened')
    if (outcome.kind !== 'opened') throw new Error('expected opened')

    expect(outcome.segment).toEqual({
      segmentId: 'seg-continue-1',
      sessionId: 'session-a',
      origin: 'inquiry-result',
      ref: 'inquiry-1',
      resume: { kind: 'feishu-delivery', deliveryId: 'delivery-1' },
      replyTarget: { chatId: 'oc-project', threadId: 'omt-topic', messageId: 'om-original' },
    })
    // The reply target is the ORIGINAL accepted message, not a newer one.
    expect(outcome.segment.replyTarget?.messageId).toBe('om-original')
    expect(Object.isFrozen(outcome.segment)).toBe(true)
  })

  it('records the delivery on the outbox row and binds it to that one segment', () => {
    const outcome = open()
    if (outcome.kind !== 'opened') throw new Error('expected opened')
    expect(outcome.record.status).toBe('delivered')
    expect(outcome.record.deliveredSegmentId).toBe('seg-continue-1')
    // The origin is a COPY of the accept-time anchor, so there is no field a
    // later caller could mutate to redirect the continuation.
    expect(outcome.record.resumeWork).toEqual({ kind: 'feishu-delivery', deliveryId: 'delivery-1' })
  })

  it('derives the segment from the proven anchor, never from the turn observer', () => {
    // The reply target survives even though NO active turn claimed the original
    // message: that is the whole point of a proven anchor. The segment is a new
    // execution segment, it does not re-claim the consumed inbox message.
    const outcome = open()
    if (outcome.kind !== 'opened') throw new Error('expected opened')
    expect(outcome.segment.origin).toBe('inquiry-result')
    expect(outcome.segment.ref).toBe('inquiry-1')
  })

  it('resumes after arbitrary elapsed time: wall clock is not evidence', () => {
    // No deadline exists in the approved design. A very late answer still
    // resumes, and there is no expiry refusal code to reach.
    const outcome = openInquiryContinuation({
      record: createInquiryResult(facts()),
      evidence: evidence(),
      delivery: anchor(),
      event: event({ at: t0 + 999_999_999 }),
    })
    expect(outcome.kind).toBe('opened')
    expect(CONTINUATION_REFUSAL_CODES).not.toContain('answer-expired')
    // The fence itself takes no clock at all.
    expect(String(openInquiryContinuation)).not.toContain('Date.now')
  })
})

describe('re-verification at use refuses rather than rebinding', () => {
  it('refuses when the original work is already settled, retaining inert evidence', () => {
    const outcome = open({ evidence: evidence({ work: { ref: 'delivery-1', settled: true } }) })
    expect(outcome).toMatchObject({ kind: 'retained', code: 'work-settled' })
    if (outcome.kind === 'opened') throw new Error('expected refusal')
    expect(outcome.record.status).toBe('retained')
    expect(outcome.record.deliveredSegmentId).toBeNull()
    expect(outcome).not.toHaveProperty('segment')
  })

  it('refuses a REBUILT requester and never redirects onto the successor generation', () => {
    const rebuilt = { kind: 'child', sessionId: 'session-a2', locusId: 'locus-a', generation: 3 } as const
    const outcome = open({ evidence: evidence({ currentRequester: rebuilt }) })
    expect(outcome).toMatchObject({ kind: 'refused', code: 'requester-rebuilt' })
    // The successor is never named back to the caller.
    expect(JSON.stringify(outcome)).not.toContain('session-a2')
    expect(JSON.stringify(outcome)).not.toContain('"generation":3')
  })

  it('refuses when no member is the current child of that locus any more', () => {
    expect(open({ evidence: evidence({ currentRequester: null }) }))
      .toMatchObject({ kind: 'refused', code: 'requester-absent' })
  })

  it('refuses when the ledger row is a different inquiry or a different requester', () => {
    expect(open({ evidence: evidence({ inquiry: answeredInquiry({ inquiryId: 'inquiry-9' }) }) }))
      .toMatchObject({ kind: 'refused', code: 'inquiry-mismatch' })
    // A row whose requester is some OTHER circle member is not close enough.
    const otherRequester = { kind: 'child', sessionId: 'session-c', locusId: 'locus-c', generation: 1 } as const
    expect(open({ evidence: evidence({ inquiry: answeredInquiry({ requester: otherRequester }) }) }))
      .toMatchObject({ kind: 'refused', code: 'inquiry-mismatch' })
  })

  it('refuses an answer result whose ledger row never actually reached answered', () => {
    expect(open({ evidence: evidence({ inquiry: queued() }) }))
      .toMatchObject({ kind: 'refused', code: 'inquiry-mismatch' })
  })

  it('refuses when permission no longer holds', () => {
    expect(open({ evidence: evidence({ permitted: false }) }))
      .toMatchObject({ kind: 'refused', code: 'permission-revoked' })
  })

  it('refuses an unprovable work anchor instead of defaulting to the latest', () => {
    expect(open({ evidence: evidence({ work: null }) }))
      .toMatchObject({ kind: 'refused', code: 'work-unknown' })
  })

  it('refuses a DIFFERENT proven anchor rather than rebinding to it', () => {
    expect(open({ evidence: evidence({ work: { ref: 'delivery-2', settled: false } }) }))
      .toMatchObject({ kind: 'refused', code: 'work-mismatch' })
  })
})

describe('a continuation segment never inherits another delivery target', () => {
  it('fails closed when the proven Delivery row is a different delivery', () => {
    const outcome = open({ delivery: otherAnchor() })
    expect(outcome).toMatchObject({ kind: 'refused', code: 'anchor-unproven' })
    if (outcome.kind === 'opened') throw new Error('expected refusal')
    // The foreign delivery and its message are never echoed back.
    expect(JSON.stringify(outcome)).not.toContain('delivery-2')
    expect(JSON.stringify(outcome)).not.toContain('om-newer')
  })

  it('fails closed when no Delivery row could be proven at all', () => {
    expect(open({ delivery: null })).toMatchObject({ kind: 'refused', code: 'anchor-unproven' })
  })

  it('fails closed when the Delivery belongs to another child, locus or generation', () => {
    for (const foreign of [
      anchor({ childSessionId: 'session-z' }),
      anchor({ locusId: 'locus-z' }),
      anchor({ generation: 3 }),
    ]) {
      const outcome = open({ delivery: foreign })
      expect(outcome).toMatchObject({ kind: 'refused', code: 'anchor-unproven' })
      expect(JSON.stringify(outcome)).not.toContain('locus-z')
      expect(JSON.stringify(outcome)).not.toContain('session-z')
    }
  })

  it('fails closed when the Delivery row contradicts the unsettled evidence', () => {
    // Evidence says the work is open, the durable row says it is terminal. A
    // contradiction is never resolved in favour of sending.
    for (const status of ['settled', 'failed'] as const) {
      expect(open({ delivery: anchor({ status }) }))
        .toMatchObject({ kind: 'refused', code: 'anchor-unproven' })
    }
  })

  it('fails closed when the feedback target does not derive from the row itself', () => {
    for (const forged of [
      anchor({ feedbackTarget: { chatId: 'oc-elsewhere', threadId: 'omt-topic', messageId: 'om-original' } }),
      anchor({ feedbackTarget: { chatId: 'oc-project', threadId: 'omt-other', messageId: 'om-original' } }),
      anchor({ feedbackTarget: { chatId: 'oc-project', threadId: 'omt-topic', messageId: 'om-someone-else' } }),
    ]) {
      const outcome = open({ delivery: forged })
      expect(outcome).toMatchObject({ kind: 'refused', code: 'anchor-unproven' })
      expect(JSON.stringify(outcome)).not.toContain('oc-elsewhere')
      expect(JSON.stringify(outcome)).not.toContain('om-someone-else')
    }
  })

  it('uses ONE uniform code for every anchor proof failure, so nothing can be probed', () => {
    const codes = new Set([
      open({ delivery: null }),
      open({ delivery: otherAnchor() }),
      open({ delivery: anchor({ generation: 3 }) }),
      open({ delivery: anchor({ status: 'settled' }) }),
    ].map(outcome => (outcome.kind === 'opened' ? 'opened' : outcome.code)))
    expect([...codes]).toEqual(['anchor-unproven'])
  })

  it('persists a non-leaking outbox diagnostic for an unproven anchor', () => {
    const outcome = open({ delivery: null })
    if (outcome.kind === 'opened') throw new Error('expected refusal')
    expect(outcome.record.diagnostics).toHaveLength(1)
    expect(INQUIRY_OUTBOX_DIAGNOSTIC_CODES).toContain(outcome.record.diagnostics[0]!.code)
    expect(outcome.record.diagnostics[0]!.code).toBe('work-unknown')
  })
})

describe('local / GUI origin resumes local work with NO Feishu authority', () => {
  const localFacts = () => facts({ requester: main, resumeWork: localOrigin, inquiryId: 'inquiry-2' })
  const localInquiry = () => {
    const dispatched = applyInquiryEvent(
      queued({ inquiryId: 'inquiry-2', requester: main, origin: localOrigin, audience: localAudience }),
      { type: 'dispatch', eventId: 'ev-d', at: t0 + 1_000, reason: null },
    )
    return applyInquiryEvent(dispatched, { type: 'answer', eventId: 'ev-a', at: t0 + 2_000, reason: null })
  }
  const localEvidence = (over: Record<string, unknown> = {}) => ({
    inquiry: localInquiry(), currentRequester: main,
    work: { ref: null, settled: false }, permitted: true, ...over,
  })

  it('opens a local continuation segment with a null reply target', () => {
    const outcome = openInquiryContinuation({
      record: createInquiryResult(localFacts()),
      evidence: localEvidence(),
      delivery: null,
      event: event(),
    })
    expect(outcome.kind).toBe('opened')
    if (outcome.kind !== 'opened') throw new Error('expected opened')
    expect(outcome.segment.replyTarget).toBeNull()
    expect(outcome.segment.resume).toEqual({ kind: 'local' })
    expect(outcome.segment.sessionId).toBe(circle)
    // No Feishu identifier exists anywhere in the local result.
    const serialized = JSON.stringify(outcome)
    for (const leak of ['delivery-1', 'oc-project', 'om-original', 'omt-topic', 'chatId', 'messageId']) {
      expect(serialized).not.toContain(leak)
    }
  })

  it('refuses when a Delivery row is offered for local work at all', () => {
    // Supplying Feishu proof for local work is a contradiction, not an upgrade.
    const outcome = openInquiryContinuation({
      record: createInquiryResult(localFacts()),
      evidence: localEvidence(),
      delivery: anchor(),
      event: event(),
    })
    expect(outcome).toMatchObject({ kind: 'refused', code: 'anchor-unproven' })
    expect(JSON.stringify(outcome)).not.toContain('delivery-1')
  })

  it('refuses a Feishu-anchored result whose requester is a main session', () => {
    // A main session owns no Delivery; it can never acquire reply authority.
    const outcome = openInquiryContinuation({
      record: createInquiryResult(facts({ requester: main })),
      evidence: evidence({ inquiry: answeredInquiry({ requester: main }), currentRequester: main }),
      delivery: anchor(),
      event: event(),
    })
    expect(outcome).toMatchObject({ kind: 'refused', code: 'anchor-unproven' })
  })
})

describe('idempotence: one delivered result opens exactly one segment', () => {
  it('reports already-open for a redelivered result and keeps the FIRST segment', () => {
    const first = open()
    if (first.kind !== 'opened') throw new Error('expected opened')

    const second = openInquiryContinuation({
      record: first.record,
      evidence: evidence(),
      delivery: anchor(),
      event: event({ eventId: 'ev-continue-2', at: t0 + 4_000, segmentId: 'seg-continue-2' }),
    })
    expect(second).toMatchObject({ kind: 'already-open', segmentId: 'seg-continue-1' })
    if (second.kind !== 'already-open') throw new Error('expected already-open')
    // The durable binding is untouched: no second segment, no rebind.
    expect(second.record).toEqual(first.record)
    expect(second.record.deliveredSegmentId).toBe('seg-continue-1')
    expect(second).not.toHaveProperty('segment')
  })

  it('stays already-open even when the redelivery carries a different anchor', () => {
    const first = open()
    if (first.kind !== 'opened') throw new Error('expected opened')
    const second = openInquiryContinuation({
      record: first.record,
      evidence: evidence(),
      delivery: otherAnchor(),
      event: event({ eventId: 'ev-x', at: t0 + 5_000, segmentId: 'seg-x' }),
    })
    expect(second).toMatchObject({ kind: 'already-open', segmentId: 'seg-continue-1' })
    expect(JSON.stringify(second)).not.toContain('seg-x')
  })

  it('refuses a result that was already refused or retained', () => {
    const retained = open({ evidence: evidence({ work: { ref: 'delivery-1', settled: true } }) })
    if (retained.kind === 'opened') throw new Error('expected retained')
    expect(openInquiryContinuation({
      record: retained.record, evidence: evidence(), delivery: anchor(),
      event: event({ eventId: 'ev-again', at: t0 + 6_000, segmentId: 'seg-again' }),
    })).toMatchObject({ kind: 'retained', code: 'result-not-pending' })
  })

  it('agrees with the outbox primitives it is built on', () => {
    const record = createInquiryResult(facts())
    expect(verifyInquiryContinuation(record, evidence())).toMatchObject({ ok: true })
    const delivered = markInquiryResultDelivered(record, event())
    expect(verifyInquiryContinuation(delivered, evidence())).toMatchObject({
      ok: false, code: 'result-not-pending',
    })
  })
})

describe('a cancelled branch is internal state only', () => {
  it('retains a cancelled result and opens NO segment and no reply authority', () => {
    const outcome = openInquiryContinuation({
      record: createInquiryResult(facts({ result: cancelledResult })),
      evidence: evidence({ inquiry: cancelledInquiry() }),
      delivery: anchor(),
      event: event(),
    })
    expect(outcome).toMatchObject({ kind: 'retained', code: 'branch-cancelled' })
    if (outcome.kind === 'opened') throw new Error('expected retained')
    expect(outcome).not.toHaveProperty('segment')
    expect(outcome.record.deliveredSegmentId).toBeNull()
    // Durable structured evidence only: no Feishu identifier is produced.
    expect(JSON.stringify(outcome)).not.toContain('oc-project')
    expect(JSON.stringify(outcome)).not.toContain('om-original')
    expect(outcome.record.diagnostics[0]!.code).toBe('late-result')
  })

  it('still delivers a needs-review failure, which the requester must handle', () => {
    const reviewed = applyInquiryEvent(answeredInquiry(), {
      type: 'needs-review', eventId: 'ev-nr', at: t0 + 2_500, reason: 'dispatch-outcome-unknown',
    })
    const outcome = openInquiryContinuation({
      record: createInquiryResult(facts({ result: reviewResult })),
      evidence: evidence({ inquiry: reviewed }),
      delivery: anchor(),
      event: event(),
    })
    expect(outcome.kind).toBe('opened')
  })
})

describe('the three D7 facts stay separate in progress reporting', () => {
  const progress = (over: Record<string, unknown> = {}) => describeContinuationProgress({
    segmentEnded: true, inquiries: [], results: [], outbound: 'sent', ...over,
  })

  it('does NOT read a first segment with a pending inquiry as completed', () => {
    const result = progress({ inquiries: [queued()], outbound: 'sent' })
    expect(result).toMatchObject({
      segmentEnded: true, unresolvedAssociation: true, display: 'in-progress', completed: false,
    })
  })

  it('treats an ANSWERED but undelivered inquiry as still unresolved', () => {
    expect(isTerminalInquiryStatus('answered')).toBe(false)
    expect(progress({ inquiries: [answeredInquiry()] }))
      .toMatchObject({ unresolvedAssociation: true, display: 'in-progress' })
  })

  it('treats a pending outbox result as still unresolved', () => {
    expect(progress({ results: [createInquiryResult(facts())] }))
      .toMatchObject({ unresolvedAssociation: true, display: 'in-progress' })
  })

  it('clears the association once the branch is terminal and the result delivered', () => {
    const opened = open()
    if (opened.kind !== 'opened') throw new Error('expected opened')
    const settledInquiry = applyInquiryEvent(answeredInquiry(), {
      type: 'deliver-result', eventId: 'ev-dr', at: t0 + 3_000, reason: null,
    })
    expect(progress({ inquiries: [settledInquiry], results: [opened.record] }))
      .toMatchObject({ unresolvedAssociation: false, display: 'completed', completed: true })
  })

  it.each([
    ['sent', 'completed', true],
    ['none', 'unanswered', false],
    ['failed', 'failed', false],
    ['unknown', 'needs-review', false],
  ] as const)('maps a settled, unassociated request with %s outbound to %s', (outbound, display, completed) => {
    expect(progress({ outbound })).toMatchObject({ outbound, display, completed })
  })

  it('reports a still-running segment as in-progress regardless of what was sent', () => {
    for (const outbound of ['sent', 'none', 'failed', 'unknown'] as const) {
      expect(progress({ segmentEnded: false, outbound }))
        .toMatchObject({ display: 'in-progress', completed: false })
    }
  })

  it('never derives completion from message text', () => {
    expect(String(describeContinuationProgress)).not.toMatch(/text|body|content/i)
  })
})

describe('fail-closed input handling', () => {
  it('refuses malformed top-level input rather than guessing a continuation', () => {
    for (const bad of [
      null, undefined, [], 'x', 42, {},
      { record: createInquiryResult(facts()), evidence: evidence(), delivery: anchor() },
      { record: createInquiryResult(facts()), evidence: evidence(), event: event() },
      { ...{ record: createInquiryResult(facts()), evidence: evidence(), delivery: anchor(), event: event() }, extra: 1 },
    ]) expect(() => openInquiryContinuation(bad)).toThrow(ContinuationError)
  })

  it('refuses a malformed delivery row instead of treating it as absent', () => {
    for (const bad of [
      'delivery-1', 42, [], anchor({ deliveryId: '' }), anchor({ generation: 0 }),
      anchor({ status: 'invented' }), anchor({ feedbackTarget: null }),
      anchor({ endpoint: null }),
    ]) {
      expect(() => openInquiryContinuation({
        record: createInquiryResult(facts()), evidence: evidence(),
        delivery: bad, event: event(),
      })).toThrow(ContinuationError)
    }
  })

  it('refuses a malformed segment event', () => {
    for (const bad of [null, {}, event({ segmentId: '' }), event({ at: -1 }), event({ eventId: ' x' })]) {
      expect(() => open({ event: bad })).toThrow(ContinuationError)
    }
  })

  it('refuses malformed progress input rather than displaying a guess', () => {
    for (const bad of [
      null, {}, { segmentEnded: true, inquiries: [], results: [] },
      { segmentEnded: true, inquiries: 'no', results: [], outbound: 'sent' },
      { segmentEnded: true, inquiries: [], results: [], outbound: 'delivered' },
      { segmentEnded: 'yes', inquiries: [], results: [], outbound: 'sent' },
    ]) expect(() => describeContinuationProgress(bad)).toThrow()
  })

  it('never mutates or freezes the caller objects it was handed', () => {
    const record = createInquiryResult(facts())
    const row = anchor()
    const evidenceIn = evidence()
    open({ record, delivery: row, evidence: evidenceIn })
    expect(Object.isFrozen(row)).toBe(false)
    expect(row.status).toBe('running')
    expect(record.status).toBe('pending')
    expect(evidenceIn.permitted).toBe(true)
  })

  it('exposes stable outcome kinds and refusal codes', () => {
    expect(CONTINUATION_OUTCOME_KINDS).toEqual(['opened', 'already-open', 'refused', 'retained'])
    for (const required of [
      'result-not-pending', 'inquiry-mismatch', 'requester-absent', 'requester-rebuilt',
      'work-unknown', 'work-mismatch', 'work-settled', 'permission-revoked',
      'anchor-unproven', 'branch-cancelled',
    ]) expect(CONTINUATION_REFUSAL_CODES).toContain(required)
  })
})
