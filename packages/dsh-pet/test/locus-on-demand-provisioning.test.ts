/**
 * End-to-end proof that the whole locus tree is built on demand by the first
 * qualifying @ message, over the REAL provisioning and admission controllers
 * sharing one durable repository — the exact composition `index.ts` wires
 * once `botLifecycleInitializer` is never set.
 *
 * This is the regression `pet-locus-on-demand-tree` exists to prove: bot-added
 * has zero effect on the repository, and `resolveLocus` → `ensureForDelivery`
 * → `LocusController.ensureGroup`/`ensureTopic` establishes work + locus main
 * and a not-created generation. The channel's first queue then creates its
 * reserved child with that Delivery; explicit binding creates no child early.
 */

import { LOCUS_MAIN_PRESET } from '../src/host/locus/aggregate.js'
import { createDurableLocusAuthorizationResolver } from '../src/host/locus/admission.js'
import { afterEach, describe, expect, it } from 'vitest'
import { LocusChannelController } from '../src/host/channel/locus-controller.js'
import { createLocusControlDispatcher } from '../src/host/locus/control.js'
import { LocusController } from '../src/host/locus/controller.js'
import { LocusRepositoryV20 } from '../src/host/locus/persistence-v20.js'
import { createLocusResolution } from '../src/host/locus/resolution.js'
import { openPetHarness, type PetHarness } from './harness.js'
import { enableAtomicTransactions } from './support/three-tier.js'
import { Topology, closeAllTopologies, type TopologyBackend } from './support/w-topology.js'
import { admitDocCommentEvent, parseDocCommentEvent } from '../src/host/channel/doc-comment.js'
import type { DocCommentQuery } from '../src/host/channel/lark.js'
import { compactCommentEvent } from './fixtures/lark-subscribe.js'

const CHAT_ID = 'oc-on-demand'
const PARENT_SESSION = 'session-owner-main'

function inbound(messageId: string, text: string, mentions = true) {
  return {
    type: 'im.message.receive_v1' as const,
    message_id: messageId,
    chat_id: CHAT_ID,
    chat_type: 'group' as const,
    message_type: 'text',
    content: text,
    create_time: '2000',
    sender_id: 'ou-owner',
    sender_type: 'user',
    mentions: mentions ? [{ id: 'ou-bot', name: 'Pet' }] : [],
  }
}

/** Same shape as `inbound`, but addressed to an explicit `chatId`'s group body. */
function inboundFor(chatId: string, messageId: string, text: string) {
  return {
    type: 'im.message.receive_v1' as const,
    message_id: messageId,
    chat_id: chatId,
    chat_type: 'group' as const,
    message_type: 'text',
    content: text,
    create_time: '2000',
    sender_id: 'ou-owner',
    sender_type: 'user',
    mentions: [{ id: 'ou-bot', name: 'Pet' }],
  }
}

/** Same shape as `inbound`, but addressed to a topic under a different group. */
function topicInbound(chatId: string, threadId: string, messageId: string, text: string) {
  return {
    type: 'im.message.receive_v1' as const,
    message_id: messageId,
    chat_id: chatId,
    chat_type: 'group' as const,
    thread_id: threadId,
    message_type: 'text',
    content: text,
    create_time: '2000',
    sender_id: 'ou-owner',
    sender_type: 'user',
    mentions: [{ id: 'ou-bot', name: 'Pet' }],
  }
}

/**
 * Compose the real provisioning controller and the real channel controller
 * over one shared durable repository — the same repository instance
 * `index.ts` gives both `locusProvisioningController` and `locusResolution`.
 */
