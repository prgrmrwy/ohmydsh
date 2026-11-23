/**
 * Redacted NESTED merge-forward fixtures (shapes measured 2026-11-21 for change
 * `locus-read-referenced-chats`, task 0.3/0.6; lark-cli 1.0.97, bot identity).
 *
 * Measured facts these samples pin (design「已实测的平台事实」1–3, 5):
 *
 * - the raw read of the ROOT returns every level in one `data.items` (here 29
 *   nodes), `upper_message_id` = the direct parent, each child carrying the chat
 *   it came FROM (the levels span three chats);
 * - `message_links/query` returns one level fewer (26 nodes) for the same root;
 * - `+messages-mget` of the root renders ALL levels as one nested text block with
 *   `![Image](key)` markers; an `interactive` node is a placeholder line;
 * - only the ROOT id downloads any level's key; a middle or leaf id gets 234003.
 *
 * Tree (id → kind):
 *
 *     F (root, entrance chat)
 *     ├─ F1 text
 *     ├─ G  merge_forward
 *     │  ├─ G1 image (L2 key)
 *     │  └─ H  merge_forward
 *     │     ├─ H1 text
 *     │     ├─ H2 image (L3 key a)
 *     │     ├─ H3 image (L3 key b)
 *     │     └─ H4…H22 text (19 more)
 *     ├─ F3 interactive
 *     └─ F4 file
 *
 * Also here: the stderr FAILURE envelopes the real CLI prints with an empty
 * stdout (10077, 99991672, 230002, 234003).
 *
 * Redaction rule: as in `lark-message-envelopes.ts` — synthetic ids, no real
 * open_id, token, chat name, body text or person name.
 *
 * @module
 */

import { FIXTURE_CHAT, FIXTURE_OTHER_CHAT, mgetEnvelope } from './lark-message-envelopes.js'
import { linkQueryEnvelope, snapshotMessage } from './lark-message-link-envelopes.js'

export const NESTED_THIRD_CHAT = 'oc_00000000000000000000000000000003'

const id = (tag: string): string => `om_x100b000000000000000000000000${tag}`
export const NESTED_IDS = {
  F: id('0401'), F1: id('0411'), G: id('0402'), G1: id('0421'), H: id('0403'),
  H1: id('0431'), H2: id('0432'), H3: id('0433'), F3: id('0413'), F4: id('0414'),
} as const
/** `H4`…`H22`. */
export const nestedFillerId = (index: number): string => id(`05${String(index).padStart(2, '0')}`)

export const NESTED_KEYS = {
  l2: 'img_v3_0000_00000000-0000-0000-0000-00000000a201',
  l3a: 'img_v3_0000_00000000-0000-0000-0000-00000000a301',
  l3b: 'img_v3_0000_00000000-0000-0000-0000-00000000a302',
} as const

const SENDER = { id: 'ou_00000000000000000000000000000001', id_type: 'open_id', sender_type: 'user', tenant_key: '0000000000000001' }

/** One raw item of the nested read. */
export interface NestedNode {
  readonly id: string
  readonly msgType: string
  readonly content: string
  readonly upper?: string
  readonly chatId?: string
  readonly deleted?: boolean
}

export const textContent = (text: string): string => JSON.stringify({ text })
export const imageContent = (key: string): string => JSON.stringify({ image_key: key })

/** The 29 nodes in platform order. */
export function nestedNodes(): NestedNode[] {
  const filler = Array.from({ length: 19 }, (_, index): NestedNode => ({
    id: nestedFillerId(index + 4), msgType: 'text', content: textContent(`嵌套夹具文字 H${String(index + 4)}`), upper: NESTED_IDS.H, chatId: NESTED_THIRD_CHAT,
  }))
  return [
    { id: NESTED_IDS.F, msgType: 'merge_forward', content: 'Merged and Forwarded Message', chatId: FIXTURE_CHAT },
    { id: NESTED_IDS.F1, msgType: 'text', content: textContent('嵌套夹具文字 F1'), upper: NESTED_IDS.F, chatId: FIXTURE_OTHER_CHAT },
    { id: NESTED_IDS.G, msgType: 'merge_forward', content: 'Merged and Forwarded Message', upper: NESTED_IDS.F, chatId: FIXTURE_OTHER_CHAT },
    { id: NESTED_IDS.G1, msgType: 'image', content: imageContent(NESTED_KEYS.l2), upper: NESTED_IDS.G, chatId: NESTED_THIRD_CHAT },
    { id: NESTED_IDS.H, msgType: 'merge_forward', content: 'Merged and Forwarded Message', upper: NESTED_IDS.G, chatId: NESTED_THIRD_CHAT },
    { id: NESTED_IDS.H1, msgType: 'text', content: textContent('嵌套夹具文字 H1'), upper: NESTED_IDS.H, chatId: NESTED_THIRD_CHAT },
    { id: NESTED_IDS.H2, msgType: 'image', content: imageContent(NESTED_KEYS.l3a), upper: NESTED_IDS.H, chatId: NESTED_THIRD_CHAT },
    { id: NESTED_IDS.H3, msgType: 'image', content: imageContent(NESTED_KEYS.l3b), upper: NESTED_IDS.H, chatId: NESTED_THIRD_CHAT },
    ...filler,
    { id: NESTED_IDS.F3, msgType: 'interactive', content: JSON.stringify({ title: '夹具卡片' }), upper: NESTED_IDS.F, chatId: FIXTURE_OTHER_CHAT },
    { id: NESTED_IDS.F4, msgType: 'file', content: JSON.stringify({ file_key: 'file_v3_0000_00000000-0000-0000-0000-00000000a401', file_name: '夹具.pdf' }), upper: NESTED_IDS.F, chatId: FIXTURE_OTHER_CHAT },
  ]
}

