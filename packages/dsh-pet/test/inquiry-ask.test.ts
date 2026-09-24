/**
 * Caller-bound inquiry ACCEPT tests.
 *
 * Every case drives the real caller resolver over real durable Locus records,
 * and the fake ledger store runs the real pure `createInquiry`. Only the two
 * Host seams that cannot exist in a unit test — the id generator and the
 * origin/audience prover — are substituted, and both are asserted to be the
 * ONLY source of those facts.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  acceptInquiryFromCaller, InquiryLimitError, InquiryRefusedError,
} from '../src/host/inquiry/ask.js'
import { createInquiry, INQUIRY_LIMITS, type InquiryRecord } from '../src/host/inquiry/ledger.js'
import { buildLocusRecord, type LocusRecord } from '../src/host/locus/aggregate.js'

const t0 = 1_800_000_000_000

function locus(id: string, child: string, overrides: Partial<Parameters<typeof buildLocusRecord>[0]> = {}): LocusRecord {
  return buildLocusRecord({
    id, generation: 1, parentSessionId: 'main', childSessionId: child,
    endpoint: { chatId: `chat-${id}` }, workspaceId: 'ws', source: 'explicit', state: 'active', ...overrides,
  })
}

/** In-memory ledger store that delegates every rule to the real pure model. */
function memoryStore() {
  const rows = new Map<string, InquiryRecord>()
  const calls: { request: unknown; facts: Record<string, unknown> }[] = []
  let fail: Error | undefined
  return {
    rows, calls,
    failWith(error: Error) { fail = error },
    async accept(request: unknown, facts: unknown): Promise<InquiryRecord> {
      const supplied = facts as Record<string, unknown>
      calls.push({ request, facts: supplied })
      if (fail !== undefined) throw fail
      const origin = supplied.origin as { kind?: string; parentInquiryId?: string } | undefined
      const parent = origin?.kind === 'inquiry' ? rows.get(origin.parentInquiryId!) ?? null : null
      const probe = createInquiry(request, { ...supplied, parent, rootInquiryCount: 0, pendingCount: 0 })
      let rootInquiryCount = 0
      let pendingCount = 0
      for (const row of rows.values()) {
        if (row.id === probe.id) continue
        if (row.trace.rootInquiryId === probe.trace.rootInquiryId) rootInquiryCount += 1
        if (row.target.sessionId === probe.target.sessionId) pendingCount += 1
      }
      const record = createInquiry(request, { ...supplied, parent, rootInquiryCount, pendingCount })
      rows.set(record.id, record)
      return record
    },
  }
}

const delivery = { kind: 'feishu-delivery', deliveryId: 'delivery-1' } as const
const chat = { kind: 'feishu-chat', chatId: 'oc-example' } as const

function fixture(rows: LocusRecord[] = [locus('a', 'child-a'), locus('b', 'child-b')]) {
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
  const store = memoryStore()
  const origin = vi.fn((_sessionId: string) => ({
    origin: { kind: 'local' as const },
    audience: { kind: 'local-session' as const, sessionId: _sessionId },
  }))
  let seq = 0
  const deps = {
    ports, store, origin,
    now: () => t0,
    newInquiryId: () => `inquiry-${String(++seq)}`,
  }
  return { ports, archived, identities, store, origin, deps }
}

const ask = (id: unknown, args: unknown, f: ReturnType<typeof fixture>) =>
  acceptInquiryFromCaller({ agent: { id } }, args, f.deps)

const request = (target: string, over: Record<string, unknown> = {}) => ({
  target,
  question: 'Which response shape did you settle on for the status endpoint?',
  purpose: 'Answer a request about the API contract',
  ...over,
})

const childKey = (locusId: string, generation: number, sessionId: string) =>
  `child:${locusId}:${String(generation)}:${sessionId}`

