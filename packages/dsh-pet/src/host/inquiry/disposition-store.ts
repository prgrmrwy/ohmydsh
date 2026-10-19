import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { petDomainSpec } from '../spec.js'
import { applyInquiryEvent, isTerminalInquiryStatus, parseInquiry, type InquiryRecord } from './ledger.js'
import { parseInquiryAnswer } from './answer.js'
import { parseInquiryOutboxRecord, refuseInquiryResult, retainInquiryResult, type InquiryOutboxDiagnosticCode, type InquiryOutboxRecord } from './outbox.js'
import { parseInquiryHandoff } from './handoff-store.js'
import { parseInquiryWork } from './work-store.js'

type Tables = 'inquiries' | 'inquiry_results' | 'inquiry_works'
type AtomicDomain = Domain<typeof petDomainSpec> & { readonly supportsTransaction?: boolean; transaction?: (body: (tx: { put(table: Tables, key: string, value: unknown): void }) => void) => Promise<void> }
export type InquiryDispositionCause = 'work-terminal' | 'requester-invalid' | 'permission-revoked' | 'evidence-unknown'
export interface InquiryDispositionInput { readonly kind: 'retained' | 'refused'; readonly code: InquiryOutboxDiagnosticCode; readonly reason: string; readonly eventId: string; readonly at: number; readonly cause: InquiryDispositionCause }
export class InquiryDispositionStoreError extends Error {
  constructor(readonly code: 'TRANSACTION_UNAVAILABLE' | 'INQUIRY_NOT_FOUND' | 'DISPOSITION_CONFLICT' | 'DISPOSITION_CORRUPT') { super(`Inquiry disposition failed (${code}).`); this.name = 'InquiryDispositionStoreError' }
}
const same = (a: unknown,b:unknown) => JSON.stringify(a) === JSON.stringify(b)
const workKey = (sessionId:string,workId:string) => JSON.stringify([sessionId,workId])

