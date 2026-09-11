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
      workspaceId: 'ws-1',
      state: 'active',
      permission: { desired: 'read', effective: 'read', verifiedAt: 1 },
    })
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

  it('delegates establishment and accepts a complete active locus', async () => {
    const established = {
      id: 'locus-new',
      endpoint: ENDPOINT,
      generation: 1,
      parentSessionId: 'main-new',
      childSessionId: 'child-new',
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
