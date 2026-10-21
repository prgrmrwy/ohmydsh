/**
 * Restart reconciliation of protocol (handoff-bearing) inquiries, design D6. Startup recovery only
 * re-triggers provably undelivered work (queued / pending answer results); an inquiry claimed
 * before the restart has an unprovable outcome, so reconciliation must settle it needs-review and
 * hand the requester a correlatable failure rather than leave it waiting forever.
 */
import { describe, expect, it } from 'vitest'
import { reconcileInquiriesAtStartup } from '../src/host/inquiry/reconcile.js'
import { applyInquiryEvent, createInquiry, isTerminalInquiryStatus, type InquiryRecord } from '../src/host/inquiry/ledger.js'
import { createInquiryResult, parseInquiryOutboxRecord, type InquiryOutboxRecord } from '../src/host/inquiry/outbox.js'

const t0 = 1_800_000_000_000
const childA = { kind: 'child', sessionId: 'session-a', locusId: 'locus-a', generation: 2 } as const
const childB = { kind: 'child', sessionId: 'session-b', locusId: 'locus-b', generation: 1 } as const
const delivery = { kind: 'feishu-delivery', deliveryId: 'delivery-1' } as const
const base = (id: string): InquiryRecord => createInquiry(
  { target: childB, question: 'Q?', purpose: 'P', declaredOrigin: delivery },
  { inquiryId: id, requester: childA, circleParentSessionId: 'session-main', origin: delivery,
    audience: { kind: 'feishu-chat', chatId: 'oc-example' }, createdAt: t0, parent: null, rootInquiryCount: 0, pendingCount: 0 })
const executing = (id: string) => applyInquiryEvent(base(id), { type: 'dispatch', eventId: `seed-${id}`, at: t0 + 1000, reason: null })

function stores(records: InquiryRecord[]) {
  const rows = new Map(records.map(r => [r.id, r]))
  const results = new Map<string, InquiryOutboxRecord>()
  const ledger = {
    restartDisposition: () => ({
      recoverable: [...rows.values()].filter(r => r.status === 'queued'),
      needsReview: [...rows.values()].filter(r => r.status !== 'queued' && !isTerminalInquiryStatus(r.status)),
    }),
    applyEvent: async (id: string, e: unknown) => { const n = applyInquiryEvent(rows.get(id)!, e); rows.set(id, n); return n },
  }
  const outbox = {
    restartDisposition: () => ({ recoverable: [], needsReview: [] }),
    findByInquiry: (id: string) => [...results.values()].find(r => r.inquiryId === id),
    queue: async (facts: unknown) => { const c = parseInquiryOutboxRecord(createInquiryResult(facts)); results.set(c.dedupKey, c); return c },
  }
  return { rows, results, ledger, outbox }
}

describe('restart reconciliation of protocol inquiries', () => {
  it('settles a claimed (executing) inquiry as needs-review and gives the requester a failure result', async () => {
    const s = stores([executing('claimed')])
    const report = await reconcileInquiriesAtStartup({ ledger: s.ledger, outbox: s.outbox, now: () => t0 + 5000 })
    expect(s.rows.get('claimed')!.status).toBe('needs-review')
    expect([...s.results.values()].map(r => r.result.kind)).toEqual(['failure'])
    expect(report.inquiries).toMatchObject({ needsReview: 1 })
  })

  it('leaves an answered inquiry with a pending answer result to the normal hand-back path', async () => {
    const answered = applyInquiryEvent(executing('answered'), { type: 'answer', eventId: 'ans', at: t0 + 2000, reason: null })
    const s = stores([answered])
    await s.outbox.queue({ inquiryId: 'answered', requester: childA, resumeWork: delivery,
      result: { kind: 'answer', answeredAt: t0 + 2000 }, createdAt: t0 + 2000 })
    const report = await reconcileInquiriesAtStartup({ ledger: s.ledger, outbox: s.outbox, now: () => t0 + 5000 })
    expect(s.rows.get('answered')!.status).toBe('answered')
    expect([...s.results.values()].map(r => r.result.kind)).toEqual(['answer'])
    expect(report.inquiries).toMatchObject({ needsReview: 0, correlated: 1 })
  })

  it('leaves a queued inquiry untouched for startup recovery to dispatch', async () => {
    const s = stores([base('queued')])
    const report = await reconcileInquiriesAtStartup({ ledger: s.ledger, outbox: s.outbox, now: () => t0 + 5000 })
    expect(s.rows.get('queued')!.status).toBe('queued')
    expect(s.results.size).toBe(0)
    expect(report.inquiries).toMatchObject({ recoverable: 1, needsReview: 0 })
  })
})
