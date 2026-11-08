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
import { LocusRepositoryV20 } from '../src/host/locus/persistence-v20.js'
import { endpointKeyV20 } from '../src/host/locus/locus-set-v20.js'
import { LocusChannelController, type NormalizedLocusMessage } from '../src/host/channel/locus-controller.js'
import { emptyMedium, openPetHarness } from './harness.js'

const TOKEN = 'Dx0000000000000000000000001'
const ROOT = `doc:docx:${TOKEN}`
const COMMENT = '7696944637407137026'
const ENDPOINT = { chatId: ROOT, threadId: COMMENT }

function messageId(replyId: string): string {
  return `${ROOT}/${COMMENT}/${replyId}`
}

type TablePut = { table(name: string): { put(key: string, value: unknown): Promise<void> } }

/** One group row (the doc root) and one topic row (the anchored comment) under the same M. */
async function seed(domain: unknown) {
  const base = { state: 'not-created', accessMode: 'read-only', revision: 0, createdAt: 1, updatedAt: 1 } as const
  await (domain as TablePut).table('loci').put(ROOT, {
    endpoint: { chatId: ROOT }, locusId: 'locus-doc-root', sessionId: 'child-doc-root', ...base,
    locusMainSessionId: 'session-main', workspaceId: 'workspace-main',
  })
  await (domain as TablePut).table('loci').put(endpointKeyV20(ENDPOINT), {
    endpoint: ENDPOINT, locusId: 'locus-doc-comment', sessionId: 'child-doc-comment', ...base,
  })
}

function controllerFor(repository: LocusRepositoryV20, rendered: NormalizedLocusMessage[], commentQueries: { count: number }) {
  const read = (endpoint: { chatId: string; threadId?: string }) => {
    const record = repository.getRow(endpoint)
    if (record === undefined) return undefined
    const group = repository.getRow({ chatId: endpoint.chatId })
    if (group === undefined || !('locusMainSessionId' in group)) return undefined
    return {
      locusId: record.locusId, endpoint: record.endpoint, sessionId: record.sessionId,
      locusMainSessionId: group.locusMainSessionId, workSessionId: 'session-main', workspaceId: group.workspaceId,
      state: 'active' as const, accessMode: record.accessMode, revision: record.revision,
    }
  }
  return new LocusChannelController({
    locus: {
      resolveCurrent: read,
      ensureForDelivery: ({ endpoint }: { endpoint: { chatId: string; threadId?: string } }) => {
        const record = read(endpoint)
        if (record === undefined) throw new Error('dispatch never creates an unknown entry')
        return record
      },
    } as never,
    deliveries: {
      findByMessageId: id => repository.findDeliveryByMessageId(id),
      getById: id => repository.getDelivery(id),
      accept: input => repository.acceptDelivery(input),
      bindQueued: async ({ correlation, ...rest }: { correlation: object }) => (await repository.bindQueued({ ...correlation, ...rest } as never)).record,
      bindTurn: async ({ correlation, ...rest }: { correlation: object }) => (await repository.bindTurn({ ...correlation, ...rest } as never)).record,
    } as never,
    deliveryDispatch: {
      claimCurrent: async ({ correlation, ...rest }) => {
        const claimed = await repository.claimCurrentDelivery({ ...correlation, ...rest })
        return claimed.changed ? claimed.record : undefined
      },
      currentFinished: () => {},
      dispatchNext: async () => {},
      scheduleCurrent: () => {},
    },
    child: {
      ensureChild: locus => ({ parentSessionId: locus.locusMainSessionId, childSessionId: locus.sessionId }),
      queueChild: input => ({ accepted: true as const, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }),
    },
    inspectResidentPolicy: () => ({ resident: true, policy: { mode: 'read-only', workspaceRoot: '/repo' } }),
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
    const before = new LocusRepositoryV20(first.domain as never)
    await seed(first.domain)
    const correlation = { endpoint: ENDPOINT, locusId: 'locus-doc-comment', sessionId: 'child-doc-comment' }
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
    const busy = (await before.claimCurrentDelivery({ ...correlation, now: 3 })).record
    expect(busy?.messageId).toBe(messageId('1'))
    await before.completeCurrentDelivery({
      ...correlation, deliveryId: busy!.deliveryId, now: 4, outcome: 'no-reply', outboundResult: 'none', reason: 'test',
      ...(busy!.revision === undefined ? {} : { expectedRevision: busy!.revision }),
    })
    await first.close()

    // Host restart: a fresh process with only the medium.
    const second = await openPetHarness(medium)
    const restarted = new LocusRepositoryV20(second.domain as never)
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
