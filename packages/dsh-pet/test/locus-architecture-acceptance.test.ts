import { LOCUS_MAIN_PRESET } from '../src/host/locus/aggregate.js'
import { describe, expect, it } from 'vitest'
import { LocusChannelController } from '../src/host/channel/locus-controller.js'
import { LocusController } from '../src/host/locus/controller.js'
import { LocusRepositoryV20 } from '../src/host/locus/persistence-v20.js'
import { createLocusResolution } from '../src/host/locus/resolution.js'
import { openPetHarness } from './harness.js'

function enableAtomicTransactions(harness: Awaited<ReturnType<typeof openPetHarness>>): void {
  if (harness.domain.supportsTransaction === true && typeof harness.domain.transaction === 'function') return
  type Write = { kind: 'put' | 'delete'; table: string; key: string; value?: unknown }
  const domain = harness.domain as unknown as {
    supportsTransaction?: boolean
    transaction?: (body: (tx: {
      put(table: string, key: string, value: unknown): void
      delete(table: string, key: string): void
    }) => void) => Promise<void>
    table(name: string): {
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
  const durable = new LocusRepositoryV20(harness.domain as never, { now: () => 100 })
  const sessions = new Map([
    // agentPreset mirrors the real Host: an explicitly named main must run
    // LOCUS_MAIN_PRESET, because the locus child inherits its composition.
    ['session-s1', { id: 'session-s1', workspaceId: 'workspace-s1', title: 'S1', agentPreset: LOCUS_MAIN_PRESET }],
    ['session-s2', { id: 'session-s2', workspaceId: 'workspace-s2', title: 'S2', agentPreset: LOCUS_MAIN_PRESET }],
  ])
  let sequence = 0
  const controller = new LocusController({
    repository: durable,
    establishSpace: async input => ({ ok: true, spaceId: `space-${input.locusMainSessionId}` }),
    dsh: {
      resolveSession: async id => sessions.get(id),
      resolveDefaultWorkspace: async () => ({ id: 'workspace-auto' }),
      createMainSession: async ({ workspaceId, chatId }) => {
        const session = { id: `session-auto-${++sequence}`, workspaceId, title: `auto:${chatId}` }
        sessions.set(session.id, session)
        return session
      },
      createLocusMainSession: async ({ workspaceId }) => {
        const main = { id: `locus-main-${++sequence}`, workspaceId, title: 'Locus', agentPreset: LOCUS_MAIN_PRESET }
        sessions.set(main.id, main)
        return main
      },
    },
    lark: {
      createGroup: async ({ name }) => ({ chatId: `oc-qa-${++sequence}`, chatName: name }),
      sendControlMessage: async () => {},
    },
    id: () => `id-${++sequence}`,
    now: () => sequence + 100,
  } as never)
  return { harness, durable, controller }
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
  it('A: keeps default Q&A and multiple issue groups as independent entries of one main', async () => {
    const f = await controllerFixture()
    try {
      await f.controller.createOrOpenDefaultQa({ parentSessionId: 'session-s1', ownerId: 'ou-owner' })
      await f.controller.ensureGroup({ chatId: 'oc-issue-a', parentSessionId: 'session-s1' })
      await f.controller.ensureGroup({ chatId: 'oc-issue-b', parentSessionId: 'session-s1' })
      const opened = await f.controller.createOrOpenDefaultQa({ parentSessionId: 'session-s1', ownerId: 'ou-owner' })

      const qaRow = f.durable.findDefaultQa('session-s1')!
      const rows = ['oc-issue-a', 'oc-issue-b'].map(chatId => f.durable.getRow({ chatId })!)
      const main = qaRow.locusMainSessionId
      expect(rows.map(row => (row as unknown as { locusMainSessionId: string }).locusMainSessionId)).toEqual([main, main])
      expect(new Set([qaRow.sessionId, ...rows.map(row => row.sessionId)]).size).toBe(3)
      expect(opened).toMatchObject({ reused: true })
    } finally {
      await f.harness.close()
    }
  })

  it('B/E: non-at has zero side effects; later decision turns reuse one child, serialize FIFO, and never create Invocation rows', async () => {
    const harness = await openPetHarness()
    try {
      enableAtomicTransactions(harness)
      const durable = new LocusRepositoryV20(harness.domain as never, { now: () => 100 })
      const pairing = {
        workSessionId: 'session-work', locusMainSessionId: 'session-main', status: 'active' as const,
        generation: 1, spaceId: 'space-main', workspaceId: 'workspace-main', createdAt: 1, updatedAt: 1,
      }
      await harness.domain.table('locus_mains').put(pairing.locusMainSessionId, pairing)
      await harness.domain.table('loci').put('oc-decision', {
        endpoint: { chatId: 'oc-decision' }, locusId: 'locus-decision', sessionId: 'session-child',
        state: 'active', accessMode: 'read-only', revision: 0, createdAt: 1, updatedAt: 1,
        locusMainSessionId: pairing.locusMainSessionId, workspaceId: 'workspace-main',
      })
      const queued: Array<{ childSessionId: string; prompt: string }> = []
      const controller = new LocusChannelController({
        locus: createLocusResolution({
          store: durable,
          mains: { find: id => durable.findMain(id) },
          verifyMain: id => id === pairing.locusMainSessionId,
        }) as never,
        allowOpenIds: () => ['ou-owner'],
        currentToolTier: () => 'safe',
        readAllowOpenIds: () => ['ou-owner'],
        deliveries: {
          findByMessageId: (id: string) => durable.findDeliveryByMessageId(id),
          getById: (id: string) => durable.getDelivery(id),
          accept: (input: never) => durable.acceptDelivery(input),
          bindQueued: (input: never) => durable.bindQueued({ ...(input as unknown as { correlation: object }).correlation, ...(input as object) } as never).then(result => result.record),
          bindTurn: (input: never) => durable.bindTurn({ ...(input as unknown as { correlation: object }).correlation, ...(input as object) } as never).then(result => result.record),
        } as never,
        // The durable current/backlog claim seam: one-current FIFO serialization
        // across two decision-turn Deliveries on the same entry.
        deliveryDispatch: {
          // The channel passes {correlation, deliveryId, now}; v20 takes a flat correlation.
          claimCurrent: (input: never) => {
            const nested = input as unknown as { correlation: object; deliveryId?: string; now: number }
            // The channel port wants the claimed record, or undefined when nothing was claimed.
            return durable.claimCurrentDelivery({ ...nested.correlation, deliveryId: nested.deliveryId, now: nested.now } as never).then(result => (result.changed ? result.record : undefined))
          },
          currentFinished: () => {},
          dispatchNext: async (correlation: never) => { await controller.dispatchNext(correlation) },
          scheduleCurrent: () => {},
        },
        child: {
          ensureChild: (locus: { sessionId: string }) => ({ parentSessionId: pairing.locusMainSessionId, childSessionId: locus.sessionId }),
          queueChild: async (input: never) => {
            const request = input as unknown as {
              fenceBeforeQueue: () => Promise<boolean>
              child: { childSessionId: string }
              content: Array<{ type: string; text?: string }>
              executionId: string
            }
            expect(await request.fenceBeforeQueue()).toBe(true)
            queued.push({ childSessionId: request.child.childSessionId, prompt: request.content.filter(block => block.type === 'text').map(block => block.text).join('\n') })
            return { accepted: true as const, executionId: request.executionId, inboxMessageId: `inbox-${request.executionId}` }
          },
        },
        inspectResidentPolicy: () => ({ resident: false }),
        turns: { perTurnCorrelation: true, subscribe: () => () => {} },
        admissionContext: {
          botOpenId: 'ou-bot', allowOpenIds: ['ou-owner'], watermark: 1000,
          isDuplicate: () => false,
          authorization: () => 'authorized',
        },
      } as never)

      await expect(controller.handle(inbound('om-material', 'PRD link', false) as never)).resolves.toMatchObject({ kind: 'ignored', reason: 'no-mention' })
      expect(queued).toEqual([])
      expect(durable.findDeliveryByMessageId('om-material')).toBeUndefined()

      await expect(controller.handle(inbound('om-question', '@Pet choose A or B') as never)).resolves.toMatchObject({ kind: 'accepted' })
      const correlation = { endpoint: { chatId: 'oc-decision' }, locusId: 'locus-decision', sessionId: 'session-child' }
      const first = durable.findDeliveryByMessageId('om-question')!
      expect(first.status).toBe('current')
      await expect(controller.handle(inbound('om-answer', '@Pet B') as never)).resolves.toMatchObject({ kind: 'accepted' })
      expect(durable.findDeliveryByMessageId('om-answer')).toMatchObject({ status: 'accepted', queueState: 'backlog' })
      expect(queued).toHaveLength(1)
      // Redelivery is deduplicated by the real repository.
      await controller.handle(inbound('om-answer', '@Pet B') as never)
      expect(durable.listDeliveries()).toHaveLength(2)
      expect(queued).toHaveLength(1)
      // `turn/end` never settles a Delivery: the durable finish operation does.
      // `no-reply` completes from `finishing`, so the finish begins first.
      await durable.markDeliveryFinishing({ ...correlation, deliveryId: first.deliveryId, now: 200, expectedRevision: first.revision } as never)
      await durable.completeCurrentDelivery({
        ...correlation,
        deliveryId: first.deliveryId,
        now: 201,
        outcome: 'no-reply',
        outboundResult: 'none',
        reason: 'decision recorded, no separate reply needed',
        ...(first.revision === undefined ? {} : { expectedRevision: first.revision + 1 }),
      } as never)
      controller.currentFinished({ deliveryId: first.deliveryId, correlation } as never)
      await controller.dispatchNext(correlation as never)

      expect(queued.map(item => item.childSessionId)).toEqual(['session-child', 'session-child'])
      expect(durable.findDeliveryByMessageId('om-question')?.status).toBe('no-reply')
      expect(durable.findDeliveryByMessageId('om-answer')?.status).toBe('current')
      expect(harness.domain.table('invocations').size).toBe(0)
      expect(harness.domain.table('invocation_channel').size).toBe(0)
      controller.dispose()
    } finally {
      await harness.close()
    }
  })
})
