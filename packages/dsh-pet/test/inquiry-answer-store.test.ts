import { describe, expect, it } from 'vitest'
import { InquiryLedgerStore } from '../src/host/inquiry/ledger-store.js'
import { InquiryAnswerStore } from '../src/host/inquiry/answer-store.js'
import { emptyMedium, openPetHarness } from './harness.js'

const t0 = 1_800_000_000_000
const main = { kind: 'main', sessionId: 'session-main' } as const
const target = { kind: 'child', sessionId: 'session-b', locusId: 'locus-b', generation: 1 } as const
const requester = { kind: 'child', sessionId: 'session-a', locusId: 'locus-a', generation: 1 } as const
const answer = (over: Record<string, unknown> = {}) => ({ inquiryId: 'inquiry-1', answeredBy: target, answer: 'Contract is stable.', confidence: 'confirmed', recency: 'current', sources: ['recorded work'], answeredAt: t0 + 2_000, ...over })
async function seeded(h: Awaited<ReturnType<typeof openPetHarness>>, inquiryId = 'inquiry-1') {
  const ledger = new InquiryLedgerStore(h.domain)
  await ledger.accept({ target, question: 'What is stable?', purpose: 'Answer contract question', declaredOrigin: null }, {
    inquiryId, requester, circleParentSessionId: 'session-main', origin: { kind: 'local' }, audience: { kind: 'local-session', sessionId: 'session-main' }, createdAt: t0, parent: null, rootInquiryCount: 0, pendingCount: 0,
  })
  await ledger.applyEvent(inquiryId, { type: 'dispatch', eventId: `dispatch-${inquiryId}`, at: t0 + 1_000, reason: null })
}