async function composeOnDemandHost(options: { readonly failFirstEstablishment?: boolean; readonly failFirstCreate?: boolean; readonly controls?: { target: { chatId: string; messageId: string }; text: string; senderOpenId?: string }[]; readonly receiptsThrow?: boolean; readonly imCalls?: string[] } = {}) {
  const harness: PetHarness = await openPetHarness()
  enableAtomicTransactions(harness)
  const durable = new LocusRepositoryV20(harness.domain as never, { now: () => 0 })

  // The owner's work session may use standard; only the Pet-created locus main is pinned.
  const sessions = new Map([
    [PARENT_SESSION, { id: PARENT_SESSION, workspaceId: 'workspace-owner', title: 'Owner main', agentPreset: 'standard' }],
  ])
  const archived = new Set<string>()
  const createdWorks: string[] = []
  const createdMains: string[] = []
  const spaces: string[] = []
  const released: string[] = []
  const children: string[] = []
  const firstCommits: string[] = []
  let sequence = 0
  let clock = 100
  const now = () => ++clock
  let spaceCalls = 0
  let createChildCalls = 0
  // v20: the repository IS the controller's port; these read helpers replace the old adapter.
  const adapter = {
    findGroup: async (chatId: string) => { const row = durable.getRow({ chatId }); return row !== undefined && 'locusMainSessionId' in row ? row : undefined },
    findActive: async (endpoint: { chatId: string; threadId?: string }) => durable.getRow(endpoint),
  }
  const provisioning = new LocusController({
    repository: durable,
    dsh: {
      resolveSession: async id => {
        const session = sessions.get(id)
        return session === undefined ? undefined : { ...session, state: archived.has(id) ? 'archived' as const : 'active' as const }
      },
      resolveDefaultWorkspace: async () => ({ id: 'workspace-auto' }),
      createMainSession: async ({ workspaceId, chatId }) => {
        const session = { id: `session-auto-${++sequence}`, workspaceId, title: `auto:${chatId}` }
        sessions.set(session.id, session)
        createdWorks.push(session.id)
        return session
      },
      createLocusMainSession: async ({ workspaceId }) => {
        const main = { id: `locus-main-${++sequence}`, workspaceId, title: 'Locus', agentPreset: LOCUS_MAIN_PRESET }
        sessions.set(main.id, main)
        createdMains.push(main.id)
        return main
      },
      releaseSession: async id => { released.push(id) },
    },
    // Only exercised by `replaceAutomaticGroupParentLocked`'s switch-warning
    // delivery, per `LocusControllerDeps`'s own contract. The on-demand build
    // path never calls it: `ensureGroup` with an explicit parent on a fresh
    // endpoint builds directly and never reaches the replace branch.
    lark: { createGroup: async () => { throw new Error('unused in this fixture') }, sendControlMessage: async () => {} },
    releaseSpace: async () => {},
    establishSpace: async input => {
      if (options.failFirstEstablishment === true && ++spaceCalls === 1) throw new Error('injected establishment failure')
      spaces.push(input.locusMainSessionId)
      return { ok: true, spaceId: `space-${input.locusMainSessionId}` }
    },
    id: () => `id-${++sequence}`,
    now,
  })

  const queued: { childSessionId: string; prompt: string }[] = []
  const diagnostics: string[] = []
  const controller = new LocusChannelController({
    locus: createLocusResolution({
      store: durable,
      mains: { find: id => durable.findMain(id) },
      verifyMain: id => !archived.has(id) && sessions.get(id)?.agentPreset === LOCUS_MAIN_PRESET,
      isSessionArchived: id => archived.has(id),
      provisioning: {
        ensureForDelivery: async ({ endpoint }) => {
          const ensured = await provisioning.ensureEntry(endpoint)
          const record = ensured.locus
          if (record.state !== 'not-created') throw new Error(`Provisioning must not create a child: ${record.state}`)
          const group = ensured.group ?? durable.getRow({ chatId: endpoint.chatId })
          if (group === undefined || !('locusMainSessionId' in group)) throw new Error('no group row')
          return {
            locusId: record.locusId, endpoint: record.endpoint, sessionId: record.sessionId, state: 'not-created' as const,
            accessMode: record.accessMode, revision: record.revision, locusMainSessionId: group.locusMainSessionId,
            workSessionId: durable.findMain(group.locusMainSessionId)!.workSessionId, workspaceId: group.workspaceId,
          }
        },
      },
    }) as never,
    deliveries: {
      findByMessageId: id => durable.findDeliveryByMessageId(id),
      getById: id => durable.getDelivery(id),
      accept: input => durable.acceptDelivery(input),
      bindQueued: async ({ correlation, ...rest }: { correlation: object }) => { const r = await durable.bindQueued({ ...correlation, ...rest } as never); return r.changed ? r.record : undefined },
      bindTurn: async ({ correlation, ...rest }: { correlation: object }) => { const r = await durable.bindTurn({ ...correlation, ...rest } as never); return r.changed ? r.record : undefined },
      fail: input => durable.failBeforeDispatch({ ...input, failedAt: now() }),
      failBeforeDispatch: input => durable.failBeforeDispatch({ ...input, failedAt: now() }),
    } as never,
    deliveryDispatch: {
      claimCurrent: async ({ correlation, ...rest }) => { const r = await durable.claimCurrentDelivery({ ...correlation, ...rest }); return r.changed ? r.record : undefined },
      currentFinished: () => {},
      dispatchNext: async () => {},
      scheduleCurrent: () => {},
    },
    child: {
      ensureChild: locus => ({ parentSessionId: locus.locusMainSessionId, childSessionId: locus.sessionId }),
      queueChild: async input => {
        if (!await input.fenceBeforeQueue()) return { accepted: false as const, reason: 'stale-delivery' }
        if (input.locus.state === 'not-created') {
          createChildCalls += 1
          if (options.failFirstCreate === true && createChildCalls === 1) return { accepted: false as const, reason: 'child-create-failed' }
          // Fake only the Host creation seam; publication is the real repository operation (D16).
          await durable.publishFirstDelivery({
            locusId: input.locus.locusId, sessionId: input.locus.sessionId, revision: input.locus.revision,
            deliveryId: input.deliveryId, executionId: input.executionId, now: now(),
          })
          await durable.commitFirstDelivery({ executionId: input.executionId, now: now() })
          children.push(input.child.sessionId ?? input.child.childSessionId)
        }
        queued.push({ childSessionId: input.child.childSessionId, prompt: input.content.filter(block => block.type === 'text').map(block => block.text).join('\n') })
        return { accepted: true as const, executionId: input.executionId, inboxMessageId: `inbox-${input.executionId}` }
      },
    },
    inspectResidentPolicy: () => ({ resident: false }),
    turns: { perTurnCorrelation: true, subscribe: () => () => {} },
    admissionContext: {
      botOpenId: 'ou-bot', allowOpenIds: ['ou-owner', 'ou_owner'], watermark: 1000,
      isDuplicate: () => false,
      // Use the production resolver so archive/restore and explicit owner exit
      // cross the same admission boundary as actual incoming messages.
      authorization: createDurableLocusAuthorizationResolver(durable, id => archived.has(id)),
    },
    docHasEntries: chatId => durable.listRows().some(row => row.endpoint.chatId === chatId),
    ...(options.imCalls === undefined ? {} : {
      // Spies on every IM-only port the controller can reach.
      media: {
        available: true,
        admitCurrentImage: async (input: { messageId: string }) => {
          options.imCalls!.push(`media:${input.messageId}`)
          return { kind: 'none' as const, content: [] }
        },
      } as never,
      addressing: {
        listChatBots: (chatId: string) => { options.imCalls!.push(`chat-bots:${chatId}`); return [] },
        resolveMemberName: (chatId: string) => { options.imCalls!.push(`member-name:${chatId}`); return undefined },
      },
    }),
    docDisclosureText: '本文档的评论者均可向我提问；只有 allowlist 成员能控制',
    receipts: {
      markAccepted: () => { if (options.receiptsThrow === true) throw new Error('reaction api down') },
      markSettled: () => { if (options.receiptsThrow === true) throw new Error('reaction api down') },
      sendControl: (target, text, senderOpenId) => { options.controls?.push({ target, text, ...(senderOpenId === undefined ? {} : { senderOpenId }) }) },
    },
    log: code => diagnostics.push(code),
    now,
  })

  return { harness, durable, adapter, provisioning, controller, queued, diagnostics, now, archived, sessions,
    createdWorks, createdMains, spaces, released, children,
    close: async () => { controller.dispose(); await harness.close() } }
}

