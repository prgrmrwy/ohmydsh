/** Read-only parser for retained inquiry answer rows; submission is retired. */
import type { InquiryScope } from './ledger.js'

export const INQUIRY_ANSWER_CONFIDENCE = Object.freeze(['confirmed', 'suggested', 'unknown'] as const)
export type InquiryAnswerConfidence = (typeof INQUIRY_ANSWER_CONFIDENCE)[number]
export const INQUIRY_ANSWER_RECENCY = Object.freeze(['current', 'as-of-recorded-work', 'stale', 'unknown'] as const)
export type InquiryAnswerRecency = (typeof INQUIRY_ANSWER_RECENCY)[number]
export const INQUIRY_ANSWER_LIMITS = Object.freeze({ answerLength: 8_192, sources: 8, sourceLength: 512 })

export interface InquiryAnswerRecord {
  readonly inquiryId: string
  readonly answeredBy: InquiryScope
  readonly answer: string
  readonly confidence: InquiryAnswerConfidence
  readonly recency: InquiryAnswerRecency
  readonly sources: readonly string[]
  readonly answeredAt: number
}

/** Parse using the same bounds and exact record shape as the caller protocol. */
export function parseInquiryAnswer(input: unknown): InquiryAnswerRecord {
  const value = fields(input, ['inquiryId', 'answeredBy', 'answer', 'confidence', 'recency', 'sources', 'answeredAt'])
  const inquiryId = bounded(value.inquiryId, 256)
  const answeredBy = scope(value.answeredBy)
  const answer = bounded(value.answer, INQUIRY_ANSWER_LIMITS.answerLength)
  const confidence = choice(value.confidence, INQUIRY_ANSWER_CONFIDENCE)
  const recency = choice(value.recency, INQUIRY_ANSWER_RECENCY)
  const sources = sourceList(value.sources)
  if (!Number.isSafeInteger(value.answeredAt) || (value.answeredAt as number) < 0) refuse()
  return Object.freeze({ inquiryId, answeredBy, answer, confidence, recency, sources, answeredAt: value.answeredAt as number })
}

export class InquiryAnswerRefusedError extends Error {
  readonly code = 'INQUIRY_ANSWER_REFUSED'
  constructor() { super('Invalid retained inquiry answer record.'); this.name = 'InquiryAnswerRefusedError' }
}
function refuse(): never { throw new InquiryAnswerRefusedError() }
function fields(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) refuse()
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) refuse()
  const actual = Reflect.ownKeys(input)
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) refuse()
  const result: Record<string, unknown> = {}
  for (const key of keys) { const p = Object.getOwnPropertyDescriptor(input, key); if (!p || !('value' in p)) refuse(); result[key] = p.value }
  return result
}
function bounded(value: unknown, max: number): string { if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) refuse(); return value }
function sourceList(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > INQUIRY_ANSWER_LIMITS.sources || Reflect.ownKeys(value).length !== value.length + 1) refuse()
  const sources: string[] = []
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i))
    if (!descriptor || !('value' in descriptor)) refuse()
    sources.push(bounded(descriptor.value, INQUIRY_ANSWER_LIMITS.sourceLength))
  }
  return Object.freeze(sources)
}
function choice<T extends string>(value: unknown, allowed: readonly T[]): T { if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) refuse(); return value as T }
function scope(input: unknown): InquiryScope {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) refuse()
  const kind = Object.getOwnPropertyDescriptor(input, 'kind')?.value
  if (kind === 'main') { const v = fields(input, ['kind', 'sessionId']); return Object.freeze({ kind, sessionId: bounded(v.sessionId, 256) }) }
  if (kind === 'child') { const v = fields(input, ['kind', 'sessionId', 'locusId', 'generation']); if (!Number.isSafeInteger(v.generation) || (v.generation as number) < 1) refuse(); return Object.freeze({ kind, sessionId: bounded(v.sessionId,256), locusId: bounded(v.locusId,256), generation: v.generation as number }) }
  return refuse()
}
