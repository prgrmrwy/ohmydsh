import { describe, expect, it } from 'vitest'
import { openThreeTier } from './support/three-tier.js'

async function current() {
  const world = await openThreeTier()
  const entry = await world.controller.ensureGroup({ chatId: 'stop-chat', parentSessionId: 'work-1' })
  const locus = world.durable.getLocus(entry.locus.locusId)!
  const childSessionId = locus.reservedChildSessionId!
  await world.durable.publishCreatedChild({ locusId: locus.id, generation: locus.generation, childSessionId, now: 999 })
  const correlation = { endpoint: locus.endpoint, locusId: locus.id, generation: locus.generation, childSessionId }
  const a = await world.durable.acceptDelivery({ ...correlation, messageId: 'A', senderOpenId: 'owner', acceptedAt: 1000 })
  const b = await world.durable.acceptDelivery({ ...correlation, messageId: 'B', senderOpenId: 'owner', acceptedAt: 1001 })
  await world.durable.claimCurrentDelivery({ correlation, now: 1002 })
  await world.durable.bindQueued({ deliveryId: a.record.deliveryId, correlation, executionId: 'execution-A', inboxMessageId: 'inbox-A', queuedAt: 1003 })
  const turnId = `${childSessionId}#1`
  await world.durable.bindTurn({ deliveryId: a.record.deliveryId, correlation, executionId: 'execution-A', turnId, startedAt: 1004 })
  const before = world.durable.getDelivery(a.record.deliveryId)!
  return { world, a, b, before, correlation, input: { deliveryId: a.record.deliveryId, executionId: 'execution-A', inboxMessageId: 'inbox-A', correlation: { ...correlation, turnId }, expectedRevision: before.revision!, settledAt: 1100, outcome: 'failed' as const, failureReason: 'turn-interrupted' } }
}

describe('durable interrupted current settlement', () => {
  it('commits one exact cancellation and releases B without replaying A', async () => {
    const h = await current()
    try {
      const results = await Promise.all([h.world.durable.settleByTurn(h.input), h.world.durable.settleByTurn(h.input)])
      expect(results.filter(result => result.changed)).toHaveLength(1)
      expect(h.world.durable.getDelivery(h.a.record.deliveryId)).toMatchObject({ status: 'failed', startupDisposition: 'turn-interrupted', inboxMessageId: 'inbox-A', executionId: 'execution-A' })
      expect((await h.world.durable.claimCurrentDelivery({ correlation: h.correlation, now: 1101 }))?.deliveryId).toBe(h.b.record.deliveryId)
    } finally { await h.world.close() }
  })

  it.each(['inbox', 'execution', 'turn', 'generation', 'revision', 'child', 'endpoint'] as const)('rejects %s mismatch without releasing A', async mismatch => {
    const h = await current()
    try {
      const input = { ...h.input, correlation: { ...h.input.correlation } }
      if (mismatch === 'inbox') input.inboxMessageId = 'other-inbox'
      if (mismatch === 'execution') input.executionId = 'other-execution'
      if (mismatch === 'turn') input.correlation.turnId = `${h.correlation.childSessionId}#2`
      if (mismatch === 'generation') input.correlation.generation += 1
      if (mismatch === 'revision') input.expectedRevision += 1
      if (mismatch === 'child') input.correlation.childSessionId = 'other-child'
      if (mismatch === 'endpoint') input.correlation.endpoint = { chatId: 'other-chat' }
      expect((await h.world.durable.settleByTurn(input)).changed).toBe(false)
      expect(h.world.durable.getDelivery(h.a.record.deliveryId)).toEqual(h.before)
      expect(await h.world.durable.claimCurrentDelivery({ correlation: h.correlation, now: 1101 })).toBeUndefined()
    } finally { await h.world.close() }
  })
})
