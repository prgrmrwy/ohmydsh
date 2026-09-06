/**
 * Trigger lookup and prompt assembly.
 *
 * The conversation is deliberately NOT pasted into the prompt: flattening
 * chat content destroys exactly the structure that matters (forwarded
 * threads, cards, images, topic replies) and spends tokens on messages the
 * answer may not need. The prompt instead tells the agent it can read — and
 * must reply — through lark-cli itself.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  captureChatContext,
  renderChannelPrompt,
  type ChatContext,
} from '../src/host/channel/context.js'
import type { LarkClient, LarkHistoryMessage } from '../src/host/channel/lark.js'

function client(messages: readonly LarkHistoryMessage[]): LarkClient {
  return {
    addReaction: vi.fn(async () => undefined),
    removeReaction: vi.fn(async () => undefined),
    listMessages: vi.fn(async () => messages),
    listChatBots: vi.fn(async () => []),
    chatName: vi.fn(async () => undefined),
    botReady: vi.fn(async () => true),
    reply: vi.fn(async () => undefined),
  }
}

const trigger = {
  chatType: 'group' as const,
  chatId: 'oc_group0000000000000000000000000',
  messageId: 'om_trigger',
  chatName: 'Pet 测试群',
  senderName: '张勇',
  senderOpenId: 'ou_322ec1d3cd062f04bc2b1f4ba1eff8e9',
  text: '看下这个话题',
  larkReady: true,
}

describe('locating the trigger message', () => {
  it('returns the trigger record, which carries the resolved sender name', async () => {
    const messages: LarkHistoryMessage[] = [
      { messageId: 'om_other', senderName: '同事', text: '之前', createTime: '', position: 1 },
      { messageId: 'om_trigger', senderName: '张勇', text: '问题', createTime: '', position: 2 },
    ]

    const context = await captureChatContext(client(messages), 'oc_x', 'om_trigger')

    // The inbound event carries only an open_id; this is where a human-
    // readable name comes from, with no extra call and no contact scope.
    expect(context.trigger?.senderName).toBe('张勇')
  })

  it('carries no conversation window at all', async () => {
    const messages: LarkHistoryMessage[] = Array.from({ length: 10 }, (_, index) => ({
      messageId: index === 5 ? 'om_trigger' : `om_${index}`,
      senderName: '张勇',
      text: `消息 ${index}`,
      createTime: '',
      position: index,
    }))

    const context = await captureChatContext(client(messages), 'oc_x', 'om_trigger')

    // Nothing but the trigger: the agent reads what it needs itself.
    expect(Object.keys(context)).toEqual(['trigger'])
  })

  it('degrades quietly when the trigger is not in the page', async () => {
    const context = await captureChatContext(client([]), 'oc_x', 'om_trigger')

    // Only the display name is lost, so this must not disturb the run.
    expect(context.trigger).toBeUndefined()
    expect(context.degraded).toBeDefined()
  })

  it('fetches exactly once', async () => {
    const larkClient = client([])

    await captureChatContext(larkClient, 'oc_x', 'om_trigger')

    expect(larkClient.listMessages).toHaveBeenCalledTimes(1)
  })
})

describe('the prompt states the question and who asked', () => {
  it('names the asker and the conversation', () => {
    const prompt = renderChannelPrompt(trigger, {})

    expect(prompt).toContain('看下这个话题')
    expect(prompt).toContain('张勇')
    expect(prompt).toContain('Pet 测试群')
  })

  it('labels a direct chat as such', () => {
    const prompt = renderChannelPrompt({ ...trigger, chatType: 'p2p' }, {})

    expect(prompt).toContain('飞书单聊')
  })

  it('pastes no conversation transcript', () => {
    const prompt = renderChannelPrompt(trigger, {})

    // The whole point of the change: no flattened history in the prompt.
    expect(prompt).not.toContain('会话上下文摘要')
    expect(prompt).toContain('刻意**不**附带聊天记录摘要')
  })
})

describe('the agent is told to read and to reply itself', () => {
  it('points at the skill catalog rather than dictating commands', () => {
    const prompt = renderChannelPrompt(trigger, {})

    // lark-cli ships its own agent documentation; listing then reading it
    // beats a hand-written command list that goes stale.
    expect(prompt).toContain('lark-cli skills list')
    expect(prompt).toContain('lark-cli skills read')
    expect(prompt).toContain('按需读取')
  })

  it('states that nothing is sent on its behalf', () => {
    const prompt = renderChannelPrompt(trigger, {})

    // There is no Host-side auto-reply any more: silence from the agent means
    // silence in the chat.
    expect(prompt).toContain('回复也由你发出')
    expect(prompt).toContain('系统不会代你发送任何内容')
  })

  it('confines replies to the originating conversation', () => {
    const prompt = renderChannelPrompt(trigger, {})

    // The Host no longer enforces the destination, so the constraint has to
    // be stated where the model will read it.
    expect(prompt).toContain('只发到本次会话')
    expect(prompt).toContain(trigger.chatId)
    expect(prompt).toContain(trigger.messageId)
  })

  it('asks for a card when the answer is structured', () => {
    const prompt = renderChannelPrompt(trigger, {})

    expect(prompt).toContain('消息卡片')
  })

  it('requires bot identity on every call', () => {
    const prompt = renderChannelPrompt(trigger, {})

    expect(prompt).toContain('--as bot')
  })

  it('says plainly when lark-cli is unusable, including that it cannot reply', () => {
    const prompt = renderChannelPrompt({ ...trigger, larkReady: false }, {})

    // Silence would read as "nobody told me", and the model would try anyway.
    expect(prompt).toContain('lark-cli 当前不可用')
    expect(prompt).toContain('无法**回复到飞书')
    expect(prompt).not.toContain('lark-cli skills list')
  })
})
