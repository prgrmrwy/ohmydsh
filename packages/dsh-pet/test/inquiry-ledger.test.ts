import { describe, expect, it } from 'vitest'
import {
  INQUIRY_DIAGNOSTIC_KINDS,
  INQUIRY_LIMITS as limits,
  INQUIRY_STATUSES,
  InquiryLedgerError,
  applyInquiryEvent,
  createInquiry,
  inquiryMemberKey,
  inquiryRootHasCapacity,
  inquirySeatKey,
  inquirySessionHasCapacity,
  inquiryTargetIsUnvisited,
  isTerminalInquiryStatus,
  parseInquiry,
  recordInquiryDiagnostic,
  type InquiryEvent,
  type InquiryRecord,
  type InquiryRecordStatus,
} from '../src/host/inquiry/ledger.js'

const circle = 'session-main'
const main = { kind: 'main', sessionId: circle } as const
const childA = { kind: 'child', sessionId: 'session-a', locusId: 'locus-a', generation: 2 } as const
const childB = { kind: 'child', sessionId: 'session-b', locusId: 'locus-b', generation: 1 } as const
const childC = { kind: 'child', sessionId: 'session-c', locusId: 'locus-c', generation: 1 } as const
const t0 = 1_800_000_000_000
const delivery = { kind: 'feishu-delivery', deliveryId: 'delivery-1' } as const
const chat = { kind: 'feishu-chat', chatId: 'oc-example' } as const
const unknownAudience = { kind: 'unknown' } as const

const request = (over: Record<string, unknown> = {}) => ({
  target: childB,
  question: 'Which response shape did you settle on for the status endpoint?',
  purpose: 'Answer a Feishu request about the API contract',
  declaredOrigin: delivery,
  ...over,
})
const context = (over: Record<string, unknown> = {}) => ({
  inquiryId: 'inquiry-1',
  requester: childA,
  circleParentSessionId: circle,
  origin: delivery,
  audience: chat,
  createdAt: t0,
  parent: null,
  rootInquiryCount: 0,
  pendingCount: 0,
  ...over,
})

const failureEvents = ['reject', 'unavailable', 'cancel', 'needs-review']
const event = (type: string, over: Record<string, unknown> = {}) => ({
  type,
  eventId: `event-${type}`,
  at: t0 + 1_000,
  reason: failureEvents.includes(type) ? 'host-observed-fact' : null,
  ...over,
}) as unknown as InquiryEvent

const advance = (record: InquiryRecord, type: string, over: Record<string, unknown> = {}) =>
  applyInquiryEvent(record, event(type, over))

const eventForStatus: Record<string, string> = {
  executing: 'dispatch',
  answered: 'answer',
  'result-delivered': 'deliver-result',
  rejected: 'reject',
  unavailable: 'unavailable',
  cancelled: 'cancel',
  'needs-review': 'needs-review',
}

function legacyExpired(): InquiryRecord {
  const row = createInquiry(request(), context())
  return parseInquiry({
    ...row, deadlineAt: t0 + 300_000, status: 'expired', statusAt: t0 + 300_000,
    reason: 'legacy-deadline-reached', appliedEventIds: ['legacy-expire'],
  })
}

function recordAt(status: InquiryRecordStatus): InquiryRecord {
  const queued = createInquiry(request(), context())
  switch (status) {
    case 'queued': return queued
    case 'executing': return advance(queued, 'dispatch')
    case 'answered': return advance(advance(queued, 'dispatch'), 'answer')
    case 'result-delivered': return advance(advance(advance(queued, 'dispatch'), 'answer'), 'deliver-result')
    case 'needs-review': return advance(advance(queued, 'dispatch'), 'needs-review')
    case 'expired': return legacyExpired()
    default: return advance(queued, eventForStatus[status]!)
  }
}

function rejects(run: () => unknown, code = 'INVALID_INQUIRY_INPUT') {
  expect(run).toThrow(InquiryLedgerError)
  expect(run).toThrow(expect.objectContaining({ code }))
}
/** A restart is a re-read of persisted JSON, never a recomputation from "now". */
const reread = (record: InquiryRecord) => parseInquiry(JSON.parse(JSON.stringify(record)))

