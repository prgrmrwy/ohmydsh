import { describe, expect, it } from 'vitest'
import { openThreeTier } from './support/three-tier.js'

/**
 * v20: the trigger Delivery is claimed current first, then the first child is
 * published with its executionId (publishFirstDelivery), then the Delivery is
 * bound to the queue and to a turn. Settlement must match the exact
 * (locusId, sessionId, executionId, inboxMessageId, turnId, revision).
 */
async function current() {
  const world = await openThreeTier()
  await world.controller.ensureGroup({ chatId: 'stop-chat', parentSessionId: 'work-1' })
  const row = world.durable.getRow({ chatId: 'stop-chat' })!
  const endpoint = row.endpoint
  const sessionId = row.sessionId
  const correlation = { endpoint, locusId: row.locusId, sessionId }
  const a = await world.durable.acceptDelivery({ ...correlation, messageId: 'A', senderOpenId: 'owner', acceptedAt: 1000 } as never)
  const b = await world.durable.acceptDelivery({ ...correlation, messageId: 'B', senderOpenId: 'owner', acceptedAt: 1001 } as never)
  await world.durable.claimCurrentDelivery({ ...correlation, now: 1002 } as never)
  await world.durable.publishFirstDelivery({ locusId: row.locusId, sessionId, revision: row.revision, deliveryId: a.record.deliveryId, now: 1002, executionId: 'execution-A' })
  await world.durable.commitFirstDelivery({ executionId: 'execution-A', now: 1002 })
  await world.durable.bindQueued({ deliveryId: a.record.deliveryId, ...correlation, executionId: 'execution-A', inboxMessageId: 'inbox-A', queuedAt: 1003 } as never)
  const turnId = `${sessionId}#1`
  await world.durable.bindTurn({ deliveryId: a.record.deliveryId, ...correlation, executionId: 'execution-A', turnId, startedAt: 1004 } as never)
  const before = world.durable.getDelivery(a.record.deliveryId)!
  return {
    world, a, b, before, correlation,
    input: {
      deliveryId: a.record.deliveryId, executionId: 'execution-A', turnId, inboxMessageId: 'inbox-A',
      correlation: { ...correlation, turnId }, expectedRevision: before.revision!,
      settledAt: 1100, outcome: 'failed' as const, failureReason: 'turn-interrupted',
    },
  }
}

describe('durable interrupted current settlement', () => {
  it('commits one exact cancellation and releases B without replaying A', async () => {
    const h = await current()
    try {
      const results = await Promise.all([h.world.durable.settleByTurn(h.input as never), h.world.durable.settleByTurn(h.input as never)])
      expect(results.filter(result => result.changed)).toHaveLength(1)
      expect(h.world.durable.getDelivery(h.a.record.deliveryId)).toMatchObject({ status: 'failed', startupDisposition: 'turn-interrupted', inboxMessageId: 'inbox-A', executionId: 'execution-A' })
      expect((await h.world.durable.claimCurrentDelivery({ ...h.correlation, now: 1101 } as never)).record?.deliveryId).toBe(h.b.record.deliveryId)
    } finally { await h.world.close() }
  })

  it.each(['inbox', 'execution', 'turn', 'session', 'revision', 'endpoint'] as const)('rejects %s mismatch without releasing A', async mismatch => {
    const h = await current()
    try {
      const input = { ...h.input, correlation: { ...h.input.correlation } }
      if (mismatch === 'inbox') input.inboxMessageId = 'other-inbox'
      if (mismatch === 'execution') input.executionId = 'other-execution'
      if (mismatch === 'turn') { input.turnId = `${h.correlation.sessionId}#2`; input.correlation.turnId = input.turnId }
      if (mismatch === 'session') input.correlation.sessionId = 'session-other'
      if (mismatch === 'revision') input.expectedRevision += 1
      if (mismatch === 'endpoint') input.correlation.endpoint = { chatId: 'other-chat' }
      expect((await h.world.durable.settleByTurn(input as never)).changed).toBe(false)
      expect(h.world.durable.getDelivery(h.a.record.deliveryId)).toEqual(h.before)
      expect((await h.world.durable.claimCurrentDelivery({ ...h.correlation, now: 1101 } as never)).changed).toBe(false)
    } finally { await h.world.close() }
  })
})
