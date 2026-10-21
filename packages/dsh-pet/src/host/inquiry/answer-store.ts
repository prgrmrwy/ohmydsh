/** Durable atomic answer + inquiry transition + result-outbox commit. */
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { petDomainSpec } from '../spec.js'
import { applyInquiryEvent, inquiryMemberKey, parseInquiry, type InquiryRecord } from './ledger.js'
import { createInquiryResult, inquiryResultDedupKey, parseInquiryOutboxRecord, type InquiryOutboxRecord } from './outbox.js'
import { parseInquiryAnswer, type InquiryAnswerRecord } from './answer.js'

type Tables = 'inquiries' | 'inquiry_answers' | 'inquiry_results'
type AtomicDomain = Domain<typeof petDomainSpec> & {
  readonly supportsTransaction?: boolean
  transaction?: (body: (tx: { put(table: Tables, key: string, value: unknown): void }) => void) => Promise<void>
}
export class InquiryAnswerStoreError extends Error {
  constructor(readonly code: 'TRANSACTION_UNAVAILABLE' | 'INQUIRY_NOT_FOUND' | 'ANSWER_CONFLICT' | 'INQUIRY_CLOSED' | 'ANSWER_CORRUPT') {
    super(`Inquiry answer commit failed (${code}).`); this.name = 'InquiryAnswerStoreError'
  }
}
function memberKey(value: unknown): string { return inquiryMemberKey(value as never) }
export class InquiryAnswerStore {
  constructor(private readonly domain: AtomicDomain) {}
  get(inquiryId: string): InquiryAnswerRecord | undefined {
    const value = this.domain.table('inquiry_answers').get(inquiryId)
    if (value === undefined) return undefined
    try { const parsed = parseInquiryAnswer(value); if (parsed.inquiryId !== inquiryId) throw new Error(); return parsed }
    catch { throw new InquiryAnswerStoreError('ANSWER_CORRUPT') }
  }
  async commit(answerInput: InquiryAnswerRecord, eventId: string): Promise<InquiryAnswerRecord> {
    const answer = parseInquiryAnswer(answerInput)
    const domain = this.domain
    if (domain.supportsTransaction !== true || typeof domain.transaction !== 'function') throw new InquiryAnswerStoreError('TRANSACTION_UNAVAILABLE')
    let result: InquiryAnswerRecord | undefined
    await domain.transaction(tx => {
      const inquiryValue = domain.table('inquiries').get(answer.inquiryId)
      if (inquiryValue === undefined) throw new InquiryAnswerStoreError('INQUIRY_NOT_FOUND')
      const inquiry = parseInquiry(inquiryValue)
      if (inquiry.id !== answer.inquiryId) throw new InquiryAnswerStoreError('ANSWER_CORRUPT')
      if (memberKey(inquiry.target) !== memberKey(answer.answeredBy)) throw new InquiryAnswerStoreError('ANSWER_CONFLICT')
      const existingValue = domain.table('inquiry_answers').get(answer.inquiryId)
      if (existingValue !== undefined) {
        let existing: InquiryAnswerRecord
        try { existing = parseInquiryAnswer(existingValue) } catch { throw new InquiryAnswerStoreError('ANSWER_CORRUPT') }
        if (existing.inquiryId !== answer.inquiryId) throw new InquiryAnswerStoreError('ANSWER_CORRUPT')
        if (inquiry.status !== 'answered') throw new InquiryAnswerStoreError('INQUIRY_CLOSED')
        if (memberKey(existing.answeredBy) !== memberKey(inquiry.target)) throw new InquiryAnswerStoreError('ANSWER_CONFLICT')
        const expected = createInquiryResult({ inquiryId: inquiry.id, requester: inquiry.requester, resumeWork: inquiry.origin,
          result: { kind: 'answer', answeredAt: existing.answeredAt }, createdAt: existing.answeredAt })
        let correlated: InquiryOutboxRecord | undefined
        for (const [key, value] of domain.table('inquiry_results').entries()) {
          let parsed: InquiryOutboxRecord
          try { parsed = parseInquiryOutboxRecord(value) } catch { throw new InquiryAnswerStoreError('ANSWER_CORRUPT') }
          if (key !== parsed.dedupKey) throw new InquiryAnswerStoreError('ANSWER_CORRUPT')
          if (parsed.inquiryId !== answer.inquiryId) continue
          if (correlated) throw new InquiryAnswerStoreError('ANSWER_CORRUPT')
          if (parsed.result.kind !== 'answer' || parsed.dedupKey !== expected.dedupKey
            || memberKey(parsed.requester) !== memberKey(expected.requester)
            || JSON.stringify(parsed.resumeWork) !== JSON.stringify(expected.resumeWork)
            || JSON.stringify(parsed.result) !== JSON.stringify(expected.result) || parsed.createdAt !== expected.createdAt
            || parsed.status !== 'pending') throw new InquiryAnswerStoreError('ANSWER_CONFLICT')
          correlated = parsed
        }
        if (!correlated) throw new InquiryAnswerStoreError('ANSWER_CORRUPT')
        result = existing
        return
      }
      if (inquiry.status !== 'executing') throw new InquiryAnswerStoreError('INQUIRY_CLOSED')
      const nextInquiry = applyInquiryEvent(inquiry, { type: 'answer', eventId, at: answer.answeredAt, reason: null })
      const outbox = createInquiryResult({ inquiryId: inquiry.id, requester: inquiry.requester, resumeWork: inquiry.origin,
        result: { kind: 'answer', answeredAt: answer.answeredAt }, createdAt: answer.answeredAt })
      const resultTable = domain.table('inquiry_results')
      let sameResult: InquiryOutboxRecord | undefined
      for (const [key, value] of resultTable.entries()) {
        let parsed: InquiryOutboxRecord
        try { parsed = parseInquiryOutboxRecord(value) } catch { throw new InquiryAnswerStoreError('ANSWER_CORRUPT') }
        if (key !== parsed.dedupKey) throw new InquiryAnswerStoreError('ANSWER_CORRUPT')
        if (parsed.inquiryId !== answer.inquiryId) continue
        if (sameResult) throw new InquiryAnswerStoreError('ANSWER_CORRUPT')
        if (parsed.result.kind !== 'answer') throw new InquiryAnswerStoreError('ANSWER_CONFLICT')
        sameResult = parsed
      }
      const existingOutbox = resultTable.get(outbox.dedupKey)
      if (sameResult !== undefined && (sameResult.status !== 'pending' || memberKey(sameResult.requester) !== memberKey(outbox.requester)
        || JSON.stringify(sameResult.resumeWork) !== JSON.stringify(outbox.resumeWork)
        || JSON.stringify(sameResult.result) !== JSON.stringify(outbox.result)
        || sameResult.createdAt !== outbox.createdAt || sameResult.dedupKey !== outbox.dedupKey)) {
        throw new InquiryAnswerStoreError('ANSWER_CONFLICT')
      }
      tx.put('inquiry_answers', answer.inquiryId, answer)
      tx.put('inquiries', answer.inquiryId, nextInquiry)
      if (existingOutbox === undefined) tx.put('inquiry_results', inquiryResultDedupKey(answer.inquiryId, outbox.result), outbox)
      result = answer
    })
    return result!
  }
}
