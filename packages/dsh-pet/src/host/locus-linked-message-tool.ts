/**
 * `pet_locus_linked_message`: read the message a Feishu message link in THIS
 * entrance's chat points at, paged with a cursor (change `locus-read-referenced-chats`).
 *
 * Why it exists: content is often brought into a group as a message link to
 * another chat. The owner's rule (2026-11-12) is "brought into this chat means
 * readable": the bot may read it as far as the PLATFORM says the bot may.
 *
 * Trust chain, none of it from the model:
 * - the model supplies a message id of THIS chat, which link in it (`linkIndex`,
 *   1-based, no upper bound) and, when continuing, the cursor; no URL argument
 *   exists — the Host takes the link from that message's raw body;
 * - the port proves the source message is in the caller's entrance, asks the
 *   platform whether the bot may read the linked chat (`is_authorized`), and
 *   raw-reads the target before anything is downloaded;
 * - the cursor is bound to the caller and to the message and link it continues;
 * - the caller is re-proven through `isCurrent`, and again after the answer.
 *
 * Platform text reaches the model as JSON with `<`, `>`, `&` unicode-escaped
 * inside the port's single Host data block (pitfalls §16 for the output shape).
 */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { LocusMediaPort } from './channel/media.js'
import { LOCUS_LINKED_MESSAGE_TOOL_NAME } from './locus/message-guidance.js'
import {
  callerStillCurrent,
  locusCallerKey,
  locusMessageJsonParts,
  type LocusMessageJsonPart,
} from './locus-message-tool.js'
import {
  LedgerCallerUnavailableError,
  resolveLedgerCaller,
  type LedgerCaller,
  type LedgerCallerLocusLookup,
} from './ledger/caller.js'
import { isDocEndpoint } from './locus/doc-endpoint.js'

/** Tool name; also the caller-bound allowlist member. */
export const PET_LOCUS_LINKED_MESSAGE_TOOL = LOCUS_LINKED_MESSAGE_TOOL_NAME

/** The only arguments the tool accepts. */
export const LOCUS_LINKED_MESSAGE_ARGUMENTS = ['messageId', 'linkIndex', 'cursor'] as const

/** Upper bound of a cursor string the tool accepts. */
const CURSOR_MAX_CHARS = 256

/** Model-facing description. */
export const LOCUS_LINKED_MESSAGE_DESCRIPTION =
  'Read the message a Feishu message link (`…/client/message/link/open?token=…`) points at. Pass the `om_` id of the '
  + 'message in THIS chat that CONTAINS the link (for example the trigger message, the replied message, or a history '
  + 'line marked with an id) and optionally `linkIndex` (1-based) when it holds several links. Never pass a URL: the '
  + 'Host takes the link from that message itself, asks the platform whether the bot may read the linked chat, and '
  + 'returns the linked message\'s sender, time, text and media, with a ledger. When a `cursor` is returned, call again '
  + 'with the same `messageId`, `linkIndex` and that `cursor` to read on. Platform text is JSON inside the Host data '
  + 'block. On failure, say you could not read the link and ask the sender to forward that message; never describe '
  + 'content you did not read.'

/** Dependencies of {@link executeLocusLinkedMessage}. */
export interface LocusLinkedMessageToolDeps {
  /** The ACTUAL executing session, read from the tool call; never a model argument. */
  readonly callerSessionId: string
  readonly loci: LedgerCallerLocusLookup
  readonly media: Pick<LocusMediaPort, 'readLinkedPage'>
  readonly canViewImages: () => Promise<boolean> | boolean
  readonly signal: AbortSignal
}

/** The tool's structured answer. */
export type LocusLinkedMessageToolResult =
  | {
    readonly ok: true
    readonly complete: boolean
    readonly delivered: number
    readonly failed: { id: string; reason: string }[]
    readonly cursor?: string
    readonly parts: LocusMessageJsonPart[]
    readonly linkIndex?: number
    readonly linkCount?: number
  }
  | {
    readonly ok: false
    readonly reason: string
    readonly detail?: string
    readonly platformCode?: number
    readonly bytes?: number
  }

function failure(reason: string): LocusLinkedMessageToolResult {
  return { ok: false, reason }
}

