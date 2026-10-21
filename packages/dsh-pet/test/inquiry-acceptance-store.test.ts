import { describe, expect, it } from 'vitest'
import { InquiryAcceptanceStore } from '../src/host/inquiry/acceptance-store.js'
import { InquiryLedgerStore } from '../src/host/inquiry/ledger-store.js'
import { InquiryHandoffStore } from '../src/host/inquiry/handoff-store.js'
import { InquiryWorkStore } from '../src/host/inquiry/work-store.js'
import { emptyMedium, openPetHarness } from './harness.js'

const root = { kind: 'child', sessionId: 'session-a', locusId: 'locus-a', generation: 2 } as const
const target = { kind: 'child', sessionId: 'session-b', locusId: 'locus-b', generation: 1 } as const
const targetC = { kind: 'child', sessionId: 'session-c', locusId: 'locus-c', generation: 3 } as const
const targetD = { kind: 'child', sessionId: 'session-d', locusId: 'locus-d', generation: 4 } as const
const chat = { kind: 'local-session', sessionId: 'session-a' } as const
const feishuChat = { kind: 'feishu-chat', chatId: 'oc-example' } as const
const at = 1_800_000_000_000
const request = { target, question: 'Question?', purpose: 'Test', declaredOrigin: null }
const facts = { inquiryId: 'inq-1', requester: root, circleParentSessionId: 'session-main', origin: { kind: 'local' }, audience: chat, createdAt: at }
const work = { kind: 'local', sessionId: root.sessionId, workId: 'root-turn' } as const

async function setup(medium = emptyMedium(), faults?: { failOnWriteNumber?: number }) {
  const h = await openPetHarness(medium, faults)
  return { ...h, acceptance: new InquiryAcceptanceStore(h.domain), ledger: new InquiryLedgerStore(h.domain), handoffs: new InquiryHandoffStore(h.domain), works: new InquiryWorkStore(h.domain) }
}

