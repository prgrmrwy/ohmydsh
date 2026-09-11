import { describe, expect, it } from 'vitest'
import { LocusChannelController } from '../src/host/channel/locus-controller.js'
import { ControllerLocusRepositoryAdapter } from '../src/host/locus/controller-persistence-adapter.js'
import { LocusController } from '../src/host/locus/controller.js'
import { LocusRepository as DurableLocusRepository } from '../src/host/locus/persistence.js'
import { createLocusResolution } from '../src/host/locus/resolution.js'
import { openPetHarness } from './harness.js'

function enableAtomicTransactions(harness: Awaited<ReturnType<typeof openPetHarness>>): void {
  type TableName = 'loci' | 'locus_indexes' | 'locus_operations' | 'locus_switch_notices' | 'locus_deliveries' | 'locus_permission_audit'
  type Write = { kind: 'put' | 'delete'; table: TableName; key: string; value?: unknown }
  const domain = harness.domain as unknown as {
    supportsTransaction?: boolean
    transaction?: (body: (tx: {
      put(table: TableName, key: string, value: unknown): void
      delete(table: TableName, key: string): void
    }) => void) => Promise<void>
    table(name: TableName): {
      put(key: string, value: unknown): Promise<void>
      delete(key: string): Promise<boolean>
    }
  }
  Object.defineProperty(domain, 'supportsTransaction', { value: true, configurable: true })
  domain.transaction = async body => {
    const writes: Write[] = []
    body({
      put: (table, key, value) => writes.push({ kind: 'put', table, key, value }),
      delete: (table, key) => writes.push({ kind: 'delete', table, key }),
    })
    for (const write of writes) {
      if (write.kind === 'delete') await domain.table(write.table).delete(write.key)
      else await domain.table(write.table).put(write.key, write.value)
    }
  }
}

async function controllerFixture() {
  const harness = await openPetHarness()
  enableAtomicTransactions(harness)
  const durable = new DurableLocusRepository(harness.domain)
  const sessions = new Map([
    ['session-s1', { id: 'session-s1', workspaceId: 'workspace-s1', title: 'S1' }],
    ['session-s2', { id: 'session-s2', workspaceId: 'workspace-s2', title: 'S2' }],
  ])
  const children: Array<{ id: string; parentSessionId: string }> = []
  let sequence = 0
  const controller = new LocusController({
    repository: new ControllerLocusRepositoryAdapter(durable),
    dsh: {
      resolveSession: async id => sessions.get(id),
      resolveDefaultWorkspace: async () => ({ id: 'workspace-auto' }),
      createMainSession: async ({ workspaceId, chatId }) => {
        const session = { id: `session-auto-${++sequence}`, workspaceId, title: `auto:${chatId}` }
        sessions.set(session.id, session)
        return session
      },
      createChildSession: async ({ parentSessionId }) => {
        const parent = sessions.get(parentSessionId)
        if (parent === undefined) throw new Error('missing parent fixture')
        const child = { id: `session-child-${++sequence}`, parentSessionId, workspaceId: parent.workspaceId }
        children.push(child)
        return child
      },
    },
    lark: {
      createGroup: async ({ name }) => ({ chatId: `oc-qa-${++sequence}`, chatName: name }),
      sendControlMessage: async () => {},
    },
    id: () => `id-${++sequence}`,
    now: () => sequence + 100,
  })
  return { harness, durable, controller, children }
}

function inbound(messageId: string, text: string, mentions = true) {
  return {
    type: 'im.message.receive_v1' as const,
    message_id: messageId,
    chat_id: 'oc-decision',
    chat_type: 'group' as const,
    message_type: 'text',
    content: text,
    create_time: '2000',
    sender_id: 'ou-member',
    sender_type: 'user',
    mentions: mentions ? [{ id: 'ou-bot', name: 'Pet' }] : [],
  }
}