describe('inquiry ledger values', () => {
  it('exposes the agreed bounded budget as frozen constants', () => {
    expect(limits.maxChainEdges).toBe(3)
    expect(limits.maxInquiriesPerRoot).toBe(16)
    expect(limits.maxPendingPerSession).toBe(32)
    expect(limits).not.toHaveProperty('absoluteDeadlineMs')
    expect(Object.isFrozen(limits)).toBe(true)
    expect(INQUIRY_STATUSES).toEqual([
      'queued', 'executing', 'answered', 'result-delivered',
      'rejected', 'unavailable', 'cancelled', 'needs-review',
    ])
  })

  it('creates a frozen queued root inquiry whose trace the Host derives, not the caller', () => {
    const record = createInquiry(request(), context())
    expect(record).toEqual({
      id: 'inquiry-1',
      requester: childA,
      target: childB,
      circleParentSessionId: circle,
      question: request().question,
      purpose: request().purpose,
      origin: delivery,
      audience: chat,
      trace: { rootInquiryId: 'inquiry-1', depth: 1, visited: [childA, childB] },
      createdAt: t0,
      status: 'queued',
      statusAt: t0,
      reason: null,
      appliedEventIds: [],
      diagnostics: [],
      droppedDiagnostics: 0,
    })
    expect(Object.isFrozen(record)).toBe(true)
    expect(Object.isFrozen(record.trace)).toBe(true)
    expect(Object.isFrozen(record.trace.visited)).toBe(true)
    expect(Object.isFrozen(record.trace.visited[0])).toBe(true)
    expect(Object.isFrozen(record.origin)).toBe(true)
    expect(Object.isFrozen(record.requester)).toBe(true)
    expect(Object.isFrozen(record.appliedEventIds)).toBe(true)
    expect(Object.isFrozen(record.diagnostics)).toBe(true)
  })

  it('carries no answer text: the ledger tracks state, the answer record carries content', () => {
    expect(Object.keys(recordAt('answered'))).not.toContain('answer')
    expect(JSON.stringify(recordAt('answered'))).not.toContain('answerText')
  })

  it('detaches its inputs and never mutates or freezes caller-owned objects', () => {
    // Fresh copies: a leaked write must not reach the shared fixtures either.
    const input = { ...request(), target: { ...childB } }
    const facts = { ...context(), requester: { ...childA } }
    const record = createInquiry(input, facts)
    expect(Object.isFrozen(input)).toBe(false)
    expect(Object.isFrozen(facts)).toBe(false)
    expect(Object.isFrozen(facts.requester)).toBe(false)
    ;(input as { question: string }).question = 'mutated after the call'
    ;(facts.requester as { sessionId: string }).sessionId = 'session-hijacked'
    expect(record.question).toBe(request().question)
    expect(record.requester.sessionId).toBe('session-a')
    expect(record.trace.visited[0]!.sessionId).toBe('session-a')
  })

  it('accepts a main session at either end of the circle', () => {
    const asRequester = createInquiry(request(), context({ requester: main }))
    expect(asRequester.requester).toEqual(main)
    expect(asRequester.trace.visited).toEqual([main, childB])
    const asTarget = createInquiry(request({ target: main }), context())
    expect(asTarget.target).toEqual(main)
    expect(asTarget.trace.visited).toEqual([childA, main])
  })
})