describe('locus tree is built on demand by the first qualifying @ message', () => {
  it('spec Scenario "入群不建自动主会话": bot-added has zero repository effect: no group marker exists until the first @', async () => {
    const host = await composeOnDemandHost()
    try {
      // No admission at all yet — simulating that `im.chat.member.bot.added_v1`
      // never reaches provisioning, because `index.ts` never constructs its
      // subscription without `botLifecycleInitializer`. Nothing else in this
      // fixture ever calls `ensureGroup`/`ensureTopic` on its own, so the
      // repository staying empty here is exactly what "bot-added has zero
      // effect" means end to end.
      expect(await host.adapter.findGroup(CHAT_ID)).toBeUndefined()
      expect(await host.adapter.findActive({ chatId: CHAT_ID })).toBeUndefined()
    } finally {
      await host.close()
    }
  })

  it('spec Scenario "首次消息补齐": the first qualifying @ builds main, child and an active locus inside one admission, then delivers it', async () => {
    const host = await composeOnDemandHost()
    try {
      expect(await host.adapter.findGroup(CHAT_ID)).toBeUndefined()

      const result = await host.controller.handle(inbound('om-first', '@Pet hello'))

      expect(result).toMatchObject({ kind: 'accepted' })
      const group = await host.adapter.findGroup(CHAT_ID)
      expect(group).toBeDefined()
      const locus = host.durable.getRow({ chatId: CHAT_ID })!
      expect(locus).toMatchObject({ state: 'active', accessMode: 'read-only' })
      // Delivered in the SAME admission: the child that was just created
      // already received the message, not a second round trip.
      expect(host.queued).toHaveLength(1)
      expect(host.queued[0]!.childSessionId).toBe(locus.sessionId)
      expect(host.createdWorks).toHaveLength(1)
      expect(host.createdMains).toEqual([group!.locusMainSessionId])
      expect(host.spaces).toEqual([group!.locusMainSessionId])
      expect(host.durable.findMain(group!.locusMainSessionId)?.workSessionId).toBe(host.createdWorks[0])
      await host.controller.handle(inbound('om-first', '@Pet hello'))
      expect(host.durable.listDeliveries()).toHaveLength(1)
      expect(host.queued).toHaveLength(1)
      expect(host.children).toHaveLength(1)
    } finally {
      await host.close()
    }
  })

  it('spec Scenario "普通资料发布": non-@ traffic before the first mention does no work and builds nothing', async () => {
    const host = await composeOnDemandHost()
    try {
      const result = await host.controller.handle(inbound('om-noise', 'just chatting', false))
      expect(result).toMatchObject({ kind: 'ignored', reason: 'no-mention' })
      expect(await host.adapter.findGroup(CHAT_ID)).toBeUndefined()
      expect(host.queued).toEqual([])
    } finally {
      await host.close()
    }
  })

  it.each(['archived', 'preset-drift'] as const)('M 不可用而 W 正常: 真实入站整 W 迁移到新 M (D7): %s', async unavailable => {
    const host = await composeOnDemandHost()
    try {
      const initial = await host.provisioning.ensureGroup({ chatId: CHAT_ID, parentSessionId: PARENT_SESSION })
      const oldMain = initial.group.locusMainSessionId
      const oldSession = initial.locus.sessionId
      if (unavailable === 'archived') host.archived.add(oldMain)
      else host.sessions.set(oldMain, { ...host.sessions.get(oldMain)!, agentPreset: 'standard' })
      expect(await host.controller.handle(inbound('om-m-unavailable', '@Pet 继续'))).toMatchObject({ kind: 'accepted' })
      const group = host.durable.getRow({ chatId: CHAT_ID })!
      if (!('locusMainSessionId' in group)) throw new Error('group row expected')
      expect(group.locusMainSessionId).not.toBe(oldMain)
      expect(group.locusId).toBe(initial.locus.locusId)
      expect(host.durable.findMain(group.locusMainSessionId)?.workSessionId).toBe(PARENT_SESSION)
      expect(host.durable.findMain(oldMain)?.status).toBe('retired')
      expect(host.createdWorks).toEqual([])
      expect(host.queued).toHaveLength(1)
      expect(host.queued[0]!.prompt).toContain('继续')
      expect(host.queued[0]!.childSessionId).not.toBe(oldSession)
      // The new M is reused afterwards.
      await host.controller.handle(inbound('om-reuse-main', '@Pet 下一条'))
      expect(host.createdMains).toHaveLength(2)
    } finally { await host.close() }
  })

  it('W 已归档时授权 @ 不会替换 M，只有管理面改绑 (D7)', async () => {
    const host = await composeOnDemandHost()
    try {
      await host.provisioning.ensureGroup({ chatId: CHAT_ID, parentSessionId: PARENT_SESSION })
      host.archived.add(PARENT_SESSION)
      expect(await host.controller.handle(inbound('om-source-archived', '@Pet 暂停'))).toMatchObject({ kind: 'ignored', reason: 'retired-endpoint' })
      expect(host.createdMains).toHaveLength(1)
      expect(host.queued).toEqual([])
    } finally { await host.close() }
  })

  it('locus 主会话 active 时真实入站复用；明确停止入口不会被替换', async () => {
    const host = await composeOnDemandHost()
    try {
      const initial = await host.provisioning.ensureGroup({ chatId: CHAT_ID, parentSessionId: PARENT_SESSION })
      expect(await host.controller.handle(inbound('om-reuse-active', '@Pet 使用原入口'))).toMatchObject({ kind: 'accepted' })
      expect(host.createdMains).toHaveLength(1)
      expect((host.durable.getRow({ chatId: CHAT_ID }) as { locusMainSessionId?: string }).locusMainSessionId).toBe(initial.group.locusMainSessionId)
    } finally { await host.close() }
    const stopped = await composeOnDemandHost()
    try {
      const initial = await stopped.provisioning.ensureGroup({ chatId: CHAT_ID, parentSessionId: PARENT_SESSION })
      await stopped.durable.stopRow({ expectedLocusId: initial.locus.locusId, expectedRevision: initial.locus.revision }, stopped.now())
      stopped.archived.add(initial.group.locusMainSessionId)
      expect(await stopped.controller.handle(inbound('om-stopped', '@Pet 不应复活'))).toMatchObject({ kind: 'ignored', reason: 'retired-endpoint' })
      expect(stopped.createdMains).toHaveLength(1)
      expect(stopped.queued).toEqual([])
    } finally { await stopped.close() }
  })

  it('a space establishment failure publishes no partial locus and leaves no group marker', async () => {
    const host = await composeOnDemandHost({ failFirstEstablishment: true })
    try {
      const result = await host.controller.handle(inbound('om-fails', '@Pet hello'))

      // The controller must not silently swallow this into an accepted
      // Delivery: a group that never got a working child must not look active.
      expect(result).not.toMatchObject({ kind: 'accepted' })
      expect(await host.adapter.findGroup(CHAT_ID)).toBeUndefined()
      expect(await host.adapter.findActive({ chatId: CHAT_ID })).toBeUndefined()
      expect(host.queued).toEqual([])
    } finally {
      await host.close()
    }
  })

  it('a failed establishment tells the owner instead of going silent', async () => {
    const controls: { target: { chatId: string; messageId: string }; text: string; senderOpenId?: string }[] = []
    const host = await composeOnDemandHost({ failFirstEstablishment: true, controls })
    try {
      await host.controller.handle(inbound('om-fails', '@Pet hello'))
      expect(controls).toHaveLength(1)
      expect(controls[0]!.target).toMatchObject({ chatId: CHAT_ID, messageId: 'om-fails' })
      expect(controls[0]!.text).toMatch(/^入口建立失败：/)
      expect(host.queued).toEqual([])
    } finally {
      await host.close()
    }
  })

  it('a first-child creation failure settles only that Delivery and the next message creates the child on the same entry', async () => {
    const host = await composeOnDemandHost({ failFirstCreate: true })
    try {
      expect(await host.controller.handle(inbound('om-child-fails', '@Pet hello'))).toMatchObject({ kind: 'refused' })
      const waiting = host.durable.getRow({ chatId: CHAT_ID })!
      expect(waiting.state).toBe('not-created')
      expect(host.durable.findDeliveryByMessageId('om-child-fails')).toMatchObject({ status: 'failed' })
      expect(host.queued).toEqual([])

      expect(await host.controller.handle(inbound('om-child-retry', '@Pet retry'))).toMatchObject({ kind: 'accepted' })
      const after = host.durable.getRow({ chatId: CHAT_ID })!
      expect(after).toMatchObject({ locusId: waiting.locusId, state: 'active' })
      expect(host.createdWorks).toHaveLength(1)
      expect(host.createdMains).toHaveLength(1)
      expect(host.children).toEqual([after.sessionId])
      expect(host.queued).toHaveLength(1)
    } finally { await host.close() }
  })

  it('a failed establishment whose rollback fully reclaimed its resources does not block the endpoint', async () => {
    // The controller's rollback released everything the failed attempt created, so
    // nothing is left to compensate: the retry is served at once (the ten-minute
    // block is pinned down in locus-provisioning-rollback-v20 for a partial rollback).
    const host = await composeOnDemandHost({ failFirstEstablishment: true })
    try {
      const first = await host.controller.handle(inbound('om-fails', '@Pet hello'))
      expect(first).not.toMatchObject({ kind: 'accepted' })

      const retried = await host.controller.handle(inbound('om-retry', '@Pet hello again'))
      expect(retried).toMatchObject({ kind: 'accepted' })
      expect(host.queued).toHaveLength(1)
    } finally {
      await host.close()
    }
  })
})

