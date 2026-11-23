/**
 * Redacted samples of the `lark-cli im +threads-messages-list` envelopes and of
 * lark-cli failure envelopes (lark-cli 1.0.97, bot identity; probes 2026-11-12
 * and 2026-11-21 for change `locus-read-referenced-chats`, task 0.6).
 *
 * Measured facts these samples pin:
 *
 * - the success envelope keeps the page under `data`: `messages[]`, `has_more`,
 *   `page_token` (only while `has_more` is true) and `total`, which is the
 *   number of items on THIS page, not of the thread;
 * - `--order asc` puts the thread root first with `thread_message_position`
 *   `-1` (a string) and replies at `0, 1, …`; every item carries `chat_id` and
 *   `thread_id`;
 * - an invalid `--page-token` fails with code 230001;
 * - failure envelopes are printed on STDERR with an empty stdout (10077,
 *   99992354, 99991672 were all seen that way); {@link failureEnvelopeText}
 *   builds the text both runners (stdout form, stderr form) must map equally.
 *
 * Redaction rule: no real chat, user, message, thread or token survives and no
 * business text is present; every identifier is a synthetic body of the same
 * prefix and length class as the real form.
 *
 * @module
 */

export const TOPIC_CHAT = 'oc_00000000000000000000000000000b01'
export const TOPIC_OTHER_CHAT = 'oc_00000000000000000000000000000b02'
export const TOPIC_THREAD = 'omt_0000000000000b01'
export const TOPIC_OTHER_THREAD = 'omt_0000000000000b02'

/** Id of the n-th item (0 = thread root) of the synthetic topic. */
export function topicMessageId(index: number): string {
  return `om_x100b00000000000000000000000b${String(index).padStart(4, '0')}`
}

export interface TopicItemOptions {
  /** 0 = root; replies are 1-based in this helper and carry platform position `index - 1`. */
  readonly index: number
  readonly chatId?: string
  readonly threadId?: string
  readonly msgType?: string
  readonly content?: string
  readonly position?: number
  readonly deleted?: boolean
  readonly senderName?: string
}

/** One list item as the platform prints it. */
export function topicItem(options: TopicItemOptions): Record<string, unknown> {
  const position = options.position ?? options.index - 1
  return {
    chat_id: options.chatId ?? TOPIC_CHAT,
    content: options.content ?? `夹具话题消息 ${String(options.index)}`,
    create_time: '2026-11-21 10:00',
    deleted: options.deleted ?? false,
    message_id: topicMessageId(options.index),
    message_position: String(1000 + options.index),
    msg_type: options.msgType ?? 'text',
    sender: {
      id: 'ou_00000000000000000000000000000001',
      id_type: 'open_id',
      name: options.senderName ?? '测试用户',
      sender_type: 'user',
      tenant_key: '0000000000000001',
    },
    thread_id: options.threadId ?? TOPIC_THREAD,
    thread_message_position: String(position),
    updated: false,
  }
}

/** Items `from..to` (inclusive) of the topic, root first when `from` is 0. */
export function topicItems(from: number, to: number): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = []
  for (let index = from; index <= to; index += 1) items.push(topicItem({ index }))
  return items
}

export interface TopicPageOptions {
  readonly hasMore?: boolean
  readonly pageToken?: string
}

const NOTICE = {
  update: {
    command: 'lark-cli update',
    current: '1.0.97',
    latest: '1.0.99',
    message: 'lark-cli 1.0.99 is available (current 1.0.97). Run: lark-cli update',
  },
}

/** The success envelope of one list call. */
export function topicPageEnvelope(
  items: readonly Record<string, unknown>[],
  options: TopicPageOptions = {},
): Record<string, unknown> {
  const hasMore = options.hasMore ?? false
  return {
    ok: true,
    identity: 'bot',
    data: {
      has_more: hasMore,
      messages: items,
      ...(hasMore && options.pageToken !== undefined ? { page_token: options.pageToken } : {}),
      total: items.length,
    },
    _notice: NOTICE,
  }
}

/** Page tokens: opaque, synthetic, base64-ish like the platform's. */
export const TOPIC_TOKENS = {
  second: 'PT_0000000000000000000000000000000000000000000000000000000000a2',
  third: 'PT_0000000000000000000000000000000000000000000000000000000000a3',
  fourth: 'PT_0000000000000000000000000000000000000000000000000000000000a4',
} as const

/** Failure codes seen on the wire. */
export const FAILURE_CODES = {
  invalidPageToken: '230001',
  noPermission: '230002',
  scopeMissing: '99991672',
  rateLimited: '99992354',
  appLinkUnresolved: '10077',
} as const

/** The JSON text lark-cli prints for a failure (to stderr in the real tool). */
export function failureEnvelopeText(code: string, message = 'fixture failure'): string {
  return JSON.stringify({
    ok: false,
    identity: 'bot',
    error: { type: 'api_error', code: Number(code), message },
    _notice: NOTICE,
  })
}

/** The failure as a parsed envelope (stdout form). */
export function failureEnvelope(code: string, message?: string): Record<string, unknown> {
  return JSON.parse(failureEnvelopeText(code, message)) as Record<string, unknown>
}