describe('inquiry ledger input strictness', () => {
  it('rejects unknown keys instead of ignoring them', () => {
    rejects(() => createInquiry({ ...request(), extra: 1 }, context()))
    rejects(() => createInquiry(request(), { ...context(), extra: 1 }))
    rejects(() => createInquiry(request({ target: { ...childB, extra: 1 } }), context()))
  })

  it('rejects missing keys, non-objects and prototype-bearing inputs', () => {
    const { target, ...withoutTarget } = request()
    expect(target).toBeDefined()
    rejects(() => createInquiry(withoutTarget, context()))
    rejects(() => createInquiry(null, context()))
    rejects(() => createInquiry([], context()))
    rejects(() => createInquiry(Object.assign(Object.create({ inherited: 1 }), request()), context()))
  })

  it('never invokes a getter on caller-controlled input', () => {
    let called = 0
    const hostile = { ...request() } as Record<string, unknown>
    delete hostile.question
    Object.defineProperty(hostile, 'question', { enumerable: true, get() { called++; return 'sneaky' } })
    rejects(() => createInquiry(hostile, context()))
    expect(called).toBe(0)
  })

  it('rejects out-of-range or non-integer numbers', () => {
    rejects(() => createInquiry(request(), context({ createdAt: -1 })))
    rejects(() => createInquiry(request(), context({ createdAt: 1.5 })))
    rejects(() => createInquiry(request(), context({ createdAt: Number.NaN })))
    rejects(() => createInquiry(request(), context({ rootInquiryCount: -1 })))
    rejects(() => createInquiry(request(), context({ pendingCount: 1.5 })))
    rejects(() => createInquiry(request({ target: { ...childB, generation: 0 } }), context()))
    rejects(() => createInquiry(request({ target: { ...childB, generation: -1 } }), context()))
  })

  it('rejects blank, overlong or non-string bounded text', () => {
    rejects(() => createInquiry(request({ question: '   ' }), context()))
    rejects(() => createInquiry(request({ question: 'a'.repeat(limits.questionLength + 1) }), context()))
    rejects(() => createInquiry(request({ purpose: '' }), context()))
    rejects(() => createInquiry(request({ question: 42 }), context()))
    rejects(() => createInquiry(request(), context({ inquiryId: ' padded ' })))
  })

  it('rejects sparse arrays and arrays carrying extra runtime properties on re-read', () => {
    const record = createInquiry(request(), context())
    const sparse: unknown[] = [childA]
    sparse.length = 2
    rejects(() => parseInquiry({ ...record, trace: { ...record.trace, visited: sparse } }))
    const tagged = [childA, childB] as unknown[] & { tag?: string }
    tagged.tag = 'extra'
    rejects(() => parseInquiry({ ...record, trace: { ...record.trace, visited: tagged } }))
    rejects(() => parseInquiry({ ...record, appliedEventIds: { 0: 'a', length: 1 } }))
  })

  it('keeps caller content out of error messages', () => {
    const secret = 'CONFIDENTIAL-LEAKED-BODY'
    try {
      createInquiry(request({ question: secret, purpose: secret, target: 'not-a-scope' }), context())
      expect.unreachable('must reject')
    } catch (error) {
      expect(error).toBeInstanceOf(InquiryLedgerError)
      expect((error as Error).message).not.toContain(secret)
      expect((error as Error).message).toBe('Invalid inquiry input.')
    }
  })
})

describe('inquiry origin and audience cannot be restated by the requester', () => {
  it('refuses a Feishu delivery disguised as private local work', () => {
    rejects(
      () => createInquiry(request({ declaredOrigin: { kind: 'local' } }), context({ origin: delivery })),
      'ORIGIN_MISMATCH',
    )
  })

  it('refuses a declared delivery identity that is not the executing one', () => {
    rejects(
      () => createInquiry(request({ declaredOrigin: { kind: 'feishu-delivery', deliveryId: 'delivery-other' } }), context()),
      'ORIGIN_MISMATCH',
    )
    rejects(
      () => createInquiry(request({ declaredOrigin: { kind: 'inquiry', parentInquiryId: 'inquiry-0' } }), context()),
      'ORIGIN_MISMATCH',
    )
  })

  it('accepts an absent claim and still records the Host-derived origin', () => {
    const record = createInquiry(request({ declaredOrigin: null }), context())
    expect(record.origin).toEqual(delivery)
  })

  it('accepts an honest local origin and its local audience', () => {
    const record = createInquiry(
      request({ declaredOrigin: { kind: 'local' } }),
      context({ origin: { kind: 'local' }, audience: { kind: 'local-session', sessionId: circle } }),
    )
    expect(record.origin).toEqual({ kind: 'local' })
    expect(record.audience).toEqual({ kind: 'local-session', sessionId: circle })
  })

  it('writes an explicit unknown audience rather than guessing one', () => {
    const record = createInquiry(request(), context({ audience: unknownAudience }))
    expect(record.audience).toEqual(unknownAudience)
  })

  it('refuses an audience that contradicts the bound origin', () => {
    rejects(() => createInquiry(request(), context({ origin: delivery, audience: { kind: 'local-session', sessionId: circle } })))
    rejects(() => createInquiry(
      request({ declaredOrigin: { kind: 'local' } }),
      context({ origin: { kind: 'local' }, audience: chat }),
    ))
  })

  it('refuses a scope that is not structurally inside the named circle', () => {
    rejects(() => createInquiry(request(), context({ requester: { kind: 'main', sessionId: 'session-other-main' } })))
    rejects(() => createInquiry(request({ target: { ...childB, sessionId: circle } }), context()))
  })
})

