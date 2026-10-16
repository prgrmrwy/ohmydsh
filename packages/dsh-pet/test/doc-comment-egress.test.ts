/**
 * Doc-comment egress: the reply lands on the triggering comment, association
 * is proven first, feedback is fail-soft
 * (openspec pet-locus-doc-comments, 「评论出站只经受管完成工具且反馈 fail-soft」).
 */

import { describe, expect, it } from 'vitest'
import {
  createDocControlMessenger,
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
      addWholeComment: async (token: string, mentionOpenId: string, text: string) => {
        calls.push(['whole', token, mentionOpenId, text])
        if (options.reply instanceof Error) throw options.reply
        return options.reply ?? 'success'
      },
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
  it('spec Scenario "划词评论回复回到触发评论": an anchored entry replies under its own comment, never a new comment', async () => {
    const h = recordingClient()
    const outcome = await sendDocBusinessReply(h.client, { chatId: ROOT, threadId: '111', messageId: `${ROOT}/111/222`, senderOpenId: 'ou_asker01' }, '答案')

    expect(outcome).toEqual({ kind: 'sent' })
    expect(h.calls).toEqual([['reply', D, '111', '答案']])
  })

  it('spec Scenario "全文评论以新全文评论答复并提及提问者": a whole-doc entry never replies to c1; it opens a new full comment mentioning the asker', async () => {
    const h = recordingClient()
    const outcome = await sendDocBusinessReply(h.client, { chatId: ROOT, messageId: `${ROOT}/111/222`, senderOpenId: 'ou_asker01' }, '答案')

    expect(outcome).toEqual({ kind: 'sent' })
    expect(h.calls).toEqual([['whole', D, 'ou_asker01', '答案']])
    expect(h.calls.some(call => call[0] === 'reply')).toBe(false)
  })

  it('refuses a whole-doc answer whose asker is not a provable open id (association-unproven)', async () => {
    const h = recordingClient()
    for (const senderOpenId of [undefined, '', 'u_x', 'ou_x y']) {
      const outcome = await sendDocBusinessReply(h.client, {
        chatId: ROOT, messageId: `${ROOT}/111/222`, ...(senderOpenId === undefined ? {} : { senderOpenId }),
      }, '答案')
      expect(outcome).toEqual({ kind: 'refused', reason: 'association-unproven' })
    }
    expect(h.calls).toEqual([])
  })

  it('spec Scenario "回复目标与入口不符": a different comment or token sends nothing', async () => {
    const h = recordingClient()
    const otherComment = await sendDocBusinessReply(h.client, { chatId: ROOT, threadId: '222', messageId: `${ROOT}/333/1`, senderOpenId: 'ou_a1' }, 'x')
    const otherToken = await sendDocBusinessReply(h.client, { chatId: ROOT, threadId: '222', messageId: 'doc:docx:Dx0000000000000000000000002/222/1', senderOpenId: 'ou_a1' }, 'x')

    expect(otherComment).toEqual({ kind: 'refused', reason: 'association-unproven' })
    expect(otherToken).toEqual({ kind: 'refused', reason: 'association-unproven' })
    expect(h.calls).toEqual([])
  })

  it('spec Scenario "评论回复发送结果未知": a timeout or vague output is unknown, never retried', async () => {
    const timeout = recordingClient({ reply: new Error('timeout') })
    const vague = recordingClient({ reply: 'unknown' })

    await expect(sendDocBusinessReply(timeout.client, { chatId: ROOT, threadId: '1', messageId: `${ROOT}/1/2`, senderOpenId: 'ou_a1' }, 'x')).resolves.toEqual({ kind: 'unknown' })
    await expect(sendDocBusinessReply(vague.client, { chatId: ROOT, messageId: `${ROOT}/1/2`, senderOpenId: 'ou_a1' }, 'x')).resolves.toEqual({ kind: 'unknown' })
    expect(timeout.calls).toHaveLength(1)
    expect(vague.calls).toHaveLength(1)
  })

  it('spec Scenario "文档回复不渲染 @": text goes out as a plain text element, @ left as typed', async () => {
    const calls: string[][] = []
    const client = createLarkCliClient('lark-cli', (async (_b: string, args: readonly string[]) => {
      calls.push([...args])
      return { stdout: JSON.stringify({ ok: true, data: { created: true, comment_id: '1' } }) }
    }) as unknown as LarkCliRunner)

    await sendDocBusinessReply(client, { chatId: ROOT, threadId: '1', messageId: `${ROOT}/1/2`, senderOpenId: 'ou_a1' }, '@张三 看这里')

    const content = calls[0]![calls[0]!.indexOf('--content') + 1]!
    expect(JSON.parse(content)).toEqual([{ type: 'text', text: '@张三 看这里' }])
    expect(calls[0]!.join(' ')).not.toMatch(/<at |mention_user/)
  })
})

