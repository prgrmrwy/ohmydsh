import { describe, expect, it, vi } from 'vitest'
import { createDurableLocusAuthorizationResolver } from '../src/host/locus/admission.js'
import { InboundPipeline, SOURCE_ARCHIVED_RECEIPT_LIMIT } from '../src/host/channel/pipeline.js'
import { createLocusResolution } from '../src/host/locus/resolution.js'
import { reconcileLocusChildren } from '../src/host/locus/reconcile.js'
import { type ThreeTier, openThreeTier } from './support/three-tier.js'

/** Entry whose child exists (the first message already created it). */
async function withChild(world: ThreeTier, chatId: string, workSessionId = 'work-1') {
  const entry = await world.controller.ensureGroup({ chatId, parentSessionId: workSessionId })
  const reserved = entry.locus.reservedChildSessionId as string
  const active = await world.durable.publishCreatedChild({
    locusId: entry.locus.locusId,
    generation: entry.locus.generation,
    childSessionId: reserved,
    now: 200,
  })
  return { entry, active }
}

describe('换绑与归档按层处理', () => {
  it('干活主会话归档', async () => {
    const world = await openThreeTier()
    try {
      const { entry } = await withChild(world, 'oc_proj')
      world.archive('work-1')
      const builtBefore = { works: world.world.createdWorks.length, mains: world.world.createdMains.length }

      // 1. The controller refuses to repair or re-source it: that is the owner's call.
      await expect(world.controller.ensureEntry({ chatId: 'oc_proj' })).rejects.toMatchObject({
        code: 'SOURCE_ARCHIVED',
      })
      expect(world.world.createdWorks).toHaveLength(builtBefore.works)
      expect(world.world.createdMains).toHaveLength(builtBefore.mains)
      expect(world.durable.getLatestLocusByEndpoint({ chatId: 'oc_proj' })).toMatchObject({
        id: entry.locus.locusId,
        state: 'active',
      })

      // 2. Resolution stops serving it (and never routes to the child) ...
      const provisioning = { ensureForDelivery: vi.fn() }
      const resolution = createLocusResolution({
        store: world.durable,
        mains: { find: id => world.durable.getLocusMain(id) },
        isSessionArchived: id => id === 'work-1',
        provisioning: provisioning as never,
      })
      expect(() => resolution.resolveCurrent({ chatId: 'oc_proj' })).toThrow(/来源会话已归档/)
      await expect(
        resolution.ensureForDelivery({ endpoint: { chatId: 'oc_proj' }, messageId: 'om_1', signal: new AbortController().signal }),
      ).rejects.toMatchObject({ reason: 'source-archived' })
      expect(provisioning.ensureForDelivery).not.toHaveBeenCalled()

      // 3. ... and admission classifies it as an owner-side stop, naming why.
      const authorization = createDurableLocusAuthorizationResolver(
        {
          getLatestLocusByEndpoint: endpoint => {
            const record = world.durable.getLatestLocusByEndpoint(endpoint)
            const main = record === undefined ? undefined : world.durable.getLocusMain(record.parentSessionId)
            return record === undefined ? undefined : {
              id: record.id,
              state: record.state,
              parentSessionId: record.parentSessionId,
              ...(main === undefined ? { legacy: true } : { workSessionId: main.workSessionId }),
            }
          },
        },
        { find: () => undefined },
        id => id === 'work-1',
      )
      expect(authorization({ chatId: 'oc_proj', key: 'oc_proj' })).toEqual({ state: 'retired', reason: 'source-archived' })

      // 4. The group is told what happened and what to do — a bounded number of times.
      const reply = vi.fn(async () => undefined)
      const pipeline = new InboundPipeline({
        repository: { getChannelConfig: () => ({ enabled: true, botOpenId: 'ou_bot', allowOpenIds: ['ou_owner'] }) },
        coordinator: {} as never,
        client: { botReady: async () => true, reply } as never,
        locator: { locate: () => undefined },
        watermark: () => 0,
        locusController: { handle: async () => ({ kind: 'ignored' as const, reason: 'retired-endpoint' }) } as never,
        locusAuthorization: authorization,
      } as never)
      const line = (n: number) => JSON.stringify({
        type: 'im.message.receive_v1',
        message_id: `om_${String(n)}`,
        chat_id: 'oc_proj',
        chat_type: 'group',
        message_type: 'text',
        content: '@bot 继续',
        create_time: '2000',
        sender_id: 'ou_owner',
        sender_type: 'user',
        mentions: [{ id: 'ou_bot', key: '@_user_1', name: 'bot' }],
      })
      for (let n = 1; n <= SOURCE_ARCHIVED_RECEIPT_LIMIT + 2; n += 1) await pipeline.handleLine(line(n))
      expect(reply).toHaveBeenCalledTimes(SOURCE_ARCHIVED_RECEIPT_LIMIT)
      expect(reply).toHaveBeenCalledWith('om_1', expect.stringContaining('来源会话已归档'))
      expect(reply).toHaveBeenCalledWith('om_1', expect.stringContaining('/bind'))
    } finally { await world.close() }
  })

  it('archived work session can be explicitly rebound via the advertised bind repair', async () => {
    const world = await openThreeTier()
    try {
      const old = await world.controller.ensureGroup({ chatId: 'oc_rebind', parentSessionId: 'work-1' })
      const oldTopic = await world.controller.ensureTopic({ chatId: 'oc_rebind', threadId: 'omt_rebind', parentSessionId: 'work-1' })
      world.archive('work-1')
      const rebound = await world.controller.ensureGroup({ chatId: 'oc_rebind', parentSessionId: 'work-2' })
      const topic = await world.controller.ensureTopic({ chatId: 'oc_rebind', threadId: 'omt_rebind', parentSessionId: 'work-2' })
      expect(topic.locus).toMatchObject({ state: 'not-created', generation: 2, workSessionId: 'work-2', replacesLocusId: oldTopic.locus.locusId })
      expect(rebound.locus).toMatchObject({ state: 'not-created', generation: 2, workSessionId: 'work-2', replacesLocusId: old.locus.locusId })
      expect(world.world.sent[0]).toContain('上下文来源发生变化')
      expect(world.durable.getLocus(old.locus.locusId)?.state).toBe('retired')
    } finally { await world.close() }
  })

  it('子会话不可用只换该入口一代', async () => {
    const world = await openThreeTier()
    try {
      const a = await withChild(world, 'oc_a')
      const b = await world.controller.ensureGroup({ chatId: 'oc_b', parentSessionId: 'work-1' })
      const mainsBefore = world.world.createdMains.length

      // A's child fails its composition proof (a non-capacity reason).
      await world.durable.invalidateLocus(a.active.id, '组合核验失败', 500)
      const repaired = await world.controller.ensureEntry({ chatId: 'oc_a' })

      expect(repaired.created).toBe(true)
      expect(repaired.locus).toMatchObject({
        generation: 2,
        state: 'not-created',
        parentSessionId: a.active.parentSessionId,
        replacesLocusId: a.active.id,
        source: a.active.source,
      })
      expect(repaired.locus.reservedChildSessionId).not.toBe(a.active.reservedChildSessionId)
      // Same locus main, no new session or space for the repair ...
      expect(world.world.createdMains).toHaveLength(mainsBefore)
      expect(world.durable.listLocusMains().filter(main => main.status === 'active')).toHaveLength(1)
      // ... the old generation stays as history, and B is exactly as it was.
      expect(world.durable.getLocus(a.active.id)?.state).toBe('invalid')
      expect(world.durable.getLatestLocusByEndpoint({ chatId: 'oc_b' })).toMatchObject({
        id: b.locus.locusId,
        generation: 1,
        state: 'not-created',
      })
    } finally { await world.close() }
  })

  it('名额不足的冷恢复保留原代际', async () => {
    const world = await openThreeTier()
    try {
      const a = await withChild(world, 'oc_a')
      const before = world.durable.getLocus(a.active.id)

      // The runtime is at its activation limit: resuming C fails, for a reason
      // that says nothing about C. That is "cannot tell", never "gone".
      const invalidate = vi.fn(async () => undefined)
      const report = await reconcileLocusChildren(
        [world.durable.getLocus(a.active.id)!],
        {
          store: { invalidate, clearBusy: async () => undefined },
          probe: { check: async () => ({ kind: 'capacity-limited' as const, diagnostic: 'ACTIVATION_LIMIT_REACHED' }) },
        },
      )
      expect(invalidate).not.toHaveBeenCalled()
      expect(report).toMatchObject({ invalidated: [], unproven: [a.active.id] })

      // The entry is not repaired either: same generation, same child.
      const kept = await world.controller.ensureEntry({ chatId: 'oc_a' })
      expect(kept.created).toBe(false)
      expect(kept.locus).toMatchObject({
        locusId: a.active.id,
        generation: 1,
        childSessionId: a.active.childSessionId,
        state: 'active',
      })
      expect(world.durable.getLocus(a.active.id)).toEqual(before)
      expect(world.durable.getLatestLocusByEndpoint({ chatId: 'oc_a' })?.generation).toBe(1)
    } finally { await world.close() }
  })

  it('locus 主会话不可用时整体迁移', async () => {
    const world = await openThreeTier()
    try {
      const a = await withChild(world, 'oc_a')
      const c = await world.controller.ensureGroup({ chatId: 'oc_c', parentSessionId: 'work-1' })
      await world.durable.stopLocus(c.locus.locusId, 600)
      const oldMain = a.active.parentSessionId

      // M is archived by someone.
      world.archive(oldMain)
      const moved = await world.controller.ensureEntry({ chatId: 'oc_a' })

      // M2 serves the SAME work session; A moved onto it as a fresh not-created generation.
      const active = world.durable.listLocusMains().filter(main => main.status === 'active')
      expect(active).toHaveLength(1)
      const [m2] = active
      expect(m2).toMatchObject({ workSessionId: 'work-1', generation: 2 })
      expect(m2!.locusMainSessionId).not.toBe(oldMain)
      expect(world.durable.getLocusMain(oldMain)).toMatchObject({ status: 'retired' })
      expect(moved.locus).toMatchObject({
        generation: 2,
        state: 'not-created',
        parentSessionId: m2!.locusMainSessionId,
        replacesLocusId: a.active.id,
      })
      expect(world.durable.getLocus(a.active.id)?.state).toBe('invalid')
      expect(world.world.spaces.at(-1)).toEqual({ workSessionId: 'work-1', locusMainSessionId: m2!.locusMainSessionId })
      // C, which the owner stopped, is NOT revived or moved ...
      expect(world.durable.getLatestLocusByEndpoint({ chatId: 'oc_c' })).toMatchObject({
        id: c.locus.locusId,
        state: 'stopped',
        parentSessionId: oldMain,
      })
      // ... and the receipt says how many moved and why one did not.
      expect(moved.migration).toEqual({
        migrated: 1,
        skipped: [{ locusId: c.locus.locusId, reason: '入口由所有者停止/退役，不迁移。' }],
      })
      expect(moved.notice).toContain('已迁移 1 个入口')
      expect(moved.notice).toContain(c.locus.locusId)
      expect(moved.notice).toContain('入口由所有者停止/退役')
    } finally { await world.close() }
  })

  it('locus 主会话被删除或 preset 核验失败时同样整体迁移', async () => {
    for (const break_ of ['deleted', 'preset'] as const) {
      const world = await openThreeTier()
      try {
        const a = await withChild(world, 'oc_a')
        const oldMain = a.active.parentSessionId
        if (break_ === 'deleted') world.delete(oldMain)
        else world.setPreset(oldMain, 'standard')

        const moved = await world.controller.ensureEntry({ chatId: 'oc_a' })

        expect(moved.migration?.migrated, break_).toBe(1)
        expect(world.durable.getLocusMain(oldMain), break_).toMatchObject({ status: 'retired' })
        expect(moved.locus.parentSessionId, break_).not.toBe(oldMain)
      } finally { await world.close() }
    }
  })
})