describe('inquiry budget predicates', () => {
  it('scores root volume against the 16 inquiry ceiling', () => {
    expect(inquiryRootHasCapacity(0)).toBe(true)
    expect(inquiryRootHasCapacity(limits.maxInquiriesPerRoot - 1)).toBe(true)
    expect(inquiryRootHasCapacity(limits.maxInquiriesPerRoot)).toBe(false)
  })

  it('scores pending volume against the 32 per-session ceiling', () => {
    expect(inquirySessionHasCapacity(limits.maxPendingPerSession - 1)).toBe(true)
    expect(inquirySessionHasCapacity(limits.maxPendingPerSession)).toBe(false)
  })

  it('treats a visited member as visited by locus seat, not only by generation', () => {
    const visited = [childA, childB]
    expect(inquiryTargetIsUnvisited(visited, childC)).toBe(true)
    expect(inquiryTargetIsUnvisited(visited, childA)).toBe(false)
    expect(inquiryTargetIsUnvisited(visited, { ...childA, generation: 9, sessionId: 'session-a2' })).toBe(false)
    expect(inquiryTargetIsUnvisited(visited, main)).toBe(true)
    expect(inquiryTargetIsUnvisited([main], main)).toBe(false)
  })

  it('derives stable member and seat keys', () => {
    expect(inquiryMemberKey(childA)).toBe(inquiryMemberKey({ ...childA }))
    expect(inquiryMemberKey(childA)).not.toBe(inquiryMemberKey({ ...childA, generation: 3 }))
    expect(inquirySeatKey(childA)).toBe(inquirySeatKey({ ...childA, generation: 3, sessionId: 'session-a2' }))
    expect(inquirySeatKey(main)).not.toBe(inquirySeatKey(childA))
  })

  it('names exactly the terminal statuses', () => {
    expect(INQUIRY_STATUSES.filter(isTerminalInquiryStatus)).toEqual([
      'result-delivered', 'rejected', 'unavailable', 'cancelled', 'needs-review',
    ])
    expect(isTerminalInquiryStatus('expired')).toBe(true)
  })
})

describe('inquiry budget enforcement at creation', () => {
  it('refuses an inquiry beyond the per-root ceiling', () => {
    expect(createInquiry(request(), context({ rootInquiryCount: limits.maxInquiriesPerRoot - 1 })).status).toBe('queued')
    rejects(() => createInquiry(request(), context({ rootInquiryCount: limits.maxInquiriesPerRoot })), 'ROOT_BUDGET_EXCEEDED')
  })

  it('refuses an inquiry beyond the per-session pending ceiling', () => {
    expect(createInquiry(request(), context({ pendingCount: limits.maxPendingPerSession - 1 })).status).toBe('queued')
    rejects(() => createInquiry(request(), context({ pendingCount: limits.maxPendingPerSession })), 'PENDING_BUDGET_EXCEEDED')
  })
})

