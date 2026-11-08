import { describe, expect, it, vi } from 'vitest'
import {
  createLocusResolution,
  LocusResolutionError,
  type LocusResolutionRefusal,
} from '../src/host/locus/resolution.js'
import type { LocusGroupRowV20, LocusRowV20, LocusTopicRowV20 } from '../src/host/locus/contract-v20.js'

const ENDPOINT = { chatId: 'oc-project' } as const

function group(overrides: Partial<LocusGroupRowV20> = {}): LocusGroupRowV20 {
  return {
    endpoint: ENDPOINT, locusId: 'locus-1', sessionId: 'child-1', state: 'active', accessMode: 'read-only',
    revision: 2, createdAt: 1, updatedAt: 1, locusMainSessionId: 'main-1', workspaceId: 'ws-1', ...overrides,
  }
}
function topic(overrides: Partial<LocusTopicRowV20> = {}): LocusTopicRowV20 {
  return {
    endpoint: { chatId: 'oc-project', threadId: 't1' }, locusId: 'locus-t1', sessionId: 'child-t1', state: 'active',
    accessMode: 'read-only', revision: 1, createdAt: 1, updatedAt: 1, ...overrides,
  }
}

function resolution(options: {
  readonly rows?: readonly LocusRowV20[]
  readonly throws?: unknown
  readonly provisioning?: Parameters<typeof createLocusResolution>[0]['provisioning']
  readonly archived?: readonly string[]
  readonly archivedThrows?: boolean
  readonly mainUsable?: boolean
  readonly mainStatus?: 'active' | 'retired'
  readonly debt?: boolean
} = {}) {
  const diagnostics: LocusResolutionRefusal[] = []
  const rows = options.rows ?? []
  const port = createLocusResolution({
    mains: { find: () => ({ workSessionId: 'work-1', status: options.mainStatus ?? 'active' }) },
    verifyMain: () => options.mainUsable ?? true,
    store: {
      getRow: endpoint => {
        if (options.throws !== undefined) throw options.throws
        return rows.find(row => row.endpoint.chatId === endpoint.chatId && (row.endpoint as { threadId?: string }).threadId === endpoint.threadId)
      },
      hasFirstDeliveryRecoveryDebt: () => options.debt === true,
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
const ensure = (port: ReturnType<typeof resolution>['port'], endpoint: { chatId: string; threadId?: string } = ENDPOINT) =>
  port.ensureForDelivery({ endpoint, messageId: 'm', signal })

describe('durable locus resolution', () => {
  it('serves an active group row with the v20 shape', () => {
    const { port } = resolution({ rows: [group()] })
    expect(port.resolveCurrent(ENDPOINT)).toEqual({
      locusId: 'locus-1', endpoint: ENDPOINT, sessionId: 'child-1', state: 'active', accessMode: 'read-only',
      revision: 2, locusMainSessionId: 'main-1', workSessionId: 'work-1', workspaceId: 'ws-1',
    })
  })

  it('a topic row takes its M and workspace from the group row', () => {
    const { port } = resolution({ rows: [group(), topic()] })
    expect(port.resolveCurrent({ chatId: 'oc-project', threadId: 't1' })).toMatchObject({
      locusId: 'locus-t1', sessionId: 'child-t1', locusMainSessionId: 'main-1', workspaceId: 'ws-1',
    })
  })

  it('serves a not-created row with its reserved sessionId', () => {
    const { port } = resolution({ rows: [group({ state: 'not-created', sessionId: 'reserved-1' })] })
    expect(port.resolveCurrent(ENDPOINT)).toMatchObject({ state: 'not-created', sessionId: 'reserved-1' })
  })

  it('reports an endpoint that never had a locus as absent, not refused', () => {
    expect(resolution().port.resolveCurrent(ENDPOINT)).toBeUndefined()
  })

  it('refuses a stopped endpoint instead of treating it as never established', () => {
    const { port, diagnostics } = resolution({ rows: [group({ state: 'stopped', stoppedAt: 1 })] })
    expect(() => port.resolveCurrent(ENDPOINT)).toThrowError(expect.objectContaining({ reason: 'endpoint-stopped' }))
    expect(diagnostics).toEqual(['endpoint-stopped'])
  })

  it('refuses an invalid row', () => {
    const { port } = resolution({ rows: [group({ state: 'invalid', invalidReason: '子会话已不存在' })] })
    expect(() => port.resolveCurrent(ENDPOINT)).toThrowError(expect.objectContaining({ reason: 'endpoint-invalid' }))
  })

  it('refuses a topic row whose group row is missing as unusable data', () => {
    const { port } = resolution({ rows: [topic()] })
    expect(() => port.resolveCurrent({ chatId: 'oc-project', threadId: 't1' })).toThrowError(expect.objectContaining({ reason: 'locus-unusable' }))
  })

  it('refuses while first-creation recovery debt blocks the row', () => {
    const { port } = resolution({ rows: [group()], debt: true })
    expect(() => port.resolveCurrent(ENDPOINT)).toThrowError(expect.objectContaining({ reason: 'locus-unusable' }))
  })

  it('propagates an unexpected store failure unchanged', () => {
    const boom = new Error('disk')
    const { port } = resolution({ throws: boom })
    expect(() => port.resolveCurrent(ENDPOINT)).toThrow(boom)
  })
})

describe('establishing a locus for a new endpoint', () => {
  it('returns the existing row without provisioning again', async () => {
    const ensureForDelivery = vi.fn()
    const { port } = resolution({ rows: [group()], provisioning: { ensureForDelivery } })
    await expect(ensure(port)).resolves.toMatchObject({ locusId: 'locus-1' })
    expect(ensureForDelivery).not.toHaveBeenCalled()
  })

  it('reports unavailable rather than auto-creating without a provisioning seam', async () => {
    await expect(ensure(resolution().port)).rejects.toMatchObject({ reason: 'provisioning-unavailable' })
  })

  it('never establishes a replacement for a stopped endpoint', async () => {
    const ensureForDelivery = vi.fn()
    const { port } = resolution({ rows: [group({ state: 'stopped', stoppedAt: 1 })], provisioning: { ensureForDelivery } })
    await expect(ensure(port)).rejects.toMatchObject({ reason: 'endpoint-stopped' })
    expect(ensureForDelivery).not.toHaveBeenCalled()
  })

  it('delegates an invalid row to provisioning (in-place rebuild) and returns the rebuilt row', async () => {
    const rebuilt = { locusId: 'locus-1', endpoint: ENDPOINT, sessionId: 'new', state: 'not-created' as const, accessMode: 'read-only' as const, revision: 3, locusMainSessionId: 'main-1', workSessionId: 'work-1', workspaceId: 'ws-1' }
    const ensureForDelivery = vi.fn(async () => rebuilt)
    const { port } = resolution({ rows: [group({ state: 'invalid', invalidReason: 'gone' })], provisioning: { ensureForDelivery } })
    await expect(ensure(port)).resolves.toEqual(rebuilt)
    expect(ensureForDelivery).toHaveBeenCalledTimes(1)
  })

  it('an unusable M delegates to provisioning (whole-W migration) instead of serving the row', async () => {
    const ensureForDelivery = vi.fn(async () => ({ locusId: 'locus-1', endpoint: ENDPOINT, sessionId: 'reset', state: 'not-created' as const, accessMode: 'read-only' as const, revision: 3, locusMainSessionId: 'main-2', workSessionId: 'work-1', workspaceId: 'ws-1' }))
    const { port } = resolution({ rows: [group()], mainUsable: false, provisioning: { ensureForDelivery } })
    await expect(ensure(port)).resolves.toMatchObject({ locusMainSessionId: 'main-2' })
  })

  it('rejects a provisioned row that could not serve a delivery', async () => {
    const { port } = resolution({ provisioning: { ensureForDelivery: async () => ({ locusId: '', endpoint: ENDPOINT, sessionId: 's', state: 'active' as const, accessMode: 'read-only' as const, revision: 0, locusMainSessionId: 'm', workSessionId: 'w', workspaceId: 'x' }) } })
    await expect(ensure(port)).rejects.toMatchObject({ reason: 'locus-unusable' })
  })

  it('propagates a provisioning failure so nothing is published', async () => {
    const failure = new Error('lark down')
    const { port } = resolution({ provisioning: { ensureForDelivery: async () => { throw failure } } })
    await expect(ensure(port)).rejects.toBe(failure)
  })

  it('has no retirement refusal any more: a never-seen endpoint is established normally', async () => {
    const established = { locusId: 'l', endpoint: ENDPOINT, sessionId: 's', state: 'not-created' as const, accessMode: 'read-only' as const, revision: 0, locusMainSessionId: 'm', workSessionId: 'w', workspaceId: 'x' }
    const { port } = resolution({ provisioning: { ensureForDelivery: async () => established } })
    await expect(ensure(port)).resolves.toEqual(established)
  })
})

describe('an archived work session stops the endpoint', () => {
  it('refuses the row with the rebind reason and does not rewrite state', () => {
    const { port, diagnostics } = resolution({ rows: [group()], archived: ['work-1'] })
    let caught: unknown
    try { port.resolveCurrent(ENDPOINT) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(LocusResolutionError)
    expect((caught as LocusResolutionError).reason).toBe('source-archived')
    expect((caught as LocusResolutionError).message).toContain('改绑')
    expect(diagnostics).toEqual(['source-archived'])
  })

  it('does not auto-replace it, even though `invalid` alone would be replaceable', async () => {
    const ensureForDelivery = vi.fn()
    const { port } = resolution({ rows: [group({ state: 'invalid', invalidReason: 'x' })], archived: ['work-1'], provisioning: { ensureForDelivery } })
    await expect(ensure(port)).rejects.toMatchObject({ reason: 'source-archived' })
    expect(ensureForDelivery).not.toHaveBeenCalled()
  })

  it('does not migrate an archived W with an unusable M', async () => {
    const ensureForDelivery = vi.fn()
    const { port } = resolution({ rows: [group()], archived: ['work-1'], mainUsable: false, provisioning: { ensureForDelivery } })
    await expect(ensure(port)).rejects.toMatchObject({ reason: 'source-archived' })
    expect(ensureForDelivery).not.toHaveBeenCalled()
  })

  it('serves normally once the session is restored', () => {
    expect(resolution({ rows: [group()], archived: [] }).port.resolveCurrent(ENDPOINT)).toMatchObject({ state: 'active' })
  })

  it('never turns an unreadable archive probe into a refusal', () => {
    expect(resolution({ rows: [group()], archivedThrows: true }).port.resolveCurrent(ENDPOINT)).toMatchObject({ state: 'active' })
  })
})
