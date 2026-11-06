/**
 * Spec: pet-locus-collaboration 已退役的 locus 子会话不能再运行 (D15) and the
 * `agent/created` wiring of D8 / D7: one lookup in order, compose once,
 * `recordAccessVerified` before publication, class A/B/main-unavailable.
 * The decision lives in `agent-created.ts`; index.ts only injects its ports.
 */
import { describe, expect, it, vi } from 'vitest'
import { handleLocusAgentCreated, type LocusAgentCreatedPorts } from '../src/host/locus/agent-created.js'
import { LocusCompositionError } from '../src/host/locus/composition.js'
import type { LocusChildComposition } from '../src/host/locus/composition.js'
import type { LocusChildLookupResultV20, LocusResolvedRowV20 } from '../src/host/locus/contract-v20.js'

const composition: LocusChildComposition = {
  locusMainSessionId: 'M1', sessionId: 'child-1', locusId: 'locus-1', revision: 4,
  accessMode: 'read-only', endpoint: { chatId: 'oc_1' },
}
const resolved = (state: 'active' | 'not-created'): LocusResolvedRowV20 => ({
  row: {
    endpoint: { chatId: 'oc_1' }, locusId: 'locus-1', sessionId: 'child-1', state, accessMode: 'read-only',
    revision: 4, createdAt: 1, updatedAt: 1, locusMainSessionId: 'M1', workspaceId: 'w',
  },
  locusMainSessionId: 'M1',
  workspaceId: 'w',
})

function setup(lookup: LocusChildLookupResultV20, overrides: Partial<LocusAgentCreatedPorts> = {}) {
  const order: string[] = []
  const lookupChild = vi.fn((_input: unknown) => { order.push('lookup'); return lookup })
  const recordAccessVerified = vi.fn(async () => { order.push('verify'); return {} as never })
  const markInvalid = vi.fn(async () => { order.push('markInvalid'); return {} as never })
  const compose = vi.fn(() => { order.push('compose'); return { composed: true as const, composition, accessMode: 'read-only' as const } })
  const claim = vi.fn(() => { order.push('claim') })
  const publishClaimed = vi.fn(async () => { order.push('publish') })
  const migrateMain = vi.fn(async (_composition: unknown) => { order.push('main-unavailable') })
  const log = vi.fn((_message: string) => {})
  const ports: LocusAgentCreatedPorts = {
    repository: { lookupChildForAgentCreated: lookupChild, recordAccessVerified, markInvalid },
    agentPreset: () => 'locus-child',
    staged: () => undefined,
    claimStaged: claim,
    compose,
    publishClaimed,
    migrateMain,
    log,
    now: () => 99,
    ...overrides,
  }
  return { ports, order, lookupChild, recordAccessVerified, markInvalid, compose, claim, publishClaimed, migrateMain, log }
}
const run = (ports: LocusAgentCreatedPorts, id = 'child-1') => handleLocusAgentCreated(ports, { id })
const refusal = (p: Promise<unknown>) => p.then(() => undefined, e => e as Error)

describe('已退役的 locus 子会话不能再运行 (one lookup, in order)', () => {
  it('普通会话不受影响: ordinary hit composes nothing and publishes nothing', async () => {
    const t = setup({ kind: 'ordinary' }, { agentPreset: () => 'standard' })
    await expect(run(t.ports)).resolves.toBe('ordinary')
    expect(t.compose).not.toHaveBeenCalled()
    expect(t.publishClaimed).not.toHaveBeenCalled()
    expect(t.lookupChild).toHaveBeenCalledTimes(1)
  })

  it('passes the durable preset and the staged tuple to the ONE lookup', async () => {
    const staged = { sessionId: 'child-1', locusMainSessionId: 'M1', revision: 4 }
    const t = setup({ kind: 'staged', row: resolved('not-created') }, { staged: () => staged })
    await run(t.ports)
    expect(t.lookupChild).toHaveBeenCalledTimes(1)
    expect(t.lookupChild).toHaveBeenCalledWith({ sessionId: 'child-1', agentPreset: 'locus-child', staged })
  })

  it('被替换的旧子会话冷恢复被拒绝: retired → refusal, nothing composed or published', async () => {
    const t = setup({ kind: 'retired' })
    const error = await refusal(run(t.ports))
    expect(error?.message).toContain('已退役的 locus 子会话不可再运行')
    expect(t.compose).not.toHaveBeenCalled()
    expect(t.recordAccessVerified).not.toHaveBeenCalled()
    expect(t.publishClaimed).not.toHaveBeenCalled()
  })

  it.each([['access-changing', '访问模式变更期间发布被拒绝'], ['recovery-debt', '存在首次创建恢复债时冷恢复与父回复都被拒绝']] as const)(
    '%s blocks before any composition (%s)', async reason => {
      const t = setup({ kind: 'blocked', reason, locusId: 'locus-1' })
      const error = await refusal(run(t.ports))
      expect(error).toBeInstanceOf(Error)
      expect(t.compose).not.toHaveBeenCalled()
      expect(t.recordAccessVerified).not.toHaveBeenCalled()
      expect(t.publishClaimed).not.toHaveBeenCalled()
    },
  )

  it('首次创建经 staged 精确匹配 claim 一次, then compose, verify, publish — in that order', async () => {
    const t = setup({ kind: 'staged', row: resolved('not-created') })
    await expect(run(t.ports)).resolves.toBe('composed')
    expect(t.order).toEqual(['lookup', 'claim', 'compose', 'verify', 'publish'])
    expect(t.claim).toHaveBeenCalledTimes(1)
  })

  it('active hit composes from the row (no claim), verifies on the row fence, then publishes', async () => {
    const t = setup({ kind: 'active', row: resolved('active') })
    await run(t.ports)
    expect(t.order).toEqual(['lookup', 'compose', 'verify', 'publish'])
    expect(t.recordAccessVerified).toHaveBeenCalledWith({ expectedLocusId: 'locus-1', expectedRevision: 4 }, 'read-only', 99)
  })
})

