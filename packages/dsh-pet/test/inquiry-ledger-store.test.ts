/**
 * Durable inquiry-ledger store tests.
 *
 * Split exactly like the public-context store: the default suite proves the
 * store refuses to write on a medium without atomic transactions, and the
 * behavioural suite runs only under the opt-in reviewed runtime config, where
 * `Domain.transaction` actually exists and commits as one batch.
 */
import { describe, expect, it } from 'vitest'
import { InquiryLedgerStore } from '../src/host/inquiry/ledger-store.js'
import { INQUIRY_LIMITS as limits, parseInquiry } from '../src/host/inquiry/ledger.js'
import { emptyMedium, openPetHarness } from './harness.js'

const atomic = process.env.DSH_PET_TEST_ATOMIC_DOMAIN === '1'

const circle = 'session-main'
const main = { kind: 'main', sessionId: circle } as const
const childA = { kind: 'child', sessionId: 'session-a', locusId: 'locus-a', generation: 2 } as const
const childB = { kind: 'child', sessionId: 'session-b', locusId: 'locus-b', generation: 1 } as const
const childC = { kind: 'child', sessionId: 'session-c', locusId: 'locus-c', generation: 1 } as const
const other = (n: number) =>
  ({ kind: 'child', sessionId: `session-x${n}`, locusId: `locus-x${n}`, generation: 1 }) as const
const t0 = 1_800_000_000_000
const delivery = { kind: 'feishu-delivery', deliveryId: 'delivery-1' } as const
const chat = { kind: 'feishu-chat', chatId: 'oc-example' } as const

const request = (over: Record<string, unknown> = {}) => ({
  target: childB,
  question: 'Which response shape did you settle on for the status endpoint?',
  purpose: 'Answer a Feishu request about the API contract',
  declaredOrigin: delivery,
  ...over,
})
const facts = (over: Record<string, unknown> = {}) => ({
  inquiryId: 'inquiry-1',
  requester: childA,
  circleParentSessionId: circle,
  origin: delivery,
  audience: chat,
  createdAt: t0,
  ...over,
})
const event = (type: string, over: Record<string, unknown> = {}) => ({
  type,
  eventId: `event-${type}`,
  at: t0 + 1_000,
  reason: ['reject', 'unavailable', 'cancel', 'needs-review'].includes(type)
    ? 'host-observed-fact'
    : null,
  ...over,
})

describe('inquiry ledger store capability boundary', () => {
  it('refuses every mutation without actual atomic Domain support; reads never create rows', async () => {
    const h = await openPetHarness(emptyMedium(), { noTransaction: true })
    try {
      const store = new InquiryLedgerStore(h.domain)
      expect(store.get('inquiry-1')).toBeUndefined()
      expect(store.listPending('session-b')).toEqual([])
      expect(store.restartDisposition()).toEqual({ recoverable: [], needsReview: [] })
      await expect(store.accept(request(), facts())).rejects.toMatchObject({ code: 'TRANSACTION_UNAVAILABLE' })
      // A missing record is reported before any transaction is attempted, so
      // the two failures cannot be confused with each other.
      await expect(store.applyEvent('inquiry-1', event('dispatch'))).rejects.toMatchObject({ code: 'INQUIRY_NOT_FOUND' })
      await expect(store.recordDiagnostic('inquiry-1', { kind: 'late-answer', at: t0, eventId: 'e' }))
        .rejects.toMatchObject({ code: 'INQUIRY_NOT_FOUND' })
      expect(h.domain.table('inquiries').size).toBe(0)
      expect(h.medium.tables.inquiries).toBeUndefined()
    } finally { await h.close() }
  })
})

