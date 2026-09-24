/**
 * Caller-bound, inquiry-bound ANSWER submission.
 *
 * Two independent bindings must both hold, and both are re-proven HERE rather
 * than inherited from whatever authorized the dispatch:
 *
 *  1. CALLER-BOUND. The answerer identity comes from the ACTUAL executing
 *     session through the shared caller resolver. There is no `answeredBy`
 *     parameter, so a model cannot attribute an answer to someone else.
 *  2. INQUIRY-BOUND. That identity must equal the stored target of the exact
 *     `inquiryId`, matched on the full member key INCLUDING the locus
 *     generation. A rebuilt successor at the same seat is a different member
 *     and cannot answer an inquiry addressed to its predecessor.
 *
 * There is deliberately NO recipient parameter of any kind. The requester is
 * already recorded on the inquiry, so naming one would only ever be an attempt
 * to redirect an answer. And an answer is never inferred from an assistant's
 * final message: it exists only because the target called this with an explicit
 * body plus explicit source, recency and confidence fields.
 *
 * Recording is not delivering. This module writes the answer and advances the
 * ledger to `answered`; the result outbox, the requester's continuation and any
 * Feishu outbound are other slices' work and are explicitly not performed here.
 * Nothing in this path creates or consumes a Feishu delivery, and nothing here
 * mutates shared public facts.
 */
import {
  readForCollaborationCaller, type CollaborationCaller, type CollaborationCallerPorts,
} from '../collaboration/caller.js'
import { inquiryMemberKey, type InquiryRecord, type InquiryScope } from './ledger.js'

/**
 * How sure the answerer is. An explicit field, never prose in the body.
 *
 * `unknown` exists so a target is never forced to invent a fact to satisfy the
 * schema: "I never decided this" is a valid, useful answer.
 */
export const INQUIRY_ANSWER_CONFIDENCE = Object.freeze(['confirmed', 'suggested', 'unknown'] as const)
export type InquiryAnswerConfidence = (typeof INQUIRY_ANSWER_CONFIDENCE)[number]

/** How current the answer is, as a fact about the answer rather than a hedge. */
export const INQUIRY_ANSWER_RECENCY = Object.freeze([
  'current', 'as-of-recorded-work', 'stale', 'unknown',
] as const)
export type InquiryAnswerRecency = (typeof INQUIRY_ANSWER_RECENCY)[number]

/** Bounds keep one answer from becoming a transcript dump. */
export const INQUIRY_ANSWER_LIMITS = Object.freeze({
  answerLength: 8_192,
  sources: 8,
  sourceLength: 512,
})

/** Exactly what a model may send. Anything else is a refusal. */
const ANSWER_KEYS = Object.freeze(['inquiryId', 'answer', 'confidence', 'recency', 'sources'])

/**
 * The durable answer body.
 *
 * `answeredBy` is Host-derived provenance written here, not a submitted field.
 * The record holds the answer text and its provenance only — never an excerpt
 * of the responder's transcript, and never the requester's chat or delivery.
 */
export interface InquiryAnswerRecord {
  readonly inquiryId: string
  readonly answeredBy: InquiryScope
  readonly answer: string
  readonly confidence: InquiryAnswerConfidence
  readonly recency: InquiryAnswerRecency
  /** Where the claim came from, e.g. work this session actually performed. */
  readonly sources: readonly string[]
  readonly answeredAt: number
}

export interface InquiryAnswerDependencies {
  readonly ports: CollaborationCallerPorts
  readonly ledger: {
    get(inquiryId: string): InquiryRecord | undefined
    applyEvent(inquiryId: string, event: unknown): Promise<InquiryRecord>
    recordDiagnostic(inquiryId: string, entry: unknown): Promise<InquiryRecord>
  }
  /** Put-if-absent answer storage; the FIRST answer is the durable one. */
  readonly answers: {
    get(inquiryId: string): unknown
    put(inquiryId: string, value: InquiryAnswerRecord): Promise<unknown>
  }
  readonly now: () => number
  readonly newEventId: () => string
}