describe('组合失败的分类处理 (recordAccessVerified only after composed:true)', () => {
  const failing = (reason: ConstructorParameters<typeof LocusCompositionError>[0]) => () => {
    throw new LocusCompositionError(reason, `composition ${reason}`)
  }

  it('class B (policy / surface / readback): refuses, never verifies, never publishes, row untouched', async () => {
    for (const reason of ['policy-not-verified', 'surface-failed', 'preset-mismatch', 'write-disabled'] as const) {
      const t = setup({ kind: 'active', row: resolved('active') }, { compose: failing(reason) })
      const error = await refusal(run(t.ports))
      expect(error?.message, reason).toContain(reason)
      expect(t.recordAccessVerified, reason).not.toHaveBeenCalled()
      expect(t.publishClaimed, reason).not.toHaveBeenCalled()
      expect(t.markInvalid, reason).not.toHaveBeenCalled()
      expect(t.migrateMain, reason).not.toHaveBeenCalled()
    }
  })

  it('an unclassified throw is class B', async () => {
    const t = setup({ kind: 'active', row: resolved('active') }, { compose: () => { throw new Error('boom') } })
    await refusal(run(t.ports))
    expect(t.recordAccessVerified).not.toHaveBeenCalled()
    expect(t.markInvalid).not.toHaveBeenCalled()
  })

  it('class A (identity unproven): marks the row invalid on its fence, never verifies or publishes', async () => {
    const t = setup({ kind: 'active', row: resolved('active') }, { compose: failing('identity-unproven') })
    await refusal(run(t.ports))
    expect(t.markInvalid).toHaveBeenCalledWith({ expectedLocusId: 'locus-1', expectedRevision: 4 }, expect.stringContaining('identity-unproven'), 99)
    expect(t.recordAccessVerified).not.toHaveBeenCalled()
    expect(t.publishClaimed).not.toHaveBeenCalled()
  })

  it('main-unavailable: hands over to the whole-W migration, no markInvalid, never verifies', async () => {
    const t = setup({ kind: 'active', row: resolved('active') }, { compose: failing('main-unavailable') })
    await refusal(run(t.ports))
    expect(t.migrateMain).toHaveBeenCalledWith(expect.objectContaining({ locusId: 'locus-1' }))
    expect(t.markInvalid).not.toHaveBeenCalled()
    expect(t.recordAccessVerified).not.toHaveBeenCalled()
    expect(t.publishClaimed).not.toHaveBeenCalled()
  })

  it('main-unavailable: a REJECTED migration never escapes unhandled — it is logged deterministically and the delivery is still refused as before', async () => {
    const t = setup({ kind: 'active', row: resolved('active') }, { compose: failing('main-unavailable') })
    t.migrateMain.mockRejectedValueOnce(Object.assign(new Error('current in oc_c'), { code: 'LOCUS_BUSY' }))
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const error = await refusal(run(t.ports))
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(error?.message).toContain('main-unavailable')
      expect(t.log).toHaveBeenCalledWith(expect.stringContaining('locus whole-W migration failed'))
      expect(unhandled).toEqual([])
      expect(t.recordAccessVerified).not.toHaveBeenCalled()
      expect(t.publishClaimed).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('a refused recordAccessVerified refuses publication (class B) and does not invalidate', async () => {
    const t = setup({ kind: 'active', row: resolved('active') })
    t.recordAccessVerified.mockRejectedValueOnce(Object.assign(new Error('cas'), { code: 'LOCUS_CONFLICT' }))
    const error = await refusal(run(t.ports))
    expect(error).toBeInstanceOf(Error)
    expect(t.publishClaimed).not.toHaveBeenCalled()
    expect(t.markInvalid).not.toHaveBeenCalled()
  })

  it('a composer that says composed:false for a locus hit is refused (never published unverified)', async () => {
    const t = setup({ kind: 'active', row: resolved('active') }, { compose: () => ({ composed: false }) })
    await refusal(run(t.ports))
    expect(t.recordAccessVerified).not.toHaveBeenCalled()
    expect(t.publishClaimed).not.toHaveBeenCalled()
  })
})
