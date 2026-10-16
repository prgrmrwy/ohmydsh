/**
 * Bot-identity drive/docs adapters for doc-comment loci
 * (openspec pet-locus-doc-comments D6/D8/D10). Shapes follow spike captures
 * and lark-cli v1.0.97 shortcut source.
 */

import { describe, expect, it } from 'vitest'
import { createLarkCliClient, type LarkCliRunner } from '../src/host/channel/lark.js'
import { batchQueryComments, commentCard, DOC_IDS, docsFetchMarkdown, inspectDoc } from './fixtures/lark-subscribe.js'

function scripted(responses: ((args: readonly string[]) => unknown)[]) {
  const calls: string[][] = []
  let index = 0
  const runner = (async (_binary: string, args: readonly string[]) => {
    calls.push([...args])
    const respond = responses[Math.min(index, responses.length - 1)]!
    index += 1
    const value = respond(args)
    if (value instanceof Error) throw value
    return { stdout: JSON.stringify(value) }
  }) as unknown as LarkCliRunner
  return { client: createLarkCliClient('lark-cli', runner), calls }
}

const ok = (data: unknown) => () => ({ ok: true, identity: 'bot', data })

describe('queryDocComment', () => {
  it('reads is_whole, quote and the trigger reply as bot, by token and comment id', async () => {
    const { client, calls } = scripted([ok(batchQueryComments([
      commentCard({
        commentId: DOC_IDS.anchoredCommentId,
        isWhole: false,
        quote: '接口已有',
        replies: [
          { replyId: DOC_IDS.anchoredRootReplyId, text: '这里为什么' },
          { replyId: DOC_IDS.anchoredFollowupReplyId, text: '补充一下' },
        ],
      }),
    ]))])

    const result = await client.queryDocComment!(DOC_IDS.docToken, DOC_IDS.anchoredCommentId, DOC_IDS.anchoredFollowupReplyId)

    expect(result).toMatchObject({ kind: 'ok', isWhole: false, quote: '接口已有' })
    expect(result.kind === 'ok' && result.trigger.text).toBe(`@${DOC_IDS.botOpenId} 补充一下`)
    expect(calls[0]).toEqual(expect.arrayContaining([
      'drive', '+batch-query-comments', '--as', 'bot', '--token', DOC_IDS.docToken, '--type', 'docx',
      '--comment-ids', DOC_IDS.anchoredCommentId,
    ]))
  })

  it('spec Scenario "长线程中的触发回复": pages +list-replies until the trigger is found', async () => {
    const { client, calls } = scripted([
      ok(batchQueryComments([commentCard({
        commentId: '1', isWhole: true, hasMore: true, replies: [{ replyId: '10', text: 'first' }],
      })])),
      ok({ items: [{ reply_id: '11', content: { elements: [] } }], has_more: true, page_token: 'p2' }),
      ok({ items: [{ reply_id: '300', content: { elements: [{ type: 'text_run', text_run: { text: 'the one' } }] } }], has_more: false }),
    ])

    const result = await client.queryDocComment!('Dx1', '1', '300')

    expect(result.kind === 'ok' && result.trigger.text).toBe('the one')
    expect(calls.filter(args => args.includes('+list-replies'))).toHaveLength(2)
    expect(calls[2]).toEqual(expect.arrayContaining(['--page-token', 'p2']))
  })

  it('distinguishes a failed call, an unknown scope and a missing reply', async () => {
    const failed = scripted([() => new Error('timeout')])
    const scope = scripted([ok(batchQueryComments([{ comment_id: '1', reply_list: { replies: [] } }]))])
    const missing = scripted([ok(batchQueryComments([commentCard({ commentId: '1', isWhole: true, replies: [{ replyId: '9', text: 'x' }] })]))])

    await expect(failed.client.queryDocComment!('Dx1', '1', '2')).resolves.toEqual({ kind: 'error' })
    await expect(scope.client.queryDocComment!('Dx1', '1', '2')).resolves.toEqual({ kind: 'scope-unknown' })
    await expect(missing.client.queryDocComment!('Dx1', '1', '2')).resolves.toEqual({ kind: 'reply-missing' })
  })

  it('refuses malformed ids before calling lark-cli', async () => {
    const { client, calls } = scripted([ok({})])
    await expect(client.queryDocComment!('bad/token', '1', '2')).rejects.toThrow()
    await expect(client.queryDocComment!('Dx1', 'c1', '2')).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })
})