/** One uniform denial for a non-target, an unknown inquiry or a malformed body. */
export class InquiryAnswerRefusedError extends Error {
  readonly code = 'INQUIRY_ANSWER_REFUSED'
  constructor() {
    // Unknown-id and wrong-answerer must be indistinguishable, or this becomes
    // a probe for which inquiries exist and who they were addressed to.
    super('This answer cannot be recorded. Answer only an inquiry that was addressed to you, with an explicit source, recency and confidence.')
    this.name = 'InquiryAnswerRefusedError'
  }
}

/**
 * The inquiry already reached a terminal state.
 *
 * Distinct from the uniform refusal on purpose: the answerer WAS the right
 * member, and the useful fact is that the request is closed. The late body is
 * not stored, but the event is retained as an owner-visible diagnostic, which
 * revives nothing and wakes nobody.
 */
export class InquiryAnswerClosedError extends Error {
  readonly code = 'INQUIRY_ANSWER_CLOSED'
  constructor(readonly retainedAsDiagnostic: boolean) {
    super('This inquiry already reached a final state; the late answer was not recorded and did not reopen it.')
    this.name = 'InquiryAnswerClosedError'
  }
}

/** What the answerer is told. Recording an answer is not delivering it. */
export interface InquiryAnswerReceipt {
  readonly status: 'recorded'
  readonly inquiryId: string
  readonly answeredAt: number
  readonly confidence: InquiryAnswerConfidence
  readonly recency: InquiryAnswerRecency
  /** Always false here: delivery to the requester is a separate, later fact. */
  readonly delivered: false
  readonly note: string
}

const RECORDED_NOTE =
  'Recorded against this inquiry only. It is not delivered yet, it sends no message to any chat, and it settles none of your own work.'

function refuse(): never { throw new InquiryAnswerRefusedError() }

/** Declared keys only, read as data properties; an extra key is a refusal. */
function fields(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) refuse()
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) refuse()
  const actual = Reflect.ownKeys(input)
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) refuse()
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(input, key)
    if (!property || !('value' in property)) refuse()
    result[key] = property.value
  }
  return result
}

function bounded(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) refuse()
  return value
}

/** At least one source: an answer with no stated provenance is not acceptable. */
function sourceList(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > INQUIRY_ANSWER_LIMITS.sources) refuse()
  if (Reflect.ownKeys(value).length !== value.length + 1) refuse()
  return Object.freeze(value.map(entry => bounded(entry, INQUIRY_ANSWER_LIMITS.sourceLength)))
}

function choice<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) refuse()
  return value as T
}

/** The caller's own durable circle position, in the ledger's scope shape. */
function selfScope(caller: CollaborationCaller): InquiryScope {
  return caller.callerLocus === undefined
    ? { kind: 'main', sessionId: caller.parentSessionId }
    : {
        kind: 'child', sessionId: caller.callerSessionId,
        locusId: caller.callerLocus.locusId, generation: caller.callerLocus.generation,
      }
}

/**
 * Submit one answer as the actual target of one inquiry.
 *
 * Identity, the ledger read and the target match all happen at the SAME fence
 * as the caller resolution, so authorization cannot be observed before a
 * revocation and used after it. The writes then happen in a fixed order: the
 * answer body first, the ledger transition second. If the body cannot be
 * stored the inquiry stays `executing`, because marking it answered without a
 * retrievable answer would strand the requester on a promise that no longer
 * exists.
 */
