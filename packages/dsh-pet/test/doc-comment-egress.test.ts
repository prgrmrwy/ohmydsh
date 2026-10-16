/**
 * Doc-comment egress: the reply lands on the triggering comment, association
 * is proven first, feedback is fail-soft
 * (openspec pet-locus-doc-comments, 「评论出站只经受管完成工具且反馈 fail-soft」).
 */

import { describe, expect, it } from 'vitest'
import {
  DOC_DISCLOSURE_TEXT,
  reactOnDocTrigger,
  sendDocBusinessReply,
  sendDocControlReceipt,
} from '../src/host/channel/doc-comment-egress.js'
import { createLarkCliClient, type LarkCliRunner } from '../src/host/channel/lark.js'

const D = 'Dx0000000000000000000000001'
const ROOT = `doc:docx:${D}`

function recordingClient(options: { reply?: 'success' | 'unknown' | Error; react?: Error } = {}) {
  const calls: string[][] = []
  return {
    calls,
    client: {
      replyComment: async (token: string, commentId: string, text: string) => {
        calls.push(['reply', token, commentId, text])
        if (options.reply instanceof Error) throw options.reply
        return options.reply ?? 'success'
      },
      reactCommentReply: async (token: string, replyId: string, emoji: string, action: 'add' | 'delete') => {
        calls.push(['react', token, replyId, emoji, action])
        if (options.react !== undefined) throw options.react
      },
    },
  }
}

describe('doc business reply', () => {
  it('spec Scenario "文档评论回复回到触发评论": replies under c1, never a new comment', async () => {
    const h = recordingClient()
    const outcome = await sendDocBusinessReply(h.client, { chatId: ROOT, messageId: `${ROOT}/111/222` }, '答案')

    expect(outcome).toEqual({ kind: 'sent' })
    expect(h.calls).toEqual([['reply', D, '111', '答案']])
  })

  it('spec Scenario "回复目标与入口不符": a different comment or token sends nothing', async () => {
    const h = recordingClient()
    const otherComment = await sendDocBusinessReply(h.client, { chatId: ROOT, threadId: '222', messageId: `${ROOT}/333/1` }, 'x')
    const otherToken = await sendDocBusinessReply(h.client, { chatId: ROOT, threadId: '222', messageId: 'doc:docx:Dx0000000000000000000000002/222/1' }, 'x')

    expect(otherComment).toEqual({ kind: 'refused', reason: 'association-unproven' })
    expect(otherToken).toEqual({ kind: 'refused', reason: 'association-unproven' })
    expect(h.calls).toEqual([])
  })

  it('spec Scenario "评论回复发送结果未知": a timeout or vague output is unknown, never retried', async () => {
    const timeout = recordingClient({ reply: new Error('timeout') })
    const vague = recordingClient({ reply: 'unknown' })

    await expect(sendDocBusinessReply(timeout.client, { chatId: ROOT, messageId: `${ROOT}/1/2` }, 'x')).resolves.toEqual({ kind: 'unknown' })
    await expect(sendDocBusinessReply(vague.client, { chatId: ROOT, messageId: `${ROOT}/1/2` }, 'x')).resolves.toEqual({ kind: 'unknown' })
    expect(timeout.calls).toHaveLength(1)
    expect(vague.calls).toHaveLength(1)
  })

  it('spec Scenario "文档回复不渲染 @": text goes out as a plain text element, @ left as typed', async () => {
    const calls: string[][] = []
    const client = createLarkCliClient('lark-cli', (async (_b: string, args: readonly string[]) => {
      calls.push([...args])
      return { stdout: JSON.stringify({ ok: true, data: { created: true, comment_id: '1' } }) }
    }) as unknown as LarkCliRunner)

    await sendDocBusinessReply(client, { chatId: ROOT, messageId: `${ROOT}/1/2` }, '@张三 看这里')

    const content = calls[0]![calls[0]!.indexOf('--content') + 1]!
    expect(JSON.parse(content)).toEqual([{ type: 'text', text: '@张三 看这里' }])
    expect(calls[0]!.join(' ')).not.toMatch(/<at |mention_user/)
  })
})

describe('doc control receipt', () => {
  it('goes to the triggering comment and throws on an unproven or unknown send', async () => {
    const h = recordingClient()
    await sendDocControlReceipt(h.client, { chatId: ROOT, messageId: `${ROOT}/1/2` }, DOC_DISCLOSURE_TEXT)
    expect(h.calls).toEqual([['reply', D, '1', DOC_DISCLOSURE_TEXT]])

    await expect(sendDocControlReceipt(recordingClient({ reply: 'unknown' }).client, { chatId: ROOT, messageId: `${ROOT}/1/2` }, 'x')).rejects.toThrow()
    await expect(sendDocControlReceipt(h.client, { chatId: ROOT, threadId: '9', messageId: `${ROOT}/1/2` }, 'x')).rejects.toThrow()
  })
})

describe('doc reaction feedback', () => {
  it('Typing on accept, then DONE on success, CRY on failure, nothing extra on no-reply', async () => {
    const h = recordingClient()
    const id = `${ROOT}/1/22`
    await reactOnDocTrigger(h.client, id, 'accepted')
    await reactOnDocTrigger(h.client, id, 'settled')
    await reactOnDocTrigger(h.client, id, 'failed')
    await reactOnDocTrigger(h.client, id, 'no-reply')

    expect(h.calls).toEqual([
      ['react', D, '22', 'Typing', 'add'],
      ['react', D, '22', 'Typing', 'delete'],
      ['react', D, '22', 'DONE', 'add'],
      ['react', D, '22', 'Typing', 'delete'],
      ['react', D, '22', 'CRY', 'add'],
      ['react', D, '22', 'Typing', 'delete'],
    ])
  })

  it('spec Scenario "过期的反馈": expiry is the failed phase (Typing removed, CRY added, no text)', async () => {
    const h = recordingClient()
    await reactOnDocTrigger(h.client, `${ROOT}/1/22`, 'failed')
    expect(h.calls.map(call => call[3])).toEqual(['Typing', 'CRY'])
    expect(h.calls.some(call => call[0] === 'reply')).toBe(false)
  })
})
