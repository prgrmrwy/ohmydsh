/**
 * A live provisioning failure whose controller rollback already reclaimed what
 * it created must not keep its endpoint blocked (design D4; the 10-minute block
 * exists only for resources a failed operation still has to compensate).
 */
import { describe, expect, it } from 'vitest'
import { openThreeTier } from './support/three-tier.js'

describe('live provisioning failure with a completed rollback', () => {
  it('does not block the endpoint after the controller reclaimed the created locus main', async () => {
    const world = await openThreeTier()
    try {
      world.world.spaceError = new Error('space store unavailable')
      await expect(world.controller.ensureGroup({ chatId: 'oc_live', parentSessionId: 'work-1' })).rejects.toThrow()

      // The failure really created and reclaimed a locus main.
      expect(world.world.createdMains).toHaveLength(1)
      expect(world.world.released).toContain(world.world.createdMains[0]!.id)

      // A retry a minute later is not blocked by the already-rolled-back attempt.
      await expect(world.durable.beginProvisioning({
        provisioningId: 'provisioning-after-rollback',
        kind: 'chat',
        chatId: 'oc_live',
        startedAt: 60_000,
      })).resolves.toBeUndefined()
    } finally {
      await world.close()
    }
  })

  it('a partial rollback keeps the endpoint blocked for ten minutes, then the wired compensator reclaims the leftover', async () => {
    const world = await openThreeTier()
    try {
      const durable = world.durable
      await durable.beginProvisioning({ provisioningId: 'partial-1', kind: 'chat', chatId: 'oc_partial', startedAt: 0 })
      await durable.recordProvisioningResource('partial-1', { locusMainSessionId: 'locus-main-left' })
      // The rollback could not release the locus main, so the failure is recorded without `reclaimed`.
      await durable.failProvisioning('partial-1', 'rollback could not release locus main')

      await expect(durable.beginProvisioning({ provisioningId: 'partial-retry-1', kind: 'chat', chatId: 'oc_partial', startedAt: 60_000 }))
        .rejects.toMatchObject({ code: 'LOCUS_CONFLICT' })

      // Wired exactly as index.ts wires the startup compensators.
      const reclaimed: string[] = []
      durable.setProvisioningCompensators({
        locusMainSession: async ({ locusMainSessionId }) => { reclaimed.push(locusMainSessionId) },
      })
      await expect(durable.beginProvisioning({ provisioningId: 'partial-retry-2', kind: 'chat', chatId: 'oc_partial', startedAt: 11 * 60_000 }))
        .resolves.toBeUndefined()
      expect(reclaimed).toEqual(['locus-main-left'])
      expect(durable.getOperation('partial-1')).toMatchObject({ phase: 'compensated' })
    } finally {
      await world.close()
    }
  })
})