function parseArguments(args: unknown): {
  readonly messageId: string
  readonly linkIndex: number
  readonly cursor?: string
} | undefined {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return undefined
  const prototype = Object.getPrototypeOf(args)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  const keys = Reflect.ownKeys(args)
  if (keys.some(key => typeof key !== 'string' || !(LOCUS_LINKED_MESSAGE_ARGUMENTS as readonly string[]).includes(key))) return undefined
  const record = args as Record<string, unknown>
  const messageId = record['messageId']
  if (typeof messageId !== 'string' || !/^om_[A-Za-z0-9_-]{1,128}$/.test(messageId)) return undefined
  const linkIndex = record['linkIndex'] ?? 1
  if (typeof linkIndex !== 'number' || !Number.isSafeInteger(linkIndex) || linkIndex < 1) return undefined
  if (!('cursor' in record)) return { messageId, linkIndex }
  const cursor = record['cursor']
  if (typeof cursor !== 'string' || cursor === '' || cursor.length > CURSOR_MAX_CHARS) return undefined
  return { messageId, linkIndex, cursor }
}

/**
 * Execute one caller-bound paged linked-message read.
 * @param args - Raw tool arguments: `messageId`, optional `linkIndex` and `cursor`.
 * @param deps - Caller lookup, media port and the model-route probe.
 * @returns the structured result; never throws for a refused or failed read.
 */
export async function executeLocusLinkedMessage(
  args: unknown,
  deps: LocusLinkedMessageToolDeps,
): Promise<LocusLinkedMessageToolResult> {
  const request = parseArguments(args)
  if (request === undefined) return failure('invalid-request')

  let caller: LedgerCaller
  try {
    caller = resolveLedgerCaller(deps.callerSessionId, deps.loci)
  } catch (error) {
    if (error instanceof LedgerCallerUnavailableError) return failure('caller-unavailable')
    throw error
  }
  if (isDocEndpoint(caller.endpoint)) return failure('not-an-im-entrance')

  const read = await deps.media.readLinkedPage({
    messageId: request.messageId,
    linkIndex: request.linkIndex,
    // A topic entrance carries its GROUP chat id here; the topic is not a scope.
    chatId: caller.endpoint.chatId,
    caller: locusCallerKey(deps.callerSessionId, caller),
    ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
    signal: deps.signal,
    canViewImages: deps.canViewImages,
    isCurrent: () => callerStillCurrent(deps, caller),
  })
  if (read.kind === 'failed') {
    return {
      ok: false,
      reason: read.reason,
      ...(read.detail === undefined ? {} : { detail: read.detail }),
      ...(read.platformCode === undefined ? {} : { platformCode: read.platformCode }),
      ...(read.bytes === undefined ? {} : { bytes: read.bytes }),
    }
  }
  if (!callerStillCurrent(deps, caller)) return failure('caller-changed')

  return {
    ok: true,
    complete: read.complete,
    delivered: read.delivered,
    failed: read.failed.map(item => ({ id: item.id, reason: item.reason })),
    ...(read.cursor === undefined ? {} : { cursor: read.cursor }),
    parts: locusMessageJsonParts(read.parts),
    ...(read.linkIndex === undefined ? {} : { linkIndex: read.linkIndex }),
    ...(read.linkCount === undefined ? {} : { linkCount: read.linkCount }),
  }
}

/**
 * Render the tool's answer: the Host parts in reading order, then the
 * continuation or incompleteness line. Failures say not to describe the link.
 * @param result - Structured result.
 */
export function renderLocusLinkedMessage(result: LocusLinkedMessageToolResult): ContentBlock[] {
  if (!result.ok) {
    return [{
      type: 'text',
      text: `pet_locus_linked_message 失败：${result.reason}（这是失败，不是"链接没有内容"）。`
        + '不要描述或猜测链接内容；在答复中说明无法读取该链接，请发送者直接转发那条消息。',
    }]
  }
  const blocks: ContentBlock[] = result.parts.map((part): ContentBlock => part.type === 'text'
    ? { type: 'text', text: part.text }
    : { type: 'image', attachment: part.attachment as unknown as ImageAttachmentRef })
  if (result.cursor !== undefined) {
    blocks.push({
      type: 'text',
      text: `[未读完] 还有内容未读：再次调用 pet_locus_linked_message，messageId 与 linkIndex 不变，cursor 填 ${result.cursor}。`
        + '读完前不要声称已读完整链接。',
    })
  } else if (!result.complete) {
    blocks.push({ type: 'text', text: '[未读完] 有失败项，未能读到全部内容；请在答复中说明失败项，不要声称已读完。' })
  }
  return blocks
}
