import { describe, expect, it, vi } from 'vitest'
import {
  reconcileLocusChildren,
  type ChildLiveness,
  type ReconcileDiagnostic,
  type ReconcileRow,
} from '../src/host/locus/reconcile.js'
import type { LocusRowV20 } from '../src/host/locus/contract-v20.js'

function row(overrides: Partial<LocusRowV20> = {}, main = 'main-1'): ReconcileRow {
  return {
    row: {
      endpoint: { chatId: 'oc-1' },
      locusId: 'locus-1',
      sessionId: 'child-1',
      state: 'active',
      accessMode: 'read-only',
      revision: 3,
      createdAt: 1,
      updatedAt: 1,
      locusMainSessionId: main,
      workspaceId: 'ws-1',
      ...overrides,
    } as LocusRowV20,
    locusMainSessionId: main,
  }
}

function harness(liveness?: (sessionId: string) => ChildLiveness) {
  const invalidated: { locusId: string; expectedRevision: number; reason: string }[] = []
  const diagnostics: ReconcileDiagnostic[] = []
  return {
    invalidated,
    diagnostics,
    probed: [] as { parentSessionId: string; childSessionId: string }[],
    ports: {
      store: {
        invalidate: async (fence: { expectedLocusId: string; expectedRevision: number }, reason: string) => {
          invalidated.push({ locusId: fence.expectedLocusId, expectedRevision: fence.expectedRevision, reason })
        },
      },
      ...(liveness === undefined
        ? {}
        : { probe: { check: async ({ childSessionId }: { childSessionId: string }) => liveness(childSessionId) } }),
      now: () => 100,
      log: (code: ReconcileDiagnostic) => { diagnostics.push(code) },
    },
  }
}

describe('startup reconciliation of child sessions (v20 rows)', () => {
  it('leaves a usable child untouched', async () => {
    const h = harness(() => ({ kind: 'usable' }))
    const report = await reconcileLocusChildren([row()], h.ports)
    expect(report).toMatchObject({ checked: 1, usable: 1, invalidated: [], unproven: [] })
    expect(h.invalidated).toEqual([])
  })

  it('marks a definitively gone child invalid with the row fence, never re-creating it', async () => {
    const h = harness(() => ({ kind: 'unusable', reason: '子会话已归档' }))
    const report = await reconcileLocusChildren([row()], h.ports)
    expect(report.invalidated).toEqual([{ locusId: 'locus-1', reason: '子会话已归档' }])
    expect(h.invalidated).toEqual([{ locusId: 'locus-1', expectedRevision: 3, reason: '子会话已归档' }])
    expect(h.diagnostics).toContain('child-unusable')
  })

  it('probes the child under the group row\'s M, also for a topic row', async () => {
    const calls: unknown[] = []
    const h = harness()
    const ports = {
      ...h.ports,
      probe: { check: async (input: { parentSessionId: string; childSessionId: string }) => { calls.push(input); return { kind: 'usable' as const } } },
    }
    const topic = row({ endpoint: { chatId: 'oc-1', threadId: 'th-1' }, locusId: 'locus-t', sessionId: 'child-t' } as never, 'main-9')
    await reconcileLocusChildren([topic], ports)
    expect(calls).toEqual([expect.objectContaining({ parentSessionId: 'main-9', childSessionId: 'child-t' })])
  })

  it('treats an unanswerable probe as unproven, never as absence', async () => {
    const h = harness(() => ({ kind: 'unknown', diagnostic: 'runtime still starting' }))
    const report = await reconcileLocusChildren([row()], h.ports)
    expect(report.unproven).toEqual(['locus-1'])
    expect(h.invalidated).toEqual([])
    expect(h.diagnostics).toContain('child-unknown')
  })

  it('treats a capacity-limited child as unproven', async () => {
    const h = harness(() => ({ kind: 'capacity-limited', diagnostic: 'full' }))
    const report = await reconcileLocusChildren([row()], h.ports)
    expect(report.unproven).toEqual(['locus-1'])
    expect(h.diagnostics).toContain('child-capacity-limited')
  })

  it('treats a throwing probe as unproven', async () => {
    const h = harness(() => { throw new Error('probe exploded') })
    const report = await reconcileLocusChildren([row()], h.ports)
    expect(report.unproven).toEqual(['locus-1'])
    expect(h.invalidated).toEqual([])
  })

  it('leaves every row untouched when no probe is composed', async () => {
    const h = harness()
    const report = await reconcileLocusChildren([row(), row({ locusId: 'locus-2', sessionId: 'c2', endpoint: { chatId: 'oc-2' } })], h.ports)
    expect(report).toMatchObject({ checked: 0, usable: 0, invalidated: [] })
    expect(report.unproven).toEqual(['locus-1', 'locus-2'])
    expect(h.diagnostics).toEqual(['probe-unavailable'])
  })

  it('only probes active rows: not-created, stopped and invalid have no live child to prove', async () => {
    const check = vi.fn(async () => ({ kind: 'usable' as const }))
    const h = harness(() => ({ kind: 'usable' }))
    const report = await reconcileLocusChildren([
      row({ locusId: 'a', state: 'not-created' }),
      row({ locusId: 'b', state: 'stopped', stoppedAt: 2 }),
      row({ locusId: 'c', state: 'invalid', invalidReason: 'x' }),
    ], { ...h.ports, probe: { check } })
    expect(report.checked).toBe(0)
    expect(check).not.toHaveBeenCalled()
  })

  it('continues past one broken entry and reports each independently', async () => {
    const h = harness(sessionId => (sessionId === 'child-broken' ? { kind: 'unusable', reason: '不可恢复' } : { kind: 'usable' }))
    const report = await reconcileLocusChildren([
      row({ locusId: 'ok-1', sessionId: 'c-a' }),
      row({ locusId: 'broken', sessionId: 'child-broken' }),
      row({ locusId: 'ok-2', sessionId: 'c-b' }),
    ], h.ports)
    expect(report).toMatchObject({ checked: 3, usable: 2 })
    expect(report.invalidated).toEqual([{ locusId: 'broken', reason: '不可恢复' }])
  })

  it('stops early when the pass is aborted', async () => {
    const controller = new AbortController()
    const h = harness(() => { controller.abort(); return { kind: 'usable' } })
    const report = await reconcileLocusChildren(
      [row({ locusId: 'l1', sessionId: 's1' }), row({ locusId: 'l2', sessionId: 's2' })],
      h.ports,
      controller.signal,
    )
    expect(report.usable).toBe(1)
  })

  it('has no busy fence to clear and no sender: the store only invalidates', () => {
    const h = harness(() => ({ kind: 'usable' }))
    expect(Object.keys(h.ports.store)).toEqual(['invalidate'])
  })
})