describe('nested inquiry chains inherit the ancestor budget', () => {
  const parent = () => advance(createInquiry(request(), context()), 'dispatch')
  const nested = (over: Record<string, unknown> = {}, requestOver: Record<string, unknown> = {}) => {
    const ancestor = parent()
    return createInquiry(
      request({ target: childC, declaredOrigin: { kind: 'inquiry', parentInquiryId: ancestor.id }, ...requestOver }),
      context({
        inquiryId: 'inquiry-2',
        requester: childB,
        origin: { kind: 'inquiry', parentInquiryId: ancestor.id },
        audience: chat,
        createdAt: t0 + 1_000,
        parent: ancestor,
        rootInquiryCount: 1,
        ...over,
      }),
    )
  }

  it('keeps the ancestor root and deepens the trace instead of starting a new root', () => {
    const record = nested()
    expect(record.trace.rootInquiryId).toBe('inquiry-1')
    expect(record.trace.rootInquiryId).not.toBe(record.id)
    expect(record.trace.depth).toBe(2)
    expect(record.trace.visited).toEqual([childA, childB, childC])
  })

  it('allows a nested inquiry days later while inheriting only trace and count budgets', () => {
    const daysLater = t0 + 7 * 24 * 60 * 60 * 1_000
    const record = nested({ createdAt: daysLater })
    expect(record.createdAt).toBe(daysLater)
    expect(record.trace).toEqual({ rootInquiryId: 'inquiry-1', depth: 2, visited: [childA, childB, childC] })
    expect(record).not.toHaveProperty('deadlineAt')
  })

  it('refuses a member already visited on this chain, including the original requester', () => {
    rejects(() => nested({}, { target: childA }), 'TARGET_ALREADY_VISITED')
    rejects(() => nested({}, { target: childB }), 'TARGET_ALREADY_VISITED')
    rejects(() => nested({}, { target: { ...childA, generation: 7, sessionId: 'session-a2' } }), 'TARGET_ALREADY_VISITED')
  })

  it('refuses a root inquiry that would immediately loop back on the requester', () => {
    rejects(() => createInquiry(request({ target: childA }), context()), 'TARGET_ALREADY_VISITED')
  })

  it('allows three chain edges and refuses the fourth', () => {
    const second = nested()
    const third = createInquiry(
      request({ target: main, declaredOrigin: { kind: 'inquiry', parentInquiryId: second.id } }),
      context({
        inquiryId: 'inquiry-3', requester: childC,
        origin: { kind: 'inquiry', parentInquiryId: second.id },
        createdAt: t0 + 2_000, parent: advance(second, 'dispatch', { at: t0 + 1_500 }), rootInquiryCount: 2,
      }),
    )
    expect(third.trace.depth).toBe(limits.maxChainEdges)
    expect(third.trace.rootInquiryId).toBe('inquiry-1')
    rejects(
      () => createInquiry(
        request({ target: { kind: 'child', sessionId: 'session-d', locusId: 'locus-d', generation: 1 }, declaredOrigin: { kind: 'inquiry', parentInquiryId: third.id } }),
        context({
          inquiryId: 'inquiry-4', requester: main,
          origin: { kind: 'inquiry', parentInquiryId: third.id },
          createdAt: t0 + 3_000, parent: advance(third, 'dispatch', { at: t0 + 2_500 }), rootInquiryCount: 3,
        }),
      ),
      'CHAIN_DEPTH_EXCEEDED',
    )
  })

  it('counts nested inquiries against the ancestor root budget, not a fresh one', () => {
    rejects(() => nested({ rootInquiryCount: limits.maxInquiriesPerRoot }), 'ROOT_BUDGET_EXCEEDED')
  })

  it('refuses an inquiry origin whose parent record does not match', () => {
    rejects(() => nested({ origin: { kind: 'inquiry', parentInquiryId: 'inquiry-unrelated' } }, { declaredOrigin: null }), 'CHAIN_MISMATCH')
    rejects(() => nested({ parent: null }), 'CHAIN_MISMATCH')
    rejects(() => createInquiry(request(), context({ parent: recordAt('executing') })), 'CHAIN_MISMATCH')
  })

  it('refuses a nested inquiry from a member that is not on the ancestor edge', () => {
    rejects(() => nested({ requester: main }), 'CHAIN_MISMATCH')
  })

  it('allows the original requester to continue the chain after the result comes back', () => {
    const ancestor = recordAt('answered')
    const record = createInquiry(
      request({ target: childC, declaredOrigin: { kind: 'inquiry', parentInquiryId: ancestor.id } }),
      context({
        inquiryId: 'inquiry-2', requester: childA,
        origin: { kind: 'inquiry', parentInquiryId: ancestor.id },
        createdAt: t0 + 2_000, parent: ancestor, rootInquiryCount: 1,
      }),
    )
    expect(record.trace.rootInquiryId).toBe('inquiry-1')
    expect(record.trace.depth).toBe(2)
  })

  it('refuses to extend a chain from a failed or undispatched ancestor', () => {
    for (const status of ['queued', 'expired', 'cancelled', 'rejected', 'unavailable', 'needs-review'] as const) {
      rejects(() => nested({ parent: recordAt(status) }), 'CHAIN_MISMATCH')
    }
  })

  it('refuses a nested inquiry that widens the ancestor audience', () => {
    rejects(() => nested({ audience: { kind: 'feishu-chat', chatId: 'oc-other' } }))
    rejects(() => nested({ audience: { kind: 'local-session', sessionId: circle } }))
    expect(nested({ audience: unknownAudience }).audience).toEqual(unknownAudience)
  })
})