describe('/bind on a not-yet-built endpoint builds directly, once, with the explicit W', () => {
  it('a fresh endpoint bound before any @ is built once with the explicit W, no auto W', async () => {
    const host = await composeOnDemandHost()
    try {
      expect(await host.adapter.findGroup(CHAT_ID)).toBeUndefined()
      const bound = await host.provisioning.ensureGroup({ chatId: CHAT_ID, parentSessionId: PARENT_SESSION })

      expect(bound.created).toBe(true)
      expect(bound.group.locusMainSessionId).not.toBe(PARENT_SESSION)
      expect(host.durable.findMain(bound.group.locusMainSessionId)?.workSessionId).toBe(PARENT_SESSION)
      expect(bound.locus).toMatchObject({ state: 'not-created', accessMode: 'read-only' })
      expect(host.createdWorks).toEqual([])
      expect(host.createdMains).toEqual([bound.group.locusMainSessionId])
      expect(host.spaces).toEqual([bound.group.locusMainSessionId])
      expect(host.children).toEqual([])
      expect(await host.controller.handle(inbound('om-bound-first', '@Pet hello'))).toMatchObject({ kind: 'accepted' })
      expect(host.children).toEqual([bound.locus.sessionId])
      expect(host.createdWorks).toEqual([])
      expect(host.createdMains).toHaveLength(1)
    } finally {
      await host.close()
    }
  })

  it('binding an existing entry to ANOTHER W is refused (D5): cross-W changes only through the management rebind', async () => {
    const host = await composeOnDemandHost()
    try {
      expect(await host.controller.handle(inbound('om-first', '@Pet hello'))).toMatchObject({ kind: 'accepted' })
      const before = host.durable.getRow({ chatId: CHAT_ID })!
      await expect(host.provisioning.ensureGroup({ chatId: CHAT_ID, parentSessionId: PARENT_SESSION }))
        .rejects.toMatchObject({ code: 'EXPLICIT_PARENT_CONFLICT' })
      expect(host.durable.getRow({ chatId: CHAT_ID })).toEqual(before)
      expect(host.createdMains).toHaveLength(1)
    } finally {
      await host.close()
    }
  })
})

