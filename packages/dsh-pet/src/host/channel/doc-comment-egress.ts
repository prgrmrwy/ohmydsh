/**
 * Doc-comment egress: business replies, control receipts and reaction
 * feedback for `doc:docx:` loci (openspec pet-locus-doc-comments D5/D8).
 *
 * Every target is derived from the DURABLE Delivery: the reply goes to the
 * comment named in its `messageId`, and only after proving that comment and
 * token match the locus endpoint. Nothing here takes a doc, comment or reply
 * selector from a model, and nothing here calls an IM API.
 *
 * @module
 */

import type { LarkClient } from './lark.js'
import { docReplyTarget, parseDocChatId, parseDocMessageId } from '../locus/doc-endpoint.js'
import { DOC_ASK_SCOPE_DISCLOSURE } from '../locus/control.js'

/** Reactions in the Drive enum (spike E15; `OnIt` is not in it). */
export const DOC_REACTION = { inProgress: 'Typing', done: 'DONE', failed: 'CRY' } as const

/** The disclosure every first entry of a document announces (D7); one source with /bind. */
export const DOC_DISCLOSURE_TEXT = DOC_ASK_SCOPE_DISCLOSURE

type DriveClient = Pick<LarkClient, 'replyComment' | 'reactCommentReply' | 'addWholeComment'>

/** A target as the locus layer knows it: an endpoint and the trigger message id. */
export interface DocEgressTarget {
  readonly chatId: string
  readonly threadId?: string
  readonly messageId: string
  /** The durable asker; a whole-doc answer mentions exactly this open id. */
  readonly senderOpenId?: string
}

const OPEN_ID = /^ou_[A-Za-z0-9]+$/

/**
 * Where an answer goes, proven from the durable target alone (D5/D8):
 * - an anchored entry replies under its own comment;
 * - a whole-doc entry opens a NEW full comment mentioning the asker, because
 *   Feishu refuses replies to `is_whole` comments (1069302).
 */
type DocAnswerRoute =
  | { readonly kind: 'reply'; readonly token: string; readonly commentId: string }
  | { readonly kind: 'whole'; readonly token: string; readonly mentionOpenId: string }

function routeAnswer(target: DocEgressTarget): DocAnswerRoute | undefined {
  const proven = proveDocReplyTarget(target)
  if (proven === undefined) return undefined
  if (target.threadId !== undefined) return { kind: 'reply', token: proven.token, commentId: proven.commentId }
  const asker = target.senderOpenId
  if (asker === undefined || !OPEN_ID.test(asker)) return undefined
  return { kind: 'whole', token: proven.token, mentionOpenId: asker }
}

async function sendRouted(client: DriveClient, route: DocAnswerRoute, text: string): Promise<'success' | 'unknown' | 'unavailable'> {
  if (route.kind === 'reply') {
    if (client.replyComment === undefined) return 'unavailable'
    return client.replyComment(route.token, route.commentId, text)
  }
  if (client.addWholeComment === undefined) return 'unavailable'
  return client.addWholeComment(route.token, route.mentionOpenId, text)
}

/** Outcome of a business reply; `refused` sends nothing. */
export type DocReplyOutcome =
  | { readonly kind: 'sent' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'refused'; readonly reason: 'association-unproven' }

/**
 * Prove the Delivery's trigger belongs to its own endpoint (D5): same token,
 * and for a comment-level entry the same comment id. Pure; no platform call.
 */
export function proveDocReplyTarget(target: DocEgressTarget): { readonly token: string; readonly commentId: string; readonly replyId: string } | undefined {
  return docReplyTarget(
    { chatId: target.chatId, ...(target.threadId === undefined ? {} : { threadId: target.threadId }) },
    target.messageId,
  )
}

/**
 * Send the business reply of a doc Delivery as a plain-text comment reply.
 * `unknown` means it may or may not have reached the platform and must NOT be
 * retried (same rule as IM).
 */
export async function sendDocBusinessReply(client: DriveClient, target: DocEgressTarget, text: string): Promise<DocReplyOutcome> {
  const route = routeAnswer(target)
  if (route === undefined) return { kind: 'refused', reason: 'association-unproven' }
  try {
    const result = await sendRouted(client, route, text)
    if (result === 'unavailable') return { kind: 'refused', reason: 'association-unproven' }
    return result === 'success' ? { kind: 'sent' } : { kind: 'unknown' }
  } catch {
    return { kind: 'unknown' }
  }
}

/** A Host control receipt (not business text) under the triggering comment. Throws on failure. */
export async function sendDocControlReceipt(client: DriveClient, target: DocEgressTarget, text: string): Promise<void> {
  const route = routeAnswer(target)
  if (route === undefined) throw new Error('doc control receipt: association-unproven')
  const result = await sendRouted(client, route, text)
  if (result === 'unavailable') throw new Error('doc control receipt: association-unproven')
  if (result !== 'success') throw new Error('doc control receipt: result unknown')
}