describe('inquiry status transitions', () => {
  it('walks the accepted path queued -> executing -> answered -> result-delivered', () => {
    const queued = createInquiry(request(), context())
    const executing = advance(queued, 'dispatch')
    const answered = advance(executing, 'answer')
    const delivered = advance(answered, 'deliver-result')
    expect([queued.status, executing.status, answered.status, delivered.status])
      .toEqual(['queued', 'executing', 'answered', 'result-delivered'])
    expect(delivered.appliedEventIds).toEqual(['event-dispatch', 'event-answer', 'event-deliver-result'])
    expect(delivered.statusAt).toBe(t0 + 1_000)
    expect(delivered.reason).toBe(null)
    expect(Object.isFrozen(delivered)).toBe(true)
  })

  it('never mutates the record it transitions from', () => {
    const queued = createInquiry(request(), context())
    const executing = advance(queued, 'dispatch')
    expect(queued.status).toBe('queued')
    expect(queued.appliedEventIds).toEqual([])
    expect(executing).not.toBe(queued)
  })

  it.each([
    ['queued', 'answer'], ['queued', 'deliver-result'], ['queued', 'needs-review'],
    ['executing', 'deliver-result'], ['answered', 'dispatch'],
    ['result-delivered', 'answer'], ['result-delivered', 'dispatch'], ['result-delivered', 'cancel'],
    ['expired', 'dispatch'], ['expired', 'answer'], ['expired', 'cancel'],
    ['cancelled', 'answer'], ['rejected', 'dispatch'], ['unavailable', 'answer'],
    ['needs-review', 'answer'], ['needs-review', 'deliver-result'], ['needs-review', 'dispatch'],
  ] as const)('refuses the illegal transition %s + %s', (status, type) => {
    rejects(() => advance(recordAt(status), type, { at: t0 + 2_000 }), 'ILLEGAL_TRANSITION')
  })

  it('refuses needs-review for a provably undispatched inquiry, which is recoverable instead', () => {
    rejects(() => advance(recordAt('queued'), 'needs-review'), 'ILLEGAL_TRANSITION')
    expect(advance(recordAt('executing'), 'needs-review').status).toBe('needs-review')
    expect(advance(recordAt('answered'), 'needs-review').status).toBe('needs-review')
  })

  it('offers no path that turns an unknown outcome into a success', () => {
    const unknown = recordAt('needs-review')
    for (const type of ['dispatch', 'answer', 'deliver-result']) {
      rejects(() => advance(unknown, type, { at: t0 + 5_000 }), 'ILLEGAL_TRANSITION')
    }
    expect(unknown.reason).toBe('host-observed-fact')
  })

  it('accepts cancellation of an answered but undelivered inquiry after a long wait', () => {
    const cancelled = advance(recordAt('answered'), 'cancel', {
      at: t0 + 7 * 24 * 60 * 60 * 1_000, reason: 'owner-cancelled',
    })
    expect(cancelled).toMatchObject({ status: 'cancelled', reason: 'owner-cancelled' })
    expect(advance(cancelled, 'cancel', { eventId: 'cancel-repeat', at: cancelled.statusAt + 1, reason: 'other' }))
      .toEqual(cancelled)
  })

  it('requires a stable reason code for failures and forbids one for successes', () => {
    rejects(() => advance(recordAt('queued'), 'reject', { reason: null }))
    rejects(() => advance(recordAt('queued'), 'dispatch', { reason: 'why-not' }))
    rejects(() => advance(recordAt('queued'), 'cancel', { reason: 'Owner said: cancel this now' }))
    rejects(() => advance(recordAt('queued'), 'cancel', { reason: 'a'.repeat(limits.reasonLength + 1) }))
    expect(advance(recordAt('queued'), 'cancel', { reason: 'owner-cancelled' }).reason).toBe('owner-cancelled')
  })

  it('rejects unknown event types and malformed events', () => {
    rejects(() => applyInquiryEvent(recordAt('queued'), { type: 'resurrect', eventId: 'e', at: t0, reason: null } as unknown as InquiryEvent))
    rejects(() => applyInquiryEvent(recordAt('queued'), { type: 'dispatch', eventId: 'e', at: t0 } as unknown as InquiryEvent))
    rejects(() => applyInquiryEvent(recordAt('queued'), { type: 'dispatch', eventId: '', at: t0, reason: null } as unknown as InquiryEvent))
    rejects(() => applyInquiryEvent(recordAt('queued'), null as unknown as InquiryEvent))
  })

  it('refuses an event dated before the current status, so time cannot run backwards', () => {
    rejects(() => advance(recordAt('executing'), 'answer', { at: t0 - 1 }), 'ILLEGAL_TRANSITION')
  })

  it('allows progress events days later but still enforces monotonic statusAt', () => {
    const daysLater = t0 + 7 * 24 * 60 * 60 * 1_000
    const executing = advance(recordAt('queued'), 'dispatch', { at: daysLater })
    const answered = advance(executing, 'answer', { at: daysLater + 1 })
    const delivered = advance(answered, 'deliver-result', { at: daysLater + 2 })
    expect(delivered.status).toBe('result-delivered')
    rejects(() => advance(executing, 'answer', { at: daysLater - 1 }), 'ILLEGAL_TRANSITION')
    rejects(() => advance(recordAt('queued'), 'expire', { at: daysLater }), 'INVALID_INQUIRY_INPUT')
  })
})