describe('group and topic entries build on demand with structurally equivalent timing', () => {
  it('a topic\'s first qualifying @ builds the group root AND the topic child in the same admission, just like a bare group', async () => {
    const host = await composeOnDemandHost()
    const TOPIC_CHAT_ID = 'oc-on-demand-topic-host'
    const THREAD_ID = 'omt-on-demand'
    try {
      expect(await host.adapter.findGroup(TOPIC_CHAT_ID)).toBeUndefined()

      const result = await host.controller.handle(
        topicInbound(TOPIC_CHAT_ID, THREAD_ID, 'om-topic-first', '@Pet hello from topic'),
      )

      expect(result).toMatchObject({ kind: 'accepted' })
      // Exactly the same shape the bare-group test proved: no bot-added ever
      // touched this endpoint, yet the FIRST @ on the topic alone was enough
      // to establish both levels of the hierarchy at once — a group with no
      // dedicated topic child of its own, and the topic's own active locus.
      const group = await host.adapter.findGroup(TOPIC_CHAT_ID)
      expect(group).toBeDefined()
      const topicLocus = host.durable.getRow({ chatId: TOPIC_CHAT_ID, threadId: THREAD_ID })!
      expect(topicLocus.state).toBe('active')
      // Delivered in the SAME admission, exactly like the bare-group case.
      expect(host.queued).toHaveLength(1)
      expect(host.queued[0]!.childSessionId).toBe(topicLocus.sessionId)
      // One commit, one M: the topic row stores no M of its own.
      expect(topicLocus).not.toHaveProperty('locusMainSessionId')
    } finally {
      await host.close()
    }
  })

  it('the topic child is a sibling of the group child under the same main, not built ahead of the group', async () => {
    const host = await composeOnDemandHost()
    const TOPIC_CHAT_ID = 'oc-on-demand-topic-sibling'
    const THREAD_ID = 'omt-sibling'
    try {
      const topicResult = await host.controller.handle(
        topicInbound(TOPIC_CHAT_ID, THREAD_ID, 'om-topic-a', '@Pet first in topic'),
      )
      expect(topicResult).toMatchObject({ kind: 'accepted' })

      const groupResult = await host.controller.handle(
        inboundFor(TOPIC_CHAT_ID, 'om-group-a', '@Pet first in group body'),
      )
      expect(groupResult).toMatchObject({ kind: 'accepted' })

      const group = (await host.adapter.findGroup(TOPIC_CHAT_ID))!
      const topicLocus = host.durable.getRow({ chatId: TOPIC_CHAT_ID, threadId: THREAD_ID })!
      const groupLocus = host.durable.getRow({ chatId: TOPIC_CHAT_ID })!
      // One M for both; two distinct children.
      expect(host.durable.listGroupRowsOfMain(group.locusMainSessionId)).toHaveLength(1)
      expect(topicLocus.sessionId).not.toBe(groupLocus.sessionId)
      expect(host.queued).toHaveLength(2)
    } finally {
      await host.close()
    }
  })
})

/** Admit one doc comment the way the intake driver does, then hand it to the real controller. */
async function deliverComment(
  host: Awaited<ReturnType<typeof composeOnDemandHost>>,
  input: { token: string; commentId: string; replyId: string; isWhole: boolean; quote?: string },
) {
  const parsed = parseDocCommentEvent(compactCommentEvent({
    fileToken: input.token, commentId: input.commentId, replyId: input.replyId,
    fromOpenId: 'ou_owner', timestamp: '2000',
  }))
  if (parsed.kind !== 'event') throw new Error('fixture did not parse')
  const query: DocCommentQuery = {
    kind: 'ok', isWhole: input.isWhole, ...(input.quote === undefined ? {} : { quote: input.quote }),
    replies: [], trigger: { replyId: input.replyId, text: '@ou-bot 看看这里' },
  }
  const durable = host.durable
  const admission = admitDocCommentEvent(parsed.event, query, {
    botOpenId: 'ou-bot', allowOpenIds: ['ou_owner'], watermark: 1000, isDuplicate: () => false,
    authorization: endpoint => (durable.getRow(endpoint)?.state === 'active' ? 'authorized' : 'uninitialized'),
  })
  return host.controller.handleAdmission(admission)
}

