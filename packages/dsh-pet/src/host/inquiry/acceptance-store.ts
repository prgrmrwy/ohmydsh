import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { petDomainSpec } from '../spec.js'
import { inquiryMemberKey, parseInquiry } from './ledger.js'
import { InquiryLedgerStore, type InquiryAcceptFacts } from './ledger-store.js'
import { parseInquiryHandoff, type HandoffWork } from './handoff-store.js'
import { parseInquiryWork } from './work-store.js'

type Tables = 'inquiries' | 'inquiry_handoffs' | 'inquiry_works'
type AtomicDomain = Domain<typeof petDomainSpec> & { readonly supportsTransaction?: boolean; transaction?: (body: (tx: { put(table: Tables, key: string, value: unknown): void }) => void) => Promise<void> }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export interface InquiryAcceptanceInput {
  readonly request: unknown
  readonly facts: InquiryAcceptFacts
  readonly work: HandoffWork
  readonly messageId: string
}

/** Atomically records an accepted inquiry, its reserved target handoff, and its local work branch. */
export class InquiryAcceptanceStore {
  private readonly ledger: InquiryLedgerStore
  constructor(private readonly domain: AtomicDomain) { this.ledger = new InquiryLedgerStore(domain as never) }

  async accept(input: InquiryAcceptanceInput) {
    if (this.domain.supportsTransaction !== true || typeof this.domain.transaction !== 'function') throw new Error('atomic transaction unavailable')
    let accepted: ReturnType<InquiryLedgerStore['get']>
    await this.domain.transaction(tx => {
      const inquiry = this.ledger.stageAccept(tx, input.request, input.facts)
      const facts = input.facts
      const work = input.work
      const scope = { ...inquiry.target }
      const generation = scope.kind === 'child' ? scope.generation : 0
      const handoff = parseInquiryHandoff({
        protocolVersion: 1, inquiryId: inquiry.id, phase: 'target', scope, generation,
        messageId: input.messageId, work, parentInquiryId: inquiry.origin.kind === 'inquiry' ? inquiry.origin.parentInquiryId : null,
        createdAt: facts.createdAt, claimTurn: null, claimAt: null, state: 'intent',
      })
      const handoffKey = JSON.stringify([inquiry.id, 'target'])
      let duplicate: ReturnType<typeof parseInquiryHandoff> | undefined
      for (const [key, value] of this.domain.table('inquiry_handoffs').entries()) {
        const row = parseInquiryHandoff(value)
        if (key !== JSON.stringify([row.inquiryId, row.phase])) throw new Error('handoff corrupt')
        if (row.messageId === handoff.messageId && key !== handoffKey) throw new Error('handoff message collision')
        if (key === handoffKey) duplicate = row
      }
      if (duplicate) {
        if (JSON.stringify({ ...duplicate, claimTurn: null, claimAt: null, state: 'intent' }) !== JSON.stringify(handoff)) throw new Error('handoff conflict')
      } else tx.put('inquiry_handoffs', handoffKey, handoff)

      if (work.kind === 'local') {
        const requester = inquiry.requester
        const rootKey = JSON.stringify([work.sessionId, work.workId])
        const rootRaw = this.domain.table('inquiry_works').get(rootKey)
        if (rootRaw === undefined) throw new Error('work missing')
        const root = parseInquiryWork(rootRaw)
        if (root.sessionId !== work.sessionId || root.workId !== work.workId || root.state === 'settled') throw new Error('work scope/state mismatch')

        let branch: ReturnType<typeof parseInquiryWork> | undefined
        if (inquiry.origin.kind === 'local') {
          if (!same(requester, facts.requester) || work.sessionId !== requester.sessionId
            || root.scopeGeneration !== (requester.kind === 'child' ? requester.generation : 0)) throw new Error('work requester mismatch')
        } else if (inquiry.origin.kind === 'inquiry') {
          let current = inquiry
          let parentId = inquiry.origin.parentInquiryId
          const visited = new Set<string>([inquiry.id])
          let depth = 0
          while (true) {
            if (visited.has(parentId) || ++depth > 3) throw new Error('ancestor cycle/depth')
            visited.add(parentId)
            const parentRaw = this.domain.table('inquiries').get(parentId)
            if (parentRaw === undefined) throw new Error('ancestor inquiry missing')
            const parentInquiry = parseInquiry(parentRaw)
            if (parentInquiry.id !== parentId || parentInquiry.trace.rootInquiryId !== inquiry.trace.rootInquiryId
              || parentInquiry.trace.depth + 1 !== current.trace.depth
              || parentInquiry.trace.visited.length + 1 !== current.trace.visited.length
              || !same(current.trace.visited.slice(0, -1), parentInquiry.trace.visited)
              || !same(parentInquiry.target, current.requester) || parentInquiry.status !== 'executing') throw new Error('ancestor inquiry mismatch')
            const parentKey = JSON.stringify([parentId, 'target'])
            const parentRawHandoff = this.domain.table('inquiry_handoffs').get(parentKey)
            if (parentRawHandoff === undefined) throw new Error('ancestor handoff missing')
            const parent = parseInquiryHandoff(parentRawHandoff)
            if (parent.inquiryId !== parentId || parent.phase !== 'target' || parent.state !== 'claimed'
              || parent.claimTurn === null || parent.claimAt === null || !same(parent.scope, parentInquiry.target)
              || !same(parent.work, work)) throw new Error('ancestor claim/work mismatch')
            if (parentInquiry.origin.kind !== 'inquiry') {
              if (parentInquiry.origin.kind !== 'local' || work.kind !== 'local'
                || parentInquiry.requester.sessionId !== work.sessionId
                || root.scopeGeneration !== (parentInquiry.requester.kind === 'child' ? parentInquiry.requester.generation : 0)) throw new Error('root local scope mismatch')
              branch = root
              break
            }
            if (parentInquiry.trace.depth <= 1) throw new Error('invalid root lineage')
            current = parentInquiry
            parentId = parentInquiry.origin.parentInquiryId
          }
        } else throw new Error('origin work mismatch')

        if (!branch) {
          if (inquiry.origin.kind !== 'local') throw new Error('root proof missing')
          branch = root
        }
        if (inquiry.origin.kind === 'local' && (work.kind !== 'local' || work.sessionId !== requester.sessionId)) throw new Error('work requester mismatch')
        const open = [...branch.openInquiryIds]
        if (open.includes(inquiry.id)) {
          // Fully persisted duplicate is a no-op; partial evidence must not be repaired.
          if ((duplicate?.state !== 'intent' && duplicate?.state !== 'claimed') || !same(root, branch)) throw new Error('incomplete duplicate branch')
        } else {
          if (duplicate) throw new Error('handoff exists without branch')
          if (open.length >= 32) throw new Error('branch limit')
          open.push(inquiry.id)
          tx.put('inquiry_works', rootKey, parseInquiryWork({ ...branch, openInquiryIds: open }))
        }
      } else if (work.kind === 'delivery') {
        if (inquiry.origin.kind === 'feishu-delivery') {
          if (inquiry.origin.deliveryId !== work.id) throw new Error('delivery mismatch')
        } else if (inquiry.origin.kind === 'inquiry') {
          let current = inquiry
          let parentId = inquiry.origin.parentInquiryId
          const visited = new Set<string>([inquiry.id])
          let depth = 0
          while (true) {
            if (visited.has(parentId) || ++depth > 3) throw new Error('ancestor cycle/depth')
            visited.add(parentId)
            const parentRaw = this.domain.table('inquiries').get(parentId)
            if (parentRaw === undefined) throw new Error('ancestor inquiry missing')
            const parentInquiry = parseInquiry(parentRaw)
            if (parentInquiry.id !== parentId || parentInquiry.trace.rootInquiryId !== inquiry.trace.rootInquiryId
              || parentInquiry.trace.depth + 1 !== current.trace.depth
              || parentInquiry.trace.visited.length + 1 !== current.trace.visited.length
              || !same(current.trace.visited.slice(0, -1), parentInquiry.trace.visited)
              || !same(parentInquiry.target, current.requester) || parentInquiry.status !== 'executing') throw new Error('ancestor inquiry mismatch')
            const rawHandoff = this.domain.table('inquiry_handoffs').get(JSON.stringify([parentId, 'target']))
            if (rawHandoff === undefined) throw new Error('ancestor handoff missing')
            const parent = parseInquiryHandoff(rawHandoff)
            if (parent.inquiryId !== parentId || parent.phase !== 'target' || parent.state !== 'claimed'
              || parent.claimTurn === null || parent.claimAt === null || !same(parent.scope, parentInquiry.target)
              || !same(parent.work, work)) throw new Error('ancestor claim/work mismatch')
            if (parentInquiry.origin.kind === 'inquiry') {
              current = parentInquiry
              parentId = parentInquiry.origin.parentInquiryId
              continue
            }
            if (parentInquiry.origin.kind !== 'feishu-delivery' || parentInquiry.origin.deliveryId !== work.id) throw new Error('root delivery mismatch')
            break
          }
        } else throw new Error('origin work mismatch')
      } else throw new Error('origin work mismatch')
      accepted = inquiry
    })
    return accepted!
  }
}
