import { describe, expect, it } from 'vitest'
import { createInquiryOwnerProjection } from '../src/host/inquiry/owner-projection.js'
import { InquiryLedgerStore } from '../src/host/inquiry/ledger-store.js'
import { openPetHarness } from './harness.js'

const parentSessionId = 'main-owner'
const locus = {
  id: 'locus-owner', generation: 3, parentSessionId, childSessionId: 'child-owner',
} as never

describe('owner inquiry projection assembly seam', () => {
  it('projects a live queued inquiry from the opened Pet domain without exposing its content', async () => {
    const h = await openPetHarness()
    try {
      const ledger = new InquiryLedgerStore(h.domain)
      await ledger.accept({
        target: { kind: 'child', sessionId: 'child-owner', locusId: 'locus-owner', generation: 3 },
        question: 'PRIVATE question', purpose: 'PRIVATE purpose', declaredOrigin: null,
      }, {
        inquiryId: 'inquiry-live',
        requester: { kind: 'main', sessionId: parentSessionId },
        circleParentSessionId: parentSessionId,
        origin: { kind: 'local' }, audience: { kind: 'unknown' }, createdAt: 123,
      })

      const project = createInquiryOwnerProjection({
        domain: h.domain,
        capability: () => ({ available: false }),
      })
      const output = project({ locus, parentSessionId })
      expect(output).toMatchObject({
        snapshotStatus: 'available', dispatchCapability: 'unavailable',
        inquiries: [{ inquiryId: 'inquiry-live', status: 'queued', createdAt: 123 }],
      })
      expect(JSON.stringify(output)).not.toContain('PRIVATE')
    } finally {
      await h.close()
    }
  })

  it('keeps an empty snapshot distinct from an unreadable snapshot', async () => {
    const h = await openPetHarness()
    try {
      const project = createInquiryOwnerProjection({ domain: h.domain, capability: () => ({ available: false }) })
      expect(project({ locus, parentSessionId })).toMatchObject({ snapshotStatus: 'available', inquiries: [] })
      const broken = createInquiryOwnerProjection({
        domain: { ...h.domain, table: () => { throw new Error('private') } } as never,
        capability: () => ({ available: false }),
      })
      expect(broken({ locus, parentSessionId })).toMatchObject({
        snapshotStatus: 'unknown', diagnostics: [{ code: 'inquiry-snapshot-read-failed' }],
      })
    } finally {
      await h.close()
    }
  })
})
