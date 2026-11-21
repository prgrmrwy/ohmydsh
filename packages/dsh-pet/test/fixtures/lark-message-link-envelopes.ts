/**
 * Redacted samples of the REAL envelopes for resolving a Feishu message link
 * (lark-cli 1.0.97, `--profile dsh-pet --as bot`, measured 2026-11-12 for
 * change `locus-read-referenced-chats`).
 *
 * `POST /open-apis/im/v1/message_links/query` has no public doc entry and no
 * lark-cli shortcut; it is called as
 * `lark-cli api POST /open-apis/im/v1/message_links/query --as bot --data '{"message_link_url": …}'`.
 * Measured facts these samples pin:
 *
 * - success keeps `data.chat_info{chat_id,is_authorized,name}` beside
 *   `data.messages[].message{…}`; each message is a SNAPSHOT taken when the link
 *   was copied, and its `body.content` resource keys DIFFER from the original
 *   message's — downloading with a snapshot key fails 234003 "File not in msg".
 *   Pet must raw-read the returned `message_id` and use THAT message's keys.
 * - the snapshot's `create_time` is epoch milliseconds as a string and the
 *   sender carries `sender_name` (the raw read does not).
 * - an app without the scope gets `ok: false` with code 99991672 and
 *   `subtype: app_scope_not_applied`.
 *
 * Redaction rule: as in `lark-message-envelopes.ts` — synthetic ids of the same
 * prefix and length class, no real names or business text, a synthetic token.
 *
 * @module
 */

import { FIXTURE_OTHER_CHAT, rawApiEnvelope } from './lark-message-envelopes.js'

/** The applink host and path the measured link used. */
export const FIXTURE_LINK = 'https://applink.larkoffice.com/client/message/link/open?token=AAAAAAAAAAAAAAAAAAAAAA%3D'
export const FIXTURE_LINK_2 = 'https://applink.feishu.cn/client/message/link/open?token=BBBBBBBBBBBBBBBBBBBBBB%3D'

/** The source message the link points at, in ANOTHER chat. */
export const FIXTURE_LINKED_ID = 'om_x100b0000000000000000000000000101'
export const FIXTURE_SOURCE_NAME = '夹具来源群'

/** Keys as they appear in the SNAPSHOT (unusable for download). */
export const SNAPSHOT_KEYS = {
  cover: 'img_v3_0000_00000000-0000-0000-0000-0000000055c1',
  video: 'file_v3_0000_00000000-0000-0000-0000-0000000055b1',
} as const

/** Keys as they appear in the RAW read of the same message (the downloadable ones). */
export const RAW_LINKED_KEYS = {
  cover: 'img_v3_0000_00000000-0000-0000-0000-00000000ee01',
  video: 'file_v3_0000_00000000-0000-0000-0000-00000000ee02',
} as const

const NOTICE = {
  update: { command: 'lark-cli update', current: '1.0.97', latest: '1.0.100', message: 'lark-cli 1.0.100 available' },
}

function postWithMedia(cover: string, video: string, text: string): string {
  const paragraphs = [
    [{ tag: 'media', file_key: video, image_key: cover }],
    [{ tag: 'text', text, style: [] }],
  ]
  return JSON.stringify({ title: '', content: paragraphs, content_v2: paragraphs })
}

/** Options for {@link linkQueryEnvelope}. */
export interface LinkQueryOptions {
  readonly authorized?: unknown
  readonly chatId?: string
  readonly name?: string
  readonly messages?: readonly Record<string, unknown>[]
  /** Drop `chat_info` entirely. */
  readonly omitChatInfo?: boolean
}

/** One snapshot message as `message_links/query` returns it. */
export function snapshotMessage(overrides: Partial<{
  messageId: string
  chatId: string
  msgType: string
  content: string
  senderName: string
}> = {}): Record<string, unknown> {
  return {
    message: {
      body: { content: overrides.content ?? postWithMedia(SNAPSHOT_KEYS.cover, SNAPSHOT_KEYS.video, '夹具来源正文') },
      chat_id: overrides.chatId ?? FIXTURE_OTHER_CHAT,
      create_time: '1794302511337',
      deleted: false,
      message_id: overrides.messageId ?? FIXTURE_LINKED_ID,
      msg_type: overrides.msgType ?? 'post',
      sender: {
        id: 'ou_00000000000000000000000000000009',
        id_type: 'open_id',
        sender_name: overrides.senderName ?? '夹具来源用户',
        sender_type: 'user',
      },
      update_time: '1794302511337',
      updated: false,
    },
  }
}

/** The success envelope of `message_links/query`. */
export function linkQueryEnvelope(options: LinkQueryOptions = {}): Record<string, unknown> {
  return {
    ok: true,
    identity: 'bot',
    data: {
      ...(options.omitChatInfo === true ? {} : {
        chat_info: {
          chat_id: options.chatId ?? FIXTURE_OTHER_CHAT,
          is_authorized: 'authorized' in options ? options.authorized : true,
          ...(options.name === undefined && 'authorized' in options && options.authorized !== true
            ? {}
            : { name: options.name ?? FIXTURE_SOURCE_NAME }),
        },
      }),
      messages: options.messages ?? [snapshotMessage()],
    },
    _notice: NOTICE,
  }
}

/** The measured 99991672 envelope for an app that has not applied the scope. */
export const LINK_QUERY_SCOPE_MISSING = {
  ok: false,
  identity: 'bot',
  error: {
    type: 'authorization',
    subtype: 'app_scope_not_applied',
    code: 99991672,
    message: 'access denied: app cli_00000000000000 has not applied for the required scope(s): im:message.message_link:read',
    missing_scopes: ['im:message.message_link:read'],
    identity: 'bot',
  },
}

/** Raw read of the linked message: same id, other chat, DIFFERENT (downloadable) keys. */
export const RAW_LINKED_POST_MEDIA = rawApiEnvelope({
  messageId: FIXTURE_LINKED_ID,
  msgType: 'post',
  chatId: FIXTURE_OTHER_CHAT,
  content: postWithMedia(RAW_LINKED_KEYS.cover, RAW_LINKED_KEYS.video, '夹具来源正文'),
})

/** Raw read of a linked plain-text message. */
export const RAW_LINKED_TEXT = rawApiEnvelope({
  messageId: FIXTURE_LINKED_ID,
  msgType: 'text',
  chatId: FIXTURE_OTHER_CHAT,
  content: JSON.stringify({ text: '夹具来源纯文本 "引号" \\反斜杠' }),
})
