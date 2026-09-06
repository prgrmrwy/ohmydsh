/**
 * Chat context capture and prompt assembly for an inbound message.
 *
 * Context is fetched ONCE, at trigger time: a bounded window around the
 * message, not a live feed. The window is a snapshot of what the conversation
 * looked like when the user asked, which is what makes the resulting prompt
 * reproducible and its cost predictable.
 *
 * The fetched text never reaches Pet's durable store. It goes into the
 * Invocation prompt and nowhere else, so the persistent exposure of a chat's
 * contents stays exactly the DSH session log it would have had if the user had
 * pasted the conversation themselves.
 */

import type { LarkClient, LarkHistoryMessage } from './lark.js'

/**
 * How many messages to fetch when locating the trigger.
 *
 * NOT a context window: the conversation itself is no longer pasted into the
 * prompt. This page exists only to find the trigger's own record, which is
 * where the asker's resolved display name comes from — the inbound event
 * carries an open_id and nothing else.
 */
const LOOKUP_PAGE = 10

/** The conversation window captured around one trigger message. */
export interface ChatContext {
  /**
   * The trigger message's own history record, when it was found.
   *
   * The only thing kept from the fetch: the history API resolves sender
   * display names while the inbound event carries just an open_id. The
   * conversation is deliberately NOT carried — pasting it flattens rich
   * content into lossy lines and spends tokens on messages the answer may not
   * need. The agent reads what it needs through lark-cli instead.
   */
  readonly trigger?: LarkHistoryMessage
  /** Present when the lookup failed; harmless, since nothing depends on it. */
  readonly degraded?: string
}

/**
 * Fetch the bounded window around a trigger message.
 *
 * Failure is NOT an error: history may be unavailable for permission or
 * transport reasons, and the user's question still deserves an answer. The
 * caller receives an empty window plus a reason to state in the prompt.
 * @param client - Bot-identity Lark client.
 * @param chatId - Chat the trigger arrived in.
 * @param triggerMessageId - The trigger message.
 * @returns the captured window.
 */
export async function captureChatContext(
  client: LarkClient,
  chatId: string,
  triggerMessageId: string,
): Promise<ChatContext> {
  const fetched = await client.listMessages(chatId, LOOKUP_PAGE)
  const trigger = fetched.find(message => message.messageId === triggerMessageId)
  if (trigger === undefined) {
    // Not an error worth reporting to the model: only the asker's display
    // name is lost, and the prompt falls back to the open_id.
    return { degraded: 'trigger message not found in the recent page' }
  }
  return { trigger }
}

/** Facts about the trigger that the prompt states outright. */
export interface TriggerFacts {
  readonly chatType: 'p2p' | 'group'
  /**
   * Whether lark-cli can act as the bot right now.
   *
   * Gates the "you can operate Lark yourself" briefing: promising that
   * capability while the bot login has expired produces a confident plan that
   * fails on its first command.
   */
  readonly larkReady?: boolean
  /** Chat the trigger arrived in; the agent needs it to read more. */
  readonly chatId: string
  /** The trigger message id, so the agent can fetch its untouched original. */
  readonly messageId: string
  readonly chatName?: string
  readonly senderName?: string
  readonly senderOpenId: string
  readonly text: string
}

/**
 * Assemble the prompt for one inbound message.
 *
 * The history block is fenced and labelled as REFERENCE, not instruction.
 * Chat content is untrusted input: anyone in a group can write anything, and
 * without an explicit boundary a sentence in the transcript reads exactly like
 * a directive from the user.
 * @param trigger - Facts about the triggering message.
 * @param context - The captured window.
 * @returns the prompt text.
 */
export function renderChannelPrompt(trigger: TriggerFacts, context: ChatContext): string {
  const lines: string[] = []
  const where =
    trigger.chatType === 'p2p'
      ? '飞书单聊'
      : `飞书群「${trigger.chatName ?? '未命名群'}」`
  const who = trigger.senderName ?? trigger.senderOpenId

  lines.push(`## 来自${where}的请求`)
  lines.push('')
  lines.push(`- 提出者：${who}（\`${trigger.senderOpenId}\`）`)
  lines.push('')
  lines.push('### 用户的问题')
  lines.push('')
  lines.push(trigger.text)
  lines.push('')

  if (context.degraded !== undefined) {
    lines.push(`> 上下文降级：${context.degraded}`)
    lines.push('')
  }

  // Told outright, because the injected window is deliberately small and
  // lossy: rich content (forwarded threads, cards, images, topic replies)
  // cannot survive being flattened into a line, and the agent must know it
  // can — and should — read the original.
  if (trigger.larkReady === true) {
    lines.push('### 读取上下文与回复，都由你自己完成')
    lines.push('')
    lines.push(
      '本机已安装并授权 `lark-cli`，你可以用它以 **bot 身份**读写飞书。' +
        '这里刻意**不**附带聊天记录摘要——压平的文本会丢掉转发、话题、卡片、图片等结构，' +
        '需要什么请自己按需读取，读到的是原样内容。',
    )
    lines.push('')
    lines.push('```bash')
    lines.push('lark-cli skills list                 # 有哪些能力（im/contact/doc/base/…）')
    lines.push('lark-cli skills read lark-im         # 精读某个领域的完整用法')
    lines.push('lark-cli <domain> --help             # 某个领域的命令清单')
    lines.push('```')
    lines.push('')
    lines.push(
      '**回复也由你发出**：分析完成后请主动把结论回到本会话，' +
        `回复到触发消息 \`${trigger.messageId}\` 上（例如 \`lark-cli im +messages-reply\`）。` +
        '系统不会代你发送任何内容——你不发，用户就收不到。',
    )
    lines.push('')
    lines.push(
      '几条硬性要求：' +
        `**只发到本次会话** \`${trigger.chatId}\`，不要发往任何其它群或个人；` +
        '所有调用显式带 `--as bot`（user 身份会让消息以用户本人名义发出）；' +
        '结论较长或含结构化内容时优先用消息卡片，普通结论用文本即可；' +
        '不要把中间过程逐条播报，一次说清即可。',
    )
    lines.push('')
  } else {
    // Said plainly rather than omitted: without it the model may still try
    // lark-cli, and a silent absence reads as "nobody told me".
    lines.push(
      '> 本机 lark-cli 当前不可用（bot 身份未就绪），因此你**无法**读取飞书内容，' +
        '也**无法**回复到飞书。请仅根据上面的问题作答，并说明这一限制。',
    )
    lines.push('')
  }

  return lines.join('\n')
}