describe('document entries build on demand exactly like groups and topics', () => {
  it('spec Scenario "文档首次评论建立文档专属主会话": two documents never share an automatic main', async () => {
    const host = await composeOnDemandHost()
    try {
      const a = await deliverComment(host, { token: 'DocA00000000000000000000001', commentId: '11', replyId: '12', isWhole: true })
      const b = await deliverComment(host, { token: 'DocB00000000000000000000001', commentId: '21', replyId: '22', isWhole: true })
      expect(a).toMatchObject({ kind: 'accepted' })
      expect(b).toMatchObject({ kind: 'accepted' })

      const rootA = await host.adapter.findGroup('doc:docx:DocA00000000000000000000001')
      const rootB = await host.adapter.findGroup('doc:docx:DocB00000000000000000000001')
      const workOf = (m: string | undefined) => host.durable.findMain(m!)?.workSessionId
      expect(workOf(rootA?.locusMainSessionId)).toBeDefined()
      expect(workOf(rootA?.locusMainSessionId)).not.toBe(workOf(rootB?.locusMainSessionId))
    } finally {
      await host.close()
    }
  })

  it('spec Scenario "划词评论先于文档级": an anchored first comment builds the document root first, and the whole-doc entry later shares its main', async () => {
    const host = await composeOnDemandHost()
    const token = 'DocC00000000000000000000001'
    const root = `doc:docx:${token}`
    try {
      const anchored = await deliverComment(host, { token, commentId: '31', replyId: '32', isWhole: false, quote: '接口已有' })
      expect(anchored).toMatchObject({ kind: 'accepted' })
      const group = (await host.adapter.findGroup(root))!
      const comment = host.durable.getRow({ chatId: root, threadId: '31' })!
      expect(comment).not.toHaveProperty('locusMainSessionId')

      const whole = await deliverComment(host, { token, commentId: '41', replyId: '42', isWhole: true })
      expect(whole).toMatchObject({ kind: 'accepted' })
      // Siblings under ONE M, never one child.
      expect(host.durable.listGroupRowsOfMain(group.locusMainSessionId)).toHaveLength(1)
      expect(host.durable.getRow({ chatId: root })!.sessionId).not.toBe(comment.sessionId)
      // The anchored quote was persisted with its Delivery (D5).
      expect(host.durable.findDeliveryByMessageId(`${root}/31/32`)?.docComment).toEqual({ quote: '接口已有' })
    } finally {
      await host.close()
    }
  })
})

describe('spec Requirement "评论准入与群消息准入同构且静默 fail closed": ask-scope disclosure', () => {
  const DISCLOSURE = '本文档的评论者均可向我提问；只有 allowlist 成员能控制'

  it('spec Scenario "建立回执披露提问范围": the first whole-doc entry discloses to the asker (a new mentioning full comment)', async () => {
    const controls: { target: { chatId: string; messageId: string }; text: string; senderOpenId?: string }[] = []
    const host = await composeOnDemandHost({ controls })
    try {
      await deliverComment(host, { token: 'DocE00000000000000000000001', commentId: '51', replyId: '52', isWhole: true })
      expect(controls).toEqual([{
        target: expect.objectContaining({ chatId: 'doc:docx:DocE00000000000000000000001', messageId: 'doc:docx:DocE00000000000000000000001/51/52' }),
        text: DISCLOSURE,
        // The asker the new full comment mentions: full comments cannot be replied to.
        senderOpenId: 'ou_owner',
      }])
    } finally {
      await host.close()
    }
  })

  it('spec Scenario "划词评论先建立时也披露": once per document, under the anchored comment, not again for the doc level', async () => {
    const controls: { target: { chatId: string; messageId: string }; text: string }[] = []
    const host = await composeOnDemandHost({ controls })
    const token = 'DocF00000000000000000000001'
    try {
      await deliverComment(host, { token, commentId: '61', replyId: '62', isWhole: false, quote: 'q' })
      await deliverComment(host, { token, commentId: '71', replyId: '72', isWhole: true })
      await deliverComment(host, { token, commentId: '81', replyId: '82', isWhole: false, quote: 'q2' })

      expect(controls.map(item => item.target.messageId)).toEqual([`doc:docx:${token}/61/62`])
      expect(controls.every(item => item.text === DISCLOSURE)).toBe(true)
    } finally {
      await host.close()
    }
  })

  it('never discloses for an IM group', async () => {
    const controls: { target: { chatId: string; messageId: string }; text: string }[] = []
    const host = await composeOnDemandHost({ controls })
    try {
      await host.controller.handle(inbound('om-im-1', '@Pet hello'))
      expect(controls).toEqual([])
    } finally {
      await host.close()
    }
  })
})

describe('spec Requirement "控制命令在评论中按所在入口生效"', () => {
  it('spec Scenario "文档绑定到另一个 W 被拒绝，已有划词评论不受影响" (D5)', async () => {
    const host = await composeOnDemandHost()
    const token = 'DocG00000000000000000000001'
    const root = `doc:docx:${token}`
    try {
      await deliverComment(host, { token, commentId: '91', replyId: '92', isWhole: true })
      await deliverComment(host, { token, commentId: '93', replyId: '94', isWhole: false, quote: 'q' })
      const before = [host.durable.getRow({ chatId: root }), host.durable.getRow({ chatId: root, threadId: '93' })]
      await expect(host.provisioning.ensureGroup({ chatId: root, parentSessionId: PARENT_SESSION }))
        .rejects.toMatchObject({ code: 'EXPLICIT_PARENT_CONFLICT' })
      // New comments keep joining the SAME M.
      await deliverComment(host, { token, commentId: '95', replyId: '96', isWhole: false, quote: 'q3' })
      expect(host.durable.getRow({ chatId: root })).toEqual(before[0])
      expect(host.durable.getRow({ chatId: root, threadId: '93' })).toEqual(before[1])
      expect(host.durable.getRow({ chatId: root, threadId: '95' })?.state).toBe('active')
      expect(host.createdMains).toHaveLength(1)
    } finally {
      await host.close()
    }
  })

  it('spec Scenario "划词评论内绑定到另一个 W 同样被拒绝，文档级入口不变"', async () => {
    const host = await composeOnDemandHost()
    const token = 'DocH00000000000000000000001'
    const root = `doc:docx:${token}`
    try {
      await deliverComment(host, { token, commentId: '101', replyId: '102', isWhole: true })
      const before = host.durable.getRow({ chatId: root })
      await expect(host.provisioning.ensureTopic({ chatId: root, threadId: '104', parentSessionId: PARENT_SESSION }))
        .rejects.toMatchObject({ code: 'EXPLICIT_PARENT_CONFLICT' })
      expect(host.durable.getRow({ chatId: root })).toEqual(before)
      expect(host.durable.getRow({ chatId: root, threadId: '104' })).toBeUndefined()
    } finally {
      await host.close()
    }
  })
})

