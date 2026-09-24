/**
 * Mention rendering: the inbound form is a display name, the outbound form is
 * markup, and only the second one notifies anyone.
 *
 * These cases pin the boundary between "translate what the agent wrote" and
 * "rewrite the agent's message": anything that cannot be resolved to exactly
 * one member stays untouched, because a mention that lands on the wrong person
 * is worse than plain text.
 */

import { describe, expect, it } from 'vitest'
import {
  hasMentionCandidate,
  renderMentions,
  type MentionMember,
} from '../src/host/channel/mentions.js'

const MEMBERS: readonly MentionMember[] = [
  { openId: 'ou_owner_0001', name: '张勇' },
  { openId: 'ou_reviewer_02', name: '赵鸿珂' },
  { openId: 'ou_reviewer_03', name: '林旭浩' },
  // Prefix pair: the longer name must win.
  { openId: 'ou_longer_0004', name: '张三丰' },
  { openId: 'ou_shorter_05', name: '张三' },
]

describe('mention candidate detection', () => {
  it('only claims a candidate when a scan could find something', () => {
    expect(hasMentionCandidate('@赵鸿珂 看完了')).toBe(true)
    expect(hasMentionCandidate('看完了')).toBe(false)
    expect(hasMentionCandidate('')).toBe(false)
    // Agent-authored markup is trusted as-is.
    expect(hasMentionCandidate('<at user_id="ou_x">赵鸿珂</at> 看完了')).toBe(false)
  })
})

describe('mention rendering', () => {
  it('renders a whole-word display name into a real mention', () => {
    const result = renderMentions('@赵鸿珂 这个单子我看完了', MEMBERS)

    expect(result.text).toBe('<at user_id="ou_reviewer_02">赵鸿珂</at> 这个单子我看完了')
    expect(result.rendered).toBe(1)
  })

  it('renders every mention in a longer reply', () => {
    const result = renderMentions('@张勇 结论如下，@林旭浩 麻烦确认下排期。', MEMBERS)

    expect(result.text).toBe(
      '<at user_id="ou_owner_0001">张勇</at> 结论如下，'
      + '<at user_id="ou_reviewer_03">林旭浩</at> 麻烦确认下排期。',
    )
    expect(result.rendered).toBe(2)
  })

  it('prefers the longest matching name', () => {
    // `@张三丰` must not resolve to the member named `张三`.
    const result = renderMentions('@张三丰 请看', MEMBERS)

    expect(result.text).toBe('<at user_id="ou_longer_0004">张三丰</at> 请看')
  })

  it('leaves an ambiguous display name untouched', () => {
    const ambiguous: readonly MentionMember[] = [
      { openId: 'ou_first', name: '张伟' },
      { openId: 'ou_second', name: '张伟' },
      { openId: 'ou_other', name: '李四' },
    ]
    const result = renderMentions('@张伟 请看这个', ambiguous)

    expect(result.text).toBe('@张伟 请看这个')
    expect(result.rendered).toBe(0)
  })

  it('never resolves a name that is not a member of this chat', () => {
    const result = renderMentions('@外部同事 请看', MEMBERS)

    expect(result.text).toBe('@外部同事 请看')
    expect(result.rendered).toBe(0)
    expect(result.skipped).toBe('no-unique-match')
  })

  it('renders a member open id the agent wrote instead of a display name', () => {
    // The unified locus delivery prompt reports the sender as `ou_…`; an agent
    // that addresses that literal string must still reach the person, not
    // publish the identifier as plain text that notifies nobody.
    const result = renderMentions('@ou_owner_0001 你好，我是小小芒果。', MEMBERS)

    expect(result.text).toBe('<at user_id="ou_owner_0001">张勇</at> 你好，我是小小芒果。')
    expect(result.rendered).toBe(1)
  })

  it('leaves an open id that is not a member of this chat as written', () => {
    const result = renderMentions('@ou_stranger_99 你好', MEMBERS)

    expect(result.text).toBe('@ou_stranger_99 你好')
    expect(result.rendered).toBe(0)
    expect(result.skipped).toBe('no-unique-match')
  })

  it('does not resolve an open id sitting inside a word', () => {
    const result = renderMentions('发给 wang@ou_owner_0001 即可', MEMBERS)

    expect(result.text).toBe('发给 wang@ou_owner_0001 即可')
    expect(result.rendered).toBe(0)
  })

  it('does not touch an email address or other in-word @', () => {
    const result = renderMentions('发给 wang@example.com 或者 foo@bar 都行', MEMBERS)

    expect(result.text).toBe('发给 wang@example.com 或者 foo@bar 都行')
    expect(result.rendered).toBe(0)
  })

  it('does not rewrite text that already carries markup', () => {
    const text = '<at user_id="ou_reviewer_02">赵鸿珂</at> 以及 @张勇'
    const result = renderMentions(text, MEMBERS)

    expect(result.text).toBe(text)
    expect(result.rendered).toBe(0)
    expect(result.skipped).toBe('already-marked')
  })

  it('treats punctuation and end of string as boundaries, not the middle of a word', () => {
    const result = renderMentions('问下@赵鸿珂：这个怎么办？谢谢@张勇', MEMBERS)

    expect(result.text).toBe(
      '问下<at user_id="ou_reviewer_02">赵鸿珂</at>：这个怎么办？'
      + '谢谢<at user_id="ou_owner_0001">张勇</at>',
    )
  })

  it('degrades to the original text when there are no members', () => {
    const result = renderMentions('@赵鸿珂 看完了', [])

    expect(result.text).toBe('@赵鸿珂 看完了')
    expect(result.rendered).toBe(0)
    expect(result.skipped).toBe('no-members')
  })

  it('ignores malformed member entries instead of inventing a target', () => {
    const malformed = [
      { openId: '', name: '张勇' },
      { openId: 'ou_x', name: '   ' },
      { openId: 'ou_ok', name: '林旭浩' },
    ] as readonly MentionMember[]
    const result = renderMentions('@张勇 @林旭浩 请看', malformed)

    expect(result.text).toBe('@张勇 <at user_id="ou_ok">林旭浩</at> 请看')
    expect(result.rendered).toBe(1)
  })

  it('bounds how much of one message it rewrites', () => {
    const many = Array.from({ length: 15 }, (_, index) => `@赵鸿珂 ${String(index)}`).join(' ')
    const result = renderMentions(many, MEMBERS)

    expect(result.rendered).toBe(10)
    expect(result.text.split('<at user_id=').length - 1).toBe(10)
  })
})
