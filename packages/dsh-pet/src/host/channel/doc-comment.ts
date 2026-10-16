/**
 * Doc-comment intake: transport parsing and admission
 * (openspec pet-locus-doc-comments D6/D7).
 *
 * The flow is parse → (comment query, owned by the caller with its retry and
 * cancellation) → admit. Parsing rejects everything that needs no platform
 * call; admission applies the comment-only preconditions and then the SAME
 * shared rules a group uses (`admitCommon`), so the two cannot drift.
 *
 * @module
 */

import type { DocCommentQuery } from './lark.js'
import type { NormalizedLocusAdmission, NormalizedLocusMessage } from './locus-controller.js'
import {
  admitCommon,
  isAdmittableAuthorization,
  locusEndpointKey,
  type LocusAdmissionContext,
} from '../locus/admission.js'
import { docChatId, docMessageId } from '../locus/doc-endpoint.js'
import { DOC_COMMENT_QUOTE_MAX } from '../spec.js'

/** Event type carried on the shared `+subscribe` connection. */
export const DOC_COMMENT_EVENT_TYPE = 'drive.notice.comment_add_v1'

/** One comment event, reduced to the facts admission needs. */
export interface DocCommentEvent {
  readonly token: string
  readonly fileType: string
  readonly commentId: string
  readonly replyId: string
  readonly isMentioned: boolean
  readonly senderOpenId: string
  readonly senderType?: string
  readonly isFromAgent: boolean
  /** Top-level `timestamp` (ms); absent means "skip the watermark". */
  readonly createdAt?: number
}

/** Parsing result. `ignored` reasons are the D13 diagnostic vocabulary. */
export type DocCommentParse =
  | { readonly kind: 'event'; readonly event: DocCommentEvent }
  | { readonly kind: 'ignored'; readonly reason: 'unparsable' | 'unsupported-file-type' | 'no-mention' }

const TRUNCATION_MARK = '…（已截断）'

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * Parse one compact `drive.notice.comment_add_v1` line (lark-cli v1.0.97
 * GenericProcessor: `event` flattened, `notice_meta` nested, top-level
 * `type`/`event_id`/`timestamp`).
 */
export function parseDocCommentEvent(line: string): DocCommentParse {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return { kind: 'ignored', reason: 'unparsable' }
  }
  const root = record(value)
  const meta = record(root?.['notice_meta'])
  if (root === undefined || root['type'] !== DOC_COMMENT_EVENT_TYPE || meta === undefined) {
    return { kind: 'ignored', reason: 'unparsable' }
  }
  const token = text(meta['file_token'])
  const fileType = text(meta['file_type'])
  const commentId = text(root['comment_id'])
  const replyId = text(root['reply_id'])
  const sender = text(record(meta['from_user_id'])?.['open_id'])
  if (token === undefined || fileType === undefined || commentId === undefined || replyId === undefined || sender === undefined) {
    return { kind: 'ignored', reason: 'unparsable' }
  }
  // Both checks need no platform call, so they run before the comment query.
  if (fileType !== 'docx') return { kind: 'ignored', reason: 'unsupported-file-type' }
  if (root['is_mentioned'] !== true) return { kind: 'ignored', reason: 'no-mention' }
  const rawTime = root['timestamp']
  const createdAt = typeof rawTime === 'string' && /^\d+$/.test(rawTime) ? Number(rawTime) : undefined
  const senderType = text(meta['from_user_type'])
  return {
    kind: 'event',
    event: {
      token,
      fileType,
      commentId,
      replyId,
      isMentioned: true,
      senderOpenId: sender,
      ...(senderType === undefined ? {} : { senderType }),
      isFromAgent: meta['is_from_agent'] === true,
      ...(createdAt === undefined || !Number.isFinite(createdAt) ? {} : { createdAt }),
    },
  }
}

/** Bound a quote so that the stored value, marker included, never exceeds the cap. */
export function boundDocCommentQuote(quote: string): string {
  if (quote.length <= DOC_COMMENT_QUOTE_MAX) return quote
  return quote.slice(0, DOC_COMMENT_QUOTE_MAX - TRUNCATION_MARK.length) + TRUNCATION_MARK
}

/** Rejection reasons specific to comments, on top of the shared vocabulary. */
export type DocCommentRefusal = 'bot-sender' | 'comment-scope-unknown' | 'comment-reply-missing' | 'invalid-event'

/**
 * Admit one parsed comment event given its comment query outcome.
 *
 * Whole vs anchored comes ONLY from the queried `is_whole` (D6). The trigger
 * text is the queried reply's body, never another reply on the same comment.
 */
export function admitDocCommentEvent(
  event: DocCommentEvent,
  query: DocCommentQuery,
  context: LocusAdmissionContext,
): NormalizedLocusAdmission {
  if (
    event.isFromAgent ||
    (event.senderType !== undefined && event.senderType !== 'user') ||
    (context.botOpenId !== undefined && event.senderOpenId === context.botOpenId)
  ) {
    return { kind: 'rejected', reason: 'bot-sender' }
  }
  if (query.kind === 'error' || query.kind === 'scope-unknown') {
    return { kind: 'rejected', reason: 'comment-scope-unknown' }
  }
  if (query.kind === 'reply-missing') return { kind: 'rejected', reason: 'comment-reply-missing' }

  const chatId = docChatId(event.token)
  const messageId = docMessageId({ token: event.token, commentId: event.commentId, replyId: event.replyId })
  if (chatId === undefined || messageId === undefined) return { kind: 'rejected', reason: 'invalid-event' }
  const endpoint = query.isWhole
    ? { chatId, key: locusEndpointKey(chatId) }
    : { chatId, threadId: event.commentId, key: locusEndpointKey(chatId, event.commentId) }
  const plain = query.isWhole ? { chatId } : { chatId, threadId: event.commentId }

  const decision = admitCommon({
    endpoint,
    messageId,
    senderId: event.senderOpenId,
    text: query.trigger.text,
    ...(event.createdAt === undefined ? {} : { createTime: String(event.createdAt) }),
    // Like a group: an authorized document admits any commenter's question.
    memberQuestions: true,
  }, context)
  if (!decision.admit) {
    return { kind: 'rejected', reason: decision.reason, endpoint: plain }
  }

  const quote = !query.isWhole && query.quote !== undefined && query.quote !== ''
    ? boundDocCommentQuote(query.quote)
    : undefined
  const message: NormalizedLocusMessage = {
    kind: 'message',
    source: 'doc-comment',
    messageId,
    endpoint: plain,
    senderOpenId: decision.senderId,
    text: decision.text,
    replyTarget: { ...plain, messageId },
    ...(event.createdAt === undefined ? {} : { createdAt: event.createdAt }),
    ...(quote === undefined ? {} : { docComment: { quote } }),
  }
  if (decision.command !== undefined) {
    return { kind: 'control', message, command: decision.command, authorization: decision.authorization }
  }
  if (!isAdmittableAuthorization(decision.authorization)) {
    return { kind: 'rejected', reason: 'authorization-unresolved' }
  }
  return {
    kind: 'accepted',
    message,
    authorization: decision.authorization,
    needsInitialization: decision.needsInitialization,
  }
}
