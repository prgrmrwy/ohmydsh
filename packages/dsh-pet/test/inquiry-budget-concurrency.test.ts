import { describe, expect, it } from 'vitest'
import { InquiryLedgerStore } from '../src/host/inquiry/ledger-store.js'
import { emptyMedium, openPetHarness } from './harness.js'

describe('inquiry pending budget concurrency', () => {
  it('serializes concurrent accepts at the 32-record target limit', async () => {
    const medium = emptyMedium()
    const h = await openPetHarness(medium)
    try {
      const store = new InquiryLedgerStore(h.domain)
      const request = {
        target: { kind: 'main', sessionId: 'parent' },
        question: 'memory only',
        purpose: 'budget test',
        declaredOrigin: null,
      }
      const accept = (n: number) => store.accept(request, {
        inquiryId: `inquiry-${n}`,
        requester: { kind: 'child', sessionId: `child-${n}`, locusId: `locus-${n}`, generation: 1 },
        circleParentSessionId: 'parent',
        origin: { kind: 'local' },
        audience: { kind: 'unknown' },
        createdAt: 1_800_000_000_000 + n,
      })

      await Promise.all(Array.from({ length: 31 }, (_, n) => accept(n)))
      const results = await Promise.allSettled([accept(31), accept(32)])
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      const rejected = results.find(result => result.status === 'rejected')
      expect(rejected).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ code: 'PENDING_BUDGET_EXCEEDED' }) })
      expect(store.listPending('parent')).toHaveLength(32)
      expect(Object.keys(medium.tables.inquiries)).toHaveLength(32)
      const winner = results.find(result => result.status === 'fulfilled')
      expect(winner?.status).toBe('fulfilled')
      if (winner?.status === 'fulfilled') {
        const durableWinner = JSON.parse(medium.tables.inquiries[winner.value.id])
        expect(durableWinner).toMatchObject({ id: winner.value.id, status: 'queued' })
      }
    } finally {
      await h.close()
    }
  })
})