describe('duplicate inquiry events are idempotent', () => {
  it('returns an unchanged record when the same event is redelivered', () => {
    const executing = advance(createInquiry(request(), context()), 'dispatch')
    const again = advance(executing, 'dispatch')
    expect(again).toEqual(executing)
    expect(again.appliedEventIds).toEqual(['event-dispatch'])
  })

  it('does not double-advance when a second distinct event repeats a completed transition', () => {
    const answered = recordAt('answered')
    const duplicate = advance(answered, 'answer', { eventId: 'event-answer-retry', at: t0 + 9_000 })
    expect(duplicate.status).toBe('answered')
    expect(duplicate.statusAt).toBe(answered.statusAt)
    expect(duplicate.appliedEventIds).toEqual(['event-dispatch', 'event-answer'])
    expect(duplicate).toEqual(answered)
  })

  it('keeps the first terminal outcome when a duplicate failure event arrives', () => {
    const cancelled = advance(recordAt('queued'), 'cancel', { reason: 'owner-cancelled' })
    const again = advance(cancelled, 'cancel', { eventId: 'event-cancel-2', at: t0 + 4_000, reason: 'other-reason' })
    expect(again).toEqual(cancelled)
    expect(again.reason).toBe('owner-cancelled')
  })

  it('refuses to reuse an applied event id for a different transition', () => {
    const executing = advance(createInquiry(request(), context()), 'dispatch')
    rejects(() => advance(executing, 'answer', { eventId: 'event-dispatch' }), 'ILLEGAL_TRANSITION')
  })
})

describe('late answers after a terminal state stay diagnostics', () => {
  it('refuses a late answer transition on every terminal status', () => {
    for (const status of INQUIRY_STATUSES.filter(isTerminalInquiryStatus)) {
      rejects(() => advance(recordAt(status), 'answer', { at: t0 + 9_000 }), 'ILLEGAL_TRANSITION')
    }
  })

  it('keeps the late answer as a diagnostic without reviving or advancing the record', () => {
    const expired = recordAt('expired')
    const noted = recordInquiryDiagnostic(expired, { kind: 'late-answer', at: t0 + 9_000, eventId: 'answer-late' })
    expect(noted.status).toBe('expired')
    expect(noted.statusAt).toBe(expired.statusAt)
    expect(noted.diagnostics).toEqual([{ kind: 'late-answer', at: t0 + 9_000, eventId: 'answer-late' }])
    expect(expired.diagnostics).toEqual([])
    expect(Object.isFrozen(noted.diagnostics)).toBe(true)
    expect(Object.isFrozen(noted.diagnostics[0])).toBe(true)
  })

  it('deduplicates a redelivered late answer by its event id', () => {
    const expired = recordAt('expired')
    const once = recordInquiryDiagnostic(expired, { kind: 'late-answer', at: t0 + 9_000, eventId: 'answer-late' })
    const twice = recordInquiryDiagnostic(once, { kind: 'late-answer', at: t0 + 9_500, eventId: 'answer-late' })
    expect(twice).toEqual(once)
  })

  it('bounds retained diagnostics and counts what it dropped rather than growing forever', () => {
    let record = recordAt('expired')
    for (let i = 0; i < limits.diagnostics + 4; i++) {
      record = recordInquiryDiagnostic(record, { kind: 'late-answer', at: t0 + 9_000 + i, eventId: `late-${i}` })
    }
    expect(record.diagnostics).toHaveLength(limits.diagnostics)
    expect(record.diagnostics[0]!.eventId).toBe('late-0')
    expect(record.droppedDiagnostics).toBe(4)
  })

  it('validates diagnostics as strictly as any other input', () => {
    const expired = recordAt('expired')
    expect(INQUIRY_DIAGNOSTIC_KINDS).toContain('late-answer')
    rejects(() => recordInquiryDiagnostic(expired, { kind: 'whatever', at: t0, eventId: 'x' }))
    rejects(() => recordInquiryDiagnostic(expired, { kind: 'late-answer', at: -1, eventId: 'x' }))
    rejects(() => recordInquiryDiagnostic(expired, { kind: 'late-answer', at: t0, eventId: 'x', note: 'the answer body' }))
  })
})