describe('design architecture acceptance A-F focused gaps', () => {
  it('A: keeps default Q&A and multiple issue groups as independent children of one main', async () => {
    const f = await controllerFixture()
    try {
      const qa = await f.controller.createOrOpenDefaultQa({ parentSessionId: 'session-s1', ownerId: 'ou-owner' })
      const issueA = await f.controller.ensureGroup({ chatId: 'oc-issue-a', parentSessionId: 'session-s1' })
      const issueB = await f.controller.ensureGroup({ chatId: 'oc-issue-b', parentSessionId: 'session-s1' })
      const opened = await f.controller.createOrOpenDefaultQa({ parentSessionId: 'session-s1', ownerId: 'ou-owner' })

      expect([qa.locus, issueA.locus, issueB.locus].map(item => item.parentSessionId)).toEqual([
        'session-s1', 'session-s1', 'session-s1',
      ])
      expect(new Set([qa.locus.childSessionId, issueA.locus.childSessionId, issueB.locus.childSessionId]).size).toBe(3)
      expect(opened).toMatchObject({ reused: true, locus: { locusId: qa.locus.locusId } })
      expect(f.durable.getDefaultQaLocus('session-s1')?.id).toBe(qa.locus.locusId)
    } finally {
      await f.harness.close()
    }
  })

  it('C/D: preserves old S0 topics, keeps explicit S2 local, and gives post-switch topics S1 read', async () => {
    const f = await controllerFixture()
    try {
      const oldTopic = await f.controller.ensureTopic({ chatId: 'oc-project', threadId: 'omt-old' })
      const groupBefore = await f.controller.ensureGroup({ chatId: 'oc-project' })
      const explicitS2 = await f.controller.ensureTopic({
        chatId: 'oc-project', threadId: 'omt-explicit-s2', parentSessionId: 'session-s2',
      })
      const switched = await f.controller.replaceAutomaticGroupParent({
        chatId: 'oc-project', parentSessionId: 'session-s1',
      })
      const newTopic = await f.controller.ensureTopic({ chatId: 'oc-project', threadId: 'omt-new' })

      expect(oldTopic.locus.parentSessionId).toBe(groupBefore.group.mainSessionId)
      expect(f.durable.getLocus(oldTopic.locus.locusId)).toMatchObject({ state: 'active', parentSessionId: groupBefore.group.mainSessionId })
      expect(explicitS2.locus).toMatchObject({ parentSessionId: 'session-s2', source: 'explicit', permission: 'read' })
      expect(switched.locus).toMatchObject({ parentSessionId: 'session-s1', generation: 2, permission: 'read' })
      expect(newTopic.locus).toMatchObject({ parentSessionId: 'session-s1', source: 'inherited', permission: 'read' })
      expect(f.durable.getLocus(groupBefore.locus.locusId)?.state).toBe('retired')
    } finally {
      await f.harness.close()
    }
  })

  it('B/E: non-at has zero side effects; later decision turns reuse one child and never create Invocation rows', async () => {
    const harness = await openPetHarness()
    try {
      const durable = new DurableLocusRepository(harness.domain)
      await durable.putLocus({
        id: 'locus-decision', generation: 1, endpoint: { chatId: 'oc-decision' },
        parentSessionId: 'session-main', childSessionId: 'session-child', workspaceId: 'workspace-main',
        source: 'auto', state: 'active', permission: { desired: 'read', effective: 'read', verifiedAt: 1 },
        busy: false, createdAt: 1, updatedAt: 1,
      })
      const queued: Array<{ childSessionId: string; prompt: string }> = []
      const controller = new LocusChannelController({
        locus: createLocusResolution({ store: durable }) as never,
        deliveries: {
          findByMessageId: id => durable.findDeliveryByMessageId(id),
          accept: input => durable.acceptDelivery(input),
          bindQueued: input => durable.bindQueued(input),
          bindTurn: input => durable.bindTurn(input),
          settleByTurn: input => durable.settleByTurn(input),
        } as never,
        child: {
          ensureChild: locus => ({ parentSessionId: locus.parentSessionId, childSessionId: locus.childSessionId }),
          queueChild: input => {
            queued.push({ childSessionId: input.child.childSessionId, prompt: input.prompt })
            return { accepted: true as const, executionId: input.executionId }
          },
        },
        turns: { perTurnCorrelation: true, subscribe: () => () => {} },
        admissionContext: {
          botOpenId: 'ou-bot', allowOpenIds: ['ou-owner'], watermark: 1000,
          isDuplicate: () => false,
          authorization: () => 'authorized',
        },
      })

      await expect(controller.handle(inbound('om-material', 'PRD link', false))).resolves.toMatchObject({ kind: 'ignored', reason: 'no-mention' })
      expect(queued).toEqual([])
      expect(durable.findDeliveryByMessageId('om-material')).toBeUndefined()

      await expect(controller.handle(inbound('om-question', '@Pet choose A or B'))).resolves.toMatchObject({ kind: 'accepted' })
      await expect(controller.handle(inbound('om-answer', '@Pet B'))).resolves.toMatchObject({ kind: 'accepted' })
      expect(queued.map(item => item.childSessionId)).toEqual(['session-child', 'session-child'])
      expect(durable.findDeliveryByMessageId('om-question')?.replyTarget?.messageId).toBe('om-question')
      expect(durable.findDeliveryByMessageId('om-answer')?.replyTarget?.messageId).toBe('om-answer')
      expect(harness.domain.table('invocations').size).toBe(0)
      expect(harness.domain.table('invocation_channel').size).toBe(0)
      controller.dispose()
    } finally {
      await harness.close()
    }
  })
})
