import { describe, expect, it } from 'vitest'
import { openThreeTier } from './support/three-tier.js'

describe('入口建立统一为一条路径', () => {
  it('auto 建立', async () => {
    const world = await openThreeTier()
    try {
      // A never-associated chat gets its first authorized @.
      const entry = await world.controller.ensureEntry({ chatId: 'oc_new_group', chatName: '新项目' })

      // Pet created the work session AND the locus main, and wired their space.
      expect(world.world.createdWorks).toHaveLength(1)
      expect(world.world.createdMains).toHaveLength(1)
      const [work] = world.world.createdWorks
      const [main] = world.world.createdMains
      expect(main).toMatchObject({ workSessionId: work })
      expect(world.world.spaces).toEqual([{ workSessionId: work, locusMainSessionId: main!.id }])
      expect(world.durable.getLocusMain(main!.id)).toMatchObject({
        workSessionId: work,
        status: 'active',
        generation: 1,
        spaceId: `space-${main!.id}`,
      })

      // The entry is a NEW generation with no child: nothing is pre-created.
      expect(entry.locus).toMatchObject({
        state: 'not-created',
        generation: 1,
        parentSessionId: main!.id,
        permission: 'read',
        source: 'auto',
      })
      expect(entry.locus.childSessionId).toBeUndefined()
      expect(world.durable.getCurrentLocus({ chatId: 'oc_new_group' })).toMatchObject({
        state: 'not-created',
        parentSessionId: main!.id,
      })
      expect(world.durable.getCurrentLocus({ chatId: 'oc_new_group' })?.childSessionId).toBeUndefined()
      expect(world.world.children).toEqual([])
      // And it is the work session, not the user's, that the entry belongs to.
      expect(entry.group?.mainSessionId).toBe(work)
    } finally { await world.close() }
  })

  it('绑定到已有干活主会话复用 locus 主会话', async () => {
    const world = await openThreeTier()
    try {
      const first = await world.controller.ensureGroup({ chatId: 'oc_first', parentSessionId: 'work-1' })
      const second = await world.controller.ensureGroup({ chatId: 'oc_second', parentSessionId: 'work-1' })

      // W already had an active locus main M: no second one is built, no second space.
      expect(world.world.createdMains).toHaveLength(1)
      expect(world.world.spaces).toHaveLength(1)
      expect(second.locus.parentSessionId).toBe(first.locus.parentSessionId)
      expect(world.durable.listLocusMains().filter(main => main.status === 'active')).toHaveLength(1)
      // A different work session gets its own, independent locus main.
      const other = await world.controller.ensureGroup({ chatId: 'oc_other', parentSessionId: 'work-2' })
      expect(other.locus.parentSessionId).not.toBe(first.locus.parentSessionId)
      expect(world.world.createdMains).toHaveLength(2)
    } finally { await world.close() }
  })

  it('建立失败不留半成品', async () => {
    const world = await openThreeTier()
    try {
      world.world.spaceResult = { ok: false, reason: 'establish-failed' }
      await expect(
        world.controller.ensureGroup({ chatId: 'oc_half', parentSessionId: 'work-1' }),
      ).rejects.toMatchObject({ code: 'PROVISIONING_FAILED' })

      // Nothing addressable was published ...
      expect(world.durable.listLoci()).toEqual([])
      expect(world.durable.listLocusMains()).toEqual([])
      // ... the locus main that was built is released ...
      const [built] = world.world.createdMains
      expect(world.world.released).toContain(built!.id)
      // ... and the operation is failed with the locus main recorded, so a
      // compensator can still release it if the inline rollback had not run.
      expect(world.durable.listOperations().find(op => op.operation === 'provisioning:group')).toMatchObject({
        phase: 'failed',
        resourceRefs: { locusMainSessionId: built!.id },
      })

      // The auto path leaves nothing either: both sessions it created are released.
      const auto = await openThreeTier()
      try {
        auto.world.spaceResult = { ok: false, reason: 'work-not-invitable' }
        await expect(auto.controller.ensureEntry({ chatId: 'oc_auto_half' })).rejects.toMatchObject({
          code: 'PROVISIONING_FAILED',
        })
        expect(auto.world.released).toEqual(expect.arrayContaining([
          auto.world.createdMains[0]!.id,
          auto.world.createdWorks[0]!,
        ]))
        expect(auto.durable.listLoci()).toEqual([])
        expect(auto.durable.listLocusMains()).toEqual([])
      } finally { await auto.close() }
    } finally { await world.close() }
  })
})