describe('durable inquiry answer store', () => {
  it('requires an atomic domain and reports missing inquiry', async () => {
    const h = await openPetHarness(emptyMedium(), { noTransaction: true })
    try {
      const store = new InquiryAnswerStore(h.domain)
      await expect(store.commit(answer() as never, 'answer-event')).rejects.toMatchObject({ code: 'TRANSACTION_UNAVAILABLE' })
    } finally { await h.close() }
    const h2 = await openPetHarness()
    try { await expect(new InquiryAnswerStore(h2.domain).commit(answer() as never, 'e')).rejects.toMatchObject({ code: 'INQUIRY_NOT_FOUND' }) }
    finally { await h2.close() }
  })
  it('atomically writes answer, answered ledger and pending result; survives restart', async () => {
    const medium = emptyMedium(), h = await openPetHarness(medium)
    try {
      await seeded(h)
      const store = new InquiryAnswerStore(h.domain)
      expect(await store.commit(answer() as never, 'answer-event')).toEqual(answer())
      expect(h.domain.table('inquiries').get('inquiry-1')).toMatchObject({ status: 'answered' })
      expect(h.domain.table('inquiry_answers').size).toBe(1)
      expect(h.domain.table('inquiry_results').size).toBe(1)
    } finally { await h.close() }
    const reopened = await openPetHarness(medium)
    try { expect(new InquiryAnswerStore(reopened.domain).get('inquiry-1')).toEqual(answer()) }
    finally { await reopened.close() }
  })
  it('rejects queued and wrong-target commits', async () => {
    const h = await openPetHarness()
    try {
      const ledger = new InquiryLedgerStore(h.domain)
      await ledger.accept({ target, question: 'Q', purpose: 'P', declaredOrigin: null }, { inquiryId:'inquiry-1', requester, circleParentSessionId:'session-main', origin:{kind:'local'}, audience:{kind:'local-session',sessionId:'session-main'}, createdAt:t0,parent:null,rootInquiryCount:0,pendingCount:0 })
      const store = new InquiryAnswerStore(h.domain)
      await expect(store.commit(answer() as never,'e')).rejects.toMatchObject({ code:'INQUIRY_CLOSED' })
      await ledger.applyEvent('inquiry-1',{type:'dispatch',eventId:'d',at:t0+1_000,reason:null})
      await expect(store.commit(answer({ answeredBy: main }) as never,'e')).rejects.toMatchObject({ code:'ANSWER_CONFLICT' })
    } finally { await h.close() }
  })
  it('first answer wins across concurrent commits without another result', async () => {
    const h = await openPetHarness()
    try {
      await seeded(h)
      const store = new InquiryAnswerStore(h.domain)
      const other = answer({ answer:'Different answer', answeredAt:t0+3_000 })
      const results = await Promise.all([store.commit(answer() as never,'e1'),store.commit(other as never,'e2')])
      expect(results[0]).toEqual(results[1])
      expect(store.get('inquiry-1')).toEqual(results[0])
      expect(h.domain.table('inquiry_results').size).toBe(1)
    } finally { await h.close() }
  })
  it('rejects an existing answer bound to a different target, without disclosing it', async () => {
    const h = await openPetHarness()
    try {
      await seeded(h)
      const answers = h.domain.table('inquiry_answers')
      await answers.put('inquiry-1', { ...answer(), answeredBy: main })
      await new InquiryLedgerStore(h.domain).applyEvent('inquiry-1', { type: 'answer', eventId: 'seed-answer', at: t0 + 2_000, reason: null })
      await expect(new InquiryAnswerStore(h.domain).commit(answer() as never, 'retry')).rejects.toMatchObject({ code: 'ANSWER_CONFLICT' })
    } finally { await h.close() }
  })
  it('rejects conflicting existing outbox identity or another failure result', async () => {
    const h = await openPetHarness()
    try {
      await seeded(h)
      const store = new InquiryAnswerStore(h.domain)
      const row = (await import('../src/host/inquiry/outbox.js')).createInquiryResult({ inquiryId: 'inquiry-1', requester: main, resumeWork: { kind: 'local' }, result: { kind: 'answer', answeredAt: t0 + 2_000 }, createdAt: t0 + 2_000 })
      await h.domain.table('inquiry_results').put(row.dedupKey, row)
      const before = JSON.stringify(h.medium)
      await expect(store.commit(answer() as never, 'e')).rejects.toMatchObject({ code: 'ANSWER_CONFLICT' })
      expect(JSON.stringify(h.medium)).toBe(before)
    } finally { await h.close() }
  })
  it('rejects a duplicate answer when its correlated outbox is missing without changing bytes', async () => {
    const h = await openPetHarness()
    try {
      await seeded(h)
      const store = new InquiryAnswerStore(h.domain)
      await store.commit(answer() as never, 'first')
      for (const key of h.domain.table('inquiry_results').keys()) await h.domain.table('inquiry_results').delete(key)
      const before = JSON.stringify(h.medium)
      await expect(store.commit(answer() as never, 'duplicate')).rejects.toMatchObject({ code: 'ANSWER_CORRUPT' })
      expect(JSON.stringify(h.medium)).toBe(before)
    } finally { await h.close() }
  })
  it('rejects inquiry rows stored under a mismatched table key', async () => {
    const h = await openPetHarness()
    try {
      await seeded(h)
      const value = h.domain.table('inquiries').get('inquiry-1')!
      await h.domain.table('inquiries').delete('inquiry-1')
      await h.domain.table('inquiries').put('wrong-key', value)
      const before = JSON.stringify(h.medium)
      await expect(new InquiryAnswerStore(h.domain).commit(answer() as never, 'e')).rejects.toMatchObject({ code: 'INQUIRY_NOT_FOUND' })
      expect(JSON.stringify(h.medium)).toBe(before)
    } finally { await h.close() }
  })
  it('rejects a wrong-key outbox without creating another result', async () => {
    const h = await openPetHarness()
    try {
      await seeded(h)
      const row = (await import('../src/host/inquiry/outbox.js')).createInquiryResult({ inquiryId: 'inquiry-1', requester, resumeWork: { kind: 'local' }, result: { kind: 'answer', answeredAt: t0 + 2_000 }, createdAt: t0 + 2_000 })
      await h.domain.table('inquiry_results').put('wrong-key', row)
      const before = JSON.stringify(h.medium)
      await expect(new InquiryAnswerStore(h.domain).commit(answer() as never, 'e')).rejects.toMatchObject({ code: 'ANSWER_CORRUPT' })
      expect(JSON.stringify(h.medium)).toBe(before)
      expect(h.domain.table('inquiry_results').size).toBe(1)
    } finally { await h.close() }
  })
  it('does not revive a cancelled inquiry', async () => {
    const h = await openPetHarness()
    try {
      await seeded(h)
      await new InquiryLedgerStore(h.domain).applyEvent('inquiry-1',{type:'cancel',eventId:'c',at:t0+1_500,reason:'host-observed-fact'})
      await expect(new InquiryAnswerStore(h.domain).commit(answer() as never,'e')).rejects.toMatchObject({ code:'INQUIRY_CLOSED' })
      expect(h.domain.table('inquiry_answers').size).toBe(0)
      expect(h.domain.table('inquiry_results').size).toBe(0)
    } finally { await h.close() }
  })
  it('leaves all medium bytes unchanged when any staged batch write fails', async () => {
    for (const failOnWriteNumber of [1,2,3]) {
      const medium = emptyMedium()
      const setup = await openPetHarness(medium)
      try { await seeded(setup) } finally { await setup.close() }
      const faults: { failOnWriteNumber?: number } = { failOnWriteNumber }
      const h = await openPetHarness(medium, faults)
      try {
        const before = JSON.stringify(medium)
        await expect(new InquiryAnswerStore(h.domain).commit(answer() as never,'e')).rejects.toThrow()
        expect(JSON.stringify(medium)).toBe(before)
      } finally { await h.close() }
    }
  })
})