describe('spec Scenario "表情接口失败": feedback failure never changes Delivery truth', () => {
  it('a throwing reaction port still accepts and queues the comment Delivery', async () => {
    const host = await composeOnDemandHost({ receiptsThrow: true })
    const token = 'DocI00000000000000000000001'
    try {
      const result = await deliverComment(host, { token, commentId: '111', replyId: '112', isWhole: true })
      expect(result).toMatchObject({ kind: 'accepted' })
      expect(host.queued).toHaveLength(1)
      expect(host.durable.findDeliveryByMessageId(`doc:docx:${token}/111/112`)?.status).not.toBe('failed')
    } finally {
      await host.close()
    }
  })
})

describe('spec Scenario "文档 Delivery 不调用 IM 接口" (controller side)', () => {
  it('a doc Delivery reaches neither media, chat-bot nor IM member lookups with a doc id', async () => {
    const imCalls: string[] = []
    const host = await composeOnDemandHost({ imCalls })
    try {
      const result = await deliverComment(host, { token: 'DocJ00000000000000000000001', commentId: '121', replyId: '122', isWhole: true })
      expect(result).toMatchObject({ kind: 'accepted' })
      expect(imCalls.filter(call => call.startsWith('media:') || call.startsWith('chat-bots:'))).toEqual([])
      // Name lookup is source-dispatched by the Host port, never an IM member read.
      expect(imCalls.every(call => !call.startsWith('media:'))).toBe(true)
    } finally {
      await host.close()
    }
  })

  it('an IM group Delivery still uses the IM ports (unchanged)', async () => {
    const imCalls: string[] = []
    const host = await composeOnDemandHost({ imCalls })
    try {
      await host.controller.handle(inbound('om-im-media', '@Pet look'))
      expect(imCalls.some(call => call.startsWith('chat-bots:'))).toBe(true)
      expect(imCalls.some(call => call.startsWith('media:'))).toBe(true)
    } finally {
      await host.close()
    }
  })
})



/**
 * `/bind` against a W whose active locus main is unavailable: migrate the whole
 * W first, then build the entry on the new M1. Each scenario runs on the
 * recording fake AND the real v20 repository over temp SQLite.
 */
afterEach(closeAllTopologies)

