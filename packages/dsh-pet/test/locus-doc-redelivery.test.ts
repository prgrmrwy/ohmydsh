/**
 * A queued anchored-comment Delivery survives a Host restart with its comment
 * facts intact (openspec pet-locus-doc-comments D5, round 5).
 *
 * The facts that matter here exist only at intake (the anchored quote comes
 * from a comment query), so a backlog row rebuilt by `dispatchNext` must take
 * them from the durable record. Per pitfalls §11 this is proved on the REAL
 * repository reopened on the same medium and the REAL controller dispatch, not
 * on a stubbed dispatch port that would stay green while a projection drops
 * the field.
 */

import { describe, expect, it } from 'vitest'
import { buildLocusRecord } from '../src/host/locus/aggregate.js'
import { LocusRepository as DurableLocusRepository } from '../src/host/locus/persistence.js'
import { LocusChannelController, type NormalizedLocusMessage } from '../src/host/channel/locus-controller.js'
import { emptyMedium, openPetHarness } from './harness.js'

const TOKEN = 'Dx0000000000000000000000001'
const ROOT = `doc:docx:${TOKEN}`
const COMMENT = '7696944637407137026'
const ENDPOINT = { chatId: ROOT, threadId: COMMENT }

function messageId(replyId: string): string {
  return `${ROOT}/${COMMENT}/${replyId}`
}

async function seed(repository: DurableLocusRepository) {
  const root = await repository.putLocus(buildLocusRecord({
    id: 'locus-doc-root', endpoint: { chatId: ROOT },
    parentSessionId: 'session-main', childSessionId: 'child-doc-root', workspaceId: 'workspace-main',
    source: 'auto', createdAt: 1, updatedAt: 1,
  }))
  const comment = await repository.putLocus(buildLocusRecord({
    id: 'locus-doc-comment', endpoint: ENDPOINT, parentLocusId: root.id,
    parentSessionId: 'session-main', childSessionId: 'child-doc-comment', workspaceId: 'workspace-main',
    source: 'inherited', createdAt: 1, updatedAt: 1,
  }))
  return comment
}

function controllerFor(repository: DurableLocusRepository, rendered: NormalizedLocusMessage[], commentQueries: { count: number }) {
  return new LocusChannelController({
    locus: {
      resolveCurrent: endpoint => {
        const record = repository.getCurrentLocus(endpoint)
        return record === undefined ? undefined : {
          id: record.id, endpoint: record.endpoint, generation: record.generation,
          parentSessionId: record.parentSessionId, childSessionId: record.childSessionId as string,
          workspaceId: record.workspaceId, state: 'active' as const,
          childComposition: 'safe-v2' as const, toolTier: { desired: 'safe' as const, effective: 'safe' as const },
          permission: record.permission,
        }
      },
      ensureForDelivery: () => { throw new Error('dispatch never provisions') },
    } as never,
    deliveries: {
      findByMessageId: id => repository.findDeliveryByMessageId(id),
      getById: id => repository.getDelivery(id),
      accept: input => repository.acceptDelivery(input),
      bindQueued: input => repository.bindQueued(input),
      bindTurn: input => repository.bindTurn(input),
    } as never,
    deliveryDispatch: {
      claimCurrent: input => repository.claimCurrentDelivery(input),
      currentFinished: () => {},
      dispatchNext: async () => {},
      scheduleCurrent: () => {},
    },
    child: {
      ensureChild: locus => ({ parentSessionId: locus.parentSessionId, childSessionId: locus.childSessionId }),
      withChildSession: async input => ({ ok: true as const, value: await input.operation({ id: input.identity.childSessionId }) }),
      queueChild: input => ({ accepted: true as const, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
    },
    resolveLivePolicy: () => ({ mode: 'read-only', workspaceRoot: '/repo' }),
    turns: { perTurnCorrelation: true, subscribe: () => () => {} },
    // The only place a comment fact could come from on this path. Counting it
    // proves the redelivery never re-queried the platform.
    addressing: {
      listChatBots: () => { commentQueries.count += 1; return [] },
      resolveMemberName: () => { commentQueries.count += 1; return undefined },
    },
    renderPrompt: ({ message }) => {
      rendered.push(message)
      return message.text
    },
    allowOpenIds: () => ['ou_owner'],
    log: () => {},
    now: (() => { let value = 10; return () => value++ })(),
  })
}

describe('spec Scenario "重启后再投递排队中的划词评论"', () => {
  it('rebuilds the queued anchored comment from the durable Delivery after a restart', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    const before = new DurableLocusRepository(first.domain)
    const locus = await seed(before)
    const correlation = {
      endpoint: locus.endpoint, locusId: locus.id, generation: locus.generation,
      childSessionId: locus.childSessionId as string,
    }
    // The child is busy with r1; r5 waits in the durable backlog.
    for (const [replyId, quote, text] of [['1', '接口已有', '第一个问题'], ['5', '接口已有', '这里为什么']] as const) {
      await before.acceptDelivery({
        ...correlation,
        messageId: messageId(replyId),
        senderOpenId: 'ou_owner',
        senderName: '张三',
        text,
        docComment: { quote },
        replyTarget: { ...ENDPOINT, messageId: messageId(replyId) },
        acceptedAt: 2,
      })
    }
    const busy = await before.claimCurrentDelivery({ correlation, now: 3 })
    expect(busy?.messageId).toBe(messageId('1'))
    await before.completeCurrentDelivery({
      ...correlation, deliveryId: busy!.deliveryId, now: 4, outcome: 'no-reply', outboundResult: 'none', reason: 'test',
      ...(busy!.revision === undefined ? {} : { expectedRevision: busy!.revision }),
    })
    await first.close()

    // Host restart: a fresh process with only the medium.
    const second = await openPetHarness(medium)
    const restarted = new DurableLocusRepository(second.domain)
    const rendered: NormalizedLocusMessage[] = []
    const queries = { count: 0 }
    const controller = controllerFor(restarted, rendered, queries)

    await controller.dispatchNext(correlation)

    expect(rendered).toHaveLength(1)
    const message = rendered[0]!
    // The four comment facts the scenario compares: kind, quote, trigger text, sender.
    expect(message.source).toBe('doc-comment')
    expect(message.endpoint).toEqual(ENDPOINT)
    expect(message.source === 'doc-comment' && message.docComment).toEqual({ quote: '接口已有' })
    expect(message.text).toBe('这里为什么')
    expect([message.senderOpenId, message.senderName]).toEqual(['ou_owner', '张三'])
    expect('chatType' in message).toBe(false)
    expect(queries.count).toBe(0)
    controller.dispose()
    await second.close()
  })
})
