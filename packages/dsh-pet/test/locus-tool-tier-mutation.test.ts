import { describe, expect, it, vi } from 'vitest'
import { createLocusToolTierMutation, type ToolTierMutationLocus } from '../src/host/locus/tool-tier-mutation.js'
import { LOCUS_SAFE_CHILD_COMPOSITION, type LocusMutationFence, type LocusToolTier } from '../src/host/locus/aggregate.js'

function setup(overrides: {
  initial?: Partial<ToolTierMutationLocus>
  live?: boolean
  setFails?: boolean
  safeAttests?: boolean
  desiredAttests?: boolean
  pending?: boolean
  idle?: boolean
} = {}) {
  let row: ToolTierMutationLocus = {
    id: 'locus-a', generation: 2, revision: 4, updatedAt: 10,
    endpoint: { chatId: 'oc-a' }, childSessionId: 'child-a', childComposition: LOCUS_SAFE_CHILD_COMPOSITION,
    state: 'active', busy: false, toolTier: { desired: 'safe', effective: 'safe' },
    ...overrides.initial,
  }
  let visible = ['read', 'read_image', 'glob', 'grep', 'web_search', 'pet_locus_finish']
  const repository = {
    findLocus: vi.fn((id: string) => row.id === id ? row : undefined),
    findCurrentLocus: vi.fn((endpoint: { chatId: string }) => endpoint.chatId === row.endpoint?.chatId && row.state === 'active' ? row : undefined),
    getLocusByChild: vi.fn((id: string) => id === row.childSessionId ? row : undefined),
    hasPendingDeliveries: vi.fn(() => overrides.pending ?? false),
    beginToolTierMutation: vi.fn(async (_id: string, now: number, fence?: LocusMutationFence) => {
      if (row.state !== 'active' || row.generation !== fence?.expectedGeneration || row.revision !== fence?.expectedRevision) throw new Error('fence conflict')
      row = { ...row, state: 'switching', revision: row.revision! + 1, updatedAt: now }
      return row
    }),
    commitToolTierMutation: vi.fn(async (_id: string, tier: LocusToolTier, now: number, fence?: LocusMutationFence) => {
      if (row.state !== 'switching' || row.revision !== fence?.expectedRevision) throw new Error('fence conflict')
      row = { ...row, state: 'active', toolTier: tier, revision: row.revision! + 1, updatedAt: now }
      return row
    }),
    abortToolTierMutation: vi.fn(async (_id: string, now: number, fence?: LocusMutationFence) => {
      if (row.state !== 'switching' || row.revision !== fence?.expectedRevision) throw new Error('fence conflict')
      row = { ...row, state: 'active', revision: row.revision! + 1, updatedAt: now }
      return row
    }),
    invalidateToolTierMutation: vi.fn(async (_id: string, reason: string, now: number) => {
      row = { ...row, state: 'invalid', updatedAt: now, invalidReason: reason }
      return row
    }),
  }
  const surface = {
    isIdle: vi.fn(() => overrides.idle ?? true),
    setToolTier: vi.fn((tier: 'safe' | 'shell') => {
      if (overrides.setFails) throw new Error('apply failed')
      visible = tier === 'safe'
        ? ['read', 'read_image', 'glob', 'grep', 'web_search', 'pet_locus_finish']
        : ['read', 'read_image', 'glob', 'grep', 'web_search', 'bash', 'skill', 'pet_locus_finish']
    }),
    visibleTools: vi.fn(() => visible),
  }
  const mutation = createLocusToolTierMutation({
    repository,
    live: { find: vi.fn(() => overrides.live === false ? undefined : surface) },
    attest: (_visible, tier) => tier === 'safe' ? (overrides.safeAttests ?? true) : (overrides.desiredAttests ?? true),
    now: (() => { let n = 11; return () => n++ })(),
  })
  return { mutation, repository, surface, row: () => row }
}

