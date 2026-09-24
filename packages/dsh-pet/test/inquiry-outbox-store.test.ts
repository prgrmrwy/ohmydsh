/**
 * Durable inquiry result-outbox store tests.
 *
 * Split exactly like the ledger store: the default suite proves the store
 * refuses to write on a medium without atomic transactions, and the
 * behavioural suite runs only under the opt-in reviewed runtime config, where
 * `Domain.transaction` actually exists and commits as one batch.
 */
import { describe, expect, it } from 'vitest'
import { INQUIRY_OUTBOX_LIMITS, inquiryResultDedupKey } from '../src/host/inquiry/outbox.js'
import { InquiryOutboxStore } from '../src/host/inquiry/outbox-store.js'
import { emptyMedium, openPetHarness } from './harness.js'

const atomic = process.env.DSH_PET_TEST_ATOMIC_DOMAIN === '1'

const childA = { kind: 'child', sessionId: 'session-a', locusId: 'locus-a', generation: 2 } as const
const main = { kind: 'main', sessionId: 'session-main' } as const
const t0 = 1_800_000_000_000
const delivery = { kind: 'feishu-delivery', deliveryId: 'delivery-1' } as const
const answer = { kind: 'answer', answeredAt: t0 + 2_000 } as const
const failure = { kind: 'failure', failure: 'unavailable', reason: 'target-unavailable', failedAt: t0 + 2_000 } as const

const facts = (over: Record<string, unknown> = {}) => ({
  inquiryId: 'inquiry-1',
  requester: childA,
  resumeWork: delivery,
  result: answer,
  createdAt: t0 + 2_000,
  ...over,
})

const key = inquiryResultDedupKey('inquiry-1', answer)

describe('inquiry outbox store capability boundary', () => {
  it('refuses every mutation without actual atomic Domain support; reads never create rows', async () => {
    const h = await openPetHarness(emptyMedium(), { noTransaction: true })
    try {
      const store = new InquiryOutboxStore(h.domain)
      expect(store.get(key)).toBeUndefined()
      expect(store.findByInquiry('inquiry-1')).toBeUndefined()
      expect(store.listPending('session-a')).toEqual([])
      expect(store.restartDisposition()).toEqual({ recoverable: [], needsReview: [] })
      await expect(store.queue(facts())).rejects.toMatchObject({ code: 'TRANSACTION_UNAVAILABLE' })
      // A missing record is reported before any transaction is attempted, so
      // the two failures cannot be confused with each other.
      await expect(store.markDelivered(key, { eventId: 'e', at: t0 + 3_000, segmentId: 'seg-1' }))
        .rejects.toMatchObject({ code: 'RESULT_NOT_FOUND' })
      await expect(store.refuse(key, { eventId: 'e', at: t0 + 3_000, code: 'work-settled' }))
        .rejects.toMatchObject({ code: 'RESULT_NOT_FOUND' })
      await expect(store.noteDiagnostic(key, { code: 'late-result', at: t0 + 3_000, eventId: 'e' }))
        .rejects.toMatchObject({ code: 'RESULT_NOT_FOUND' })
      expect(h.domain.table('inquiry_results').size).toBe(0)
      expect(h.medium.tables.inquiry_results).toBeUndefined()
    } finally { await h.close() }
  })
})