/**
 * Reaction feedback on the trigger reply. Fail-soft by contract: callers wrap
 * it, and a failure only reaches diagnostics, never Delivery state.
 */
export async function reactOnDocTrigger(
  client: DriveClient,
  messageId: string,
  phase: 'accepted' | 'settled' | 'failed' | 'no-reply',
): Promise<void> {
  const trigger = parseDocMessageId(messageId)
  if (trigger === undefined || client.reactCommentReply === undefined) return
  const react = client.reactCommentReply.bind(client)
  if (phase === 'accepted') {
    await react(trigger.token, trigger.replyId, DOC_REACTION.inProgress, 'add')
    return
  }
  // `delete` removes the bot's own reaction, so no reaction id is needed.
  await react(trigger.token, trigger.replyId, DOC_REACTION.inProgress, 'delete')
  if (phase === 'settled') await react(trigger.token, trigger.replyId, DOC_REACTION.done, 'add')
  if (phase === 'failed') await react(trigger.token, trigger.replyId, DOC_REACTION.failed, 'add')
}

/** The docx token behind a doc locus root, for doc-only reads. */
export function docTokenOf(chatId: string): string | undefined {
  return parseDocChatId(chatId)
}

/** The narrow durable surface a doc finish needs. */
export interface DocFinishRepository {
  markDeliveryFinishing(input: {
    readonly endpoint: { readonly chatId: string; readonly threadId?: string }
    readonly locusId: string
    readonly generation: number
    readonly childSessionId: string
    readonly deliveryId: string
    readonly now: number
    readonly expectedRevision?: number
  }): Promise<{ readonly changed: boolean; readonly record?: { readonly revision?: number; readonly stateRevision?: number } }>
  completeCurrentDelivery(input: Record<string, unknown>): Promise<{ readonly changed: boolean; readonly record?: unknown }>
}

/** One current doc Delivery, as `finish(reply)` sees it. */
export interface DocFinishCurrent {
  readonly deliveryId: string
  readonly messageId: string
  readonly senderOpenId?: string
  readonly endpoint: { readonly chatId: string; readonly threadId?: string }
  readonly revision?: number
}

/**
 * `pet_locus_finish(reply)` for a doc Delivery, end to end on the durable
 * lifecycle: prove → reserve `finishing` → send → record. The proof runs
 * BEFORE the reservation, so an unproven association never leaves `current`.
 * @returns `refused` (nothing changed), or the recorded outbound result.
 */
export async function finishDocReply(input: {
  readonly repository: DocFinishRepository
  readonly client: DriveClient
  readonly correlation: { readonly endpoint: { readonly chatId: string; readonly threadId?: string }; readonly locusId: string; readonly generation: number; readonly childSessionId: string }
  readonly current: DocFinishCurrent
  readonly text: string
  readonly now: () => number
}): Promise<{ readonly kind: 'refused' } | { readonly kind: 'recorded'; readonly outboundResult: 'success' | 'unknown'; readonly record: unknown }> {
  const target: DocEgressTarget = {
    chatId: input.current.endpoint.chatId,
    ...(input.current.endpoint.threadId === undefined ? {} : { threadId: input.current.endpoint.threadId }),
    messageId: input.current.messageId,
    ...(input.current.senderOpenId === undefined ? {} : { senderOpenId: input.current.senderOpenId }),
  }
  // The whole route (comment, or asker to mention) is proven BEFORE reserving.
  if (routeAnswer(target) === undefined) return { kind: 'refused' }
  const finishing = await input.repository.markDeliveryFinishing({
    ...input.correlation,
    deliveryId: input.current.deliveryId,
    now: input.now(),
    ...(input.current.revision === undefined ? {} : { expectedRevision: input.current.revision }),
  })
  if (!finishing.changed || finishing.record === undefined) throw new Error('This Delivery could not be reserved for reply.')
  const sent = await sendDocBusinessReply(input.client, target, input.text)
  const outboundResult = sent.kind === 'sent' ? 'success' as const : 'unknown' as const
  const revision = finishing.record.revision ?? finishing.record.stateRevision
  const completed = await input.repository.completeCurrentDelivery({
    ...input.correlation,
    deliveryId: input.current.deliveryId,
    now: input.now(),
    outcome: 'reply',
    outboundResult,
    ...(outboundResult === 'unknown' ? { outboundDiagnostic: 'reply result was not reliably confirmed' } : {}),
    ...(revision === undefined ? {} : { expectedRevision: revision }),
  })
  if (!completed.changed || completed.record === undefined) throw new Error('Delivery reply result could not be durably recorded.')
  return { kind: 'recorded', outboundResult, record: completed.record }
}
