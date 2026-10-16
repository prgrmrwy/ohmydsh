/**
 * `finish(reply)` for a doc Delivery on the REAL durable lifecycle
 * (openspec pet-locus-collaboration 「投递与结算关联独立于会话运行状态」 doc scenarios).
 */

import { describe, expect, it } from 'vitest'
import { buildLocusRecord } from '../src/host/locus/aggregate.js'
import { LocusRepository as DurableLocusRepository } from '../src/host/locus/persistence.js'
import { finishDocReply } from '../src/host/channel/doc-comment-egress.js'
import { openPetHarness } from './harness.js'

const D = 'Dx0000000000000000000000001'
const ROOT = `doc:docx:${D}`

async function currentDoc(input: { threadId?: string; messageId: string }) {
  const harness = await openPetHarness()
  const repository = new DurableLocusRepository(harness.domain)
  const root = await repository.putLocus(buildLocusRecord({
    id: 'root', endpoint: { chatId: ROOT }, parentSessionId: 'main', childSessionId: 'child-root',
    workspaceId: 'ws', source: 'auto', createdAt: 1, updatedAt: 1,
  }))
  const locus = input.threadId === undefined ? root : await repository.putLocus(buildLocusRecord({
    id: 'comment', endpoint: { chatId: ROOT, threadId: input.threadId }, parentLocusId: root.id,
    parentSessionId: 'main', childSessionId: 'child-comment', workspaceId: 'ws', source: 'inherited', createdAt: 1, updatedAt: 1,
  }))
  const correlation = { endpoint: locus.endpoint, locusId: locus.id, generation: locus.generation, childSessionId: locus.childSessionId as string }
  await repository.acceptDelivery({
    ...correlation, messageId: input.messageId, senderOpenId: 'ou_owner', text: 'q', acceptedAt: 2,
  })
  const current = await repository.claimCurrentDelivery({ correlation, now: 3 })
  return { harness, repository, correlation, current: current! }
}

function client(result: 'success' | 'unknown' | Error = 'success') {
  const sent: string[][] = []
  return {
    sent,
    client: {
      replyComment: async (token: string, commentId: string, text: string) => {
        sent.push([token, commentId, text])
        if (result instanceof Error) throw result
        return result
      },
    },
  }
}

describe('doc finish(reply) on the durable lifecycle', () => {
  it('spec Scenario "文档评论回复回到触发评论": replies under c1 and records completed/replied', async () => {
    const h = await currentDoc({ messageId: `${ROOT}/111/222` })
    const c = client()
    let clock = 10
    const outcome = await finishDocReply({ repository: h.repository as never, client: c.client, correlation: h.correlation, current: h.current, text: '答案', now: () => clock++ })

    expect(outcome).toMatchObject({ kind: 'recorded', outboundResult: 'success' })
    expect(c.sent).toEqual([[D, '111', '答案']])
    expect(h.repository.getDelivery(h.current.deliveryId)).toMatchObject({ status: 'replied', outboundResult: 'success' })
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
    const h = await currentDoc({ messageId: `${ROOT}/111/222` })
    const c = client(new Error('timeout'))
    let clock = 10
    const outcome = await finishDocReply({ repository: h.repository as never, client: c.client, correlation: h.correlation, current: h.current, text: 'x', now: () => clock++ })

    expect(outcome).toMatchObject({ kind: 'recorded', outboundResult: 'unknown' })
    expect(c.sent).toHaveLength(1)
    expect(h.repository.getDelivery(h.current.deliveryId)?.status).toBe('unknown-terminal')
    await h.harness.close()
  })
})