describe('caller-bound inquiry accept', () => {
  it('lets a main session ask its own current child, persisting before it returns', async () => {
    const f = fixture()
    const result = await ask('main', request(childKey('b', 1, 'child-b')), f)
    // Persistence is not merely attempted: the durable row exists already.
    expect(f.store.rows.size).toBe(1)
    expect(result).toMatchObject({
      status: 'accepted', answered: false, inquiryId: 'inquiry-1',
      acceptedAt: t0,
    })
    const stored = f.store.rows.get('inquiry-1')!
    expect(stored.status).toBe('queued')
    expect(stored.requester).toEqual({ kind: 'main', sessionId: 'main' })
    expect(stored.target).toEqual({ kind: 'child', sessionId: 'child-b', locusId: 'b', generation: 1 })
    expect(stored.circleParentSessionId).toBe('main')
  })

  it('lets a child ask its own fixed main session', async () => {
    const f = fixture()
    const result = await ask('child-a', request('main:main'), f)
    expect(result.status).toBe('accepted')
    const stored = f.store.rows.get(result.inquiryId)!
    expect(stored.requester).toEqual({ kind: 'child', sessionId: 'child-a', locusId: 'a', generation: 1 })
    expect(stored.target).toEqual({ kind: 'main', sessionId: 'main' })
  })

  it('lets a sibling ask a sibling directly, without the parent relaying', async () => {
    const f = fixture()
    const result = await ask('child-a', request(childKey('b', 1, 'child-b')), f)
    const stored = f.store.rows.get(result.inquiryId)!
    expect(stored.requester.sessionId).toBe('child-a')
    expect(stored.target.sessionId).toBe('child-b')
    // The parent is the circle, not a hop on the chain.
    expect(stored.trace.visited.map(m => m.sessionId)).toEqual(['child-a', 'child-b'])
  })

  it('refuses a self-target from a child and from a main session alike', async () => {
    const f = fixture()
    await expect(ask('child-a', request(childKey('a', 1, 'child-a')), f)).rejects.toBeInstanceOf(InquiryRefusedError)
    await expect(ask('main', request('main:main'), f)).rejects.toBeInstanceOf(InquiryRefusedError)
    expect(f.store.calls).toEqual([])
  })

  it('refuses an out-of-scope target with the same error, disclosing nothing about it', async () => {
    const f = fixture()
    const foreign = ask('child-a', request(childKey('z', 1, 'child-z')), f)
    const absent = ask('child-a', request(childKey('q', 7, 'not-a-session')), f)
    const foreignError = await foreign.catch((error: unknown) => error)
    const absentError = await absent.catch((error: unknown) => error)
    expect(foreignError).toBeInstanceOf(InquiryRefusedError)
    // Existing-but-foreign and simply-absent are indistinguishable.
    expect((foreignError as Error).message).toBe((absentError as Error).message)
    expect(JSON.stringify((foreignError as Error).message)).not.toMatch(/child-z|not-a-session/)
    expect(f.store.calls).toEqual([])
  })

  it('refuses a retired member and a stale generation reference without redirecting', async () => {
    const f = fixture([
      locus('a', 'child-a'),
      locus('c', 'child-c', { state: 'retired' }),
      locus('b', 'child-b2', { generation: 2 }),
    ])
    await expect(ask('child-a', request(childKey('c', 1, 'child-c')), f)).rejects.toBeInstanceOf(InquiryRefusedError)
    // The old generation reference must not be forwarded to the new child.
    await expect(ask('child-a', request(childKey('b', 1, 'child-b')), f)).rejects.toBeInstanceOf(InquiryRefusedError)
    expect(f.store.calls).toEqual([])
    // The current generation is still addressable, so this is a refusal and not an outage.
    await expect(ask('child-a', request(childKey('b', 2, 'child-b2')), f)).resolves.toMatchObject({ status: 'accepted' })
  })

  it('refuses a stale generation even when the rebuilt member kept the same session id', async () => {
    // Isolates the generation check: session id and locus id both still match,
    // so nothing but the generation can distinguish the retired incarnation.
    const f = fixture([locus('a', 'child-a'), locus('b', 'child-b', { generation: 2 })])
    await expect(ask('child-a', request(childKey('b', 1, 'child-b')), f)).rejects.toBeInstanceOf(InquiryRefusedError)
    expect(f.store.calls).toEqual([])
    await expect(ask('child-a', request(childKey('b', 2, 'child-b')), f)).resolves.toMatchObject({ status: 'accepted' })
    expect(f.store.rows.get('inquiry-1')!.target).toMatchObject({ generation: 2 })
  })

  it('refuses a reference that names a real member with a fabricated locus or session id', async () => {
    const f = fixture()
    for (const forged of [
      childKey('a', 1, 'child-b'), // real locus, wrong session
      childKey('b', 1, 'child-a'), // real session, wrong locus
      'main:child-b', // a child dressed up as the circle parent
      'child:b:1:child-b:extra',
      'child:b:1',
      // A seat without a generation must not be addressable: accepting it is
      // exactly how a stale reference would reach a rebuilt successor.
      'child:b',
      'child-b',
      '',
    ]) {
      await expect(ask('child-a', request(forged), f)).rejects.toBeInstanceOf(InquiryRefusedError)
    }
    expect(f.store.calls).toEqual([])
  })

  it('rejects any model-supplied parent, requester, audience, origin or delivery field', async () => {
    const f = fixture()
    const target = childKey('b', 1, 'child-b')
    for (const extra of [
      { circleParentSessionId: 'other-main' },
      { parentSessionId: 'other-main' },
      { requester: { kind: 'main', sessionId: 'other-main' } },
      { audience: { kind: 'feishu-chat', chatId: 'oc-elsewhere' } },
      { origin: { kind: 'local' } },
      { declaredOrigin: { kind: 'local' } },
      { deliveryId: 'delivery-9' },
      { inquiryId: 'inquiry-chosen' },
    ]) {
      await expect(ask('child-a', request(target, extra), f)).rejects.toBeInstanceOf(InquiryRefusedError)
    }
    expect(f.store.calls).toEqual([])
  })

  it('records the Host-proven Feishu origin and audience, which no argument can relabel', async () => {
    const f = fixture()
    f.origin.mockReturnValue({ origin: delivery, audience: chat } as never)
    const result = await ask('child-a', request(childKey('b', 1, 'child-b')), f)
    const stored = f.store.rows.get(result.inquiryId)!
    expect(stored.origin).toEqual(delivery)
    expect(stored.audience).toEqual(chat)
    // The prover is consulted with the ACTUAL executing session, nothing else.
    expect(f.origin).toHaveBeenCalledWith('child-a')
    // The model never gets to declare an origin at all.
    expect((f.store.calls[0]!.request as { declaredOrigin: unknown }).declaredOrigin).toBeNull()
  })

  it('fails closed when the origin cannot be proven, rather than guessing local', async () => {
    const missing = fixture()
    missing.origin.mockReturnValue(undefined as never)
    await expect(ask('child-a', request(childKey('b', 1, 'child-b')), missing)).rejects.toBeInstanceOf(InquiryRefusedError)
    const throwing = fixture()
    throwing.origin.mockImplementation(() => { throw new Error('unprovable') })
    await expect(ask('child-a', request(childKey('b', 1, 'child-b')), throwing)).rejects.toBeInstanceOf(InquiryRefusedError)
    // A Feishu origin paired with a private local audience is a contradiction.
    const widened = fixture()
    widened.origin.mockReturnValue({ origin: delivery, audience: { kind: 'local-session', sessionId: 'child-a' } } as never)
    await expect(ask('child-a', request(childKey('b', 1, 'child-b')), widened)).rejects.toBeInstanceOf(InquiryRefusedError)
    expect(missing.store.calls).toEqual([])
    expect(throwing.store.calls).toEqual([])
  })

  it('never reports success when the durable write failed', async () => {
    const f = fixture()
    f.store.failWith(new Error('medium unavailable'))
    await expect(ask('child-a', request(childKey('b', 1, 'child-b')), f)).rejects.toBeInstanceOf(InquiryRefusedError)
    expect(f.store.rows.size).toBe(0)
  })

  it('surfaces an exhausted budget as a stable actionable code, not as a scope denial', async () => {
    const f = fixture()
    const target = childKey('b', 1, 'child-b')
    for (let i = 0; i < INQUIRY_LIMITS.maxPendingPerSession; i++) {
      await ask('child-a', request(target), f)
    }
    const error = await ask('child-a', request(target), f).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(InquiryLimitError)
    expect((error as InquiryLimitError).code).toBe('PENDING_BUDGET_EXCEEDED')
  })

  it('refuses an unprovable caller and any malformed question or purpose', async () => {
    const f = fixture()
    const target = childKey('b', 1, 'child-b')
    await expect(ask(undefined, request(target), f)).rejects.toBeInstanceOf(InquiryRefusedError)
    await expect(ask('stranger', request(target), f)).rejects.toBeInstanceOf(InquiryRefusedError)
    await expect(ask('child-a', { target, question: '  ', purpose: 'p' }, f)).rejects.toBeInstanceOf(InquiryRefusedError)
    await expect(ask('child-a', { target, question: 'q', purpose: '' }, f)).rejects.toBeInstanceOf(InquiryRefusedError)
    await expect(ask('child-a', { target, question: 'x'.repeat(INQUIRY_LIMITS.questionLength + 1), purpose: 'p' }, f))
      .rejects.toBeInstanceOf(InquiryRefusedError)
    await expect(ask('child-a', { target: 42, question: 'q', purpose: 'p' }, f)).rejects.toBeInstanceOf(InquiryRefusedError)
    expect(f.store.calls).toEqual([])
  })

  it('means accepted and not answered, and carries no answer or delivery field', async () => {
    const f = fixture()
    const result = await ask('main', request(childKey('a', 1, 'child-a')), f)
    expect(result.answered).toBe(false)
    expect(Object.keys(result).sort()).toEqual(
      ['acceptedAt', 'answered', 'inquiryId', 'note', 'status', 'target'].sort(),
    )
    expect(result.note.toLowerCase()).toContain('not an answer')
    expect(JSON.stringify(result)).not.toMatch(/chatId|deliveryId|messageId/)
  })

  it('never reaches for a reply, delivery or public-record seam', async () => {
    const f = fixture()
    const forbidden = ['reply', 'delivery', 'deliveries', 'outbound', 'feishu', 'publicContext', 'contextStore', 'client']
    const guarded = new Proxy(f.deps, {
      get(target, key) {
        if (typeof key === 'string' && forbidden.includes(key)) throw new Error(`forbidden seam: ${key}`)
        return Reflect.get(target, key) as unknown
      },
    })
    await expect(acceptInquiryFromCaller(
      { agent: { id: 'child-a' } },
      request(childKey('b', 1, 'child-b')),
      guarded,
    )).resolves.toMatchObject({ status: 'accepted' })
  })
})