/** The raw read of a merge-forward root: items in the given order (default: platform order). */
export function rawTreeEnvelope(nodes: readonly NestedNode[] = nestedNodes()): Record<string, unknown> {
  return {
    ok: true,
    identity: 'bot',
    data: {
      items: nodes.map(node => ({
        body: { content: node.content },
        chat_id: node.chatId ?? FIXTURE_OTHER_CHAT,
        create_time: '1794562303480',
        deleted: node.deleted ?? false,
        message_id: node.id,
        msg_type: node.msgType,
        sender: SENDER,
        update_time: '1794562303480',
        updated: false,
        ...(node.upper === undefined ? {} : { upper_message_id: node.upper }),
      })),
    },
  }
}

/** `message_links/query` for the same root: one level (the three `H` leaves and fillers' tail) short — 26 of 29 nodes. */
export function nestedQueryEnvelope(): Record<string, unknown> {
  const raw = rawTreeEnvelope()
  const items = (raw['data'] as { items: Record<string, unknown>[] }).items.slice(0, 26)
  return linkQueryEnvelope({
    chatId: FIXTURE_CHAT,
    messages: items.map(item => snapshotMessage({
      messageId: item['message_id'] as string,
      chatId: item['chat_id'] as string,
      msgType: item['msg_type'] as string,
      content: (item['body'] as { content: string }).content,
    })),
  })
}

/** One mget text block rendering all three levels, with image markers. */
export function nestedMgetText(): string {
  const entry = (depth: number, name: string, body: string): string[] => [
    `${'    '.repeat(depth)}[2026-11-13T17:10:00+08:00] ${name}:`,
    ...body.split('\n').map(line => `${'    '.repeat(depth + 1)}${line}`),
  ]
  const filler = Array.from({ length: 19 }, (_, index) => entry(3, '夹具用户', `嵌套夹具文字 H${String(index + 4)}`)).flat()
  return [
    '<forwarded_messages>',
    ...entry(0, '夹具用户', '嵌套夹具文字 F1'),
    '    <forwarded_messages>',
    ...entry(1, '夹具用户', `![Image](${NESTED_KEYS.l2})`),
    '        <forwarded_messages>',
    ...entry(2, '夹具用户', '嵌套夹具文字 H1'),
    ...entry(2, '夹具用户', `![Image](${NESTED_KEYS.l3a})`),
    ...entry(2, '夹具用户', `![Image](${NESTED_KEYS.l3b})`),
    ...filler.map(line => line.replace(/^ {12}/, '            ')),
    '        </forwarded_messages>',
    '    </forwarded_messages>',
    ...entry(0, '夹具用户', '[Interactive card]'),
    ...entry(0, '夹具用户', '<file key="file_v3_0000_00000000-0000-0000-0000-00000000a401" name="夹具.pdf"/>'),
    '</forwarded_messages>',
  ].join('\n')
}

export function nestedMgetEnvelope(text: string = nestedMgetText(), rootId: string = NESTED_IDS.F): Record<string, unknown> {
  return mgetEnvelope({ messageId: rootId, msgType: 'merge_forward', content: text, chatId: FIXTURE_CHAT })
}

/** The failure envelope the CLI prints (on stderr, with an empty stdout). */
export function cliFailureEnvelope(code: number, subtype = 'fixture'): string {
  return JSON.stringify({
    ok: false,
    identity: 'bot',
    error: { type: 'api_error', subtype, code, message: 'redacted fixture failure' },
  })
}

export const STDERR_FAILURES = {
  /** Invalid link or no access. */
  linkInvalid: cliFailureEnvelope(10077),
  /** The app has not applied for `im:message.message_link:read`. */
  scopeMissing: cliFailureEnvelope(99991672, 'app_scope_not_applied'),
  /** A middle/leaf id read raw. */
  noPermission: cliFailureEnvelope(230002),
  /** A snapshot key, or a child id used for download. */
  fileNotInMessage: cliFailureEnvelope(234003),
} as const