describe('inquiry records survive a restart as durable values', () => {
  it('re-reads a persisted queued inquiry with createdAt and no deadline', () => {
    const queued = createInquiry(request(), context())
    const revived = reread(queued)
    expect(revived).toEqual(queued)
    expect(revived.createdAt).toBe(t0)
    expect(revived).not.toHaveProperty('deadlineAt')
  })

  it('normalizes an exact legacy v12 row while retaining expired terminal evidence', () => {
    const expired = recordAt('expired')
    expect(expired.status).toBe('expired')
    expect(expired).not.toHaveProperty('deadlineAt')
    rejects(() => advance(expired, 'dispatch', { at: t0 + 400_000 }), 'ILLEGAL_TRANSITION')
    expect(reread(expired).status).toBe('expired')
  })

  it('preserves applied event ids so redelivery after a restart stays idempotent', () => {
    const answered = reread(recordAt('answered'))
    expect(answered.appliedEventIds).toEqual(['event-dispatch', 'event-answer'])
    expect(advance(answered, 'answer', { eventId: 'event-answer' })).toEqual(answered)
  })

  it('refuses a persisted record whose inquiry origin claims to be its own root', () => {
    const nestedRecord = createInquiry(
      request({ target: childC, declaredOrigin: null }),
      context({
        inquiryId: 'inquiry-2', requester: childB,
        origin: { kind: 'inquiry', parentInquiryId: 'inquiry-1' },
        createdAt: t0 + 1_000, parent: recordAt('executing'), rootInquiryCount: 1,
      }),
    )
    rejects(() => parseInquiry({ ...nestedRecord, trace: { ...nestedRecord.trace, rootInquiryId: nestedRecord.id } }))
    rejects(() => parseInquiry({ ...nestedRecord, trace: { ...nestedRecord.trace, depth: 1 } }))
  })

  it('refuses a persisted root record whose trace was rewritten to another root', () => {
    const root = createInquiry(request(), context())
    rejects(() => parseInquiry({ ...root, trace: { ...root.trace, rootInquiryId: 'inquiry-elsewhere' } }))
    rejects(() => parseInquiry({ ...root, trace: { ...root.trace, depth: 2 } }))
  })

  it('refuses a persisted trace with a repeated member or an over-budget depth', () => {
    const root = createInquiry(request(), context())
    rejects(() => parseInquiry({ ...root, trace: { ...root.trace, visited: [childA, childA] } }))
    rejects(() => parseInquiry({ ...root, trace: { ...root.trace, visited: [] } }))
    rejects(() => parseInquiry({
      ...root,
      trace: { rootInquiryId: 'inquiry-0', depth: limits.maxChainEdges + 1, visited: [childA, childB, childC] },
    }))
  })

  it('refuses impossible current or legacy status, deadline, and counter values', () => {
    const root = createInquiry(request(), context())
    rejects(() => parseInquiry({ ...root, status: 'done' }))
    rejects(() => parseInquiry({ ...root, deadlineAt: root.createdAt }))
    rejects(() => parseInquiry({ ...root, deadlineAt: root.createdAt + 300_001 }))
    rejects(() => parseInquiry({ ...root, statusAt: root.createdAt - 1 }))
    rejects(() => parseInquiry({ ...root, droppedDiagnostics: -1 }))
    rejects(() => parseInquiry({ ...root, reason: 'Owner said stop' }))
    rejects(() => parseInquiry({ ...root, status: 'rejected', reason: null }))
  })

  it('returns a frozen detached copy that shares nothing with the persisted input', () => {
    const stored = JSON.parse(JSON.stringify(createInquiry(request(), context())))
    const record = parseInquiry(stored)
    stored.question = 'mutated after parse'
    stored.trace.visited[0].sessionId = 'session-hijacked'
    expect(record.question).toBe(request().question)
    expect(record.trace.visited[0]!.sessionId).toBe('session-a')
    expect(Object.isFrozen(record)).toBe(true)
    expect(Object.isFrozen(stored)).toBe(false)
  })
})