describe('Locus tool-tier mutation', () => {
  it('applies and persists on the same child under a generation/revision fence', async () => {
    const h = setup()
    const result = await h.mutation.set({ locusId: 'locus-a', endpoint: { chatId: 'oc-a' }, tier: 'shell', actor: 'owner' })
    expect(result).toMatchObject({ ok: true, effective: 'shell' })
    expect(h.surface.setToolTier).toHaveBeenCalledWith('shell')
    expect(h.repository.beginToolTierMutation).toHaveBeenCalledWith('locus-a', 11, {
      expectedGeneration: 2, expectedUpdatedAt: 10, expectedRevision: 4,
    })
    expect(h.row()).toMatchObject({ state: 'active', revision: 6, toolTier: { desired: 'shell', effective: 'shell' } })
  })

  it('records a released child\'s request as pending and keeps serving the old tier', async () => {
    const h = setup({ live: false })
    const result = await h.mutation.set({ locusId: 'locus-a', endpoint: { chatId: 'oc-a' }, tier: 'shell', actor: 'owner' })
    expect(result).toMatchObject({ ok: true, effective: 'safe', pending: true })
    expect(h.surface.setToolTier).not.toHaveBeenCalled()
    expect(h.row()).toMatchObject({ state: 'active', toolTier: { desired: 'shell', effective: 'safe' } })
  })

  it('refuses a running live child even when no Delivery is current', async () => {
    const h = setup({ idle: false })
    expect(await h.mutation.set({ locusId: 'locus-a', endpoint: { chatId: 'oc-a' }, tier: 'shell', actor: 'owner' }))
      .toEqual({ ok: false, reason: 'busy' })
    expect(h.surface.setToolTier).not.toHaveBeenCalled()
    expect(h.repository.commitToolTierMutation).not.toHaveBeenCalled()
    expect(h.repository.abortToolTierMutation).toHaveBeenCalledOnce()
    expect(h.row()).toMatchObject({ state: 'active', toolTier: { effective: 'safe' } })
  })

  it('safe-v1 入口请求 shell', async () => {
    for (const childComposition of ['safe-v1', 'safe-v2', undefined]) {
      const h = setup({ initial: { childComposition } })
      const result = await h.mutation.set({ locusId: 'locus-a', endpoint: { chatId: 'oc-a' }, tier: 'shell', actor: 'owner' })
      // Neither switched nor resumed: the old row is retired, not adopted.
      expect(result).toEqual({ ok: false, reason: 'legacy-composition' })
      expect(h.repository.beginToolTierMutation).not.toHaveBeenCalled()
      expect(h.surface.setToolTier).not.toHaveBeenCalled()
      expect(h.row()).toMatchObject({ state: 'active', toolTier: { desired: 'safe', effective: 'safe' } })
    }
  })

  it('核验失败回到 safe', async () => {
    const h = setup({ desiredAttests: false })
    const result = await h.mutation.set({ locusId: 'locus-a', endpoint: { chatId: 'oc-a' }, tier: 'shell', actor: 'owner' })
    // Never reported as success, and back on a verified `safe` surface.
    expect(result).toMatchObject({ ok: false, reason: 'verification-failed' })
    expect(h.surface.setToolTier).toHaveBeenNthCalledWith(2, 'safe')
    // The refused request is not kept as `desired`: a differing desired is the
    // pending marker and would re-apply on the next wake.
    expect(h.row()).toMatchObject({ state: 'active', toolTier: { desired: 'safe', effective: 'safe' } })
  })

  it('aborts the durable fence when live-surface discovery throws before mutation', async () => {
    const h = setup()
    h.repository.findLocus.mockImplementation(id => id === 'locus-a' ? h.row() : undefined)
    const portsMutation = createLocusToolTierMutation({
      repository: h.repository,
      live: { find: vi.fn(() => { throw new Error('live registry failed') }) },
      attest: () => true,
      now: () => 14,
    })
    const result = await portsMutation.set({ locusId: 'locus-a', endpoint: { chatId: 'oc-a' }, tier: 'shell', actor: 'owner' })
    expect(result).toEqual({ ok: false, reason: 'apply-failed' })
    expect(h.repository.abortToolTierMutation).toHaveBeenCalledOnce()
    expect(h.row().state).toBe('active')
  })

  it('invalidates rather than serving when rollback cannot be attested', async () => {
    const h = setup({ desiredAttests: false, safeAttests: false })
    const result = await h.mutation.set({ locusId: 'locus-a', endpoint: { chatId: 'oc-a' }, tier: 'shell', actor: 'owner' })
    expect(result).toMatchObject({ ok: false, reason: 'apply-failed' })
    expect(h.row()).toMatchObject({ state: 'invalid' })
    expect(h.repository.invalidateToolTierMutation).toHaveBeenCalledOnce()
  })

  it('restores and attests safe when durable commit of a live shell grant fails', async () => {
    const h = setup()
    h.repository.commitToolTierMutation.mockImplementationOnce(async () => { throw new Error('commit failed') })
    const result = await h.mutation.set({ locusId: 'locus-a', endpoint: { chatId: 'oc-a' }, tier: 'shell', actor: 'owner' })
    expect(result).toEqual({ ok: false, reason: 'apply-failed' })
    expect(h.surface.setToolTier).toHaveBeenNthCalledWith(1, 'shell')
    expect(h.surface.setToolTier).toHaveBeenNthCalledWith(2, 'safe')
    expect(h.row()).toMatchObject({ state: 'active', toolTier: { effective: 'safe', desired: 'safe' } })
  })

  it('serializes concurrent tier changes for one locus', async () => {
    const h = setup()
    const originalBegin = h.repository.beginToolTierMutation.getMockImplementation()!
    let entered!: () => void
    const enteredBegin = new Promise<void>(resolve => { entered = resolve })
    let release!: () => void
    const holdBegin = new Promise<void>(resolve => { release = resolve })
    h.repository.beginToolTierMutation.mockImplementationOnce(async (...args) => {
      const begun = await originalBegin(...args)
      entered()
      await holdBegin
      return begun
    })

    const shell = h.mutation.set({ locusId: 'locus-a', endpoint: { chatId: 'oc-a' }, tier: 'shell', actor: 'owner' })
    await enteredBegin
    const safe = h.mutation.set({ locusId: 'locus-a', endpoint: { chatId: 'oc-a' }, tier: 'safe', actor: 'owner' })
    expect(h.repository.beginToolTierMutation).toHaveBeenCalledOnce()

    release()
    await expect(shell).resolves.toMatchObject({ ok: true, effective: 'shell' })
    await expect(safe).resolves.toMatchObject({ ok: true, effective: 'safe' })
    expect(h.repository.beginToolTierMutation).toHaveBeenCalledTimes(2)
    expect(h.surface.setToolTier.mock.calls).toEqual([['shell'], ['safe']])
    expect(h.row()).toMatchObject({ state: 'active', toolTier: { desired: 'safe', effective: 'safe' } })
  })

  it('refuses busy, pending, stale, or non-current generations before mutation', async () => {
    const busy = setup({ pending: true })
    expect(await busy.mutation.set({ locusId: 'locus-a', endpoint: { chatId: 'oc-a' }, tier: 'shell', actor: 'owner' })).toEqual({ ok: false, reason: 'busy' })
    expect(busy.repository.beginToolTierMutation).not.toHaveBeenCalled()

    const stale = setup()
    expect(await stale.mutation.set({ locusId: 'locus-a', endpoint: { chatId: 'oc-other' }, tier: 'shell', actor: 'owner' })).toEqual({ ok: false, reason: 'not-found' })
    expect(stale.repository.beginToolTierMutation).not.toHaveBeenCalled()

    const moved = setup()
    moved.repository.findCurrentLocus.mockReturnValue(undefined)
    expect(await moved.mutation.set({ locusId: 'locus-a', endpoint: { chatId: 'oc-a' }, tier: 'shell', actor: 'owner' })).toEqual({ ok: false, reason: 'not-found' })
    expect(moved.repository.beginToolTierMutation).not.toHaveBeenCalled()
  })
})

