import { describe, expect, it, vi } from 'vitest'
import type { DeliveryRecord } from '../src/host/locus/delivery.js'
import { proveStartupDeliveryFromColdRead } from '../src/host/locus/startup-recovery.js'
import { recoverLocusStartupV20 } from '../src/host/locus/reconcile.js'
import { FakeSessionQuery, type FakeSessionEvent } from './support/official-subagent.js'
import { openThreeTier } from './support/three-tier.js'

const PARENT = 'session-locus-main'
const CHILD = 'session-child-1'
const INBOX = 'inbox-message-1'

function delivery(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    deliveryId: 'delivery-1',
    executionId: 'execution-1',
    inboxMessageId: INBOX,
    sessionId: CHILD,
    status: 'current',
    ...overrides,
  } as DeliveryRecord
}

function event(type: string, seq: number, time: number, data: Record<string, unknown> = {}): FakeSessionEvent {
  return { type, seq, time, data }
}

/** A child whose Host died mid-turn: the turn opened, took the message, never ended. */
const OPEN_TURN: FakeSessionEvent[] = [
  event('session/start', 0, 1000),
  event('turn/start', 1, 1001, { turn: 1 }),
  event('user/message', 2, 1002, { id: INBOX }),
]

function queryWith(events: readonly FakeSessionEvent[], parent: string | undefined = PARENT) {
  const query = new FakeSessionQuery()
  query.add(CHILD, parent, events)
  return query
}

const noop = () => undefined

describe('冷读证据与真实持久 current/backlog 的接缝', () => {
  it.each<{
    name: string; live: boolean; endTime: number | undefined; interrupted: boolean
    reason: Record<string, unknown>; inboxId?: string; boundTurn?: number; proofExecutionId?: string
  }>([
    { name: 'prepared 合成中断只等待，不重发', live: false, endTime: undefined, interrupted: false, reason: { kind: 'interrupted' } },
    { name: '不可区分中断保持等待', live: false, endTime: 1002, interrupted: false, reason: { kind: 'interrupted' } },
    { name: '真实中断立即结算推进', live: false, endTime: 1500, interrupted: true, reason: { kind: 'interrupted' } },
    { name: 'live 中断不剔除', live: true, endTime: 1002, interrupted: true, reason: { kind: 'interrupted' } },
    ...['user', 'parent', 'disposed'].flatMap(kind => [false, true].map(live => ({
      name: `${live ? 'live' : 'prepared'} 真实 aborted ${kind} 立即结算推进`,
      live, endTime: 1002, interrupted: true, reason: { kind: 'aborted', reason: { kind } },
    }))),
    ...[
      { name: 'wrong inbox UUID', inboxId: 'inbox-other' },
      { name: 'wrong bound turn', boundTurn: 2 },
      { name: 'stale execution proof', proofExecutionId: 'exec-other' },
    ].map(mismatch => ({
      ...mismatch, live: false, endTime: 1002, interrupted: false,
      reason: { kind: 'aborted', reason: { kind: 'disposed' } },
    })),
    ...[undefined, { kind: 'unknown' }, { kind: 'legacy' }, { kind: 'hook', reason: 'plugin stop' }].map(cause => ({
      name: `aborted ${cause?.kind ?? 'missing cause'} keeps waiting`, live: false, endTime: 1002, interrupted: false,
      reason: { kind: 'aborted', reason: cause },
    })),
  ])('$name', async ({ live, endTime, interrupted, reason, inboxId, boundTurn, proofExecutionId }) => {
    const world = await openThreeTier()
    try {
      await world.controller.ensureGroup({ chatId: 'cold-read-chat', parentSessionId: 'work-1' })
      const row = world.durable.getRow({ chatId: 'cold-read-chat' })!
      const childSessionId = row.sessionId
      const parent = (row as unknown as { readonly locusMainSessionId: string }).locusMainSessionId
      const correlation = { endpoint: row.endpoint, locusId: row.locusId, sessionId: childSessionId }
      const a = await world.durable.acceptDelivery({ ...correlation, messageId: 'A', senderOpenId: 'owner', text: 'original A', acceptedAt: 1000 } as never)
      const b = await world.durable.acceptDelivery({ ...correlation, messageId: 'B', senderOpenId: 'owner', text: 'backlog B', acceptedAt: 1001 } as never)
      await world.durable.claimCurrentDelivery({ ...correlation, now: 1002 } as never)
      await world.durable.publishFirstDelivery({ locusId: row.locusId, sessionId: childSessionId, revision: row.revision, deliveryId: a.record.deliveryId, now: 1002, executionId: 'exec-A' })
      await world.durable.commitFirstDelivery({ executionId: 'exec-A', now: 1002 })
      await world.durable.bindQueued({ deliveryId: a.record.deliveryId, ...correlation, executionId: 'exec-A', inboxMessageId: INBOX, queuedAt: 1003 } as never)
      await world.durable.bindTurn({ deliveryId: a.record.deliveryId, ...correlation, executionId: 'exec-A', turnId: `${childSessionId}#${boundTurn ?? 1}`, startedAt: 1004 } as never)
      const before = world.durable.getDelivery(a.record.deliveryId)!
      const query = new FakeSessionQuery()
      query.add(childSessionId, parent, [
        ...OPEN_TURN.map(entry => entry.type === 'user/message' ? { ...entry, data: { id: inboxId ?? INBOX } } : entry),
        ...(endTime === undefined ? [] : [event('turn/end', 3, endTime, { turn: 1, reason })]),
      ], live)
      const report = await recoverLocusStartupV20(world.durable, {
        now: 2000,
        deliveryProof: async record => {
          const proof = await proveStartupDeliveryFromColdRead({ delivery: record as unknown as DeliveryRecord, parentSessionId: parent, query, log: noop })
          return proof === undefined || proofExecutionId === undefined ? proof : { ...proof, executionId: proofExecutionId }
        },
      })
      // Evidence never authorizes resending A, even when it cannot close A yet.
      expect(report.replayableDeliveries.some(record => record.deliveryId === a.record.deliveryId)).toBe(false)
      const next = await world.durable.claimCurrentDelivery({ ...correlation, now: 2001 } as never)
      if (interrupted) {
        expect(world.durable.getDelivery(a.record.deliveryId)).toMatchObject({ status: 'failed', startupDisposition: 'turn-interrupted' })
        expect(next.record?.deliveryId).toBe(b.record.deliveryId)
      } else {
        expect(world.durable.getDelivery(a.record.deliveryId)).toMatchObject({
          status: 'current', inboxMessageId: INBOX, executionId: before.executionId,
          turnId: before.turnId, deadlineAt: before.deadlineAt,
        })
        expect(report.failedDeliveries).toEqual([])
        expect(next.changed).toBe(false)
      }
      expect(world.durable.getRow({ chatId: 'cold-read-chat' })?.revision).toBe(row.revision)
      expect(query.leases.every(lease => lease.disposed)).toBe(true)
    } finally { await world.close() }
  })
})

