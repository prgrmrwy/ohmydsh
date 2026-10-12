/**
 * The QA child's read claim must be the measured one.
 *
 * Same defect class as the locus delivery prompt: bot identity is a transport
 * fact, and inviting a child to "read the group for more context" while that
 * read actually fails produces a confident plan the child cannot execute.
 */

import { describe, expect, it } from 'vitest'

import { renderQaPrompt } from '../src/host/qa/prompt.js'

const base = {
  chatId: 'oc_qa_group',
  chatName: 'Pet QA 群',
  messageId: 'om_question',
  senderOpenId: 'ou_asker',
  senderName: '张勇',
  text: '帮我看下这个改动',
  larkReady: true,
  isFirst: false,
}

describe('the QA prompt states only the measured read capability', () => {
  it('invites a read of this group only when the entrance measured readable', () => {
    const prompt = renderQaPrompt({ ...base, entranceRead: 'readable' })

    expect(prompt).toContain('已实测可读')
    expect(prompt).toContain('skills read lark-im')
  })

  it('states the limit and drops the read invitation when the read failed', () => {
    const prompt = renderQaPrompt({ ...base, entranceRead: 'unreadable' })

    expect(prompt).toContain('实测不可读')
    expect(prompt).not.toContain('已实测可读')
    // Not an invitation any more: the system just disproved it.
    expect(prompt).not.toContain('需要更多群内上下文时自行读取')
  })

  it('states the unknown state rather than inviting a read it never measured', () => {
    const prompt = renderQaPrompt({ ...base, entranceRead: 'unconfirmed' })

    expect(prompt).toContain('未确认')
    expect(prompt).not.toContain('已实测可读')
    expect(prompt).not.toContain('需要更多群内上下文时自行读取')
  })

  it('treats a prompt without a measurement as unconfirmed, not as readable', () => {
    const prompt = renderQaPrompt(base)

    expect(prompt).toContain('未确认')
    expect(prompt).not.toContain('已实测可读')
  })

  it('keeps the reply obligation even when the entrance is unreadable', () => {
    const prompt = renderQaPrompt({ ...base, entranceRead: 'unreadable' })

    // Reading and replying are different capabilities; losing one does not
    // remove the other, and silence from the child means silence in the group.
    expect(prompt).toContain('回复由你自己发出')
    expect(prompt).toContain('——你不发，提问者就收不到')
    expect(prompt).toContain('--as bot')
  })
})
