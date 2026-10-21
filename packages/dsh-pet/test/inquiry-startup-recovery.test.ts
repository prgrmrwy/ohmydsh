import { describe, expect, it, vi } from 'vitest'
import { runInquiryStartupRecovery } from '../src/host/inquiry/startup-recovery.js'
import type { RecoveryAction } from '../src/host/inquiry/recovery.js'

const scopeOf = (sessionId: string) => ({ kind: 'main' as const, sessionId })
const act = (kind: string, phase: 'target' | 'result' | 'legacy', sessionId?: string, inquiryId = 'inq'): RecoveryAction =>
  ({ kind, inquiryId, phase, reason: 'test', ...(sessionId ? { scope: scopeOf(sessionId), messageId: `m-${inquiryId}` } : {}) })

function fakes(actions: readonly RecoveryAction[] | (() => Promise<readonly RecoveryAction[]>)) {
  const calls: string[] = []
  const logs: string[] = []
  return {
    calls, logs,
    ports: {
      plan: typeof actions === 'function' ? actions : async () => actions,
      pumpTarget: vi.fn(async (s: string) => { calls.push(`target:${s}`) }),
      pumpResults: vi.fn(async (s: string) => { calls.push(`result:${s}`) }),
      log: (code: string) => { logs.push(code) },
    },
  }
}

