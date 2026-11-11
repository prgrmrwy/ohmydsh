/**
 * Redacted samples of the REAL envelopes `lark-cli` returns for one IM message
 * (lark-cli 1.0.97, bot identity, measured 2026-11-11 for change
 * `locus-read-message-media`).
 *
 * Why these exist: `docs/architecture/dsh-plugin-integration-pitfalls.md` §3
 * and §4 record that a CLI envelope must be MEASURED, not inferred. The two
 * reads Pet makes disagree in shape, and neither is the shape one would guess:
 *
 * - `lark-cli api GET /open-apis/im/v1/messages/<id>` keeps the result inside
 *   `data.items[0]`; `body.content` is the platform's RAW JSON string, so it is
 *   the only place a video's cover (`image_key`) survives. `create_time` is a
 *   13-digit epoch-milliseconds string. A recalled message is `ok: true` with
 *   `deleted: true` and a NON-JSON `body.content`; it is not an error.
 * - `lark-cli im +messages-mget` keeps the result inside `data.messages[0]`,
 *   renders the body as text (`![Image](img_…)`, `[Media: file_…]`), prints
 *   `create_time` as local wall-clock minutes, and is the only one that carries
 *   the sender's display name. It DROPS a video's cover key.
 * - Post elements are tagged `img` / `media` / `text` …, inside paragraph
 *   arrays, and the platform repeats the paragraphs under `content_v2`.
 * - Both envelopes carry a top-level `_notice` upgrade hint a parser must ignore.
 *
 * Redaction rule: no real chat, user, message, thread or resource key survives
 * and no business text is present. Every identifier is a synthetic body of the
 * same prefix and (approximately) the same length class and alphabet as the
 * real form. The standalone `media` message type was not present in the
 * measured chat, so {@link RAW_MEDIA_MESSAGE} follows the documented shape
 * (`{file_key, image_key, file_name, duration}`) rather than an observation.
 *
 * @module
 */

export const FIXTURE_CHAT = 'oc_00000000000000000000000000000001'
export const FIXTURE_OTHER_CHAT = 'oc_00000000000000000000000000000002'
export const FIXTURE_THREAD = 'omt_0000000000000001'

export const FIXTURE_IDS = {
  text: 'om_x100b0000000000000000000000000001',
  postImage: 'om_x100b0000000000000000000000000002',
  postMedia: 'om_x100b0000000000000000000000000003',
  image: 'om_x100b0000000000000000000000000004',
  media: 'om_x100b0000000000000000000000000005',
  deleted: 'om_x100b0000000000000000000000000006',
  file: 'om_x100b0000000000000000000000000007',
  threaded: 'om_x100b0000000000000000000000000008',
} as const

export const FIXTURE_KEYS = {
  image: 'img_v3_0000_00000000-0000-0000-0000-00000000aa01',
  secondImage: 'img_v3_0000_00000000-0000-0000-0000-00000000aa02',
  cover: 'img_v3_0000_00000000-0000-0000-0000-00000000cc01',
  video: 'file_v3_0000_00000000-0000-0000-0000-00000000bb01',
  file: 'file_v3_0000_00000000-0000-0000-0000-00000000dd01',
} as const

const SENDER_OPEN_ID = 'ou_00000000000000000000000000000001'
const TENANT = '0000000000000001'
const NOTICE = {
  update: {
    command: 'lark-cli update',
    current: '1.0.97',
    latest: '1.0.99',
    message: 'lark-cli 1.0.99 is available (current 1.0.97). Run: lark-cli update',
  },
}

/** One element of the raw `api GET` result. */
export interface RawApiItemOptions {
  readonly messageId: string
  readonly msgType: string
  readonly content: string
  readonly chatId?: string
  readonly deleted?: boolean
  readonly threadId?: string
  /** Epoch milliseconds as a string, as the platform prints it. */
  readonly createTime?: string
}

/** The raw `lark-cli api GET /open-apis/im/v1/messages/<id> --as bot` envelope. */
export function rawApiEnvelope(options: RawApiItemOptions): Record<string, unknown> {
  return {
    ok: true,
    identity: 'bot',
    data: {
      items: [{
        body: { content: options.content },
        chat_id: options.chatId ?? FIXTURE_CHAT,
        create_time: options.createTime ?? '1794380000000',
        deleted: options.deleted ?? false,
        message_id: options.messageId,
        message_position: '123',
        msg_type: options.msgType,
        sender: { id: SENDER_OPEN_ID, id_type: 'open_id', sender_type: 'user', tenant_key: TENANT },
        update_time: options.createTime ?? '1794380000000',
        updated: false,
        ...(options.threadId === undefined ? {} : {
          thread_id: options.threadId,
          root_id: FIXTURE_IDS.text,
          parent_id: FIXTURE_IDS.text,
          thread_message_position: '1',
        }),
      }],
    },
    _notice: NOTICE,
  }
}

/** One element of the `+messages-mget` result. */
export interface MgetMessageOptions {
  readonly messageId: string
  readonly msgType: string
  readonly content: string
  readonly chatId?: string
  readonly senderName?: string
  readonly deleted?: boolean
  readonly threadId?: string
}