describe('合成中断不算证据', () => {
  it('合成中断不算证据', async () => {
    const query = queryWith(OPEN_TURN)

    const proof = await proveStartupDeliveryFromColdRead({
      delivery: delivery(),
      parentSessionId: PARENT,
      query,
      log: noop,
    })

    // The cold read closed the open turn with a fabricated `turn/end interrupted`.
    // The log only proves the turn is still open, so the Delivery is NOT settled
    // as interrupted and keeps waiting under the existing rules.
    const observed = await query.observeSession(CHILD)
    expect(observed.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'interrupted' } } })
    expect(proof).toMatchObject({ state: 'running' })
    expect(proof?.state).not.toBe('interrupted')
  })

  it('counts an interruption that was really written to the log', async () => {
    const query = queryWith([
      ...OPEN_TURN,
      // Written by a graceful shutdown: a later timestamp than the last event, so
      // it cannot be what a cold read would have fabricated.
      event('turn/end', 3, 1500, { turn: 1, reason: { kind: 'interrupted' } }),
    ])

    const proof = await proveStartupDeliveryFromColdRead({
      delivery: delivery(),
      parentSessionId: PARENT,
      query,
      log: noop,
    })

    expect(proof).toMatchObject({ state: 'interrupted', turnId: `${CHILD}#1` })
  })

  it('does not trust a written interruption indistinguishable from a fabricated one', async () => {
    // Same time and next seq as the preceding event: exactly the shape a cold
    // read adds. Ambiguity is not evidence.
    const query = queryWith([
      ...OPEN_TURN,
      event('turn/end', 3, 1002, { turn: 1, reason: { kind: 'interrupted' } }),
    ])

    const proof = await proveStartupDeliveryFromColdRead({
      delivery: delivery(),
      parentSessionId: PARENT,
      query,
      log: noop,
    })

    expect(proof?.state).not.toBe('interrupted')
  })

  it('reads a live child as written, with no stripping', async () => {
    const query = new FakeSessionQuery()
    query.add(CHILD, PARENT, [
      ...OPEN_TURN,
      event('turn/end', 3, 1002, { turn: 1, reason: { kind: 'interrupted' } }),
    ], true)

    const proof = await proveStartupDeliveryFromColdRead({
      delivery: delivery(),
      parentSessionId: PARENT,
      query,
      log: noop,
    })

    expect(proof).toMatchObject({ state: 'interrupted' })
  })

  it('refuses a log that does not belong to this parent and child', async () => {
    const log = vi.fn()
    const proof = await proveStartupDeliveryFromColdRead({
      delivery: delivery(),
      parentSessionId: PARENT,
      query: queryWith(OPEN_TURN, 'session-someone-else'),
      log,
    })

    expect(proof).toBeUndefined()
    expect(log).toHaveBeenCalledWith('startup-evidence-identity-mismatch')
  })

  it('releases the observation lease', async () => {
    const query = queryWith(OPEN_TURN)
    await proveStartupDeliveryFromColdRead({ delivery: delivery(), parentSessionId: PARENT, query, log: noop })
    expect(query.leases).toHaveLength(1)
    expect(query.leases.every(lease => lease.disposed)).toBe(true)
  })
})

describe('冷读服务不可用', () => {
  it('冷读服务不可用', async () => {
    const log = vi.fn()

    const proof = await proveStartupDeliveryFromColdRead({
      delivery: delivery(),
      parentSessionId: PARENT,
      query: undefined,
      log,
    })

    // No evidence, no settlement; the diagnostic says why.
    expect(proof).toBeUndefined()
    expect(log).toHaveBeenCalledWith('startup-evidence-unavailable')
  })

  it('treats a failing read as missing evidence rather than a decision', async () => {
    const log = vi.fn()
    const query = new FakeSessionQuery()   // the child is unknown to it: observeSession rejects

    const proof = await proveStartupDeliveryFromColdRead({
      delivery: delivery(),
      parentSessionId: PARENT,
      query,
      log,
    })

    expect(proof).toBeUndefined()
    expect(log).toHaveBeenCalledWith('startup-evidence-unavailable')
  })
})
