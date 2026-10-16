/**
 * Doc-comment locus endpoints (openspec pet-locus-doc-comments D4/D5).
 *
 * A Feishu document is a locus ROOT like a group, and an anchored comment is a
 * sub-entry like a topic. Rather than a new field that every normalizer and
 * key path would have to carry (and silently drop — pitfalls §11), the
 * category lives IN the root id: `chatId = "doc:docx:<token>"`, with
 * `threadId = <comment_id>` for an anchored comment. Every existing chatId-keyed
 * path is therefore disjoint by construction, and an IM egress handed a doc id
 * throws locally (`requireChatId` wants `oc_`) instead of reaching a real chat.
 *
 * The raw token is recovered ONLY here, for doc egress.
 *
 * @module
 */

/** Root-id prefix for docx documents. */
export const DOC_CHAT_PREFIX = 'doc:docx:' as const

/** Bounded alphabets measured on real ids (spike E1/E2/E5). */
const DOC_TOKEN = /^[A-Za-z0-9]+$/
const NUMERIC_ID = /^[0-9]+$/

/** Whether a locus root id names a document rather than a chat. */
export function isDocEndpoint(endpoint: { readonly chatId: string }): boolean {
  return endpoint.chatId.startsWith('doc:')
}

/** Build the root id for a docx token, or `undefined` when the token is not a docx token. */
export function docChatId(token: string): string | undefined {
  return DOC_TOKEN.test(token) ? `${DOC_CHAT_PREFIX}${token}` : undefined
}

/** Recover the docx token from a doc root id; `undefined` for anything else. */
export function parseDocChatId(chatId: string): string | undefined {
  if (!chatId.startsWith(DOC_CHAT_PREFIX)) return undefined
  const token = chatId.slice(DOC_CHAT_PREFIX.length)
  return DOC_TOKEN.test(token) ? token : undefined
}

/** The parts of a doc Delivery's trigger id. */
export interface DocTrigger {
  readonly token: string
  readonly commentId: string
  readonly replyId: string
}

/**
 * Durable trigger id for a doc Delivery: `doc:docx:<token>/<comment_id>/<reply_id>`.
 * It is the dedup key and acceptance order key; it is never an IM message id.
 */
export function docMessageId(trigger: DocTrigger): string | undefined {
  if (!DOC_TOKEN.test(trigger.token)) return undefined
  if (!NUMERIC_ID.test(trigger.commentId) || !NUMERIC_ID.test(trigger.replyId)) return undefined
  return `${DOC_CHAT_PREFIX}${trigger.token}/${trigger.commentId}/${trigger.replyId}`
}

/** Parse {@link docMessageId}; `undefined` for anything malformed. */
export function parseDocMessageId(messageId: string): DocTrigger | undefined {
  if (!messageId.startsWith(DOC_CHAT_PREFIX)) return undefined
  const parts = messageId.slice(DOC_CHAT_PREFIX.length).split('/')
  if (parts.length !== 3) return undefined
  const [token, commentId, replyId] = parts as [string, string, string]
  if (!DOC_TOKEN.test(token) || !NUMERIC_ID.test(commentId) || !NUMERIC_ID.test(replyId)) return undefined
  return { token, commentId, replyId }
}

/**
 * Resolve the immutable comment a doc Delivery replies to, proving it belongs
 * to the Delivery's own endpoint. Any mismatch fails closed.
 * @returns the target, or `undefined` (caller refuses with `association-unproven`).
 */
export function docReplyTarget(
  endpoint: { readonly chatId: string; readonly threadId?: string },
  messageId: string,
): DocTrigger | undefined {
  const token = parseDocChatId(endpoint.chatId)
  const trigger = parseDocMessageId(messageId)
  if (token === undefined || trigger === undefined) return undefined
  if (trigger.token !== token) return undefined
  if (endpoint.threadId !== undefined && endpoint.threadId !== trigger.commentId) return undefined
  return trigger
}