describe('comment egress', () => {
  it('replies as plain text and reports success only on a created reply', async () => {
    const created = scripted([ok({ comment_id: '1', created: true, reply_id: '5' })])
    const vague = scripted([ok({})])

    await expect(created.client.replyComment!('Dx1', '1', 'answer')).resolves.toBe('success')
    expect(created.calls[0]).toEqual(expect.arrayContaining([
      'drive', '+add-reply', '--as', 'bot', '--token', 'Dx1', '--type', 'docx', '--comment-id', '1',
      '--content', JSON.stringify([{ type: 'text', text: 'answer' }]),
    ]))
    await expect(vague.client.replyComment!('Dx1', '1', 'answer')).resolves.toBe('unknown')
  })

  it('reacts on a reply with the drive enum and the requested action', async () => {
    const { client, calls } = scripted([ok({})])
    await client.reactCommentReply!('Dx1', '5', 'Typing', 'add')
    expect(calls[0]).toEqual(expect.arrayContaining([
      'drive', '+react-reply', '--as', 'bot', '--reply-id', '5', '--emoji', 'Typing', '--action', 'add',
    ]))
  })
})

describe('document metadata and body', () => {
  it('reads title and url via +inspect', async () => {
    const { client } = scripted([ok(inspectDoc('Dx1', '技术方案'))])
    await expect(client.inspectDoc!('Dx1')).resolves.toEqual({ title: '技术方案', url: 'https://www.feishu.cn/docx/Dx1' })
  })

  it('reads markdown and keeps a failure distinguishable from an empty body', async () => {
    const body = scripted([() => docsFetchMarkdown('')])
    const denied = scripted([() => new Error('exit 1')])

    await expect(body.client.fetchDocMarkdown!('Dx1')).resolves.toEqual({ ok: true, markdown: '' })
    expect(body.calls[0]).toEqual(expect.arrayContaining(['docs', '+fetch', '--as', 'bot', '--doc', 'Dx1', '--doc-format', 'markdown']))
    await expect(denied.client.fetchDocMarkdown!('Dx1')).resolves.toMatchObject({ ok: false })
  })
})

describe('addWholeComment (whole-doc answers; full comments cannot be replied to)', () => {
  it('creates a full comment that mentions the asker first, as the bot, and succeeds only on a returned comment_id', async () => {
    // Shape captured live from lark-cli 1.0.97 (2026-10-17).
    const created = scripted([ok({
      comment_id: '7697317230484147999', comment_mode: 'full', created_at: '2026-10-17 01:30:00',
      doc_id: 'Dx1', file_token: 'Dx1', file_type: 'docx', resolved_by: 'docx',
    })])
    await expect(created.client.addWholeComment!('Dx1', 'ou_asker01', '答案')).resolves.toBe('success')
    const args = created.calls[0]!
    expect(args.slice(0, 10)).toEqual(['--profile', 'dsh-pet', 'drive', '+add-comment', '--as', 'bot', '--doc', 'Dx1', '--type', 'docx'])
    expect(args).toContain('--full-comment')
    expect(JSON.parse(args[args.indexOf('--content') + 1]!)).toEqual([
      { type: 'mention_user', text: 'ou_asker01' },
      { type: 'text', text: ' 答案' },
    ])

    const vague = scripted([ok({ comment_mode: 'full' })])
    await expect(vague.client.addWholeComment!('Dx1', 'ou_asker01', 'x')).resolves.toBe('unknown')
    const failed = scripted([() => new Error('timeout')])
    await expect(failed.client.addWholeComment!('Dx1', 'ou_asker01', 'x')).resolves.toBe('unknown')
  })

  it('refuses a non-open-id mention before calling lark-cli', async () => {
    const h = scripted([ok({ comment_id: '1' })])
    await expect(h.client.addWholeComment!('Dx1', 'not-an-id', 'x')).rejects.toThrow()
    expect(h.calls).toEqual([])
  })
})

