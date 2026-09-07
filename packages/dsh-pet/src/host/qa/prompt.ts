/**
 * The message text delivered into a QA child turn.
 *
 * Unlike the phase-one envelope this carries no Skill token and no snapshot
 * authority: the child already holds the source session's context by
 * inheritance, so the only thing this text adds is WHO is asking, WHERE the
 * answer must go, and the standing conditions of answering in public.
 *
 * The reply instruction is a behavioural requirement, not a boundary. The
 * child holds the same shell the source session did and could message any
 * chat; stating the target in code would only create the illusion of a
 * control. Phase 2.1 reached the same conclusion for its own dispatch.
 */

/** Facts about one QA trigger that the prompt states outright. */
export interface QaTriggerFacts {
  /** Group the question arrived in; the only permitted reply target. */
  readonly chatId: string
  /** Group name, for a readable opening line. */
  readonly chatName?: string
  /** Trigger message id, so the child can thread its answer. */
  readonly messageId: string
  /** Asker's open_id; always known, since admission compares it. */
  readonly senderOpenId: string
  /** Asker's display name when resolved; falls back to the open_id. */
  readonly senderName?: string
  /** The question text. */
  readonly text: string
  /** Whether lark-cli can act as the bot right now. */
  readonly larkReady: boolean
  /** Whether this is the first question since the group was created. */
  readonly isFirst: boolean
}

/**
 * Render the text queued as one child turn.
 * @param trigger - Facts about this question.
 * @returns the prompt text.
 */
export function renderQaPrompt(trigger: QaTriggerFacts): string {
  const lines: string[] = []
  const where = trigger.chatName === undefined ? '答疑群' : `答疑群「${trigger.chatName}」`
  const who = trigger.senderName ?? trigger.senderOpenId

  if (trigger.isFirst) {
    // Said once, at the top of the group's life: the child inherited a
    // working session's transcript and would otherwise have no idea that its
    // audience changed from one operator to a room of other people.
    lines.push('## 你已被接入一个飞书答疑群')
    lines.push('')
    lines.push(
      `这个会话继承了你之前那段工作的全部上下文。从现在起，${where}里的成员会向你提问，` +
        '他们看不到上面的历史，只能看到你发到群里的内容。回答时请把必要的背景讲清楚，' +
        '不要假设提问者知道你我之前聊过什么。',
    )
    lines.push('')
  }

  lines.push(`## 来自${where}的提问`)
  lines.push('')
  lines.push(`- 提问者：${who}（\`${trigger.senderOpenId}\`）`)
  lines.push('')
  lines.push('### 问题')
  lines.push('')
  lines.push(trigger.text)
  lines.push('')

  if (trigger.larkReady) {
    lines.push('### 回复由你自己发出')
    lines.push('')
    lines.push(
      '本机已安装并授权 `lark-cli`，你可以用它以 **bot 身份**读写飞书；' +
        '需要更多群内上下文时自行读取（`lark-cli skills read lark-im`）。',
    )
    lines.push('')
    lines.push(
      '几条硬性要求：' +
        `**只发到本群** \`${trigger.chatId}\`（回复到消息 \`${trigger.messageId}\`），` +
        '不要发往任何其它群或个人；所有调用显式带 `--as bot`；' +
        '结论较长或含结构化内容时优先用消息卡片；不要逐条播报中间过程。' +
        '系统不会代你发送任何内容——你不发，提问者就收不到。',
    )
    lines.push('')
    // The honest form of the trust boundary: the group's members were vouched
    // for by the owner, but they are not the owner, and the child sits in a
    // real working tree.
    lines.push(
      '**涉及修改工作区（改文件、提交、推送、执行有副作用的命令）时，先在群里说明你打算做什么并等待提问者确认**，' +
        '不要直接动手。只读的排查、检索和解释可以直接进行。',
    )
    lines.push('')
  } else {
    lines.push(
      '> 本机 lark-cli 当前不可用（bot 身份未就绪），因此你**无法**回复到飞书。' +
        '请仅根据上面的问题作答，并说明这一限制。',
    )
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Render the initial prompt that establishes a QA child.
 *
 * Sent as the child's first turn at creation time, before anyone has asked
 * anything: it exists so the child's state is settled and its label
 * meaningful when the first group message arrives.
 * @param chatName - Group name.
 * @returns the prompt text.
 */
export function renderQaSeedPrompt(chatName: string): string {
  return [
    '## 答疑群已建立',
    '',
    `你所在的这个会话继承了刚才那段工作的上下文，现在被接入飞书群「${chatName}」作为答疑代理。`,
    '群成员随后会向你提问，每个问题会作为新的一轮消息送到你这里，并注明提问者。',
    '',
    '现在**不要做任何事，也不要调用任何工具**，只回复一句简短的确认（一行即可）。',
    '真正的工作从第一个提问开始。',
  ].join('\n')
}