describe('atomic inquiry acceptance store', () => {
  it('rejects missing local root before leaving any table changed', async () => {
    const h = await setup()
    try {
      const before = JSON.stringify(h.medium)
      await expect(h.acceptance.accept({ request, facts, work, messageId: 'message-1' })).rejects.toThrow()
      expect(JSON.stringify(h.medium)).toBe(before)
      expect(h.domain.table('inquiries').size).toBe(0)
    } finally { await h.close() }
  })

  it('atomically writes inquiry, target handoff and root branch; exact redelivery is a no-op', async () => {
    const h = await setup()
    try {
      await h.works.claimLocalWork(root, 'root-turn', 4, at - 1)
      const result = await h.acceptance.accept({ request, facts, work, messageId: 'message-1' })
      expect(result.status).toBe('queued')
      expect(h.ledger.get('inq-1')).toEqual(result)
      expect(h.handoffs.get('inq-1', 'target')).toMatchObject({ state: 'intent', messageId: 'message-1', work })
      expect(h.works.get(work.sessionId, work.workId)?.openInquiryIds).toEqual(['inq-1'])
      const before = JSON.stringify(h.medium)
      expect(await h.acceptance.accept({ request, facts, work, messageId: 'message-1' })).toEqual(result)
      expect(JSON.stringify(h.medium)).toBe(before)
      await expect(h.acceptance.accept({ request, facts: { ...facts, inquiryId: 'inq-2' }, work, messageId: 'message-1' })).rejects.toThrow()
    } finally { await h.close() }
  })

  it('leaves durable bytes unchanged for each real atomic write failure', async () => {
    for (const failOnWriteNumber of [1, 2, 3]) {
      const medium = emptyMedium()
      const h = await setup(medium)
      try {
        await h.works.claimLocalWork(root, 'root-turn', 4, at - 1)
        const before = JSON.stringify(medium)
        h.failNextAtomicBatch(failOnWriteNumber)
        await expect(h.acceptance.accept({ request, facts, work, messageId: 'message-1' })).rejects.toThrow(`atomic write failure #${failOnWriteNumber}`)
        expect(JSON.stringify(medium)).toBe(before)
        expect(h.ledger.get('inq-1')).toBeUndefined()
        expect(h.handoffs.get('inq-1', 'target')).toBeUndefined()
        expect(h.works.get(work.sessionId, work.workId)?.openInquiryIds).toEqual([])
      } finally { await h.close() }
    }
  })

  it('rejects nested acceptance without a claimed executing parent and exact lineage proof', async () => {
    const h = await setup()
    try {
      await h.works.claimLocalWork(root, 'root-turn', 4, at - 1)
      await h.acceptance.accept({ request, facts, work, messageId: 'message-1' })
      const nestedFacts = { ...facts, inquiryId: 'inq-2', requester: target, createdAt: at + 2, origin: { kind: 'inquiry', parentInquiryId: 'inq-1' } }
      const nestedRequest = { target: root, question: 'Nested?', purpose: 'Test', declaredOrigin: null }
      const before = JSON.stringify(h.medium)
      await expect(h.acceptance.accept({ request: nestedRequest, facts: nestedFacts, work, messageId: 'message-2' })).rejects.toThrow()
      expect(JSON.stringify(h.medium)).toBe(before)
    } finally { await h.close() }
  })

  it('rejects a cycle without writes', async () => {
    const h = await setup()
    try {
      await h.works.claimLocalWork(root, 'root-turn', 4, at - 1)
      await h.acceptance.accept({ request, facts, work, messageId: 'message-1' })
      const before = JSON.stringify(h.medium)
      const nestedFacts = { ...facts, inquiryId: 'inq-2', requester: target, createdAt: at + 2, origin: { kind: 'inquiry', parentInquiryId: 'inq-1' } }
      await expect(h.acceptance.accept({ request: { ...request, target: root }, facts: nestedFacts, work, messageId: 'message-2' })).rejects.toThrow()
      expect(JSON.stringify(h.medium)).toBe(before)
    } finally { await h.close() }
  })

  it('accepts main-root→B→C with generation zero and exact claimed lineage', async () => {
    const mainRoot = { kind: 'main', sessionId: 'session-main' } as const
    const h = await setup()
    try {
      const mainWork = { kind: 'local', sessionId: mainRoot.sessionId, workId: 'main-turn' } as const
      const mainFacts = { ...facts, requester: mainRoot, circleParentSessionId: mainRoot.sessionId }
      await h.works.claimLocalWork(mainRoot, mainWork.workId, 4, at - 1)
      await h.acceptance.accept({ request, facts: mainFacts, work: mainWork, messageId: 'main-message' })
      await h.handoffs.claim(target, 'main-message', 6, at + 1)

      const bFacts = { ...mainFacts, inquiryId: 'inq-b', requester: target, createdAt: at + 2, origin: { kind: 'inquiry', parentInquiryId: 'inq-1' } }
      const bRequest = { target: targetC, question: 'B to C?', purpose: 'Test', declaredOrigin: null }
      const b = await h.acceptance.accept({ request: bRequest, facts: bFacts, work: mainWork, messageId: 'b-message' })
      expect(b.trace.rootInquiryId).toBe('inq-1')
      expect(b.trace.depth).toBe(2)
      await h.handoffs.claim(targetC, 'b-message', 7, at + 3)

      const cFacts = { ...mainFacts, inquiryId: 'inq-c', requester: targetC, createdAt: at + 4, origin: { kind: 'inquiry', parentInquiryId: 'inq-b' } }
      const c = await h.acceptance.accept({ request: { ...bRequest, target: targetD }, facts: cFacts, work: mainWork, messageId: 'c-message' })
      expect(c.trace.rootInquiryId).toBe('inq-1')
      expect(c.trace.depth).toBe(3)
      expect(h.works.get(mainWork.sessionId, mainWork.workId)).toMatchObject({ scopeGeneration: 0, openInquiryIds: ['inq-1', 'inq-b', 'inq-c'] })
      expect(h.handoffs.get('inq-c', 'target')).toMatchObject({ scope: targetD, work: mainWork, parentInquiryId: 'inq-b', state: 'intent' })
      expect(h.ledger.get('inq-1')?.requester).toEqual(mainRoot)
      expect(h.ledger.get('inq-1')?.trace.visited).toEqual([mainRoot, target])
      expect(h.handoffs.get('inq-3', 'target')).toBeUndefined()
    } finally { await h.close() }
  })

  it('accepts A→B→C nested branches only through each exact claimed parent handoff', async () => {
    const h = await setup()
    try {
      await h.works.claimLocalWork(root, 'root-turn', 4, at - 1)
      await h.acceptance.accept({ request, facts, work, messageId: 'message-1' })
      await h.handoffs.claim(target, 'message-1', 6, at + 1)
      const c = targetC
      const nestedFacts = { ...facts, inquiryId: 'inq-2', requester: target, createdAt: at + 2, origin: { kind: 'inquiry', parentInquiryId: 'inq-1' } }
      const nestedRequest = { target: c, question: 'B to C?', purpose: 'Test', declaredOrigin: null }
      await h.acceptance.accept({ request: nestedRequest, facts: nestedFacts, work, messageId: 'message-2' })
      expect(h.works.get(work.sessionId, work.workId)?.openInquiryIds).toEqual(['inq-1', 'inq-2'])
      await h.handoffs.claim(c, 'message-2', 7, at + 3)
      const thirdFacts = { ...facts, inquiryId: 'inq-3', requester: c, createdAt: at + 4, origin: { kind: 'inquiry', parentInquiryId: 'inq-2' } }
      const thirdRequest = { target: targetD, question: 'C to D?', purpose: 'Test', declaredOrigin: null }
      const third = await h.acceptance.accept({ request: thirdRequest, facts: thirdFacts, work, messageId: 'message-3' })
      expect(third.trace.rootInquiryId).toBe('inq-1')
      expect(third.trace.depth).toBe(3)
      expect(h.handoffs.get('inq-3', 'target')).toMatchObject({ parentInquiryId: 'inq-2', scope: targetD, work, state: 'intent' })
      expect(h.works.get(work.sessionId, work.workId)?.openInquiryIds).toEqual(['inq-1', 'inq-2', 'inq-3'])
    } finally { await h.close() }
  })

  it('accepts delivery origin only with the exact literal delivery id', async () => {
    const h = await setup()
    try {
      const dfacts = { ...facts, audience: feishuChat, origin: { kind: 'feishu-delivery', deliveryId: 'delivery-1' } }
      const drequest = { ...request, declaredOrigin: { kind: 'feishu-delivery', deliveryId: 'delivery-1' } }
      const result = await h.acceptance.accept({ request: drequest, facts: dfacts, work: { kind: 'delivery', id: 'delivery-1' }, messageId: 'delivery-message' })
      expect(result.status).toBe('queued')
      expect(h.domain.table('inquiry_works').size).toBe(0)
      await h.handoffs.claim(target, 'delivery-message', 5, at + 1)
      const child = targetC
      const nestedFacts = { ...dfacts, inquiryId: 'inq-2', requester: target, audience: feishuChat, origin: { kind: 'inquiry', parentInquiryId: 'inq-1' }, createdAt: at + 2 }
      const nestedRequest = { ...drequest, target: child, declaredOrigin: null }
      const nested = await h.acceptance.accept({ request: nestedRequest, facts: nestedFacts, work: { kind: 'delivery', id: 'delivery-1' }, messageId: 'delivery-message-2' })
      expect(nested.trace.rootInquiryId).toBe('inq-1')
      expect(h.domain.table('inquiry_works').size).toBe(0)
    } finally { await h.close() }
  })
})