export async function submitInquiryAnswerFromCaller(
  execution: unknown,
  args: unknown,
  deps: InquiryAnswerDependencies,
): Promise<InquiryAnswerReceipt> {
  let plan: {
    readonly record: InquiryRecord
    readonly answer: InquiryAnswerRecord
    readonly duplicate: boolean
    readonly closed: boolean
  } | undefined

  try {
    const sent = fields(args, ANSWER_KEYS)
    const inquiryId = bounded(sent.inquiryId, 256)
    const answer = bounded(sent.answer, INQUIRY_ANSWER_LIMITS.answerLength)
    const confidence = choice(sent.confidence, INQUIRY_ANSWER_CONFIDENCE)
    const recency = choice(sent.recency, INQUIRY_ANSWER_RECENCY)
    const sources = sourceList(sent.sources)
    const sessionId = (execution as { agent?: { id?: unknown } } | undefined)?.agent?.id
    if (typeof sessionId !== 'string') refuse()

    plan = await readForCollaborationCaller(sessionId, deps.ports, caller => {
      const record = deps.ledger.get(inquiryId)
      if (record === undefined) refuse()
      // The single binding check. The member key covers kind and sessionId,
      // and for a child its locusId AND generation, so a rebuilt successor at
      // the same seat is a different member and cannot answer its
      // predecessor's inquiry. `selfScope` comes from the resolver, never from
      // an argument, so this is simultaneously the caller and inquiry binding.
      if (inquiryMemberKey(record.target) !== inquiryMemberKey(selfScope(caller))) refuse()

      const terminal = record.status !== 'queued' && record.status !== 'executing' && record.status !== 'answered'
      // Only a dispatched inquiry can be answered: a queued one was never
      // handed over, so an answer to it would be unsolicited.
      if (!terminal && record.status === 'queued') refuse()
      return {
        record, duplicate: record.status === 'answered' || deps.answers.get(inquiryId) !== undefined,
        closed: terminal,
        answer: Object.freeze({
          inquiryId, answeredBy: selfScope(caller), answer, confidence, recency, sources,
          answeredAt: deps.now(),
        }),
      }
    })
  } catch {
    throw new InquiryAnswerRefusedError()
  }

  const { record, answer, duplicate, closed } = plan

  if (closed) {
    // Evidence only. The pure model preserves status, statusAt and reason, so
    // this cannot revive the request, trigger a continuation or send anything.
    let retained = false
    try {
      await deps.ledger.recordDiagnostic(record.id, {
        kind: 'late-answer', at: answer.answeredAt, eventId: deps.newEventId(),
      })
      retained = true
    } catch { retained = false }
    throw new InquiryAnswerClosedError(retained)
  }

  if (duplicate) {
    // Idempotent: the first answer stands. The redelivery is kept as evidence
    // and advances nothing, so no continuation is started twice.
    try {
      await deps.ledger.recordDiagnostic(record.id, {
        kind: 'duplicate-answer', at: answer.answeredAt, eventId: deps.newEventId(),
      })
    } catch { /* Diagnostics are best-effort; losing one must not fail a no-op. */ }
    const stored = (deps.answers.get(record.id) ?? answer) as InquiryAnswerRecord
    return receipt(stored)
  }

  let committed: InquiryAnswerRecord
  try {
    // Put-if-absent: a concurrent first answer wins and is what we return.
    committed = (await deps.answers.put(record.id, answer) ?? answer) as InquiryAnswerRecord
  } catch {
    // The ledger stays `executing`: never claim answered without a body.
    throw new InquiryAnswerRefusedError()
  }

  try {
    await deps.ledger.applyEvent(record.id, {
      type: 'answer', eventId: deps.newEventId(), at: answer.answeredAt, reason: null,
    })
  } catch {
    // The body is durable and the transition is idempotent, so a reconciliation
    // pass can still advance it; reporting success here would be a lie.
    throw new InquiryAnswerRefusedError()
  }

  return receipt(committed)
}

function receipt(answer: InquiryAnswerRecord): InquiryAnswerReceipt {
  return Object.freeze({
    status: 'recorded' as const,
    inquiryId: answer.inquiryId,
    answeredAt: answer.answeredAt,
    confidence: answer.confidence,
    recency: answer.recency,
    delivered: false as const,
    note: RECORDED_NOTE,
  })
}
