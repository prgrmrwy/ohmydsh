/**
 * `finish(reply)` for a doc Delivery on the REAL durable lifecycle
 * (openspec pet-locus-collaboration 「投递与结算关联独立于会话运行状态」 doc scenarios).
 */

import { describe, expect, it } from 'vitest'
import { LocusRepositoryV20 } from '../src/host/locus/persistence-v20.js'
import { endpointKeyV20 } from '../src/host/locus/locus-set-v20.js'
import { finishDocReply } from '../src/host/channel/doc-comment-egress.js'
import { openPetHarness } from './harness.js'

const D = 'Dx0000000000000000000000001'
const ROOT = `doc:docx:${D}`

async function currentDoc(input: { threadId?: string; messageId: string }) {
  const harness = await openPetHarness()
  const repository = new LocusRepositoryV20(harness.domain as never)
  const base = { state: 'not-created', accessMode: 'read-only', revision: 0, createdAt: 1, updatedAt: 1 } as const
  await (harness.domain as never as { table(name: string): { put(key: string, value: unknown): Promise<void> } }).table('loci').put(ROOT, {
    endpoint: { chatId: ROOT }, locusId: 'root', sessionId: 'child-root', ...base,
    locusMainSessionId: 'main', workspaceId: 'ws',
  })
  const endpoint = input.threadId === undefined ? { chatId: ROOT } : { chatId: ROOT, threadId: input.threadId }
  if (input.threadId !== undefined) {
    await (harness.domain as never as { table(name: string): { put(key: string, value: unknown): Promise<void> } }).table('loci').put(endpointKeyV20(endpoint), {
      endpoint, locusId: 'comment', sessionId: 'child-comment', ...base,
    })
  }
  const correlation = { endpoint, locusId: input.threadId === undefined ? 'root' : 'comment', sessionId: input.threadId === undefined ? 'child-root' : 'child-comment' }
  await repository.acceptDelivery({
    ...correlation, messageId: input.messageId, senderOpenId: 'ou_owner', text: 'q', acceptedAt: 2,
  })
  const claimed = await repository.claimCurrentDelivery({ ...correlation, now: 3 })
  return { harness, repository, correlation, current: claimed.record! }
}

function client(result: 'success' | 'unknown' | Error = 'success') {
  const sent: string[][] = []
  return {
    sent,
    client: {
      replyComment: async (token: string, commentId: string, text: string) => {
        sent.push(['reply', token, commentId, text])
        if (result instanceof Error) throw result
        return result
      },
      addWholeComment: async (token: string, mentionOpenId: string, text: string) => {
        sent.push(['whole', token, mentionOpenId, text])
        if (result instanceof Error) throw result
        return result
      },
    },
  }
}

describe('doc finish(reply) on the durable lifecycle', () => {
  it('spec Scenario "文档评论回复回到触发评论": an anchored entry replies under c2 and records completed/replied', async () => {
    const h = await currentDoc({ threadId: '111', messageId: `${ROOT}/111/222` })
    const c = client()
    let clock = 10
    const outcome = await finishDocReply({ repository: h.repository as never, client: c.client, correlation: h.correlation, current: h.current, text: '答案', now: () => clock++ })

    expect(outcome).toMatchObject({ kind: 'recorded', outboundResult: 'success' })
    expect(c.sent).toEqual([['reply', D, '111', '答案']])
    expect(h.repository.getDelivery(h.current.deliveryId)).toMatchObject({ status: 'replied', outboundResult: 'success' })
    await h.harness.close()
  })

  it('a whole-doc entry answers with a new full comment mentioning the durable asker', async () => {
    const h = await currentDoc({ messageId: `${ROOT}/111/222` })
    const c = client()
    let clock = 10
    const outcome = await finishDocReply({ repository: h.repository as never, client: c.client, correlation: h.correlation, current: h.current, text: '答案', now: () => clock++ })

    expect(outcome).toMatchObject({ kind: 'recorded', outboundResult: 'success' })
    expect(c.sent).toEqual([['whole', D, 'ou_owner', '答案']])
    await h.harness.close()
  })

  it('spec Scenario "文档回复目标与入口不符": no send, never finishing', async () => {
    const h = await currentDoc({ threadId: '222', messageId: `${ROOT}/222/1` })
    // Tamper with the persisted trigger: a comment that is not this entry's.
    const tampered = { ...h.current, messageId: `${ROOT}/333/1` }
    const c = client()

    const outcome = await finishDocReply({ repository: h.repository as never, client: c.client, correlation: h.correlation, current: tampered, text: 'x', now: () => 10 })

    expect(outcome).toEqual({ kind: 'refused' })
    expect(c.sent).toEqual([])
    expect(h.repository.getDelivery(h.current.deliveryId)?.status).toBe('current')
    await h.harness.close()
  })

  it('records unknown-terminal for an unconfirmed send and does not resend', async () => {
    const h = await currentDoc({ threadId: '111', messageId: `${ROOT}/111/222` })
    const c = client(new Error('timeout'))
    let clock = 10
    const outcome = await finishDocReply({ repository: h.repository as never, client: c.client, correlation: h.correlation, current: h.current, text: 'x', now: () => clock++ })

    expect(outcome).toMatchObject({ kind: 'recorded', outboundResult: 'unknown' })
    expect(c.sent).toHaveLength(1)
    expect(h.repository.getDelivery(h.current.deliveryId)?.status).toBe('unknown-terminal')
    await h.harness.close()
  })
})
