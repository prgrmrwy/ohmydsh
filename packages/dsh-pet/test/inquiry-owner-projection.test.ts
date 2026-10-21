import { describe, expect, it } from 'vitest'
import { createInquiryOwnerProjection } from '../src/host/inquiry/owner-projection.js'
import { InquiryLedgerStore } from '../src/host/inquiry/ledger-store.js'
import { emptyMedium, openPetHarness } from './harness.js'

const parentSessionId = 'session-main'
const child = { kind: 'child', sessionId: 'session-a', locusId: 'locus-a', generation: 2 } as const
const targetChild = { kind: 'child', sessionId: 'session-target', locusId: 'locus-target', generation: 1 } as const
const otherChild = { kind: 'child', sessionId: 'session-b', locusId: 'locus-b', generation: 1 } as const
const locus = {
  id: 'locus-a', generation: 2, parentSessionId, childSessionId: 'session-a',
} as never
const stamp = 1_800_000_000_000

async function add(store: InquiryLedgerStore, id: string, requester = child, at = stamp) {
  return store.accept({
    target: targetChild, question: 'PRIVATE question content', purpose: 'private purpose', declaredOrigin: null,
  }, {
    inquiryId: id, requester, circleParentSessionId: parentSessionId,
    origin: { kind: 'local' }, audience: { kind: 'unknown' }, createdAt: at,
  })
}

describe('inquiry owner projection', () => {
  it('distinguishes a valid empty snapshot from a failed snapshot', async () => {
    const h = await openPetHarness(emptyMedium())
    try {
      const project = createInquiryOwnerProjection({ domain: h.domain, capability: () => ({ available: true }) })
      expect(project({ locus, parentSessionId })).toMatchObject({
        snapshotStatus: 'available', dispatchCapability: 'available', inquiries: [],
      })
      const brokenDomain = {
        ...h.domain,
        table: () => { throw new Error('private failure detail') },
      } as never
      expect(createInquiryOwnerProjection({ domain: brokenDomain, capability: () => ({ available: true }) })({ locus, parentSessionId }))
        .toMatchObject({ snapshotStatus: 'unknown', diagnostics: [{ code: 'inquiry-snapshot-read-failed' }] })
    } finally { await h.close() }
  })

  it('shows only exact child identity and generation, in stable createdAt/id order', async () => {
    const h = await openPetHarness()
    try {
      const ledger = new InquiryLedgerStore(h.domain)
      await add(ledger, 'later', child, stamp + 1)
      await add(ledger, 'z-first', child, stamp)
      await add(ledger, 'a-first', child, stamp)
      await add(ledger, 'wrong-child', otherChild, stamp)
      await add(ledger, 'old-generation', { ...child, generation: 1 }, stamp)
      const projected = createInquiryOwnerProjection({ domain: h.domain, capability: () => ({ available: true }) })({ locus, parentSessionId })
      expect(projected.inquiries?.map(row => row.inquiryId)).toEqual(['a-first', 'z-first', 'later'])
      expect(projected.inquiries?.map(row => row.createdAt)).toEqual([stamp, stamp, stamp + 1])
    } finally { await h.close() }
  })

  it('does not return question content, arbitrary reasons, capability prose, or raw diagnostics', async () => {
    const h = await openPetHarness()
    try {
      const ledger = new InquiryLedgerStore(h.domain)
      const row = await add(ledger, 'private-row')
      await h.domain.table('inquiries').put(row.id, {
        ...row,
        diagnostics: [{ kind: 'late-answer', at: stamp + 2, eventId: 'diagnostic-private-message' }],
      })
      const projection = createInquiryOwnerProjection({
        domain: h.domain,
        capability: () => ({ available: false, reason: 'Do not reveal this diagnostic' }),
      })({ locus, parentSessionId })
      const output = JSON.stringify(projection)
      expect(output).not.toContain('PRIVATE')
      expect(output).not.toContain('private purpose')
      expect(output).not.toContain('diagnostic-private-message')
      expect(output).not.toContain('Do not reveal')
      expect(projection.inquiries?.[0]).toMatchObject({
        status: 'queued', diagnostics: [{ code: 'late-answer' }],
      })
    } finally { await h.close() }
  })

  it('preserves rows when dispatch is unavailable without leaking its private reason', async () => {
    const h = await openPetHarness()
    try {
      const ledger = new InquiryLedgerStore(h.domain)
      await add(ledger, 'known-reason')
      const saved = ledger.get('known-reason')!
      await h.domain.table('inquiries').put(saved.id, {
        ...saved, status: 'unavailable', statusAt: stamp + 1, reason: 'privatequestioncredentials',
      })
      const projection = createInquiryOwnerProjection({ domain: h.domain, capability: () => ({ available: false }) })({ locus, parentSessionId })
      expect(projection).toMatchObject({
        snapshotStatus: 'available', dispatchCapability: 'unavailable',
        inquiries: [{ inquiryId: 'known-reason', reason: 'inquiry-unavailable' }],
      })
    } finally { await h.close() }
  })

  it('keeps snapshot availability and known rows when capability lookup throws', async () => {
    const h = await openPetHarness()
    try {
      await add(new InquiryLedgerStore(h.domain), 'retained')
      const projection = createInquiryOwnerProjection({ domain: h.domain, capability: () => { throw new Error('private') } })({ locus, parentSessionId })
      expect(projection).toMatchObject({ snapshotStatus: 'available', dispatchCapability: 'unknown', inquiries: [{ inquiryId: 'retained' }] })
    } finally { await h.close() }
  })

  it('refuses a foreign parent scope without querying rows', async () => {
    const h = await openPetHarness()
    try {
      let reads = 0
      const domain = {
        ...h.domain,
        table: ((...args: Parameters<typeof h.domain.table>) => {
          reads++
          return h.domain.table(...args)
        }) as typeof h.domain.table,
      }
      const projection = createInquiryOwnerProjection({ domain, capability: () => ({ available: true }) })({
        locus, parentSessionId: 'foreign-parent',
      })
      expect(projection).toMatchObject({ snapshotStatus: 'unknown', diagnostics: [{ code: 'inquiry-owner-scope-unknown' }] })
      expect(reads).toBe(0)
    } finally { await h.close() }
  })

  it('treats corrupt table keys as read failure, not an empty ledger', async () => {
    const h = await openPetHarness()
    try {
      await add(new InquiryLedgerStore(h.domain), 'valid')
      const row = h.domain.table('inquiries').get('valid') as Record<string, unknown>
      await h.domain.table('inquiries').put('wrong-key', row)
      const projection = createInquiryOwnerProjection({ domain: h.domain, capability: () => ({ available: true }) })({ locus, parentSessionId })
      expect(projection).toMatchObject({ snapshotStatus: 'unknown', diagnostics: [{ code: 'inquiry-snapshot-read-failed' }] })
      expect(projection).not.toHaveProperty('inquiries')
    } finally { await h.close() }
  })
})
