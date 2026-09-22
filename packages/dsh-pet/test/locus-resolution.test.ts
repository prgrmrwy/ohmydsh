import { describe, expect, it, vi } from 'vitest'
import {
  createLocusResolution,
  LocusResolutionError,
  type LocusResolutionRefusal,
} from '../src/host/locus/resolution.js'
import { LocusError, type LocusRecord } from '../src/host/locus/aggregate.js'

const ENDPOINT = { chatId: 'oc-project' } as const

function record(overrides: Partial<LocusRecord> = {}): LocusRecord {
  return {
    id: 'locus-1',
    generation: 2,
    endpoint: ENDPOINT,
    parentSessionId: 'main-1',
    childSessionId: 'child-1',
    childComposition: 'safe-v1',
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

function resolution(options: {
  readonly current?: LocusRecord | undefined
  readonly throws?: unknown
  readonly provisioning?: Parameters<typeof createLocusResolution>[0]['provisioning']
  readonly archived?: readonly string[]
  readonly archivedThrows?: boolean
} = {}) {
  const diagnostics: LocusResolutionRefusal[] = []
  const port = createLocusResolution({
    store: {
      getCurrentLocus: () => {
        if (options.throws !== undefined) throw options.throws
        return options.current
      },
    },
    ...(options.provisioning === undefined ? {} : { provisioning: options.provisioning }),
    isSessionArchived: id => {
      if (options.archivedThrows === true) throw new Error('registry unavailable')
      return (options.archived ?? []).includes(id)
    },
    log: reason => { diagnostics.push(reason) },
  })
  return { port, diagnostics }
}

const signal = new AbortController().signal

describe('durable locus resolution', () => {
  it('serves the endpoint current active generation', () => {
    const { port } = resolution({ current: record() })

    expect(port.resolveCurrent(ENDPOINT)).toEqual({
      id: 'locus-1',
      endpoint: ENDPOINT,
      generation: 2,
      parentSessionId: 'main-1',
      childSessionId: 'child-1',
      childComposition: 'safe-v1',
      workspaceId: 'ws-1',
      state: 'active',
      permission: { desired: 'read', effective: 'read', verifiedAt: 1 },
    })
  })

  it('refuses a legacy active row without durable safe composition proof', () => {
    const { port, diagnostics } = resolution({
      current: record({ childComposition: undefined }),
    })

    expect(() => port.resolveCurrent(ENDPOINT)).toThrow(/safe-v1/)
    expect(diagnostics).toEqual(['locus-unusable'])
  })

  it('reports an endpoint that never had a locus as absent, not refused', () => {
    const { port, diagnostics } = resolution({ current: undefined })

    expect(port.resolveCurrent(ENDPOINT)).toBeUndefined()
    expect(diagnostics).toEqual([])
  })

  it('refuses a stopped endpoint instead of treating it as never established', () => {
    // Reporting "no locus" here would let the caller establish a replacement
    // and silently bypass the owner's explicit stop.
    const { port, diagnostics } = resolution({ current: record({ state: 'stopped', stoppedAt: 5 }) })

    expect(() => port.resolveCurrent(ENDPOINT)).toThrow(LocusResolutionError)
    expect(diagnostics).toEqual(['endpoint-stopped'])
  })

  it('refuses an invalid generation and surfaces its stored reason', () => {
    const { port } = resolution({
      current: record({ state: 'invalid', invalidReason: '主会话已归档' }),
    })

    try {
      port.resolveCurrent(ENDPOINT)
      expect.unreachable('an invalid locus cannot serve work')
    } catch (error) {
      expect((error as LocusResolutionError).reason).toBe('endpoint-invalid')
      expect((error as Error).message).toContain('主会话已归档')
    }
  })

  it.each(['provisioning', 'switching', 'retired'] as const)(
    'refuses a %s generation rather than serving a partial identity',
    state => {
      const { port, diagnostics } = resolution({ current: record({ state }) })

      expect(() => port.resolveCurrent(ENDPOINT)).toThrow(LocusResolutionError)
      expect(diagnostics.at(-1)).toBe(state === 'retired' ? 'locus-unusable' : 'locus-unusable')
    },
  )

  it('refuses an active row that has no child session', () => {
    // Queueing work against a locus with no child would accept a message
    // nothing can execute.
    const { port, diagnostics } = resolution({
      current: record({ childSessionId: undefined as never }),
    })

    expect(() => port.resolveCurrent(ENDPOINT)).toThrow(LocusResolutionError)
    expect(diagnostics).toEqual(['locus-unusable'])
  })

  it('treats a malformed endpoint index as unusable, never as absent', () => {
    const { port, diagnostics } = resolution({
      throws: new LocusError('INVALID_LOCUS', 'Endpoint index is malformed or ambiguous'),
    })

    // Serving the endpoint anyway could route to the wrong generation.
    expect(() => port.resolveCurrent(ENDPOINT)).toThrow(/malformed or ambiguous/)
    expect(diagnostics).toEqual(['locus-unusable'])
  })

  it('propagates an unexpected store failure unchanged', () => {
    const boom = new TypeError('store exploded')
    const { port } = resolution({ throws: boom })

    expect(() => port.resolveCurrent(ENDPOINT)).toThrow(boom)
  })
})

describe('establishing a locus for a new endpoint', () => {
  it('returns the existing generation without provisioning again', async () => {
    const ensure = vi.fn()
    const { port } = resolution({
      current: record(),
      provisioning: { ensureForDelivery: ensure },
    })

    await expect(port.ensureForDelivery({ endpoint: ENDPOINT, messageId: 'om-1', signal }))
      .resolves.toMatchObject({ id: 'locus-1' })
    expect(ensure).not.toHaveBeenCalled()
  })

  it('reports unavailable rather than auto-creating without a provisioning seam', async () => {
    const { port, diagnostics } = resolution({ current: undefined })

    await expect(port.ensureForDelivery({ endpoint: ENDPOINT, messageId: 'om-1', signal }))
      .rejects.toMatchObject({ reason: 'provisioning-unavailable' })
    expect(diagnostics).toEqual(['provisioning-unavailable'])
  })

  it('never establishes a replacement for a stopped endpoint', async () => {
    const ensure = vi.fn()
    const { port } = resolution({
      current: record({ state: 'stopped' }),
      provisioning: { ensureForDelivery: ensure },
    })

    await expect(port.ensureForDelivery({ endpoint: ENDPOINT, messageId: 'om-1', signal }))
      .rejects.toMatchObject({ reason: 'endpoint-stopped' })
    // The stop marker is authoritative: provisioning must not be consulted.
    expect(ensure).not.toHaveBeenCalled()
  })

  // A generation the HOST invalidated carries no owner decision, so the
  // "never silently replace an explicit exit" rule does not apply to it.
  // Refusing here is what left both machines' bots silent: admission admitted
  // the mention, the channel controller accepted it, and THIS layer answered
  // "must be rebuilt" — an instruction no ordinary member can act on, and one
  // the panel can only attempt against the same recorded parent, which may
  // itself be archived.
  it('replaces a Host-invalidated generation instead of reporting it unrebuildable', async () => {
    const established = {
      id: 'locus-recovered',
      endpoint: ENDPOINT,
      generation: 3,
      parentSessionId: 'main-1',
      childSessionId: 'child-recovered',
      childComposition: 'safe-v1' as const,
      workspaceId: 'ws-1',
      state: 'active' as const,
    }
    const ensure = vi.fn(async () => established)
    const { port } = resolution({
      current: record({ state: 'invalid', invalidReason: '子会话在运行时中已不存在' }),
      provisioning: { ensureForDelivery: ensure },
    })

    await expect(port.ensureForDelivery({ endpoint: ENDPOINT, messageId: 'om-1', signal }))
      .resolves.toEqual(established)
    expect(ensure).toHaveBeenCalledOnce()
  })

  // Replacing it must never mean serving it: the invalid row's child lacks the
  // safe-v1 composition proof, so adopting or cold-resuming it would inherit
  // the parent preset. Only a freshly created generation is ever published,
  // and the read path keeps refusing the old one.
  it('never serves the invalid generation itself, only its replacement', async () => {
    const { port } = resolution({
      current: record({ state: 'invalid', invalidReason: '缺少 safe-v1 证明' }),
      provisioning: { ensureForDelivery: async () => { throw new Error('unused') } },
    })

    expect(() => port.resolveCurrent(ENDPOINT)).toThrow(LocusResolutionError)
    expect(() => port.resolveCurrent(ENDPOINT)).toThrow(/invalid/)
  })

  it('delegates establishment and accepts a complete active locus', async () => {
    const established = {
      id: 'locus-new',
      endpoint: ENDPOINT,
      generation: 1,
      parentSessionId: 'main-new',
      childSessionId: 'child-new',
      childComposition: 'safe-v1' as const,
      workspaceId: 'ws-new',
      state: 'active' as const,
    }
    const ensure = vi.fn(async () => established)
    const { port } = resolution({ current: undefined, provisioning: { ensureForDelivery: ensure } })

    await expect(port.ensureForDelivery({ endpoint: ENDPOINT, messageId: 'om-1', signal }))
      .resolves.toEqual(established)
    expect(ensure).toHaveBeenCalledWith({ endpoint: ENDPOINT, messageId: 'om-1', signal })
  })

  it('rejects a provisioned locus that could not serve a delivery', async () => {
    const cases = [
      { state: 'provisioning' as const, childSessionId: 'child-new' },
      { state: 'active' as const, childSessionId: '   ' },
      { state: 'active' as const, childSessionId: 'child-new', parentSessionId: '' },
      { state: 'active' as const, childSessionId: 'child-new', id: '' },
    ]
    for (const partial of cases) {
      const { port } = resolution({
        current: undefined,
        provisioning: {
          ensureForDelivery: async () => ({
            id: 'locus-new',
            endpoint: ENDPOINT,
            generation: 1,
            parentSessionId: 'main-new',
            workspaceId: 'ws-new',
            ...partial,
          } as never),
        },
      })

      // A provisioning adapter is not trusted blindly: a half-published row
      // must not reach the delivery path.
      await expect(port.ensureForDelivery({ endpoint: ENDPOINT, messageId: 'om-1', signal }))
        .rejects.toMatchObject({ reason: 'locus-unusable' })
    }
  })

  it('refuses a retired endpoint before consulting provisioning', async () => {
    const ensure = vi.fn()
    const diagnostics: LocusResolutionRefusal[] = []
    const port = createLocusResolution({
      store: { getCurrentLocus: () => undefined },
      retired: { find: () => ({ endpoint: ENDPOINT, form: 'qa' }) },
      provisioning: { ensureForDelivery: ensure },
      log: reason => { diagnostics.push(reason) },
    })

    // The old group must not be taken over under a new default identity just
    // because the unified store has no row for it yet.
    await expect(port.ensureForDelivery({ endpoint: ENDPOINT, messageId: 'om-1', signal }))
      .rejects.toMatchObject({ reason: 'retired-endpoint' })
    expect(ensure).not.toHaveBeenCalled()
    expect(diagnostics).toEqual(['retired-endpoint'])
  })

  it('refuses when retirement cannot be proven', async () => {
    const ensure = vi.fn()
    const port = createLocusResolution({
      store: { getCurrentLocus: () => undefined },
      retired: { find: () => { throw new Error('legacy table unreadable') } },
      provisioning: { ensureForDelivery: ensure },
    })

    await expect(port.ensureForDelivery({ endpoint: ENDPOINT, messageId: 'om-1', signal }))
      .rejects.toMatchObject({ reason: 'retirement-unproven' })
    expect(ensure).not.toHaveBeenCalled()
  })

  it('establishes normally for an endpoint no model ever bound', async () => {
    const established = {
      id: 'locus-new',
      endpoint: ENDPOINT,
      generation: 1,
      parentSessionId: 'main-new',
      childSessionId: 'child-new',
      childComposition: 'safe-v1' as const,
      workspaceId: 'ws-new',
      state: 'active' as const,
    }
    const port = createLocusResolution({
      store: { getCurrentLocus: () => undefined },
      retired: { find: () => undefined },
      provisioning: { ensureForDelivery: async () => established },
    })

    await expect(port.ensureForDelivery({ endpoint: ENDPOINT, messageId: 'om-1', signal }))
      .resolves.toEqual(established)
  })

  it('propagates a provisioning failure so nothing is published', async () => {
    const failure = new Error('group creation failed')
    const { port } = resolution({
      current: undefined,
      provisioning: { ensureForDelivery: async () => { throw failure } },
    })

    await expect(port.ensureForDelivery({ endpoint: ENDPOINT, messageId: 'om-1', signal }))
      .rejects.toThrow(failure)
  })
})

/**
 * An archived main session is an OWNER action that no layer of the runtime
 * enforces: `dsh-agent` and the session controller both resume an archived
 * session, so a delivery that only asked "can I reach the parent?" would revive
 * it and keep serving. These hold the two halves that matter — the entry stops,
 * and it does not quietly come back on a main session the owner never chose.
 */
describe('an archived main session stops the endpoint', () => {
  it('refuses the current generation with the rebuild reason, not a Host fault', () => {
    const { port, diagnostics } = resolution({
      current: record({ state: 'active' }),
      archived: ['main-1'],
    })

    // `retired-endpoint` is what the channel renders as "this entry needs an
    // explicit rebuild". Reporting a generic unusable reason would send the
    // owner looking for a Host fault that does not exist.
    expect(() => port.resolveCurrent(ENDPOINT)).toThrowError(
      expect.objectContaining({ reason: 'retired-endpoint' }),
    )
    expect(diagnostics).toContain('retired-endpoint')
  })

  it('does not auto-replace it, even though `invalid` alone would be replaceable', async () => {
    const ensureForDelivery = vi.fn(async () => { throw new Error('must not provision') })
    const { port } = resolution({
      current: record({ state: 'invalid', invalidReason: 'child re-attach failed' }),
      archived: ['main-1'],
      provisioning: { ensureForDelivery },
    })

    await expect(port.ensureForDelivery({
      endpoint: ENDPOINT, messageId: 'om-1', signal,
    })).rejects.toThrowError()
    // The whole point: an ordinary mention must NOT establish a generation on a
    // main session the owner never chose. That switch belongs to the owner.
    expect(ensureForDelivery).not.toHaveBeenCalled()
  })

  it('still replaces a Host-judged generation whose parent is NOT archived', async () => {
    const ensureForDelivery = vi.fn(async () => ({
      id: 'locus-2', generation: 3, endpoint: ENDPOINT, parentSessionId: 'main-1',
      childSessionId: 'child-2', childComposition: 'safe-v1', workspaceId: 'ws-1',
      source: 'auto', state: 'active',
      permission: { desired: 'read', effective: 'read', verifiedAt: 1 },
      busy: false, createdAt: 2, updatedAt: 2,
    } as LocusRecord))
    const { port } = resolution({
      current: record({ state: 'invalid', invalidReason: 'child re-attach failed' }),
      archived: [],
      provisioning: { ensureForDelivery },
    })

    await expect(port.ensureForDelivery({
      endpoint: ENDPOINT, messageId: 'om-1', signal,
    })).resolves.toMatchObject({ id: 'locus-2', state: 'active' })
    expect(ensureForDelivery).toHaveBeenCalledOnce()
  })

  it('serves normally once the session is restored', () => {
    // Read from the live archive set, never persisted onto the record, so
    // restoring the session restores service with no rebuild in between.
    const { port } = resolution({ current: record({ state: 'active' }), archived: [] })
    expect(port.resolveCurrent(ENDPOINT)).toMatchObject({ id: 'locus-1', state: 'active' })
  })

  it('never turns an unreadable archive probe into a refusal', () => {
    const { port } = resolution({ current: record({ state: 'active' }), archivedThrows: true })
    expect(port.resolveCurrent(ENDPOINT)).toMatchObject({ id: 'locus-1', state: 'active' })
  })
})