describe.each(['fake', 'real'] as const satisfies readonly TopologyBackend[])('显式绑定遇到不可用的 locus 主会话先整 W 迁移 [%s]', backend => {
  const W = 'session-w1abcdef'

  /** W has an unavailable active M-old; group H already hangs under it; G has no entry row. */
  async function archivedMain(tweakDeps: (deps: ReturnType<Topology['deps']>) => ReturnType<Topology['deps']> = d => d) {
    const t = await Topology.open({ unusableMains: ['M-old'] }, backend)
    t.addSession({ id: W, workspaceId: 'proj-1', title: '研发会话' })
    await t.seedMain(W, 'M-old', 'active', 1)
    await t.seedGroup('oc_h', 'M-old', 'proj-1')
    t.calls.length = 0
    const controller = new LocusController(tweakDeps(t.deps()))
    // Same wiring as index.ts: the dispatcher's bind port is ensureGroup/ensureTopic.
    const dispatcher = createLocusControlDispatcher({
      allowOpenIds: () => ['ou-owner'],
      listSessions: () => [{ id: W, title: '研发会话', workspaceId: 'proj-1', state: 'active' }],
      bind: {
        bind: ({ endpoint, parentSessionId }) => endpoint.threadId === undefined
          ? controller.ensureGroup({ chatId: endpoint.chatId, parentSessionId })
          : controller.ensureTopic({ chatId: endpoint.chatId, threadId: endpoint.threadId, parentSessionId }),
      },
      exit: { unbindCurrent: async () => ({ state: 'stopped' as const }) },
    })
    const bind = (chatId: string, threadId?: string) => dispatcher.dispatch({
      command: { kind: 'bind', prefix: 'w1abcd' } as never,
      endpoint: { chatId, ...(threadId === undefined ? {} : { threadId }), key: threadId === undefined ? chatId : `${chatId}#${threadId}` } as never,
      senderId: 'ou-owner',
    })
    return { t, controller, bind }
  }
  const groupMain = (t: Topology, chatId: string) => {
    const row = t.repository.getRow({ chatId })
    return row !== undefined && 'locusMainSessionId' in row ? row.locusMainSessionId : undefined
  }

  it('spec Scenario "主会话已归档时绑定新群"', async () => {
    const { t, bind } = await archivedMain()
    const receipt = await bind('oc_g')
    expect(receipt.ok).toBe(true)
    const text = 'text' in receipt ? receipt.text ?? '' : ''
    expect(text).toContain('已绑定主会话')
    expect(text).toContain('迁移')
    expect(text).toContain('其它入口')
    expect(text).not.toContain('请稍后重试')
    const m1 = t.repository.findActiveMain(W)!
    expect(m1.locusMainSessionId).not.toBe('M-old')
    expect(t.created.filter(c => c.kind === 'locus-main')).toHaveLength(1)
    expect(groupMain(t, 'oc_h')).toBe(m1.locusMainSessionId)
    expect(groupMain(t, 'oc_g')).toBe(m1.locusMainSessionId)
    expect(t.repository.getRow({ chatId: 'oc_g' })).toMatchObject({ state: 'not-created' })
    expect(t.repository.findMain('M-old')!.status).toBe('retired')
    // Migration is committed BEFORE the entry is begun, and nothing but M1 was created.
    expect(t.calls.filter(c => c.startsWith('begin'))).toEqual(['begin:migrate', 'begin:chat'])
    expect(t.created.filter(c => c.kind === 'work')).toEqual([])
  })

  it('spec Scenario "话题绑定同样迁移"', async () => {
    const { t, bind } = await archivedMain()
    const receipt = await bind('oc_g', 'omt_1')
    expect(receipt.ok).toBe(true)
    const m1 = t.repository.findActiveMain(W)!.locusMainSessionId
    expect(m1).not.toBe('M-old')
    expect(groupMain(t, 'oc_g')).toBe(m1)
    expect(t.repository.getRow({ chatId: 'oc_g', threadId: 'omt_1' })).toMatchObject({ state: 'not-created' })
    expect(groupMain(t, 'oc_h')).toBe(m1)
    expect(t.repository.findMain('M-old')!.status).toBe('retired')
  })

  it('spec Scenario "迁移已提交但入口建立失败"', async () => {
    const { t, bind } = await archivedMain()
    t.failCommit = true
    const failed = await bind('oc_g')
    expect(failed.ok).toBe(false)
    const text = 'text' in failed ? failed.text ?? '' : ''
    expect(text).toContain('迁移已完成')
    expect(text).toContain('本入口未绑定')
    // The reason is still given (PROVISIONING_FAILED's receipt), never the raw exception.
    expect(text).toContain('入口建立失败')
    expect(text).not.toContain('commit failed')
    // The migration is a durable fact: it is not rolled back by the later failure.
    const m1 = t.repository.findActiveMain(W)!
    expect(m1.locusMainSessionId).not.toBe('M-old')
    expect(t.repository.findMain('M-old')!.status).toBe('retired')
    expect(groupMain(t, 'oc_h')).toBe(m1.locusMainSessionId)
    expect(t.repository.getRow({ chatId: 'oc_g' })).toBeUndefined()

    // A retry reuses M1: no second migration, no second M.
    t.failCommit = false
    const retried = await bind('oc_g')
    expect(retried.ok).toBe(true)
    expect(groupMain(t, 'oc_g')).toBe(m1.locusMainSessionId)
    expect(t.created.filter(c => c.kind === 'locus-main')).toHaveLength(1)
    expect(t.calls.filter(c => c === 'begin:migrate')).toHaveLength(1)
    expect(t.repository.findActiveMain(W)!.locusMainSessionId).toBe(m1.locusMainSessionId)
  })

  it('migration published but its finalize failed: the receipt still says the migration is done and this entry is unbound', async () => {
    // The M1 handoff hook runs after the durable commit; making it throw drives
    // `failOperation`'s "published" branch inside `migrateWholeW`.
    const { t, bind } = await archivedMain(deps => ({
      ...deps,
      dsh: {
        ...deps.dsh,
        createLocusMainSession: async input => ({
          ...(await deps.dsh.createLocusMainSession(input)),
          commit: async () => { throw new Error('handoff failed') },
        }),
      },
    }))
    const failed = await bind('oc_g')
    expect(failed.ok).toBe(false)
    const text = 'text' in failed ? failed.text ?? '' : ''
    expect(text).toContain('迁移已完成')
    expect(text).toContain('本入口未绑定')
    expect(text).not.toContain('handoff failed')
    // The migration is durable and no entry row was written for G.
    const m1 = t.repository.findActiveMain(W)!
    expect(m1.locusMainSessionId).not.toBe('M-old')
    expect(groupMain(t, 'oc_h')).toBe(m1.locusMainSessionId)
    expect(t.repository.getRow({ chatId: 'oc_g' })).toBeUndefined()

    // Retrying `/bind` reuses M1: no second migration, no second M, and G gets its row.
    const retried = await bind('oc_g')
    expect(retried.ok).toBe(true)
    expect(groupMain(t, 'oc_g')).toBe(m1.locusMainSessionId)
    expect(t.repository.getRow({ chatId: 'oc_g' })).toMatchObject({ state: 'not-created' })
    expect(t.repository.findActiveMain(W)!.locusMainSessionId).toBe(m1.locusMainSessionId)
    expect(t.calls.filter(c => c === 'begin:migrate')).toHaveLength(1)
    expect(t.created.filter(c => c.kind === 'locus-main')).toHaveLength(1)
  })

  it('a usable M is reused without any migration (and without the migration note)', async () => {
    const t = await Topology.open({}, backend)
    await t.seedMain('W1', 'M-ok', 'active', 1)
    await t.seedGroup('oc_h', 'M-ok', 'proj-1')
    t.calls.length = 0
    const result = await new LocusController(t.deps()).ensureGroup({ chatId: 'oc_g', parentSessionId: 'W1' })
    expect(result.migration).toBeUndefined()
    expect(result.group.locusMainSessionId).toBe('M-ok')
    expect(t.calls.filter(c => c.startsWith('begin'))).toEqual(['begin:chat'])
    expect(t.created).toEqual([])
  })

  it('a W with no active pairing builds its first M without a migration', async () => {
    const t = await Topology.open({}, backend)
    const result = await new LocusController(t.deps()).ensureGroup({ chatId: 'oc_g', parentSessionId: 'W1' })
    expect(result.migration).toBeUndefined()
    expect(t.calls.filter(c => c.startsWith('begin'))).toEqual(['begin:chat'])
  })
})