// ── Startup recovery (task 2A.9) ────────────────────────────────────────────
import { recoverLocusStartupV20, type StartupRecoveryPortV20 } from '../src/host/locus/reconcile.js'
import type { DeliveryRecord } from '../src/host/locus/delivery.js'
import type { PetLocusOperation } from '../src/host/spec.js'

const NOW = 1_000_000

function delivery(patch: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    deliveryId: 'd1', messageId: 'om1', sequence: 1, endpoint: { chatId: 'oc-1' },
    locusId: 'locus-1', sessionId: 'child-1', senderOpenId: 'ou1',
    feedbackTarget: { chatId: 'oc-1', messageId: 'om1' },
    status: 'current', queueState: 'current', acceptedAt: NOW - 1000, deadlineAt: NOW + 60_000,
    hardDeadlineAt: NOW - 1000 + 24 * 3600_000, revision: 2, stateRevision: 2,
    ...patch,
  } as DeliveryRecord
}

function operation(patch: Partial<PetLocusOperation> = {}): PetLocusOperation {
  return {
    id: 'op-1', kind: 'rebind', phase: 'provisioning', operation: 'rebind', step: 0, attempts: 0,
    createdAt: NOW - 5000, updatedAt: NOW - 5000, ...patch,
  } as PetLocusOperation
}

