import { describe, expect, it, vi } from 'vitest'
import {
  reconcileLocusChildren,
  type ChildLiveness,
  type ReconcileDiagnostic,
} from '../src/host/locus/reconcile.js'
import type { LocusRecord } from '../src/host/locus/aggregate.js'

function locus(overrides: Partial<LocusRecord> = {}): LocusRecord {
  return {
    id: 'locus-1',
    generation: 1,
    endpoint: { chatId: 'oc-1' },
    parentSessionId: 'main-1',
    childSessionId: 'child-1',
    workspaceId: 'ws-1',
    source: 'auto',
    state: 'active',
    permission: { desired: 'read', effective: 'read', verifiedAt: 1 },
    busy: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as LocusRecord
}

function harness(liveness?: (childSessionId: string) => ChildLiveness) {
  const invalidated: { locusId: string; reason: string }[] = []
  const busyCleared: string[] = []
  const diagnostics: ReconcileDiagnostic[] = []
  return {
    invalidated,
    busyCleared,
    diagnostics,
    ports: {
      store: {
        invalidate: async (locusId: string, reason: string) => { invalidated.push({ locusId, reason }) },
        hasPendingDelivery: async () => false,
        clearBusy: async (locusId: string) => { busyCleared.push(locusId) },
      },
      ...(liveness === undefined
        ? {}
        : { probe: { check: async ({ childSessionId }: { childSessionId: string }) => liveness(childSessionId) } }),
      now: () => 100,
      log: (code: ReconcileDiagnostic) => { diagnostics.push(code) },
    },
  }
}

describe('startup reconciliation', () => {
  it('leaves a usable child untouched', async () => {
    const h = harness(() => ({ kind: 'usable' }))

    const report = await reconcileLocusChildren([locus()], h.ports)

    expect(report).toMatchObject({ checked: 1, usable: 1, invalidated: [], unproven: [] })
    expect(h.invalidated).toEqual([])
  })

  it('marks a definitively gone child invalid instead of re-creating it', async () => {
    const h = harness(() => ({ kind: 'unusable', reason: '子会话已归档' }))

    const report = await reconcileLocusChildren([locus()], h.ports)

    // Re-creating would silently discard the conversation this entry has been
    // having, and would do it without anyone asking.
    expect(report.invalidated).toEqual([{ locusId: 'locus-1', reason: '子会话已归档' }])
    expect(h.invalidated).toEqual([{ locusId: 'locus-1', reason: '子会话已归档' }])
    expect(h.diagnostics).toContain('child-unusable')
  })

  it('treats an unanswerable probe as unproven, never as absence', async () => {
    const h = harness(() => ({ kind: 'unknown', diagnostic: 'runtime still starting' }))

    const report = await reconcileLocusChildren([locus()], h.ports)

    // "Cannot tell" must not become "gone": invalidating here would break a
    // perfectly good entry because the runtime was briefly unavailable.
    expect(report.unproven).toEqual(['locus-1'])
    expect(h.invalidated).toEqual([])
    expect(h.diagnostics).toContain('child-unknown')
  })

  it('treats a throwing probe as unproven', async () => {
    const h = harness(() => { throw new Error('probe exploded') })

    const report = await reconcileLocusChildren([locus()], h.ports)

    expect(report.unproven).toEqual(['locus-1'])
    expect(h.invalidated).toEqual([])
  })

  it('leaves every row untouched when no probe is composed', async () => {
    const h = harness()

    const report = await reconcileLocusChildren([locus(), locus({ id: 'locus-2' })], h.ports)

    // One missing seam must not invalidate everything the user has.
    expect(report).toMatchObject({ checked: 0, usable: 0, invalidated: [] })
    expect(report.unproven).toEqual(['locus-1', 'locus-2'])
    expect(h.diagnostics).toEqual(['probe-unavailable'])
  })

  it('invalidates an active generation that has no child at all', async () => {
    const h = harness(() => ({ kind: 'usable' }))

    const report = await reconcileLocusChildren(
      [locus({ childSessionId: undefined as never })],
      h.ports,
    )

    expect(report.invalidated[0]?.reason).toContain('没有可用子会话')
  })

  it('clears a stale busy fence left by a process that died mid-turn', async () => {
    const h = harness(() => ({ kind: 'usable' }))

    const report = await reconcileLocusChildren([locus({ busy: true })], h.ports)

    // A provably usable child cannot still be running a turn from a process
    // that no longer exists; leaving the fence blocks the entry forever with
    // no visible cause.
    expect(report.busyCleared).toEqual(['locus-1'])
    expect(h.busyCleared).toEqual(['locus-1'])
    expect(h.diagnostics).toContain('stale-busy-cleared')
  })

  it('preserves a busy fence owned by a pending durable Delivery', async () => {
    const h = harness(() => ({ kind: 'usable' }))
    const ports = {
      ...h.ports,
      store: { ...h.ports.store, hasPendingDelivery: async () => true },
    }
    const report = await reconcileLocusChildren([locus({ busy: true })], ports)
    expect(report.busyCleared).toEqual([])
    expect(h.busyCleared).toEqual([])
  })

  it('does not clear a busy fence it could not prove is stale', async () => {
    const h = harness(() => ({ kind: 'unknown', diagnostic: 'no answer' }))

    await reconcileLocusChildren([locus({ busy: true })], h.ports)

    // Clearing here could let a second turn start alongside one that is
    // genuinely still running.
    expect(h.busyCleared).toEqual([])
  })

  it('only considers active generations', async () => {
    const check = vi.fn(async () => ({ kind: 'usable' as const }))
    const h = harness(() => ({ kind: 'usable' }))

    const report = await reconcileLocusChildren([
      locus({ id: 'retired-1', state: 'retired' }),
      locus({ id: 'stopped-1', state: 'stopped' }),
      locus({ id: 'invalid-1', state: 'invalid' }),
    ], { ...h.ports, probe: { check } })

    // Retired/stopped/invalid rows are history or already-diagnosed; probing
    // them would produce noise and could overwrite an existing reason.
    expect(report.checked).toBe(0)
    expect(check).not.toHaveBeenCalled()
  })

  it('continues past one broken entry and reports each independently', async () => {
    const h = harness(childSessionId => (
      childSessionId === 'child-broken'
        ? { kind: 'unusable', reason: '子会话不可恢复' }
        : { kind: 'usable' }
    ))

    const report = await reconcileLocusChildren([
      locus({ id: 'locus-ok-1' }),
      locus({ id: 'locus-broken', childSessionId: 'child-broken' }),
      locus({ id: 'locus-ok-2' }),
    ], h.ports)

    expect(report).toMatchObject({ checked: 3, usable: 2 })
    expect(report.invalidated).toEqual([
      { locusId: 'locus-broken', reason: '子会话不可恢复' },
    ])
  })

  it('stops early when the pass is aborted', async () => {
    const controller = new AbortController()
    const h = harness(() => {
      controller.abort()
      return { kind: 'usable' }
    })

    const report = await reconcileLocusChildren(
      [locus({ id: 'locus-1' }), locus({ id: 'locus-2' })],
      h.ports,
      controller.signal,
    )

    // Shutdown must not be delayed by a long reconciliation pass.
    expect(report.usable).toBe(1)
  })

  it('never sends a message as part of reconciliation', async () => {
    // The port surface has no sender at all: telling a group its entry broke
    // is a separate, once-only decision the caller owns.
    const h = harness(() => ({ kind: 'unusable', reason: 'gone' }))
    expect(Object.keys(h.ports)).not.toContain('sender')
    expect(Object.keys(h.ports.store)).toEqual(['invalidate', 'hasPendingDelivery', 'clearBusy'])
  })
})
