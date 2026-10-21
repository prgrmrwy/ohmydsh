/**
 * Caller-bound, inquiry-bound ANSWER submission.
 *
 * Atomic durable commit is an optional seam for the next production assembly
 * batch; without it the legacy behavior remains for existing isolated callers.
 */
import {
  readForCollaborationCaller, type CollaborationCaller, type CollaborationCallerPorts,
} from '../collaboration/caller.js'
import { inquiryMemberKey, parseInquiry, type InquiryRecord, type InquiryScope } from './ledger.js'

export const INQUIRY_ANSWER_CONFIDENCE = Object.freeze(['confirmed', 'suggested', 'unknown'] as const)
export type InquiryAnswerConfidence = (typeof INQUIRY_ANSWER_CONFIDENCE)[number]
export const INQUIRY_ANSWER_RECENCY = Object.freeze(['current', 'as-of-recorded-work', 'stale', 'unknown'] as const)
export type InquiryAnswerRecency = (typeof INQUIRY_ANSWER_RECENCY)[number]
export const INQUIRY_ANSWER_LIMITS = Object.freeze({ answerLength: 8_192, sources: 8, sourceLength: 512 })
const ANSWER_KEYS = Object.freeze(['inquiryId', 'answer', 'confidence', 'recency', 'sources'])

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

export interface InquiryAnswerDependencies {
  readonly ports: CollaborationCallerPorts
  readonly ledger: {
    get(inquiryId: string): InquiryRecord | undefined
    applyEvent(inquiryId: string, event: unknown): Promise<InquiryRecord>
    recordDiagnostic(inquiryId: string, entry: unknown): Promise<InquiryRecord>
  }
  readonly answers: { get(inquiryId: string): unknown; put(inquiryId: string, value: InquiryAnswerRecord): Promise<unknown> }
  /** When present, commits answer, ledger transition and result outbox atomically. */
  readonly commitAnswer?: (answer: InquiryAnswerRecord, eventId: string) => Promise<InquiryAnswerRecord>
  /** Exact target-turn binding; production always supplies this fail-closed seam. */
  readonly binding?: (callerSessionId: string, inquiryId: string, execution: unknown) => boolean
  /** Post-commit wake only. Failure cannot undo a durable receipt. */
  readonly afterAnswer?: (inquiryId: string) => void | Promise<void>
  readonly now: () => number
  readonly newEventId: () => string
}
export class InquiryAnswerRefusedError extends Error {
  readonly code = 'INQUIRY_ANSWER_REFUSED'
  constructor() { super('This answer cannot be recorded. Answer only an inquiry that was addressed to you, with an explicit source, recency and confidence.'); this.name = 'InquiryAnswerRefusedError' }
}
export class InquiryAnswerClosedError extends Error {
  readonly code = 'INQUIRY_ANSWER_CLOSED'
  constructor(readonly retainedAsDiagnostic: boolean) { super('This inquiry already reached a final state; the late answer was not recorded and did not reopen it.'); this.name = 'InquiryAnswerClosedError' }
}
export interface InquiryAnswerReceipt {
  readonly status: 'recorded'; readonly inquiryId: string; readonly answeredAt: number
  readonly confidence: InquiryAnswerConfidence; readonly recency: InquiryAnswerRecency
  readonly delivered: false; readonly note: string
}
const RECORDED_NOTE = 'Recorded against this inquiry only. It is not delivered yet, it sends no message to any chat, and it settles none of your own work.'
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
function selfScope(caller: CollaborationCaller): InquiryScope {
  return caller.callerLocus === undefined ? { kind: 'main', sessionId: caller.parentSessionId } : { kind: 'child', sessionId: caller.callerSessionId, locusId: caller.callerLocus.locusId, generation: caller.callerLocus.generation }
}
export async function submitInquiryAnswerFromCaller(execution: unknown, args: unknown, deps: InquiryAnswerDependencies): Promise<InquiryAnswerReceipt> {
  let plan: { record: InquiryRecord; answer: InquiryAnswerRecord; duplicate: boolean; closed: boolean } | undefined
  try {
    const sent = fields(args, ANSWER_KEYS)
    const inquiryId = bounded(sent.inquiryId, 256), answer = bounded(sent.answer, INQUIRY_ANSWER_LIMITS.answerLength)
    const confidence = choice(sent.confidence, INQUIRY_ANSWER_CONFIDENCE), recency = choice(sent.recency, INQUIRY_ANSWER_RECENCY), sources = sourceList(sent.sources)
    const sessionId = (execution as { agent?: { id?: unknown } } | undefined)?.agent?.id
    if (typeof sessionId !== 'string') refuse()
    plan = await readForCollaborationCaller(sessionId, deps.ports, caller => {
      const record = deps.ledger.get(inquiryId)
      if (record === undefined || inquiryMemberKey(record.target) !== inquiryMemberKey(selfScope(caller))) refuse()
      if (deps.binding !== undefined && !deps.binding(sessionId, inquiryId, execution)) refuse()
      const terminal = record.status !== 'queued' && record.status !== 'executing' && record.status !== 'answered'
      if (!terminal && record.status === 'queued') refuse()
      return { record, duplicate: record.status === 'answered' || deps.answers.get(inquiryId) !== undefined, closed: terminal,
        answer: Object.freeze({ inquiryId, answeredBy: selfScope(caller), answer, confidence, recency, sources, answeredAt: deps.now() }) }
    })
  } catch { throw new InquiryAnswerRefusedError() }
  const { record, answer, duplicate, closed } = plan
  if (closed) { let retained = false; try { await deps.ledger.recordDiagnostic(record.id, { kind: 'late-answer', at: answer.answeredAt, eventId: deps.newEventId() }); retained = true } catch { /* evidence best effort */ }; throw new InquiryAnswerClosedError(retained) }
  if (duplicate) {
    if (deps.commitAnswer) {
      try {
        const committed = await deps.commitAnswer(answer, deps.newEventId())
        if (deps.afterAnswer) { try { await deps.afterAnswer(record.id) } catch { /* durable receipt remains authoritative; recovery is external */ } }
        return receipt(committed)
      } catch { throw new InquiryAnswerRefusedError() }
    }
    // Legacy branch is retained only for isolated unit callers without a durable committer.
    try { await deps.ledger.recordDiagnostic(record.id, { kind: 'duplicate-answer', at: answer.answeredAt, eventId: deps.newEventId() }) } catch { /* no-op */ }
    const retained = deps.answers.get(record.id)
    if (retained === undefined) throw new InquiryAnswerRefusedError()
    return receipt(retained as InquiryAnswerRecord)
  }
  try {
    const committed = deps.commitAnswer
      ? await deps.commitAnswer(answer, deps.newEventId())
      : ((await deps.answers.put(record.id, answer) ?? answer) as InquiryAnswerRecord)
    if (!deps.commitAnswer) await deps.ledger.applyEvent(record.id, { type: 'answer', eventId: deps.newEventId(), at: answer.answeredAt, reason: null })
    if (deps.commitAnswer && deps.afterAnswer) {
      try { await deps.afterAnswer(record.id) } catch { /* durable receipt remains authoritative; recovery is external */ }
    }
    return receipt(committed)
  } catch { throw new InquiryAnswerRefusedError() }
}
function receipt(answer: InquiryAnswerRecord): InquiryAnswerReceipt {
  return Object.freeze({ status: 'recorded', inquiryId: answer.inquiryId, answeredAt: answer.answeredAt, confidence: answer.confidence, recency: answer.recency, delivered: false, note: RECORDED_NOTE })
}