describe('doc control receipt', () => {
  it('goes where the business answer goes: under an anchored comment, as a new mentioning full comment for a whole-doc entry', async () => {
    const h = recordingClient()
    await sendDocControlReceipt(h.client, { chatId: ROOT, threadId: '1', messageId: `${ROOT}/1/2`, senderOpenId: 'ou_a1' }, DOC_DISCLOSURE_TEXT)
    await sendDocControlReceipt(h.client, { chatId: ROOT, messageId: `${ROOT}/5/6`, senderOpenId: 'ou_a1' }, DOC_DISCLOSURE_TEXT)
    expect(h.calls).toEqual([['reply', D, '1', DOC_DISCLOSURE_TEXT], ['whole', D, 'ou_a1', DOC_DISCLOSURE_TEXT]])

    await expect(sendDocControlReceipt(recordingClient({ reply: 'unknown' }).client, { chatId: ROOT, threadId: '1', messageId: `${ROOT}/1/2`, senderOpenId: 'ou_a1' }, 'x')).rejects.toThrow()
    await expect(sendDocControlReceipt(h.client, { chatId: ROOT, threadId: '9', messageId: `${ROOT}/1/2`, senderOpenId: 'ou_a1' }, 'x')).rejects.toThrow()
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

describe('doc control messages that are not replies (the /bind switch warning)', () => {
  const latest = { endpoint: { chatId: ROOT }, messageId: `${ROOT}/7/8`, senderOpenId: 'ou_lastasker' }

  it('spec Scenario "文档改绑后已有划词评论不迁移" (warning): a whole-doc warning mentions the /bind issuer, not the latest asker', async () => {
    const h = recordingClient()
    const messenger = createDocControlMessenger({ client: h.client, latestDelivery: () => latest })

    messenger.noteIssuer({ chatId: ROOT }, 'ou_binder')
    await messenger.send({ endpoint: { chatId: ROOT }, text: '主会话已切换' })

    expect(h.calls).toEqual([['whole', D, 'ou_binder', '主会话已切换']])
  })

  it('reads the issuer once: a later retry with no noted issuer falls back to the durable latest asker', async () => {
    const h = recordingClient()
    const messenger = createDocControlMessenger({ client: h.client, latestDelivery: () => latest })
    messenger.noteIssuer({ chatId: ROOT }, 'ou_binder')
    await messenger.send({ endpoint: { chatId: ROOT }, text: 'a' })
    await messenger.send({ endpoint: { chatId: ROOT }, text: 'b' })

    expect(h.calls.map(call => call[2])).toEqual(['ou_binder', 'ou_lastasker'])
  })

  it('an anchored entry still replies under its comment, and an entry with no Delivery fails closed', async () => {
    const h = recordingClient()
    const anchored = { endpoint: { chatId: ROOT, threadId: '7' }, messageId: `${ROOT}/7/8`, senderOpenId: 'ou_a1' }
    await createDocControlMessenger({ client: h.client, latestDelivery: () => anchored })
      .send({ endpoint: { chatId: ROOT, threadId: '7' }, text: 'w' })
    expect(h.calls).toEqual([['reply', D, '7', 'w']])

    await expect(createDocControlMessenger({ client: h.client, latestDelivery: () => undefined })
      .send({ endpoint: { chatId: ROOT }, text: 'w' })).rejects.toThrow()
  })
})
