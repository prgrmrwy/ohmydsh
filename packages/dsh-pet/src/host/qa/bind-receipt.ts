/**
 * What `/bind` says back, in the group.
 *
 * Two properties shape every line here:
 *
 * 1. **Replies go to the group, not to the person who typed.** Members have a
 *    right to know their group just gained an agent that carries someone
 *    else's working context and can run commands in a real tree. Binding
 *    quietly would be easier and less honest.
 * 2. **The two prefix failures must read identically.** `resolve-session.ts`
 *    fuses them at the value level; this module must not un-fuse them by
 *    wording them differently — which is exactly the sort of leak that
 *    survives a "both fail" test.
 */

import type { BindOutcome, UnbindOutcome } from './bind.js'

/**
 * The single message used for BOTH "no such session" and "several matched".
 *
 * Exported so a test can assert the two paths produce this same constant
 * rather than two strings that merely look similar.
 */
export const PREFIX_UNRESOLVED_TEXT =
  '没有匹配到唯一的会话。请提供更长的会话 id 前缀后重试。'

/**
 * Render the group reply for one bind outcome.
 * @param outcome - What the bind flow decided.
 * @returns the message text to send into the group.
 */
export function renderBindReceipt(outcome: BindOutcome): string {
  if (!outcome.ok) {
    switch (outcome.reason) {
      case 'prefix-too-short':
        // Safe to state precisely: it describes the text just typed, not
        // anything about which sessions exist.
        return '会话 id 前缀太短，请至少提供 6 位。'
      case 'prefix-unresolved':
        return PREFIX_UNRESOLVED_TEXT
      case 'chat-occupied':
        return (
          '本群已经绑定了一个会话，无法再绑定另一个。' +
          '如需改绑，请先在 Pet 面板归档该群对应的任务。'
        )
      case 'session-occupied':
        return (
          `该会话已经有一个答疑群${
            outcome.detail === undefined || outcome.detail === '' ? '' : `（${outcome.detail}）`
          }，一个会话只能对应一个群。` + '如需改绑，请先归档原来那个。'
        )
      case 'source-unforkable':
        return '该会话当前不可用，无法为它创建子代理。'
    }
  }

  const lines: string[] = []
  lines.push(`已把本群绑定到会话「${outcome.sourceTitle}」（${outcome.sourceShortId}）。`)
  // Stated up front because it is the one thing that surprises people later:
  // the child sees the session as of its last finished round, not as of now.
  lines.push('我继承的是该会话**最近一轮完成**的上下文；此后进行中的内容不在其中。')
  if (outcome.executionRoot !== undefined) {
    lines.push(`工作目录：${outcome.executionRoot}`)
  }
  if (outcome.memberCount !== undefined) {
    // The blast radius, shown at the moment it is chosen: from now on any of
    // these members can put work into a real repository through this bot.
    lines.push(
      `本群当前 ${outcome.memberCount} 人，之后**任何群成员** @我都可以提问。`,
    )
  } else {
    lines.push('之后**任何群成员** @我都可以提问。')
  }
  return lines.join('\n')
}

/**
 * Render the group reply for one unbind outcome.
 * @param outcome - What the unbind flow decided.
 * @returns the message text to send into the group.
 */
export function renderUnbindReceipt(outcome: UnbindOutcome): string {
  if (!outcome.ok) {
    switch (outcome.reason) {
      case 'not-bound':
        return '本群没有绑定任何会话。'
      case 'not-unbindable':
        // The group Pet created is entered from the GUI and ends there. Say
        // where to go rather than leaving the user to guess why the same
        // command works in one group and not another.
        return (
          '本群是由 Pet 创建的答疑群，不能在群内解绑。' +
          '如需结束，请在 Pet 面板归档对应任务。'
        )
      case 'busy':
        // Refusing beats interrupting: the child may be part-way through
        // writing files, and this is not an urgent operation.
        return '我正在处理上一个问题，稍后再试一次解绑。'
    }
  }

  const where = outcome.chatName === undefined ? '本群' : `本群（${outcome.chatName}）`
  const source =
    outcome.sourceTitle === undefined ? '' : `与会话「${outcome.sourceTitle}」`
  return (
    `已解除${where}${source}的绑定，此后 @我不会再触发回答。\n` +
    '之前的对话记录仍保留在 DSH 里，可随时查看。'
  )
}