describe.skipIf(!atomic)('inquiry ledger store with real reviewed atomic Domain (opt-in config)', () => {
  it('accepts a queued record, keeps it recoverable across a long restart and is idempotent per id', async () => {
    const medium = emptyMedium()
    const h = await openPetHarness(medium)
    let accepted
    try {
      const store = new InquiryLedgerStore(h.domain)
      accepted = await store.accept(request(), facts())
      expect(accepted).toMatchObject({
        id: 'inquiry-1', status: 'queued', statusAt: t0, reason: null,
        createdAt: t0,
        appliedEventIds: [], diagnostics: [], droppedDiagnostics: 0,
      })
      expect(accepted.trace).toEqual({ rootInquiryId: 'inquiry-1', depth: 1, visited: [childA, childB] })
      // A redelivered accept of the same proven facts is a no-op, not a second row.
      expect(await store.accept(request(), facts())).toEqual(accepted)
      expect(h.domain.table('inquiries').size).toBe(1)
      expect(store.listPending('session-b')).toEqual([accepted])
      expect(store.listPending('session-a')).toEqual([])
    } finally { await h.close() }

    // Restart: no wall-clock deadline is recomputed or enforced.
    const reopened = await openPetHarness(medium)
    try {
      const store = new InquiryLedgerStore(reopened.domain)
      expect(store.get('inquiry-1')).toEqual(accepted)
      expect(store.get('inquiry-1')).not.toHaveProperty('deadlineAt')
      expect(store.restartDisposition()).toEqual({ recoverable: [accepted], needsReview: [] })
      const longAfterRestart = await store.applyEvent('inquiry-1', event('dispatch', { at: t0 + 30 * 24 * 60 * 60 * 1_000 }))
      expect(longAfterRestart.status).toBe('executing')
    } finally { await reopened.close() }
  })

  it('refuses a different inquiry under an existing id and leaves the stored record untouched', async () => {
    const h = await openPetHarness()
    try {
      const store = new InquiryLedgerStore(h.domain)
      const first = await store.accept(request(), facts())
      await expect(store.accept(request({ question: 'A different question entirely' }), facts()))
        .rejects.toMatchObject({ code: 'INQUIRY_EXISTS' })
      await expect(store.accept(request(), facts({ requester: childC })))
        .rejects.toMatchObject({ code: 'INQUIRY_EXISTS' })
      expect(store.get('inquiry-1')).toEqual(first)
      expect(h.domain.table('inquiries').size).toBe(1)
    } finally { await h.close() }
  })

  it('derives a nested chain from the DURABLE ancestor, so a caller cannot mint a fresh root', async () => {
    const h = await openPetHarness()
    try {
      const store = new InquiryLedgerStore(h.domain)
      const nested = (over: Record<string, unknown> = {}) => [
        request({ target: childC, declaredOrigin: null }),
        facts({ inquiryId: 'inquiry-2', requester: childB, createdAt: t0 + 2_000,
          origin: { kind: 'inquiry', parentInquiryId: 'inquiry-1' }, audience: chat, ...over }),
      ] as const
      // No ancestor row at all: the pure chain rule refuses; nothing is written.
      await expect(store.accept(...nested())).rejects.toMatchObject({ code: 'CHAIN_MISMATCH' })
      await store.accept(request(), facts())
      // A queued ancestor is not an edge anyone stands on yet.
      await expect(store.accept(...nested())).rejects.toMatchObject({ code: 'CHAIN_MISMATCH' })
      await store.applyEvent('inquiry-1', event('dispatch'))

      const child = await store.accept(...nested())
      expect(child.trace).toEqual({ rootInquiryId: 'inquiry-1', depth: 2, visited: [childA, childB, childC] })
      expect(child).not.toHaveProperty('deadlineAt')
      // Re-asking a seat already on this chain is a loop, whatever id is used.
      await expect(store.accept(
        request({ target: childA, declaredOrigin: null }),
        facts({ inquiryId: 'inquiry-3', requester: childC, createdAt: t0 + 3_000,
          origin: { kind: 'inquiry', parentInquiryId: 'inquiry-2' } }),
      )).rejects.toMatchObject({ code: 'CHAIN_MISMATCH' })
      await store.applyEvent('inquiry-2', event('dispatch', { at: t0 + 2_500 }))
      await expect(store.accept(
        request({ target: childA, declaredOrigin: null }),
        facts({ inquiryId: 'inquiry-3', requester: childC, createdAt: t0 + 3_000,
          origin: { kind: 'inquiry', parentInquiryId: 'inquiry-2' } }),
      )).rejects.toMatchObject({ code: 'TARGET_ALREADY_VISITED' })
      // Depth is inherited from the durable ancestor, not from the caller.
      await store.accept(
        request({ target: main, declaredOrigin: null }),
        facts({ inquiryId: 'inquiry-3', requester: childC, createdAt: t0 + 3_000,
          origin: { kind: 'inquiry', parentInquiryId: 'inquiry-2' } }),
      )
      await store.applyEvent('inquiry-3', event('dispatch', { at: t0 + 3_500 }))
      await expect(store.accept(
        request({ target: other(9), declaredOrigin: null }),
        facts({ inquiryId: 'inquiry-4', requester: main, createdAt: t0 + 4_000,
          origin: { kind: 'inquiry', parentInquiryId: 'inquiry-3' } }),
      )).rejects.toMatchObject({ code: 'CHAIN_DEPTH_EXCEEDED' })
      expect(h.domain.table('inquiries').size).toBe(3)
    } finally { await h.close() }
  })

  it('counts per-root volume from durable state and refuses the ceiling-crossing accept', async () => {
    const h = await openPetHarness()
    try {
      const store = new InquiryLedgerStore(h.domain)
      await store.accept(request(), facts())
      await store.applyEvent('inquiry-1', event('dispatch'))
      const branch = (n: number) => store.accept(
        request({ target: other(n), declaredOrigin: null }),
        facts({ inquiryId: `branch-${n}`, requester: childA, createdAt: t0 + 2_000,
          origin: { kind: 'inquiry', parentInquiryId: 'inquiry-1' } }),
      )
      for (let n = 1; n < limits.maxInquiriesPerRoot; n += 1) await branch(n)
      expect(h.domain.table('inquiries').size).toBe(limits.maxInquiriesPerRoot)
      await expect(branch(limits.maxInquiriesPerRoot)).rejects.toMatchObject({ code: 'ROOT_BUDGET_EXCEEDED' })
      expect(h.domain.table('inquiries').size).toBe(limits.maxInquiriesPerRoot)
    } finally { await h.close() }
  })

  it('lets exactly one of two concurrent accepts take the last per-session pending slot', async () => {
    const h = await openPetHarness()
    try {
      const a = new InquiryLedgerStore(h.domain)
      const b = new InquiryLedgerStore(h.domain)
      for (let n = 1; n < limits.maxPendingPerSession; n += 1) {
        await a.accept(request(), facts({ inquiryId: `root-${n}` }))
      }
      const results = await Promise.allSettled([
        a.accept(request(), facts({ inquiryId: 'race-a' })),
        b.accept(request(), facts({ inquiryId: 'race-b' })),
      ])
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
      expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'PENDING_BUDGET_EXCEEDED' } })
      expect(a.listPending('session-b')).toHaveLength(limits.maxPendingPerSession)
      expect(h.domain.table('inquiries').size).toBe(limits.maxPendingPerSession)
      // A settled record frees the slot; the ceiling counts pending, not history.
      const [freed] = a.listPending('session-b')
      await a.applyEvent(freed!.id, event('cancel', { at: t0 + 5_000 }))
      expect(a.listPending('session-b')).toHaveLength(limits.maxPendingPerSession - 1)
      await expect(b.accept(request(), facts({ inquiryId: 'race-c' }))).resolves.toMatchObject({ status: 'queued' })
    } finally { await h.close() }
  })

  it('never double-advances a redelivered event and refuses a reused eventId for another transition', async () => {
    const h = await openPetHarness()
    try {
      const store = new InquiryLedgerStore(h.domain)
      await store.accept(request(), facts())
      const dispatched = await store.applyEvent('inquiry-1', event('dispatch'))
      expect(dispatched).toMatchObject({ status: 'executing', statusAt: t0 + 1_000, appliedEventIds: ['event-dispatch'] })
      // Redelivery with the same id, and with a different id for the same
      // outcome, both leave the first recorded transition exactly as it was.
      expect(await store.applyEvent('inquiry-1', event('dispatch'))).toEqual(dispatched)
      expect(await store.applyEvent('inquiry-1', event('dispatch', { eventId: 'other', at: t0 + 9_000 }))).toEqual(dispatched)
      await expect(store.applyEvent('inquiry-1', event('answer', { eventId: 'event-dispatch', at: t0 + 2_000 })))
        .rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' })
      expect(store.get('inquiry-1')).toEqual(dispatched)

      const answered = await store.applyEvent('inquiry-1', event('answer', { at: t0 + 2_000 }))
      expect(answered.appliedEventIds).toEqual(['event-dispatch', 'event-answer'])
      await store.applyEvent('inquiry-1', event('cancel', { at: t0 + 3_000 }))
      // Nothing leaves a terminal status, so no replay can revive the record.
      await expect(store.applyEvent('inquiry-1', event('deliver-result', { at: t0 + 4_000 })))
        .rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' })
      expect(store.get('inquiry-1')).toMatchObject({ status: 'cancelled', statusAt: t0 + 3_000, reason: 'host-observed-fact' })
      await expect(store.applyEvent('missing', event('dispatch'))).rejects.toMatchObject({ code: 'INQUIRY_NOT_FOUND' })
    } finally { await h.close() }
  })

  it('keeps a late answer after explicit cancellation as an owner diagnostic', async () => {
    const h = await openPetHarness()
    try {
      const store = new InquiryLedgerStore(h.domain)
      await store.accept(request(), facts())
      await store.applyEvent('inquiry-1', event('dispatch'))
      const cancelled = await store.applyEvent('inquiry-1', event('cancel', { at: t0 + 30 * 24 * 60 * 60 * 1_000 }))
      const late = { kind: 'late-answer' as const, at: t0 + 31 * 24 * 60 * 60 * 1_000, eventId: 'answer-late' }
      const noted = await store.recordDiagnostic('inquiry-1', late)
      expect(noted).toMatchObject({ status: cancelled.status, statusAt: cancelled.statusAt, reason: cancelled.reason })
      expect(noted.diagnostics).toEqual([late])
      // A redelivered diagnostic is retained once and writes nothing further.
      expect(await store.recordDiagnostic('inquiry-1', { ...late })).toEqual(noted)
      expect(store.get('inquiry-1')?.diagnostics).toHaveLength(1)
      await expect(store.recordDiagnostic('inquiry-1', { kind: 'unknown-outcome', at: 1, eventId: 'e' }))
        .rejects.toMatchObject({ code: 'INVALID_INQUIRY_INPUT' })
    } finally { await h.close() }
  })

  it('reports undispatched work as recoverable and dispatched-unknown work as needs-review only', async () => {
    const medium = emptyMedium()
    const h = await openPetHarness(medium)
    try {
      const store = new InquiryLedgerStore(h.domain)
      await store.accept(request(), facts())
      await store.accept(request(), facts({ inquiryId: 'inquiry-2' }))
      await store.applyEvent('inquiry-2', event('dispatch'))
      await store.accept(request(), facts({ inquiryId: 'inquiry-3' }))
      await store.applyEvent('inquiry-3', event('dispatch'))
      await store.applyEvent('inquiry-3', event('answer', { at: t0 + 2_000 }))
      await store.accept(request(), facts({ inquiryId: 'inquiry-4' }))
      await store.applyEvent('inquiry-4', event('reject', { at: t0 + 2_000 }))
    } finally { await h.close() }

    const reopened = await openPetHarness(medium)
    try {
      const store = new InquiryLedgerStore(reopened.domain)
      const disposition = store.restartDisposition()
      expect(disposition.recoverable.map(r => r.id)).toEqual(['inquiry-1'])
      expect(disposition.needsReview.map(r => r.id)).toEqual(['inquiry-2', 'inquiry-3'])
      // The store offers no way to put a dispatched record back on the queue:
      // review is an explicit Host event, and it is a dead end.
      await expect(store.applyEvent('inquiry-2', event('needs-review', { at: t0 + 5_000 })))
        .resolves.toMatchObject({ status: 'needs-review', reason: 'host-observed-fact' })
      await expect(store.applyEvent('inquiry-2', event('dispatch', { eventId: 'retry', at: t0 + 6_000 })))
        .rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' })
      expect(store.restartDisposition().recoverable.map(r => r.id)).toEqual(['inquiry-1'])
      expect(store.listPending('session-b').map(r => r.id)).toEqual(['inquiry-1', 'inquiry-3'])
    } finally { await reopened.close() }
  })

  it('leaves durable state untouched when the medium rejects the atomic batch', async () => {
    const medium = emptyMedium()
    const faults: { failWrites?: Error } = {}
    const h = await openPetHarness(medium, faults)
    try {
      const store = new InquiryLedgerStore(h.domain)
      const accepted = await store.accept(request(), facts())
      const bytes = JSON.stringify(medium)
      faults.failWrites = new Error('fault')
      await expect(store.applyEvent('inquiry-1', event('dispatch'))).rejects.toThrow('fault')
      await expect(store.accept(request(), facts({ inquiryId: 'inquiry-2' }))).rejects.toThrow('fault')
      expect(JSON.stringify(medium)).toBe(bytes)
      expect(store.get('inquiry-1')).toEqual(accepted)
      expect(store.restartDisposition().recoverable).toEqual([accepted])
    } finally { await h.close() }
  })

  it('validates every stored row through the pure model and stores no answer text', async () => {
    const medium = emptyMedium()
    const h = await openPetHarness(medium)
    let stored
    try {
      const store = new InquiryLedgerStore(h.domain)
      stored = await store.accept(request(), facts())
      expect(Object.keys(stored)).not.toContain('answer')
      // A row filed under the wrong key is corruption, never a second identity.
      await h.domain.table('inquiries').put('inquiry-2', stored)
      expect(() => store.get('inquiry-2')).toThrow(/could not be verified/)
      expect(() => store.listPending('session-b')).toThrow(/could not be verified/)
      await h.domain.table('inquiries').delete('inquiry-2')
      expect(store.get('inquiry-1')).toEqual(stored)
    } finally { await h.close() }

    for (const corrupt of [
      { ...stored, answer: 'the answer body must never live here' },
      { ...stored, deadline: stored.createdAt },
      { ...stored, appliedEventIds: ['dup', 'dup'] },
    ]) {
      const broken = emptyMedium()
      broken.version = (await import('../src/host/spec.js')).PET_DOMAIN_VERSION
      broken.tables.inquiries = { 'inquiry-1': JSON.stringify(corrupt) }
      await expect(openPetHarness(broken)).rejects.toThrow()
    }

    // Exact v12 rows remain readable as historical evidence. The old deadline
    // is validated and stripped in memory; no migration test may erase it.
    const legacy = { ...stored,
      deadlineAt: stored.createdAt + 300_000,
      status: 'expired' as const,
      statusAt: stored.createdAt + 300_000,
      reason: 'legacy-deadline-reached',
      appliedEventIds: ['legacy-expire'],
    }
    const parsedLegacy = parseInquiry(legacy)
    expect(parsedLegacy).toMatchObject({ status: 'expired' })
    expect(parsedLegacy).not.toHaveProperty('deadlineAt')
  })
})