/** The `lark-cli im +messages-mget --as bot --format json` envelope for one message. */
export function mgetEnvelope(options: MgetMessageOptions): Record<string, unknown> {
  return {
    ok: true,
    identity: 'bot',
    data: {
      messages: [{
        chat_id: options.chatId ?? FIXTURE_CHAT,
        content: options.content,
        create_time: '2026-11-11 10:00',
        deleted: options.deleted ?? false,
        message_app_link: 'https://applink.feishu.cn/client/message/link/open?token=FIXTURE',
        message_id: options.messageId,
        message_position: '123',
        msg_type: options.msgType,
        sender: {
          id: SENDER_OPEN_ID,
          id_type: 'open_id',
          name: options.senderName ?? '测试用户',
          sender_i18n_names: { en_us: 'Test User', zh_cn: options.senderName ?? '测试用户' },
          sender_type: 'user',
          tenant_key: TENANT,
        },
        updated: false,
        ...(options.threadId === undefined ? {} : { thread_id: options.threadId }),
      }],
      total: 1,
    },
    _notice: NOTICE,
  }
}

function post(...paragraphs: readonly Record<string, unknown>[][]): string {
  return JSON.stringify({ title: '', content: paragraphs, content_v2: paragraphs })
}

const BODY_LINE = { tag: 'text', text: '夹具正文', style: [] }

/** Raw post whose first paragraph is one inline image. */
export const RAW_POST_IMAGE = rawApiEnvelope({
  messageId: FIXTURE_IDS.postImage,
  msgType: 'post',
  content: post([{ tag: 'img', image_key: FIXTURE_KEYS.image, width: 800, height: 600 }], [BODY_LINE]),
})
export const MGET_POST_IMAGE = mgetEnvelope({
  messageId: FIXTURE_IDS.postImage,
  msgType: 'post',
  content: `![Image](${FIXTURE_KEYS.image})\n夹具正文`,
})

/** Raw post with a video: the cover survives only here. */
export const RAW_POST_MEDIA = rawApiEnvelope({
  messageId: FIXTURE_IDS.postMedia,
  msgType: 'post',
  content: post([{ tag: 'media', file_key: FIXTURE_KEYS.video, image_key: FIXTURE_KEYS.cover }], [BODY_LINE]),
})
export const MGET_POST_MEDIA = mgetEnvelope({
  messageId: FIXTURE_IDS.postMedia,
  msgType: 'post',
  content: `[Media: ${FIXTURE_KEYS.video}]\n夹具正文`,
})

/** Plain text message. */
export const RAW_TEXT = rawApiEnvelope({
  messageId: FIXTURE_IDS.text,
  msgType: 'text',
  content: JSON.stringify({ text: '夹具纯文本' }),
})
export const MGET_TEXT = mgetEnvelope({ messageId: FIXTURE_IDS.text, msgType: 'text', content: '夹具纯文本' })

/** Standalone image message. */
export const RAW_IMAGE_MESSAGE = rawApiEnvelope({
  messageId: FIXTURE_IDS.image,
  msgType: 'image',
  content: JSON.stringify({ image_key: FIXTURE_KEYS.image }),
})
export const MGET_IMAGE_MESSAGE = mgetEnvelope({
  messageId: FIXTURE_IDS.image,
  msgType: 'image',
  content: `![Image](${FIXTURE_KEYS.image})`,
})

/** Standalone `media` (video) message, documented shape. */
export const RAW_MEDIA_MESSAGE = rawApiEnvelope({
  messageId: FIXTURE_IDS.media,
  msgType: 'media',
  content: JSON.stringify({ file_key: FIXTURE_KEYS.video, image_key: FIXTURE_KEYS.cover, file_name: 'clip.mp4', duration: 19000 }),
})
export const MGET_MEDIA_MESSAGE = mgetEnvelope({
  messageId: FIXTURE_IDS.media,
  msgType: 'media',
  content: `[Media: ${FIXTURE_KEYS.video}]`,
})

/** Standalone file message: metadata only. */
export const RAW_FILE_MESSAGE = rawApiEnvelope({
  messageId: FIXTURE_IDS.file,
  msgType: 'file',
  content: JSON.stringify({ file_key: FIXTURE_KEYS.file, file_name: 'report.pdf' }),
})
export const MGET_FILE_MESSAGE = mgetEnvelope({
  messageId: FIXTURE_IDS.file,
  msgType: 'file',
  content: `<file key="${FIXTURE_KEYS.file}" name="report.pdf"/>`,
})

/** A recalled message: `ok: true`, `deleted: true`, and a NON-JSON body. */
export const RAW_DELETED = rawApiEnvelope({
  messageId: FIXTURE_IDS.deleted,
  msgType: 'text',
  content: 'This message was recalled',
  deleted: true,
})
export const MGET_DELETED = mgetEnvelope({
  messageId: FIXTURE_IDS.deleted,
  msgType: 'text',
  content: 'This message was recalled',
  deleted: true,
})

/** A topic message in the fixture chat (carries `thread_id`). */
export const RAW_THREADED = rawApiEnvelope({
  messageId: FIXTURE_IDS.threaded,
  msgType: 'text',
  content: JSON.stringify({ text: '夹具话题消息' }),
  threadId: FIXTURE_THREAD,
})
export const MGET_THREADED = mgetEnvelope({
  messageId: FIXTURE_IDS.threaded,
  msgType: 'text',
  content: '夹具话题消息',
  threadId: FIXTURE_THREAD,
})