describe('Locus tool tier scenarios on a resident child', () => {
  it('授予 shell 档', async () => {
    const h = setup()
    const before = { id: h.row().id, generation: h.row().generation, child: h.row().childSessionId }

    const result = await h.mutation.set({ locusId: 'locus-a', endpoint: { chatId: 'oc-a' }, tier: 'shell', actor: 'owner' })

    expect(result).toMatchObject({ ok: true, effective: 'shell' })
    expect(result).not.toHaveProperty('pending')
    // Same child, same generation: nothing was rebuilt.
    expect({ id: h.row().id, generation: h.row().generation, child: h.row().childSessionId }).toEqual(before)
    expect(h.row().toolTier).toMatchObject({ desired: 'shell', effective: 'shell', grantedBy: 'owner' })
    expect(h.surface.visibleTools()).toEqual(expect.arrayContaining(['bash', 'skill']))
    for (const delegation of ['subagent', 'subagent_fork', 'workflow', 'ralph', 'send_message']) {
      expect(h.surface.visibleTools()).not.toContain(delegation)
    }
  })

  it('撤回 shell 档', async () => {
    const h = setup({ initial: { toolTier: { desired: 'shell', effective: 'shell' } } })

    const result = await h.mutation.set({ locusId: 'locus-a', endpoint: { chatId: 'oc-a' }, tier: 'safe', actor: 'owner' })

    expect(result).toMatchObject({ ok: true, effective: 'safe' })
    expect(h.surface.setToolTier).toHaveBeenCalledWith('safe')
    expect(h.surface.visibleTools()).not.toContain('bash')
    expect(h.row().toolTier).toMatchObject({ desired: 'safe', effective: 'safe' })
  })

  it('冷恢复保持档位', async () => {
    const { composeLocusChild, LOCUS_SAFE_TOOL_NAMES, LOCUS_SHELL_TIER_TOOL_NAMES } =
      await import('../src/host/locus/composition.js')
    const { LOCUS_BASE_PRESET } = await import('../src/host/locus/preset.js')
    const h = setup()
    await h.mutation.set({ locusId: 'locus-a', endpoint: { chatId: 'oc-a' }, tier: 'shell', actor: 'owner' })
    const beforeRestart = [...h.surface.visibleTools()].sort()

    // The runtime released the child; the next wake publishes it again from the
    // persisted row alone.
    const persisted = h.row()
    let visible: readonly string[] = []
    const result = composeLocusChild({ id: 'child-a', scope: { get: () => ({}) } }, {
      lookup: {
        find: () => ({
          parentSessionId: 'main-locus',
          childSessionId: 'child-a',
          locusId: persisted.id,
          generation: persisted.generation,
          permission: 'read' as const,
          childComposition: 'tier3' as const,
          toolTier: { desired: persisted.toolTier!.desired, effective: persisted.toolTier!.effective },
        }),
      },
      parentPreset: () => LOCUS_BASE_PRESET,
      childPreset: () => 'locus-child',
      surface: {
        install: () => {},
        setToolTier: (_agent, tier) => {
          visible = tier === 'shell'
            ? [...LOCUS_SAFE_TOOL_NAMES, ...LOCUS_SHELL_TIER_TOOL_NAMES, 'pet_locus_finish']
            : [...LOCUS_SAFE_TOOL_NAMES, 'pet_locus_finish']
        },
        installOutboundGuard: () => {},
        visibleTools: () => visible,
      },
      policy: { apply: () => {}, resolve: () => 'read' },
    })

    expect(result).toMatchObject({ composed: true })
    expect(result).not.toHaveProperty('pending')
    expect([...visible].sort()).toEqual(beforeRestart)
  })
})