function fake(init: { rows?: LocusRowV20[]; deliveries?: DeliveryRecord[]; operations?: PetLocusOperation[]; unpaired?: string[]; revertFails?: boolean } = {}) {
  const rows = init.rows ?? [row().row]
  const deliveries = new Map((init.deliveries ?? []).map(d => [d.deliveryId, d]))
  const operations = new Map((init.operations ?? []).map(o => [o.id, o]))
  const writes: { deliveries: DeliveryRecord[]; operations: PetLocusOperation[]; invalid: { locusId: string; revision: number }[]; reverts: Record<string, unknown>[] } =
    { deliveries: [], operations: [], invalid: [], reverts: [] }
  const port: StartupRecoveryPortV20 = {
    assertEveryGroupMainPaired: () => {
      if (init.unpaired !== undefined && init.unpaired.length > 0) throw new Error(`unpaired group rows: ${init.unpaired.join(', ')}`)
    },
    listRows: () => rows,
    listRecoverableOperations: () => [...operations.values()].filter(o => ['prepared', 'provisioning', 'publishing', 'compensating', 'failed', 'needs-recovery'].includes(o.phase)),
    listPendingDeliveries: () => [...deliveries.values()].filter(d => ['accepted', 'queued', 'running', 'current', 'finishing'].includes(d.status)),
    getDelivery: id => deliveries.get(id),
    putDeliveryCas: async (_prev, next) => { deliveries.set(next.deliveryId, next); writes.deliveries.push(next) },
    putOperation: async op => { operations.set(op.id, op); writes.operations.push(op) },
    revertFirstDelivery: async input => {
      if (init.revertFails) throw new Error('revert refused')
      writes.reverts.push({ ...input })
      const prev = operations.get(`first-child:${input.executionId}`)
      if (prev !== undefined) operations.set(prev.id, { ...prev, phase: 'compensated' })
    },
    markInvalid: async (fence, _reason) => { writes.invalid.push({ locusId: fence.expectedLocusId, revision: fence.expectedRevision }); return rows[0]! },
  }
  return { port, writes, deliveries, operations }
}

