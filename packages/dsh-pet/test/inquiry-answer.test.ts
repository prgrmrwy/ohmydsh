/**
 * Caller-bound, inquiry-bound ANSWER tests.
 *
 * The answerer is never a parameter: it is re-derived from the executing
 * session and re-matched against the stored target of that exact inquiryId, so
 * these tests drive the real caller resolver over real durable Locus records.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  submitInquiryAnswerFromCaller, InquiryAnswerClosedError, InquiryAnswerRefusedError,
  INQUIRY_ANSWER_CONFIDENCE, INQUIRY_ANSWER_RECENCY, INQUIRY_ANSWER_LIMITS,
} from '../src/host/inquiry/answer.js'
import {
  applyInquiryEvent, createInquiry, recordInquiryDiagnostic, type InquiryRecord,
} from '../src/host/inquiry/ledger.js'
import { buildLocusRecord, type LocusRecord } from '../src/host/locus/aggregate.js'

const t0 = 1_800_000_000_000
const now = t0 + 1_000

function locus(id: string, child: string, overrides: Partial<Parameters<typeof buildLocusRecord>[0]> = {}): LocusRecord {
  return buildLocusRecord({
    id, generation: 1, parentSessionId: 'main', childSessionId: child,
    endpoint: { chatId: `chat-${id}` }, workspaceId: 'ws', source: 'explicit', state: 'active', ...overrides,
  })
}

const childA = { kind: 'child', sessionId: 'child-a', locusId: 'a', generation: 1 } as const
const childB = { kind: 'child', sessionId: 'child-b', locusId: 'b', generation: 1 } as const
const mainScope = { kind: 'main', sessionId: 'main' } as const

function queued(id: string, requester: unknown, target: unknown): InquiryRecord {
  return createInquiry(
    { target, question: 'What shape does the status endpoint return?', purpose: 'Answer an API question', declaredOrigin: null },
    {
      inquiryId: id, requester, circleParentSessionId: 'main',
      origin: { kind: 'local' }, audience: { kind: 'local-session', sessionId: 'main' },
      createdAt: t0, parent: null, rootInquiryCount: 0, pendingCount: 0,
    },
  )
}

const dispatch = (record: InquiryRecord): InquiryRecord =>
  applyInquiryEvent(record, { type: 'dispatch', eventId: `dispatch-${record.id}`, at: t0 + 10, reason: null })

function fixture(rows: LocusRecord[] = [locus('a', 'child-a'), locus('b', 'child-b')], seed: InquiryRecord[] = []) {
  const archived = new Set<string>()
  const identities = new Map<string, { id: string; parentSessionId?: string }>([
    ['main', { id: 'main' }],
    ...rows.map(row => [row.childSessionId!, { id: row.childSessionId!, parentSessionId: row.parentSessionId }] as const),
  ])
  const ports = {
    loci: {
      findByChildSessionId: (id: string) => rows.filter(r => r.childSessionId === id),
      getLocusByChild: (id: string) => rows.find(r => r.childSessionId === id),
      listLociByParent: (id: string) => rows.filter(r => r.parentSessionId === id),
      getCurrentLocus: (endpoint: { chatId: string; threadId?: string }) =>
        rows.find(r => r.endpoint.chatId === endpoint.chatId && r.endpoint.threadId === endpoint.threadId),
    },
    inspect: async (id: string) => identities.get(id),
    isArchived: (id: string) => archived.has(id),
    hasPublicContext: (id: string) => id === 'main',
  }
  const inquiries = new Map(seed.map(row => [row.id, row]))
  const answers = new Map<string, unknown>()
  const ledger = {
    get: (id: string) => inquiries.get(id),
    applyEvent: vi.fn(async (id: string, event: unknown) => {
      const current = inquiries.get(id)
      if (current === undefined) throw new Error('missing')
      const next = applyInquiryEvent(current, event)
      inquiries.set(id, next)
      return next
    }),
    recordDiagnostic: vi.fn(async (id: string, entry: unknown) => {
      const current = inquiries.get(id)
      if (current === undefined) throw new Error('missing')
      const next = recordInquiryDiagnostic(current, entry)
      inquiries.set(id, next)
      return next
    }),
  }
  const answerStore = {
    get: (id: string) => answers.get(id),
    put: vi.fn(async (id: string, value: unknown) => {
      // First writer wins, exactly like a durable put-if-absent.
      if (!answers.has(id)) answers.set(id, value)
      return answers.get(id)!
    }),
  }
  let seq = 0
  const deps = {
    ports, ledger, answers: answerStore,
    now: () => now,
    newEventId: () => `event-${String(++seq)}`,
  }
  return { ports, archived, inquiries, answers, ledger, answerStore, deps }
}

const answer = (id: unknown, args: unknown, f: ReturnType<typeof fixture>) =>
  submitInquiryAnswerFromCaller({ agent: { session: { id } } }, args, f.deps)

const body = (over: Record<string, unknown> = {}) => ({
  inquiryId: 'inquiry-1',
  answer: 'It returns { status, updatedAt } and no nested payload.',
  confidence: 'confirmed',
  recency: 'current',
  sources: ['the handler I implemented in this session'],
  ...over,
})

describe('caller-bound inquiry answer', () => {
  it('records an answer from the actual target, with explicit source, recency and confidence', async () => {
    const record = dispatch(queued('inquiry-1', childA, childB))
    const f = fixture(undefined, [record])
    const result = await answer('child-b', body(), f)
    expect(result).toMatchObject({
      status: 'recorded', inquiryId: 'inquiry-1', answeredAt: now,
      confidence: 'confirmed', recency: 'current', delivered: false,
    })
    expect(f.inquiries.get('inquiry-1')!.status).toBe('answered')
    // The distinctions are stored as fields, never left inside prose.
    expect(f.answers.get('inquiry-1')).toMatchObject({
      inquiryId: 'inquiry-1', confidence: 'confirmed', recency: 'current',
      sources: ['the handler I implemented in this session'],
      answeredBy: { kind: 'child', sessionId: 'child-b', locusId: 'b', generation: 1 },
    })
  })

  it('lets a main session answer a child, and a child answer its main session', async () => {
    const toMain = fixture(undefined, [dispatch(queued('inquiry-1', childA, mainScope))])
    await expect(answer('main', body(), toMain)).resolves.toMatchObject({ status: 'recorded' })
    const toChild = fixture(undefined, [dispatch(queued('inquiry-1', mainScope, childA))])
    await expect(answer('child-a', body(), toChild)).resolves.toMatchObject({ status: 'recorded' })
  })

  it('refuses anyone who is not the actual target of that inquiryId', async () => {
    const f = fixture(undefined, [dispatch(queued('inquiry-1', childA, childB))])
    // The requester, an uninvolved sibling, the circle parent and a stranger all fail alike.
    for (const caller of ['child-a', 'main', 'stranger', undefined]) {
      await expect(answer(caller, body(), f)).rejects.toBeInstanceOf(InquiryAnswerRefusedError)
    }
    expect(f.answers.size).toBe(0)
    expect(f.ledger.applyEvent).not.toHaveBeenCalled()
    expect(f.inquiries.get('inquiry-1')!.status).toBe('executing')
  })

  it('re-verifies the target at answer time, so a rebuilt generation cannot answer', async () => {
    const record = dispatch(queued('inquiry-1', childA, childB))
    // The circle now carries generation 2 at the same locus seat.
    const f = fixture([locus('a', 'child-a'), locus('b', 'child-b2', { generation: 2 })], [record])
    await expect(answer('child-b2', body(), f)).rejects.toBeInstanceOf(InquiryAnswerRefusedError)
    expect(f.answers.size).toBe(0)
  })

  it('refuses a rebuilt generation that kept the same session id', async () => {
    // Isolates the generation check: the session id the inquiry named is still
    // the caller's, so only the generation can tell the two incarnations apart.
    const record = dispatch(queued('inquiry-1', childA, childB))
    const f = fixture([locus('a', 'child-a'), locus('b', 'child-b', { generation: 2 })], [record])
    await expect(answer('child-b', body(), f)).rejects.toBeInstanceOf(InquiryAnswerRefusedError)
    expect(f.answers.size).toBe(0)
    expect(f.inquiries.get('inquiry-1')!.status).toBe('executing')
  })

  it('refuses the circle parent answering an inquiry addressed to a child, and the reverse', async () => {
    // Isolates the member-key match from the session-id match: neither member
    // shares a session id with the other, but both are valid circle members.
    const toChild = fixture(undefined, [dispatch(queued('inquiry-1', mainScope, childB))])
    await expect(answer('main', body(), toChild)).rejects.toBeInstanceOf(InquiryAnswerRefusedError)
    const toMain = fixture(undefined, [dispatch(queued('inquiry-1', childA, mainScope))])
    await expect(answer('child-b', body(), toMain)).rejects.toBeInstanceOf(InquiryAnswerRefusedError)
    expect(toChild.answers.size).toBe(0)
    expect(toMain.answers.size).toBe(0)
  })

  it('refuses an unknown inquiryId exactly like a non-target, disclosing nothing', async () => {
    const f = fixture(undefined, [dispatch(queued('inquiry-1', childA, childB))])
    const unknown = await answer('child-b', body({ inquiryId: 'inquiry-elsewhere' }), f).catch((e: unknown) => e)
    const foreign = await answer('child-a', body(), f).catch((e: unknown) => e)
    expect(unknown).toBeInstanceOf(InquiryAnswerRefusedError)
    expect((unknown as Error).message).toBe((foreign as Error).message)
    expect((unknown as Error).message).not.toMatch(/inquiry-1|child-/)
  })

  it('is idempotent for a duplicate answer and keeps the first one', async () => {
    const f = fixture(undefined, [dispatch(queued('inquiry-1', childA, childB))])
    const first = await answer('child-b', body(), f)
    const again = await answer('child-b', body({ answer: 'Actually something different.', confidence: 'suggested' }), f)
    expect(again).toEqual(first)
    expect(f.answers.get('inquiry-1')).toMatchObject({ confidence: 'confirmed' })
    expect(f.answerStore.put).toHaveBeenCalledTimes(1)
    // The redelivery is retained as evidence and advances nothing.
    expect(f.inquiries.get('inquiry-1')!.status).toBe('answered')
    expect(f.inquiries.get('inquiry-1')!.diagnostics.map(d => d.kind)).toEqual(['duplicate-answer'])
  })

  it('refuses an answer after explicit cancellation but retains it as a diagnostic', async () => {
    const cancelled = applyInquiryEvent(
      dispatch(queued('inquiry-1', childA, childB)),
      { type: 'cancel', eventId: 'cancel-1', at: t0 + 300_000, reason: 'caller-cancelled' },
    )
    const f = fixture(undefined, [cancelled])
    const error = await answer('child-b', body(), f).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(InquiryAnswerClosedError)
    expect((error as InquiryAnswerClosedError).retainedAsDiagnostic).toBe(true)
    const after = f.inquiries.get('inquiry-1')!
    // Terminal facts are preserved exactly: no revival, no continuation.
    expect(after.status).toBe('cancelled')
    expect(after.statusAt).toBe(t0 + 300_000)
    expect(after.reason).toBe('caller-cancelled')
    expect(after.diagnostics.map(d => d.kind)).toEqual(['late-answer'])
    // The refused body itself is never persisted.
    expect(f.answers.size).toBe(0)
    expect(JSON.stringify(after)).not.toContain('nested payload')
  })

  it('refuses an answer to an inquiry that was never dispatched', async () => {
    const f = fixture(undefined, [queued('inquiry-1', childA, childB)])
    await expect(answer('child-b', body(), f)).rejects.toBeInstanceOf(InquiryAnswerRefusedError)
    expect(f.inquiries.get('inquiry-1')!.status).toBe('queued')
    expect(f.answers.size).toBe(0)
  })

  it('exposes no recipient parameter and ignores nothing: unknown keys are refused', async () => {
    const f = fixture(undefined, [dispatch(queued('inquiry-1', childA, childB))])
    for (const extra of [
      { to: 'child-a' }, { recipient: 'main' }, { requesterSessionId: 'child-a' },
      { chatId: 'oc-elsewhere' }, { deliveryId: 'delivery-1' }, { answeredBy: { kind: 'main', sessionId: 'main' } },
      { audience: { kind: 'feishu-chat', chatId: 'oc-x' } },
    ]) {
      await expect(answer('child-b', body(extra), f)).rejects.toBeInstanceOf(InquiryAnswerRefusedError)
    }
    expect(f.answers.size).toBe(0)
  })

  it('requires the distinctions explicitly and refuses free-prose substitutes', async () => {
    const f = fixture(undefined, [dispatch(queued('inquiry-1', childA, childB))])
    for (const broken of [
      { confidence: 'pretty sure' }, { confidence: undefined }, { recency: 'recent-ish' }, { recency: undefined },
      { sources: 'from memory' }, { sources: [] }, { sources: [''] }, { answer: '   ' }, { answer: undefined },
      { answer: 'x'.repeat(INQUIRY_ANSWER_LIMITS.answerLength + 1) },
      { sources: Array.from({ length: INQUIRY_ANSWER_LIMITS.sources + 1 }, (_, i) => `s${String(i)}`) },
    ]) {
      await expect(answer('child-b', body(broken), f)).rejects.toBeInstanceOf(InquiryAnswerRefusedError)
    }
    expect(f.answers.size).toBe(0)
    expect(INQUIRY_ANSWER_CONFIDENCE).toEqual(['confirmed', 'suggested', 'unknown'])
    expect(INQUIRY_ANSWER_RECENCY).toEqual(['current', 'as-of-recorded-work', 'stale', 'unknown'])
  })

  it('accepts an explicit unknown answer without forcing the model to invent a fact', async () => {
    const f = fixture(undefined, [dispatch(queued('inquiry-1', childA, childB))])
    await expect(answer('child-b', body({
      answer: 'I never decided this; the contract was left open.',
      confidence: 'unknown', recency: 'unknown',
    }), f)).resolves.toMatchObject({ confidence: 'unknown', recency: 'unknown' })
  })

  it('never creates or consumes a Feishu delivery and never touches shared public facts', async () => {
    const f = fixture(undefined, [dispatch(queued('inquiry-1', childA, childB))])
    const forbidden = ['reply', 'delivery', 'deliveries', 'outbound', 'feishu', 'client',
      'publicContext', 'contextStore', 'collaborationContext']
    const guarded = new Proxy(f.deps, {
      get(target, key) {
        if (typeof key === 'string' && forbidden.includes(key)) throw new Error(`forbidden seam: ${key}`)
        return Reflect.get(target, key) as unknown
      },
    })
    const result = await submitInquiryAnswerFromCaller({ agent: { session: { id: 'child-b' } } }, body(), guarded)
    // Recording an answer is not delivering it; delivery is a separate, deferred step.
    expect(result.delivered).toBe(false)
    expect(JSON.stringify(result)).not.toMatch(/chatId|deliveryId|messageId/)
  })

  it('does not mark the inquiry answered when the answer body could not be stored', async () => {
    const f = fixture(undefined, [dispatch(queued('inquiry-1', childA, childB))])
    f.answerStore.put.mockRejectedValueOnce(new Error('medium unavailable'))
    await expect(answer('child-b', body(), f)).rejects.toBeInstanceOf(InquiryAnswerRefusedError)
    expect(f.inquiries.get('inquiry-1')!.status).toBe('executing')
    expect(f.ledger.applyEvent).not.toHaveBeenCalled()
  })
})