describe.skipIf(!atomic)('inquiry outbox store with real reviewed atomic Domain (opt-in config)', () => {
  it('queues one pending result, survives a restart and is idempotent per dedup key', async () => {
    const medium = emptyMedium()
    const h = await openPetHarness(medium)
    let queued
    try {
      const store = new InquiryOutboxStore(h.domain)
      queued = await store.queue(facts())
      expect(queued).toMatchObject({
        inquiryId: 'inquiry-1', requester: childA, resumeWork: delivery,
        status: 'pending', createdAt: t0 + 2_000, statusAt: t0 + 2_000,
        deliveredSegmentId: null, dedupKey: key,
      })
      // A redelivered result with the same proven facts is a no-op, not a
      // second row and therefore never a second continuation.
      expect(await store.queue(facts())).toEqual(queued)
      expect(h.domain.table('inquiry_results').size).toBe(1)
      expect(store.listPending('session-a')).toEqual([queued])
      expect(store.listPending('session-main')).toEqual([])
      expect(store.findByInquiry('inquiry-1')).toEqual(queued)
    } finally { await h.close() }

    const reopened = await openPetHarness(medium)
    try {
      const store = new InquiryOutboxStore(reopened.domain)
      expect(store.get(key)).toEqual(queued)
      expect(store.restartDisposition()).toEqual({ recoverable: [queued], needsReview: [] })
    } finally { await reopened.close() }
  })

  it('refuses a different result under an existing key and a second result for the same inquiry', async () => {
    const h = await openPetHarness()
    try {
      const store = new InquiryOutboxStore(h.domain)
      const first = await store.queue(facts())
      await expect(store.queue(facts({ resumeWork: { kind: 'local' } })))
        .rejects.toMatchObject({ code: 'RESULT_EXISTS' })
      await expect(store.queue(facts({ requester: main })))
        .rejects.toMatchObject({ code: 'RESULT_EXISTS' })
      // A late FAILURE for an inquiry that already produced an answer must not
      // become a second deliverable result under a different dedup key.
      await expect(store.queue(facts({ result: failure })))
        .rejects.toMatchObject({ code: 'RESULT_EXISTS' })
      expect(store.get(key)).toEqual(first)
      expect(h.domain.table('inquiry_results').size).toBe(1)
    } finally { await h.close() }
  })

  it('stores a failure result exactly like an answer result', async () => {
    const h = await openPetHarness()
    try {
      const store = new InquiryOutboxStore(h.domain)
      const record = await store.queue(facts({ inquiryId: 'inquiry-2', result: failure }))
      expect(record).toMatchObject({ status: 'pending', result: failure })
      expect(record.dedupKey).toBe(inquiryResultDedupKey('inquiry-2', failure))
      expect(store.listPending('session-a').map(r => r.inquiryId)).toEqual(['inquiry-2'])
    } finally { await h.close() }
  })

  it('marks delivery once and never rebinds a delivered result to a second segment', async () => {
    const h = await openPetHarness()
    try {
      const store = new InquiryOutboxStore(h.domain)
      await store.queue(facts())
      const delivered = await store.markDelivered(key, { eventId: 'ev-1', at: t0 + 3_000, segmentId: 'seg-1' })
      expect(delivered).toMatchObject({ status: 'delivered', deliveredSegmentId: 'seg-1' })
      expect(await store.markDelivered(key, { eventId: 'ev-1', at: t0 + 3_000, segmentId: 'seg-1' })).toEqual(delivered)
      // A redelivered event from another segment cannot start a second continuation.
      expect(await store.markDelivered(key, { eventId: 'ev-2', at: t0 + 9_000, segmentId: 'seg-2' })).toEqual(delivered)
      expect(store.listPending('session-a')).toEqual([])
      expect(store.restartDisposition().recoverable).toEqual([])
      // Nothing leaves a terminal outbox status.
      await expect(store.refuse(key, { eventId: 'ev-3', at: t0 + 10_000, code: 'work-settled' }))
        .rejects.toMatchObject({ code: 'ILLEGAL_OUTBOX_TRANSITION' })
      await expect(store.markDelivered('missing', { eventId: 'e', at: t0, segmentId: 's' }))
        .rejects.toMatchObject({ code: 'RESULT_NOT_FOUND' })
    } finally { await h.close() }
  })

  it('refuses a continuation and retains a late result without waking anyone', async () => {
    const h = await openPetHarness()
    try {
      const store = new InquiryOutboxStore(h.domain)
      await store.queue(facts())
      await store.queue(facts({ inquiryId: 'inquiry-2' }))
      const refused = await store.refuse(key, { eventId: 'ev-r', at: t0 + 3_000, code: 'requester-rebuilt' })
      expect(refused).toMatchObject({ status: 'refused', deliveredSegmentId: null })
      expect(refused.diagnostics).toEqual([{ code: 'requester-rebuilt', at: t0 + 3_000, eventId: 'ev-r' }])

      const second = inquiryResultDedupKey('inquiry-2', answer)
      const retained = await store.retain(second, { eventId: 'ev-t', at: t0 + 3_000, code: 'work-settled' })
      expect(retained).toMatchObject({ status: 'retained', deliveredSegmentId: null })
      // A late result is diagnostics only: it never becomes deliverable again.
      const noted = await store.noteDiagnostic(second, { code: 'late-result', at: t0 + 4_000, eventId: 'ev-late' })
      expect(noted).toMatchObject({ status: 'retained', statusAt: retained.statusAt })
      expect(noted.diagnostics).toHaveLength(2)
      expect(await store.noteDiagnostic(second, { code: 'late-result', at: t0 + 4_000, eventId: 'ev-late' })).toEqual(noted)
      expect(store.listPending('session-a')).toEqual([])
      expect(store.restartDisposition()).toEqual({ recoverable: [], needsReview: [] })
      await expect(store.noteDiagnostic(second, { code: 'not-a-code', at: 1, eventId: 'e' }))
        .rejects.toMatchObject({ code: 'INVALID_OUTBOX_INPUT' })
    } finally { await h.close() }
  })

  it('reports undelivered results as recoverable and unknown-outcome results as needs-review only', async () => {
    const medium = emptyMedium()
    const h = await openPetHarness(medium)
    try {
      const store = new InquiryOutboxStore(h.domain)
      await store.queue(facts())
      await store.queue(facts({ inquiryId: 'inquiry-2' }))
      await store.queue(facts({ inquiryId: 'inquiry-3' }))
      await store.markDelivered(inquiryResultDedupKey('inquiry-3', answer), {
        eventId: 'ev-3', at: t0 + 3_000, segmentId: 'seg-3',
      })
      // The Host could not prove what happened to the continuation segment.
      await store.noteDiagnostic(inquiryResultDedupKey('inquiry-2', answer), {
        code: 'delivery-outcome-unknown', at: t0 + 3_000, eventId: 'ev-unknown',
      })
    } finally { await h.close() }

    const reopened = await openPetHarness(medium)
    try {
      const store = new InquiryOutboxStore(reopened.domain)
      const disposition = store.restartDisposition()
      expect(disposition.recoverable.map(r => r.inquiryId)).toEqual(['inquiry-1'])
      expect(disposition.needsReview.map(r => r.inquiryId)).toEqual(['inquiry-2'])
      // A needs-review row is never silently re-delivered by this store; the
      // Host has to settle it explicitly.
      expect(store.listPending('session-a').map(r => r.inquiryId)).toEqual(['inquiry-1'])
    } finally { await reopened.close() }
  })

  it('leaves durable state untouched when the medium rejects the atomic batch', async () => {
    const medium = emptyMedium()
    const faults: { failWrites?: Error } = {}
    const h = await openPetHarness(medium, faults)
    try {
      const store = new InquiryOutboxStore(h.domain)
      const queued = await store.queue(facts())
      const bytes = JSON.stringify(medium)
      faults.failWrites = new Error('fault')
      await expect(store.markDelivered(key, { eventId: 'e', at: t0 + 3_000, segmentId: 's' })).rejects.toThrow('fault')
      await expect(store.queue(facts({ inquiryId: 'inquiry-2' }))).rejects.toThrow('fault')
      expect(JSON.stringify(medium)).toBe(bytes)
      expect(store.get(key)).toEqual(queued)
      expect(store.restartDisposition().recoverable).toEqual([queued])
    } finally { await h.close() }
  })

  it('validates every stored row through the pure parser and stores no answer or chat content', async () => {
    const medium = emptyMedium()
    const h = await openPetHarness(medium)
    let stored
    try {
      const store = new InquiryOutboxStore(h.domain)
      stored = await store.queue(facts())
      for (const forbidden of ['answer', 'answeredBy', 'chatId', 'messageId', 'text']) {
        expect(Object.keys(stored)).not.toContain(forbidden)
      }
      // A row filed under the wrong key is corruption, never a second identity.
      await h.domain.table('inquiry_results').put('elsewhere', stored)
      expect(() => store.get('elsewhere')).toThrow(/could not be verified/)
      expect(() => store.listPending('session-a')).toThrow(/could not be verified/)
      await h.domain.table('inquiry_results').delete('elsewhere')
      expect(store.get(key)).toEqual(stored)
    } finally { await h.close() }

    for (const corrupt of [
      { ...stored, answer: 'the answer body must never live here' },
      { ...stored, status: 'sent' },
      { ...stored, deliveredSegmentId: 'seg-1' },
      { ...stored, statusAt: stored.createdAt - 1 },
      { ...stored, appliedEventIds: ['dup', 'dup'] },
      { ...stored, diagnostics: Array.from({ length: INQUIRY_OUTBOX_LIMITS.diagnostics + 1 }, (_, n) =>
        ({ code: 'late-result', at: t0, eventId: `d-${n}` })) },
    ]) {
      const broken = emptyMedium()
      broken.version = (await import('../src/host/spec.js')).PET_DOMAIN_VERSION
      broken.tables.inquiry_results = { [key]: JSON.stringify(corrupt) }
      await expect(openPetHarness(broken)).rejects.toThrow()
    }
  })
})