describe('inquiry startup recovery executor', () => {
  it('dispatches target and result enqueue actions exactly once per session+phase', async () => {
    const f = fakes([
      act('enqueue-existing-message', 'target', 'b', 'i1'),
      act('enqueue-existing-message', 'target', 'b', 'i2'),
      act('enqueue-existing-message', 'result', 'a', 'i3'),
      act('enqueue-existing-message', 'result', 'a', 'i4'),
      act('enqueue-existing-message', 'target', 'a', 'i5'),
    ])
    const report = await runInquiryStartupRecovery(f.ports)
    expect([...f.calls].sort()).toEqual(['result:a', 'target:a', 'target:b'])
    expect(report).toMatchObject({ dispatchedTarget: 2, dispatchedResult: 1, failed: 0 })
  })

  it('does nothing for await-same-message, already-claimed and done', async () => {
    const f = fakes([act('await-same-message', 'target', 'b'), act('already-claimed', 'target', 'b', 'i2'), act('done', 'result', 'a', 'i3')])
    const report = await runInquiryStartupRecovery(f.ports)
    expect(f.calls).toEqual([])
    expect(report).toMatchObject({ dispatchedTarget: 0, dispatchedResult: 0, awaiting: 3 })
  })

  it('never dispatches review-class or unknown kinds, only counts and logs them', async () => {
    const kinds = ['needs-review', 'retain-disposition', 'legacy-disposition-required', 'unavailable', 'read-failed', 'totally-new-kind']
    const f = fakes(kinds.map((k, n) => act(k, 'target', 'b', `i${n}`)))
    const report = await runInquiryStartupRecovery(f.ports)
    expect(f.calls).toEqual([])
    expect(report.review).toBe(kinds.length)
    expect(f.logs.length).toBeGreaterThan(0)
    // Stable codes only: never an inquiry/session/message id.
    expect(new Set(f.logs)).toEqual(new Set(['inquiry-recovery-review']))
  })

  it('isolates a failing pump: others still run, failure is counted, function never throws', async () => {
    const f = fakes([act('enqueue-existing-message', 'target', 'b', 'i1'), act('enqueue-existing-message', 'result', 'a', 'i2'), act('enqueue-existing-message', 'target', 'c', 'i3')])
    f.ports.pumpTarget.mockImplementationOnce(async () => { throw new Error('boom with secret-id') })
    const report = await runInquiryStartupRecovery(f.ports)
    expect(f.calls.sort()).toEqual(['result:a', 'target:c'])
    expect(report.failed).toBe(1)
    expect(report.dispatchedTarget).toBe(1)
    expect(report.dispatchedResult).toBe(1)
    expect(f.logs.join(' ')).not.toContain('secret-id')
  })

  it('does not throw when planning fails, or when the logger throws', async () => {
    const f = fakes(async () => { throw new Error('plan failed') })
    await expect(runInquiryStartupRecovery(f.ports)).resolves.toMatchObject({ dispatchedTarget: 0, dispatchedResult: 0, failed: 1 })
    const g = fakes([act('needs-review', 'target', 'b')])
    g.ports.log = () => { throw new Error('log failed') }
    await expect(runInquiryStartupRecovery(g.ports)).resolves.toMatchObject({ review: 1 })
  })

  it('skips an enqueue action that carries no scope instead of guessing a session', async () => {
    const f = fakes([act('enqueue-existing-message', 'target')])
    const report = await runInquiryStartupRecovery(f.ports)
    expect(f.calls).toEqual([])
    expect(report.review).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Production adapters, against the real durable stores and the real planner.
// ---------------------------------------------------------------------------
import { openPetHarness } from './harness.js'
import { InquiryWorkStore } from '../src/host/inquiry/work-store.js'
import { InquiryAcceptanceStore } from '../src/host/inquiry/acceptance-store.js'
import { createInquirySessionEvidence, createInquiryWorkEvidence, planInquiryRecoveryForMembers } from '../src/host/inquiry/startup-recovery.js'

const at = 1_800_000_000_000
const requester = { kind: 'main', sessionId: 'session-a' } as const
const target = { kind: 'child', sessionId: 'session-b', locusId: 'locus-b', generation: 2 } as const
const root = { kind: 'local', sessionId: 'session-a', workId: 'root' } as const
async function seeded() {
  const h = await openPetHarness()
  await new InquiryWorkStore(h.domain).claimLocalWork(requester, 'root', 1, at)
  await new InquiryAcceptanceStore(h.domain).accept({ request: { target, question: 'Q?', purpose: 'test', declaredOrigin: null },
    facts: { inquiryId: 'inq', requester, circleParentSessionId: 'session-a', origin: { kind: 'local' }, audience: { kind: 'local-session', sessionId: 'session-a' }, createdAt: at },
    work: root, messageId: 'target-msg' })
  return h
}

describe('startup recovery production adapters', () => {
  it('sessionEvidence: live inbox hit is pending (either lane)', async () => {
    const ev = createInquirySessionEvidence({ getLive: () => ({ inbox: { nextTurn: [], nextStep: [{ id: 'm1' }] } }), readEvents: async () => [] })
    expect(await ev('s', 'm1')).toEqual({ kind: 'pending' })
  })
  it('sessionEvidence: absent only when a readable durable log never mentions the message', async () => {
    const ev = createInquirySessionEvidence({ getLive: () => undefined, readEvents: async () => [{ type: 'turn/start', data: { turn: 1 } }] })
    expect(await ev('s', 'm1')).toEqual({ kind: 'absent' })
  })
  it('sessionEvidence: never absent when the log mentions the message but the inbox does not hold it', async () => {
    const ev = createInquirySessionEvidence({ getLive: () => undefined, readEvents: async () => [{ type: 'agent/inbox/spliced', data: { inserted: [{ id: 'm1' }] } }] })
    expect(await ev('s', 'm1')).toMatchObject({ kind: 'unknown' })
  })
  it('sessionEvidence: unreadable or unavailable log is unknown, never absent', async () => {
    const throws = createInquirySessionEvidence({ getLive: () => undefined, readEvents: async () => { throw new Error('io') } })
    const none = createInquirySessionEvidence({ getLive: () => undefined, readEvents: async () => undefined })
    expect(await throws('s', 'm1')).toEqual({ kind: 'unknown' })
    expect(await none('s', 'm1')).toEqual({ kind: 'unknown' })
  })
  it('workEvidence: valid / terminal / unknown from the durable work row and generation', () => {
    const inquiry = { requester } as never
    const rows: Record<string, { state: string; scopeGeneration: number }> = { active: { state: 'active', scopeGeneration: 0 }, settled: { state: 'settled', scopeGeneration: 0 }, wrongGen: { state: 'active', scopeGeneration: 9 } }
    const ev = createInquiryWorkEvidence((_s, w) => rows[w])
    expect(ev({ kind: 'local', sessionId: 'session-a', workId: 'active' }, inquiry)).toBe('valid')
    expect(ev({ kind: 'local', sessionId: 'session-a', workId: 'settled' }, inquiry)).toBe('terminal')
    expect(ev({ kind: 'local', sessionId: 'session-a', workId: 'wrongGen' }, inquiry)).toBe('unknown')
    expect(ev({ kind: 'local', sessionId: 'session-a', workId: 'missing' }, inquiry)).toBe('unknown')
    expect(ev({ kind: 'delivery', id: 'd1' }, inquiry)).toBe('unknown')
  })
  it('plans per member: only the owner scope yields a dispatchable action, other members add no dispatch', async () => {
    const h = await seeded()
    try {
      const scopes: Record<string, unknown> = { 'session-a': requester, 'session-b': target }
      const actions = await planInquiryRecoveryForMembers({
        domain: h.domain, ready: true, currentScope: id => scopes[id] as never,
        sessionEvidence: async () => ({ kind: 'absent' }), workEvidence: () => 'valid',
      })
      const enqueue = actions.filter(a => a.kind === 'enqueue-existing-message')
      expect(enqueue).toHaveLength(1)
      expect(enqueue[0]).toMatchObject({ phase: 'target', messageId: 'target-msg', scope: { sessionId: 'session-b' } })
    } finally { await h.close() }
  })
  it('skips a member whose current scope cannot be resolved and never dispatches for it', async () => {
    const h = await seeded()
    try {
      const actions = await planInquiryRecoveryForMembers({
        domain: h.domain, ready: true, currentScope: id => (id === 'session-a' ? requester : undefined),
        sessionEvidence: async () => ({ kind: 'absent' }), workEvidence: () => 'valid',
      })
      expect(actions.filter(a => a.kind === 'enqueue-existing-message')).toHaveLength(0)
    } finally { await h.close() }
  })
  it('planning is read-only', async () => {
    const h = await seeded()
    try {
      const before = JSON.stringify(h.medium)
      await planInquiryRecoveryForMembers({ domain: h.domain, ready: true, currentScope: id => (id === 'session-b' ? target : requester) as never, sessionEvidence: async () => ({ kind: 'absent' }), workEvidence: () => 'valid' })
      expect(JSON.stringify(h.medium)).toBe(before)
    } finally { await h.close() }
  })
})