describe('startup recovery (v20)', () => {
  it('fails startup when a group row names an M with no pairing (diagnostic names the row), before touching anything', async () => {
    const f = fake({ unpaired: ['oc-1'], deliveries: [delivery({ status: 'finishing' })] })
    await expect(recoverLocusStartupV20(f.port, { now: NOW })).rejects.toThrow(/oc-1/)
    expect(f.writes.deliveries).toEqual([])
  })

  it('spec Scenario "Host 重启处理遗留 finishing": converges a leftover finishing Delivery to unknown-terminal without resending', async () => {
    const f = fake({ deliveries: [delivery({ status: 'finishing', finishOutcome: 'reply', outboundAttemptedAt: NOW - 10 })] })
    const report = await recoverLocusStartupV20(f.port, { now: NOW })
    const next = f.deliveries.get('d1')!
    expect(next).toMatchObject({ status: 'unknown-terminal', outboundResult: 'unknown', finishOutcome: 'reply' })
    expect(next.queueState).toBeUndefined()
    expect(report.sideEffectsReplayed).toBe(false)
  })

  it('retains an unexpired current whose (locusId, sessionId) is exact, without a new session', async () => {
    const f = fake({ deliveries: [delivery()] })
    const report = await recoverLocusStartupV20(f.port, { now: NOW })
    expect(report.retainedDeliveries.map(d => d.deliveryId)).toEqual(['d1'])
    expect(report.manualDeliveries).toEqual([])
    expect(f.deliveries.get('d1')!.sessionId).toBe('child-1')
  })

  it('pauses on an unprovable association: sessionId mismatch becomes manual debt, no FIFO guess', async () => {
    const f = fake({ deliveries: [delivery({ sessionId: 'other-session' })] })
    const report = await recoverLocusStartupV20(f.port, { now: NOW })
    expect(report.manualDeliveries.map(d => d.deliveryId)).toEqual(['d1'])
    expect(f.deliveries.get('d1')!.startupRecoveryDebt).toBeDefined()
    expect(report.retainedDeliveries).toEqual([])
  })

  it('treats a delivery whose locus has no row as unprovable', async () => {
    const f = fake({ rows: [], deliveries: [delivery()] })
    const report = await recoverLocusStartupV20(f.port, { now: NOW })
    expect(report.manualDeliveries).toHaveLength(1)
  })

  it('expires a current past its deadline', async () => {
    const f = fake({ deliveries: [delivery({ deadlineAt: NOW - 1 })] })
    const report = await recoverLocusStartupV20(f.port, { now: NOW })
    expect(report.failedDeliveries[0]).toMatchObject({ deliveryId: 'd1', status: 'expired' })
  })

  it('keeps an accepted backlog row as retained', async () => {
    const f = fake({ deliveries: [delivery({ status: 'accepted', queueState: 'backlog', deadlineAt: undefined, revision: undefined, stateRevision: undefined })] })
    const report = await recoverLocusStartupV20(f.port, { now: NOW })
    expect(report.retainedDeliveries.map(d => d.deliveryId)).toEqual(['d1'])
  })

  it('terminating an unprovable queued row fails it and invalidates the active row by its fence', async () => {
    const f = fake({ deliveries: [delivery({ status: 'queued', queueState: undefined, executionId: 'e1', inboxMessageId: 'i1', queuedAt: NOW - 500, deadlineAt: undefined })] })
    const terminate = vi.fn(async () => undefined)
    const report = await recoverLocusStartupV20(f.port, { now: NOW, terminateDelivery: terminate })
    expect(terminate).toHaveBeenCalledOnce()
    expect(report.failedDeliveries[0]).toMatchObject({ status: 'failed', startupDisposition: 'execution-unrecoverable' })
    expect(f.writes.invalid).toEqual([{ locusId: 'locus-1', revision: 3 }])
  })

  it('compensates a crashed rebind by reclaiming only the M1 it created; never a chat or work session', async () => {
    const f = fake({ operations: [operation({ resourceRefs: { locusMainSessionId: 'm1' } })] })
    const calls: string[] = []
    const report = await recoverLocusStartupV20(f.port, {
      now: NOW,
      compensators: {
        locusMainSession: async i => { calls.push(`m:${i.locusMainSessionId}`) },
        chat: async i => { calls.push(`chat:${i.chatId}`) },
        mainSession: async i => { calls.push(`w:${i.mainSessionId}`) },
      },
    })
    expect(calls).toEqual(['m:m1'])
    expect(report.compensatedOperations[0]).toMatchObject({ id: 'op-1', phase: 'compensated' })
    expect(f.operations.get('op-1')!.phase).toBe('compensated')
  })

  it('a crashed rebind that created no M1 compensates nothing and is closed', async () => {
    const f = fake({ operations: [operation({ resourceRefs: {} })] })
    const locusMain = vi.fn(async () => undefined)
    await recoverLocusStartupV20(f.port, { now: NOW, compensators: { locusMainSession: locusMain } })
    expect(locusMain).not.toHaveBeenCalled()
    expect(f.operations.get('op-1')!.phase).toBe('compensated')
  })

  it('compensates a crashed migrate the same way (M1 only)', async () => {
    const f = fake({ operations: [operation({ id: 'op-m', kind: 'migrate', operation: 'migrate', resourceRefs: { locusMainSessionId: 'm1' } })] })
    const locusMain = vi.fn(async () => undefined)
    await recoverLocusStartupV20(f.port, { now: NOW, compensators: { locusMainSession: locusMain } })
    expect(locusMain).toHaveBeenCalledWith({ locusMainSessionId: 'm1', operationId: 'op-m' })
  })

  it('a chat operation reclaims the chat it created, its M, then its auto work session', async () => {
    const f = fake({ operations: [operation({ id: 'op-c', kind: 'ensure', operation: 'chat', resourceRefs: { chatId: 'oc-new', locusMainSessionId: 'm1', mainSessionId: 'w0' } })] })
    const calls: string[] = []
    await recoverLocusStartupV20(f.port, {
      now: NOW,
      compensators: {
        chat: async i => { calls.push(`chat:${i.chatId}`) },
        locusMainSession: async i => { calls.push(`m:${i.locusMainSessionId}`) },
        mainSession: async i => { calls.push(`w:${i.mainSessionId}`) },
      },
    })
    expect(calls).toEqual(['chat:oc-new', 'm:m1', 'w:w0'])
  })

  it('a missing compensator leaves needs-recovery debt, not a closed operation', async () => {
    const f = fake({ operations: [operation({ resourceRefs: { locusMainSessionId: 'm1' } })] })
    const report = await recoverLocusStartupV20(f.port, { now: NOW, compensators: {} })
    expect(report.manualOperations[0]).toMatchObject({ id: 'op-1', phase: 'needs-recovery' })
    expect(report.compensatedOperations).toEqual([])
  })

  it('does not retry manual debt past its budget unless the cause was a missing capability', async () => {
    const f = fake({ operations: [operation({ phase: 'needs-recovery', attempts: 9, manualRecoveryReason: 'boom', resourceRefs: { locusMainSessionId: 'm1' } })] })
    const locusMain = vi.fn(async () => undefined)
    const report = await recoverLocusStartupV20(f.port, { now: NOW, compensators: { locusMainSession: locusMain } })
    expect(locusMain).not.toHaveBeenCalled()
    expect(report.manualOperations).toHaveLength(1)
  })

  it('retries compensation of a failed operation; a failure keeps it failed (not manual debt)', async () => {
    const f = fake({ operations: [operation({ phase: 'failed', resourceRefs: { locusMainSessionId: 'm1' } })] })
    const ok = await recoverLocusStartupV20(f.port, { now: NOW, compensators: { locusMainSession: async () => undefined } })
    expect(ok.compensatedOperations[0]).toMatchObject({ id: 'op-1', phase: 'compensated' })

    const g = fake({ operations: [operation({ phase: 'failed', resourceRefs: { locusMainSessionId: 'm1' } })] })
    const bad = await recoverLocusStartupV20(g.port, { now: NOW, compensators: { locusMainSession: async () => { throw new Error('boom') } } })
    expect(g.operations.get('op-1')!.phase).toBe('failed')
    expect(bad.compensatedOperations).toEqual([])
    expect(bad.manualOperations).toEqual([])
  })

  describe('a first-child publication left mid-flight (D16)', () => {
    const publishing = (patch: Partial<PetLocusOperation> = {}) => operation({
      id: 'first-child:exec-1', kind: 'delivery', operation: 'first-child-publication', phase: 'publishing',
      locusId: 'locus-1', deliveryId: 'd1', expectedRevision: 2,
      resourceRefs: { parentSessionId: 'main-1', childSessionId: 'child-1' }, ...patch,
    })
    const first = (patch: Partial<DeliveryRecord> = {}) => delivery({ executionId: 'exec-1', ...patch })
    const rotate = () => 'session-new'

    it('terminates the child, then reverts with one combined write: the trigger Delivery is not retargeted', async () => {
      const f = fake({ deliveries: [first()], operations: [publishing()] })
      const order: string[] = []
      const report = await recoverLocusStartupV20(f.port, {
        now: NOW,
        reserveChildSessionId: rotate,
        compensators: { childSession: async i => { order.push(`terminate:${i.parentSessionId}/${i.childSessionId}`) } },
      })
      expect(order).toEqual(['terminate:main-1/child-1'])
      expect(f.writes.reverts).toEqual([expect.objectContaining({
        locusId: 'locus-1', sessionId: 'child-1', revision: 2, deliveryId: 'd1', executionId: 'exec-1', now: NOW,
      })])
      expect(f.writes.reverts[0]).not.toHaveProperty('retargetDeliveryId')
      expect(report.compensatedOperations.map(o => o.id)).toEqual(['first-child:exec-1'])
      expect(report.manualOperations).toEqual([])
    })

    it('does not revert when the child cannot be terminated: needs-recovery debt, delivery held manual', async () => {
      const f = fake({ deliveries: [first()], operations: [publishing()] })
      const report = await recoverLocusStartupV20(f.port, {
        now: NOW, reserveChildSessionId: rotate,
        compensators: { childSession: async () => { throw new Error('terminate failed') } },
      })
      expect(f.writes.reverts).toEqual([])
      expect(report.manualOperations[0]).toMatchObject({ id: 'first-child:exec-1', phase: 'needs-recovery' })
      expect(report.manualDeliveries.map(d => d.deliveryId)).toEqual(['d1'])
      expect(report.retainedDeliveries).toEqual([])
    })

    it('without a childSession compensator it is needs-recovery debt, never reverted', async () => {
      const f = fake({ deliveries: [first()], operations: [publishing()] })
      const report = await recoverLocusStartupV20(f.port, { now: NOW, reserveChildSessionId: rotate, compensators: {} })
      expect(f.writes.reverts).toEqual([])
      expect(report.manualOperations).toHaveLength(1)
    })

    it('refuses on any identity mismatch (row session, delivery session, M) and never terminates', async () => {
      const terminate = vi.fn(async () => undefined)
      for (const op of [
        publishing({ resourceRefs: { parentSessionId: 'main-1', childSessionId: 'other' } }),
        publishing({ resourceRefs: { parentSessionId: 'wrong-main', childSessionId: 'child-1' } }),
      ]) {
        const f = fake({ deliveries: [first()], operations: [op] })
        const report = await recoverLocusStartupV20(f.port, { now: NOW, reserveChildSessionId: rotate, compensators: { childSession: terminate } })
        expect(f.writes.reverts).toEqual([])
        expect(report.manualOperations).toHaveLength(1)
      }
      expect(terminate).not.toHaveBeenCalled()
    })

    it('a refused combined write leaves needs-recovery debt', async () => {
      const f = fake({ deliveries: [first()], operations: [publishing()], revertFails: true })
      const report = await recoverLocusStartupV20(f.port, { now: NOW, reserveChildSessionId: rotate, compensators: { childSession: async () => undefined } })
      expect(report.manualOperations[0]).toMatchObject({ phase: 'needs-recovery' })
      expect(report.compensatedOperations).toEqual([])
    })
  })
})
