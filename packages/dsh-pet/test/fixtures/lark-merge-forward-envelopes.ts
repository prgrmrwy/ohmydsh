/**
 * Redacted samples of the REAL envelopes for a merge-forward message
 * (lark-cli 1.0.97, `--profile dsh-pet --as bot`, measured 2026-11-13 for
 * change `locus-read-referenced-chats`, task 0.1).
 *
 * Measured facts these samples pin:
 *
 * - the raw read `api GET /open-apis/im/v1/messages/<outer>` returns the outer
 *   message FIRST and then one item per child in `data.items`; the outer body is
 *   the non-JSON string `Merged and Forwarded Message`; every child carries
 *   `upper_message_id` = the outer id and the `chat_id` of the chat it came FROM;
 * - a child's resources download only through the OUTER id
 *   (`--message-id <outer> --file-key <child key>`); the child's own id is
 *   refused with 234003 "File not in msg";
 * - `+messages-mget` of the outer returns ONE message whose `content` is a
 *   `<forwarded_messages>` block: `[<iso time>] <sender name>:` then the child
 *   body indented by four spaces, a video rendered as `[Media: file_…]`;
 * - `+chat-messages-list` reports `msg_type: merge_forward` with the same block.
 *
 * Redaction rule: as in `lark-message-envelopes.ts`.
 *
 * @module
 */

import { FIXTURE_CHAT, FIXTURE_OTHER_CHAT, mgetEnvelope } from './lark-message-envelopes.js'

export const MERGE_OUTER_ID = 'om_x100b0000000000000000000000000201'
export const MERGE_KEYS = {
  cover: 'img_v3_0000_00000000-0000-0000-0000-0000000f0c01',
  video: 'file_v3_0000_00000000-0000-0000-0000-0000000f0b01',
} as const

const SENDER = { id: 'ou_00000000000000000000000000000001', id_type: 'open_id', sender_type: 'user', tenant_key: '0000000000000001' }

/** One child item of the raw read. */
export interface MergeChild {
  readonly id: string
  readonly msgType: string
  readonly content: string
  readonly upper?: string
  readonly chatId?: string
}

export function childId(index: number): string {
  return `om_x100b0000000000000000000000003${String(index).padStart(3, '0')}`
}

export function textChild(index: number, text = `夹具子消息 ${String(index)}`): MergeChild {
  return { id: childId(index), msgType: 'text', content: JSON.stringify({ text }) }
}

export function videoChild(index: number, cover: string = MERGE_KEYS.cover, video: string = MERGE_KEYS.video): MergeChild {
  const paragraphs = [
    [{ tag: 'text', text: '夹具视频说明', style: [] }],
    [{ tag: 'media', file_key: video, image_key: cover }],
  ]
  return { id: childId(index), msgType: 'post', content: JSON.stringify({ title: '', content: paragraphs, content_v2: paragraphs }) }
}

export function nestedChild(index: number): MergeChild {
  return { id: childId(index), msgType: 'merge_forward', content: 'Merged and Forwarded Message' }
}

/** The raw read of a merge-forward: outer item, then children. */
export function rawMergeEnvelope(children: readonly MergeChild[], outerId = MERGE_OUTER_ID): Record<string, unknown> {
  return {
    ok: true,
    identity: 'bot',
    data: {
      items: [
        {
          body: { content: 'Merged and Forwarded Message' },
          chat_id: FIXTURE_CHAT,
          create_time: '1794568986767',
          deleted: false,
          message_id: outerId,
          message_position: '48',
          msg_type: 'merge_forward',
          sender: SENDER,
          update_time: '1794568986767',
          updated: false,
        },
        ...children.map(child => ({
          body: { content: child.content },
          chat_id: child.chatId ?? FIXTURE_OTHER_CHAT,
          create_time: '1794562303480',
          deleted: false,
          message_id: child.id,
          msg_type: child.msgType,
          sender: SENDER,
          update_time: '1794562303480',
          updated: false,
          upper_message_id: child.upper ?? outerId,
        })),
      ],
    },
  }
}

/** The formatted block mget renders for the same children. */
export function mergeBlock(entries: readonly { readonly name?: string; readonly body: string }[]): string {
  const lines = entries.flatMap((entry, index) => [
    `[2026-11-13T17:${String(10 + (index % 50)).padStart(2, '0')}:00+08:00] ${entry.name ?? '夹具用户'}:`,
    ...entry.body.split('\n').map(line => `    ${line}`),
  ])
  return ['<forwarded_messages>', ...lines, '</forwarded_messages>'].join('\n')
}

export function mgetMergeEnvelope(content: string, outerId = MERGE_OUTER_ID): Record<string, unknown> {
  return mgetEnvelope({ messageId: outerId, msgType: 'merge_forward', content })
}