/** Atomically records a Host-proven terminal disposition; it does not authorize, answer, or deliver. */
export class InquiryDispositionStore {
  constructor(private readonly domain: AtomicDomain) {}
  private targetHandoff(inquiryId: string) {
    const hkey = JSON.stringify([inquiryId,'target'])
    const hraw = this.domain.table('inquiry_handoffs').get(hkey)
    if (hraw === undefined) throw new InquiryDispositionStoreError('DISPOSITION_CONFLICT')
    const handoff = parseInquiryHandoff(hraw)
    if (handoff.inquiryId !== inquiryId || handoff.phase !== 'target') throw new InquiryDispositionStoreError('DISPOSITION_CORRUPT')
    return handoff
  }
  private rootWork(inquiry: InquiryRecord, depth: number, visited: Set<string>): { readonly kind: 'local'; readonly inquiry: InquiryRecord } | { readonly kind: 'delivery'; readonly inquiry: InquiryRecord; readonly deliveryId: string } {
    if (depth > 3 || visited.has(inquiry.id)) throw new InquiryDispositionStoreError('DISPOSITION_CORRUPT')
    visited.add(inquiry.id)
    const handoff = this.targetHandoff(inquiry.id)
    if (!same(handoff.scope, inquiry.target)) throw new InquiryDispositionStoreError('DISPOSITION_CORRUPT')
    if (inquiry.origin.kind === 'local') {
      if (handoff.work.kind !== 'local' || handoff.parentInquiryId !== null
        || handoff.work.sessionId !== inquiry.requester.sessionId) throw new InquiryDispositionStoreError('DISPOSITION_CORRUPT')
      return {kind:'local',inquiry}
    }
    if (inquiry.origin.kind === 'feishu-delivery') {
      if (handoff.work.kind !== 'delivery' || handoff.work.id !== inquiry.origin.deliveryId || handoff.parentInquiryId !== null
        || inquiry.trace.rootInquiryId !== inquiry.id || inquiry.trace.depth !== 1) throw new InquiryDispositionStoreError('DISPOSITION_CORRUPT')
      return {kind:'delivery',inquiry,deliveryId:inquiry.origin.deliveryId}
    }
    if (handoff.parentInquiryId !== inquiry.origin.parentInquiryId) throw new InquiryDispositionStoreError('DISPOSITION_CORRUPT')
    const parentRaw = this.domain.table('inquiries').get(inquiry.origin.parentInquiryId)
    if (parentRaw === undefined) throw new InquiryDispositionStoreError('DISPOSITION_CONFLICT')
    const parent = parseInquiry(parentRaw)
    if (parent.id !== inquiry.origin.parentInquiryId || parent.trace.rootInquiryId !== inquiry.trace.rootInquiryId
      || parent.circleParentSessionId !== inquiry.circleParentSessionId || parent.trace.depth + 1 !== inquiry.trace.depth
      || !same(parent.trace.visited, inquiry.trace.visited.slice(0, -1))) throw new InquiryDispositionStoreError('DISPOSITION_CORRUPT')
    const root = this.rootWork(parent, depth + 1, visited)
    if (!same(this.targetHandoff(parent.id).work, handoff.work)
      || (root.kind === 'local' ? handoff.work.kind !== 'local' : handoff.work.kind !== 'delivery' || handoff.work.id !== root.deliveryId)) throw new InquiryDispositionStoreError('DISPOSITION_CORRUPT')
    return root
  }
  async dispose(inquiryId: string, input: InquiryDispositionInput): Promise<{ readonly inquiry: InquiryRecord; readonly outbox: InquiryOutboxRecord }> {
    if (this.domain.supportsTransaction !== true || typeof this.domain.transaction !== 'function') throw new InquiryDispositionStoreError('TRANSACTION_UNAVAILABLE')
    let result: { inquiry: InquiryRecord; outbox: InquiryOutboxRecord } | undefined
    await this.domain.transaction(tx => {
      const raw = this.domain.table('inquiries').get(inquiryId)
      if (raw === undefined) throw new InquiryDispositionStoreError('INQUIRY_NOT_FOUND')
      const inquiry = parseInquiry(raw)
      if (inquiry.id !== inquiryId) throw new InquiryDispositionStoreError('DISPOSITION_CORRUPT')
      let correlated: InquiryOutboxRecord | undefined
      for (const [storedKey, value] of this.domain.table('inquiry_results').entries()) {
        const row = parseInquiryOutboxRecord(value)
        if (storedKey !== row.dedupKey) throw new InquiryDispositionStoreError('DISPOSITION_CORRUPT')
        if (row.inquiryId !== inquiryId) continue
        if (correlated) throw new InquiryDispositionStoreError('DISPOSITION_CORRUPT')
        correlated = row
      }
      if (!correlated || correlated.requester.sessionId !== inquiry.requester.sessionId || !same(correlated.requester,inquiry.requester) || !same(correlated.resumeWork,inquiry.origin) || (correlated.result.kind === 'answer' ? correlated.result.answeredAt !== correlated.createdAt : correlated.result.failedAt !== correlated.createdAt)) throw new InquiryDispositionStoreError('DISPOSITION_CONFLICT')
      const failureForStatus = { unavailable: 'unavailable', rejected: 'rejected', cancelled: 'cancelled', 'needs-review': 'needs-review' } as const
      const failureMatches = correlated.result.kind === 'failure' && isTerminalInquiryStatus(inquiry.status)
        && failureForStatus[inquiry.status as keyof typeof failureForStatus] === correlated.result.failure
        && correlated.result.reason === inquiry.reason
      const answerRaw = correlated.result.kind === 'answer' ? this.domain.table('inquiry_answers').get(inquiryId) : undefined
      const answer = answerRaw === undefined ? undefined : parseInquiryAnswer(answerRaw)
      const answerTransitionProven = correlated.result.kind === 'answer' && answer !== undefined
        && answer.inquiryId === inquiryId && same(answer.answeredBy,inquiry.target)
        && answer.answeredAt === correlated.result.answeredAt
      const answerMatches = answerTransitionProven && (inquiry.status === 'answered' || isTerminalInquiryStatus(inquiry.status))
      const answerDispositionDuplicate = answerTransitionProven && inquiry.appliedEventIds.includes(input.eventId)
        && inquiry.status === (input.cause === 'evidence-unknown' ? 'needs-review' : 'cancelled')
        && inquiry.reason === input.reason
      const terminalAnswer = answerTransitionProven && isTerminalInquiryStatus(inquiry.status)
      const duplicateEvent = correlated.appliedEventIds.includes(input.eventId)
      const root = this.rootWork(inquiry, 0, new Set())
      if (duplicateEvent) {
        if (root.kind === 'local') {
          const handoff = this.targetHandoff(inquiryId)
          if (handoff.work.kind !== 'local') throw new InquiryDispositionStoreError('DISPOSITION_CORRUPT')
          const workRaw = this.domain.table('inquiry_works').get(workKey(handoff.work.sessionId, handoff.work.workId))
          if (workRaw === undefined) throw new InquiryDispositionStoreError('DISPOSITION_CONFLICT')
          const work = parseInquiryWork(workRaw)
          if (work.openInquiryIds.includes(inquiryId)) throw new InquiryDispositionStoreError('DISPOSITION_CORRUPT')
        }
        const diagnostic = correlated.diagnostics.find(item => item.eventId === input.eventId)
        const expectedStatus = input.kind === 'retained' ? 'retained' : 'refused'
        if (!diagnostic || correlated.status !== expectedStatus || diagnostic.code !== input.code || diagnostic.at !== input.at
          || !((correlated.result.kind === 'answer' && (answerMatches || answerDispositionDuplicate)) || failureMatches)) {
          throw new InquiryDispositionStoreError('DISPOSITION_CONFLICT')
        }
        result = { inquiry, outbox: correlated }; return
      }
      if (correlated.status !== 'pending') throw new InquiryDispositionStoreError('DISPOSITION_CONFLICT')
      if (!(answerMatches || failureMatches)) throw new InquiryDispositionStoreError('DISPOSITION_CONFLICT')

      const nextOutbox = input.kind === 'retained'
        ? retainInquiryResult(correlated,{eventId:input.eventId,at:input.at,code:input.code})
        : refuseInquiryResult(correlated,{eventId:input.eventId,at:input.at,code:input.code})
      const nextInquiry = correlated.result.kind === 'answer' && inquiry.status === 'answered'
        ? applyInquiryEvent(inquiry, {type: input.cause === 'evidence-unknown' ? 'needs-review' : 'cancel', eventId: input.eventId, at: input.at, reason: input.reason})
        : inquiry
      tx.put('inquiry_results',correlated.dedupKey,nextOutbox)
      if (nextInquiry !== inquiry) tx.put('inquiries',inquiryId,nextInquiry)
      const handoff = this.targetHandoff(inquiryId)
      if (root.kind === 'delivery') {
        if (handoff.work.kind !== 'delivery' || handoff.work.id !== root.deliveryId) throw new InquiryDispositionStoreError('DISPOSITION_CORRUPT')
      } else {
        if (handoff.work.kind !== 'local' || handoff.work.sessionId !== root.inquiry.requester.sessionId) throw new InquiryDispositionStoreError('DISPOSITION_CORRUPT')
        const wk = workKey(handoff.work.sessionId,handoff.work.workId), wraw = this.domain.table('inquiry_works').get(wk)
        if (wraw === undefined) throw new InquiryDispositionStoreError('DISPOSITION_CONFLICT')
        const work = parseInquiryWork(wraw)
        if (work.sessionId !== handoff.work.sessionId || work.workId !== handoff.work.workId
          || work.scopeGeneration !== (root.inquiry.requester.kind === 'child' ? root.inquiry.requester.generation : 0)) throw new InquiryDispositionStoreError('DISPOSITION_CORRUPT')
        if (!work.openInquiryIds.includes(inquiryId)) throw new InquiryDispositionStoreError('DISPOSITION_CONFLICT')
        const openInquiryIds = work.openInquiryIds.filter(id => id !== inquiryId)
        const state = work.state === 'waiting' && openInquiryIds.length === 0 ? 'settled' : work.state
        const updated = parseInquiryWork({...work,openInquiryIds,state,continuationTurn:state === 'settled' ? null : work.continuationTurn})
        tx.put('inquiry_works',wk,updated)
      }
      result = {inquiry:nextInquiry,outbox:nextOutbox}
    })
    return result!
  }
}
