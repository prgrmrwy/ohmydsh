import { describe, expect, it, vi } from 'vitest'
import { buildLocusRecord, type LocusRecord } from '../src/host/locus/aggregate.js'
import {
  createLocusManagementPort,
  createLocusSessionDescriber,
  LocusManagementError,
  type LocusManagementRepository,
} from '../src/host/locus/management.js'
import type { PetLocusActionRequest } from '../src/wire.js'

function record(overrides: Partial<LocusRecord> = {}): LocusRecord {
  return buildLocusRecord({
    id: 'locus-group',
    endpoint: { chatId: 'oc-project' },
    parentSessionId: 'main-1',
    childSessionId: 'child-1',
    workspaceId: 'workspace-1',
    source: 'auto',
    createdAt: 10,
    updatedAt: 10,
    ...overrides,
  })
}

function memory(initial: readonly LocusRecord[]): LocusManagementRepository & {
  records: LocusRecord[]
  stopped: string[]
  modes: string[]
  pending: Set<string>
  anchors: string[]
} {
  const state = {
    records: [...initial], stopped: [] as string[], modes: [] as string[], anchors: [] as string[], pending: new Set<string>(),
  }
  return {
    ...state,
    listLoci: () => state.records,
    getCurrent: endpoint => state.records.find(item => item.state !== 'retired' && JSON.stringify(item.endpoint) === JSON.stringify(endpoint)),
    listByParent: parent => state.records.filter(item => item.parentSessionId === parent),
    getByChild: child => state.records.find(item => item.childSessionId === child),
    getDefaultQa: parent => state.records.find(item => item.parentSessionId === parent && item.source === 'qa-created'),
    hasPendingDeliveries: id => state.pending.has(id),
    transitionLocus: async (id, stateName, now) => {
      const previous = state.records.find(item => item.id === id)
      if (previous === undefined) throw new Error('LOCUS_NOT_FOUND')
      const next = { ...previous, state: stateName, busy: false, updatedAt: now ?? 0, stoppedAt: stateName === 'stopped' ? now ?? 0 : previous.stoppedAt }
      state.records = state.records.map(item => item.id === id ? next : item)
      state.stopped.push(id)
      return next
    },
    confirmContextAnchor: async (id, anchor, actor, now) => {
      const previous = state.records.find(item => item.id === id)
      if (previous === undefined) throw new Error('LOCUS_NOT_FOUND')
      const next = {
        ...previous,
        contextAnchor: { ...anchor, authorization: 'unknown' as const, provenance: `owner:${actor}`, confirmedAt: now },
        updatedAt: now ?? 0,
      }
      state.records = state.records.map(item => item.id === id ? next : item)
      state.anchors.push(id)
      return next
    },
    setLocusMode: async (id, mode, _actor, verifiedAt) => {
      const previous = state.records.find(item => item.id === id)
      if (previous === undefined) throw new Error('LOCUS_NOT_FOUND')
      if (previous.state !== 'active') throw Object.assign(new Error('stopped'), { code: 'LOCUS_INVALID' })
      const next = { ...previous, permission: { desired: mode, effective: mode, verifiedAt }, updatedAt: verifiedAt ?? 0 }
      state.records = state.records.map(item => item.id === id ? next : item)
      state.modes.push(`${id}:${mode}`)
      return next
    },
  }
}

describe('locus management projection adapter', () => {
  it('projects owner view and all three reverse discovery indexes', async () => {
    const repository = memory([
      record({ contextAnchor: { status: 'confirmed', executionRoot: '/repo', constraints: ['read'], provenance: 'test', confirmedAt: 11 } }),
      record({
        id: 'locus-topic',
        endpoint: { chatId: 'oc-project', threadId: 'omt-topic' },
        childSessionId: 'child-topic',
        parentLocusId: 'locus-group',
        source: 'inherited',
        generation: 1,
      }),
    ])
    const port = createLocusManagementPort({ repository, generation: () => 7 })
    const view = await port.view()

    expect(view.generation).toBe(7)
    expect(view.loci.map(item => item.locusId)).toEqual(['locus-group', 'locus-topic'])
    expect(view.discovery.byEndpoint).toHaveLength(2)
    expect(view.discovery.byParent[0]?.loci).toHaveLength(2)
    expect(view.discovery.byChild.find(item => item.childSessionId === 'child-topic')?.locus?.locusId).toBe('locus-topic')
    expect(view.loci[0]?.main.sessionId).toBe('main-1')
    expect(view.loci[0]?.permission.effective).toBe('read')
    expect(view.loci[0]?.contextAnchor).toEqual({
      status: 'confirmed',
      executionRoot: '/repo',
      constraints: ['read'],
      provenance: 'test',
      confirmedAt: 11,
    })
  })

  it('scopes discovery to exactly the requested reverse index', async () => {
    const repository = memory([record()])
    const port = createLocusManagementPort({ repository })
    await expect(port.discovery({ parentSessionId: 'main-1' })).resolves.toMatchObject({
      byEndpoint: [],
      byParent: [{ parentSessionId: 'main-1' }],
      byChild: [],
    })
    await expect(port.discovery({ endpoint: { chatId: 'oc-project' } })).resolves.toMatchObject({
      byEndpoint: [{ endpoint: { chatId: 'oc-project' } }],
      byParent: [],
      byChild: [],
    })
    await expect(port.discovery({})).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('fails unavailable bind/rebuild/default-Q&A actions without legacy fallback', async () => {
    const port = createLocusManagementPort({ repository: memory([record()]) })
    const request = {
      action: 'bind', endpoint: { chatId: 'oc-other' }, parentSessionId: 'main-1',
    } as PetLocusActionRequest
    await expect(port.action?.(request, { actorId: 'owner' })).rejects.toMatchObject({ code: 'ACTION_UNAVAILABLE' })
    expect(port.defaultQa).toBeUndefined()
  })

  it('rejects scope changes when Host identity is unavailable', async () => {
    const repository = memory([record()])
    const port = createLocusManagementPort({ repository, verifyWrite: () => ({ verifiedAt: 22 }) })
    await expect(port.scope!({ action: 'scope', locusId: 'locus-group', mode: 'read' }, { actorId: 'owner' }))
      .rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
    expect(repository.modes).toEqual([])
  })

  it('keeps a stop marker for panel archive and explicit stop without external actions', async () => {
    const repository = memory([record()])
    repository.stopLocus = async (id, now) => repository.transitionLocus!(id, 'stopped', now)
    const port = createLocusManagementPort({
      repository,
      identity: () => ({ actorId: 'owner' }),
      now: () => 20,
    })
    const archived = await port.archive!({
      action: 'archive',
      endpoint: { chatId: 'oc-project' },
      locusId: 'locus-group',
      expectedGeneration: 1,
      expectedUpdatedAt: 10,
    }, { actorId: 'owner' })
    expect(archived.locus.state.state).toBe('stopped')

    const stoppable = memory([record({ id: 'locus-stop' })])
    stoppable.stopLocus = async (id, now) => stoppable.transitionLocus!(id, 'stopped', now)
    const stopPort = createLocusManagementPort({
      repository: stoppable,
      identity: () => ({ actorId: 'owner' }),
      now: () => 20,
    })
    const stopped = await stopPort.stop!({
      action: 'stop',
      endpoint: { chatId: 'oc-project' },
      locusId: 'locus-stop',
      expectedGeneration: 1,
      expectedUpdatedAt: 10,
    }, { actorId: 'owner' })
    expect(stopped.locus.state.state).toBe('stopped')
  })

  it('confirms anchors only for the caller-bound current locus and never grants authority', async () => {
    const repository = memory([record()])
    const port = createLocusManagementPort({
      repository,
      identity: () => ({ actorId: 'owner-1' }),
      now: () => 30,
    })
    const result = await port.action!({
      action: 'confirm-anchor',
      locusId: 'locus-group',
      endpoint: { chatId: 'oc-project' },
      executionRoot: '/repo/.worktrees/feature',
      projectResources: ['https://example.test/prd'],
      constraints: ['no new worktree'],
      existence: 'exists',
      expectedGeneration: 1,
    }, { actorId: 'owner-1' })
    expect(result.locus.contextAnchor).toEqual({
      status: 'confirmed', existence: 'exists', authorization: 'unknown',
      executionRoot: '/repo/.worktrees/feature', projectResources: ['https://example.test/prd'],
      constraints: ['no new worktree'], provenance: 'owner:owner-1', confirmedAt: 30,
    })
    expect(result.locus.permission.effective).toBe('read')
    expect(repository.anchors).toEqual(['locus-group'])

    await expect(port.action!({
      action: 'confirm-anchor', locusId: 'locus-group', endpoint: { chatId: 'oc-other' }, executionRoot: '/tmp/attacker',
    }, { actorId: 'owner-1' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('supports durable unbind and host-verified write scope only', async () => {
    const repository = memory([record()])
    const port = createLocusManagementPort({
      repository,
      now: () => 20,
      identity: () => ({ actorId: 'owner' }),
      verifyWrite: () => ({ verifiedAt: 21 }),
    })
    const unbound = await port.unbind!({ action: 'unbind', endpoint: { chatId: 'oc-project' }, locusId: 'locus-group', expectedGeneration: 1 }, { actorId: 'owner' })
    expect(unbound.locus.state.state).toBe('stopped')
    await expect(port.scope!({ action: 'scope', locusId: 'locus-group', mode: 'write' }, { actorId: 'owner' })).rejects.toMatchObject({ code: 'LOCUS_INVALID' })

    const activeRepository = memory([record()])
    const activePort = createLocusManagementPort({
      repository: activeRepository,
      identity: () => ({ actorId: 'owner' }),
      verifyWrite: () => ({ verifiedAt: 22 }),
    })
    const scoped = await activePort.scope!({ action: 'scope', locusId: 'locus-group', mode: 'write' }, { actorId: 'owner' })
    expect(scoped.locus.permission.effective).toBe('write')
  })

  it('routes both read and write management changes through the shared policy mutation', async () => {
    const repository = memory([record()])
    const calls: Array<{ locusId: string; actorId: string; mode: string }> = []
    const port = createLocusManagementPort({
      repository,
      identity: () => ({ actorId: 'owner' }),
      permissionMutation: {
        mutate: async request => {
          calls.push(request)
          const current = repository.records[0]!
          const next = {
            ...current,
            permission: {
              desired: request.mode,
              effective: request.mode,
              verifiedAt: 30,
              grantedBy: request.actorId,
            },
            updatedAt: 30,
          }
          repository.records = [next]
          return next
        },
      },
    })

    await port.scope!({ action: 'scope', locusId: 'locus-group', mode: 'write' }, { actorId: 'owner' })
    await port.scope!({ action: 'scope', locusId: 'locus-group', mode: 'read' }, { actorId: 'owner' })
    expect(calls.map(call => call.mode)).toEqual(['write', 'read'])
    expect(repository.modes).toEqual([])
  })

  it('repeats exit idempotently only for the same current stopped marker', async () => {
    const stopped = record({ state: 'stopped', stoppedAt: 10 })
    const repository = memory([stopped])
    repository.stopLocus = async (id, now) => repository.transitionLocus!(id, 'stopped', now)
    const port = createLocusManagementPort({ repository, identity: () => ({ actorId: 'owner' }) })

    await expect(port.unbind!({
      action: 'unbind', endpoint: stopped.endpoint, locusId: stopped.id,
      expectedGeneration: stopped.generation, expectedLocusId: stopped.id, expectedUpdatedAt: stopped.updatedAt,
    }, { actorId: 'owner' })).resolves.toMatchObject({ reused: true, locus: { state: { state: 'stopped' } } })
    expect(repository.stopped).toEqual([])
  })

  it('rejects stale historical ids instead of mutating the endpoint replacement', async () => {
    const old = record({ id: 'locus-old', state: 'retired', generation: 1, updatedAt: 20 })
    const current = record({ id: 'locus-current', childSessionId: 'child-2', generation: 2, createdAt: 21, updatedAt: 21 })
    const repository = memory([old, current])
    repository.stopLocus = async (id, now) => repository.transitionLocus!(id, 'stopped', now)
    const port = createLocusManagementPort({
      repository,
      identity: () => ({ actorId: 'owner' }),
      now: () => 30,
    })

    await expect(port.archive!({
      action: 'archive',
      endpoint: { chatId: 'oc-project' },
      locusId: old.id,
      expectedGeneration: 1,
      expectedLocusId: old.id,
      expectedUpdatedAt: 20,
    }, { actorId: 'owner' })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(repository.records.find(item => item.id === current.id)?.state).toBe('active')
  })

  it('fails closed when the repository cannot prove the entry is idle', async () => {
    const repository = memory([record()])
    delete repository.hasPendingDeliveries
    repository.stopLocus = async (id, now) => repository.transitionLocus!(id, 'stopped', now)
    const port = createLocusManagementPort({ repository, identity: () => ({ actorId: 'owner' }) })

    await expect(port.archive!({
      action: 'archive', endpoint: { chatId: 'oc-project' }, locusId: 'locus-group',
    }, { actorId: 'owner' })).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
    expect(repository.stopped).toEqual([])
  })

  it('refuses exit for accepted-but-not-running Delivery work', async () => {
    const repository = memory([record()])
    repository.pending.add('locus-group')
    repository.stopLocus = async (id, now) => repository.transitionLocus!(id, 'stopped', now)
    const port = createLocusManagementPort({ repository, identity: () => ({ actorId: 'owner' }) })

    await expect(port.unbind!({
      action: 'unbind',
      endpoint: { chatId: 'oc-project' },
      locusId: 'locus-group',
    }, { actorId: 'owner' })).rejects.toMatchObject({ code: 'LOCUS_BUSY' })
    expect(repository.stopped).toEqual([])
  })

  it('stops only the group entry and leaves existing topic loci active', async () => {
    const group = record()
    const topic = record({
      id: 'locus-topic',
      endpoint: { chatId: 'oc-project', threadId: 'omt-existing' },
      parentLocusId: group.id,
      childSessionId: 'child-topic',
      source: 'inherited',
    })
    const repository = memory([group, topic])
    repository.stopLocus = async (id, now) => repository.transitionLocus!(id, 'stopped', now)
    const port = createLocusManagementPort({ repository, identity: () => ({ actorId: 'owner' }), now: () => 20 })

    await port.archive!({
      action: 'archive', endpoint: group.endpoint, locusId: group.id,
    }, { actorId: 'owner' })
    expect(repository.listLoci().find(item => item.id === group.id)?.state).toBe('stopped')
    expect(repository.listLoci().find(item => item.id === topic.id)?.state).toBe('active')
  })

  it('applies current-generation and busy fences before delegating panel bind', async () => {
    const current = record({ busy: false })
    const repository = memory([current])
    const calls: PetLocusActionRequest[] = []
    const port = createLocusManagementPort({
      repository,
      identity: () => ({ actorId: 'owner' }),
      actions: {
        bind: async request => {
          calls.push(request)
          return { action: 'bind', locus: {} } as never
        },
      },
    })

    await expect(port.bind!({
      action: 'bind', endpoint: current.endpoint, parentSessionId: 'main-2',
      expectedLocusId: 'stale', expectedGeneration: current.generation,
    }, { actorId: 'owner' })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    repository.pending.add(current.id)
    await expect(port.bind!({
      action: 'bind', endpoint: current.endpoint, parentSessionId: 'main-2',
      expectedLocusId: current.id, expectedGeneration: current.generation,
    }, { actorId: 'owner' })).rejects.toMatchObject({ code: 'LOCUS_BUSY' })
    expect(calls).toEqual([])
  })

  it('requires an explicit stopped marker fence before delegating rebuild', async () => {
    const stopped = record({ state: 'stopped', stoppedAt: 10 })
    const repository = memory([stopped])
    const rebuild = async () => ({ action: 'rebuild', locus: {} } as never)
    const port = createLocusManagementPort({
      repository,
      identity: () => ({ actorId: 'owner' }),
      actions: { rebuild },
    })

    await expect(port.rebuild!({
      action: 'rebuild', endpoint: stopped.endpoint, parentSessionId: stopped.parentSessionId,
    }, { actorId: 'owner' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(port.rebuild!({
      action: 'rebuild', endpoint: stopped.endpoint, parentSessionId: stopped.parentSessionId,
      expectedLocusId: stopped.id, expectedGeneration: stopped.generation, expectedUpdatedAt: stopped.updatedAt,
    }, { actorId: 'owner' })).resolves.toMatchObject({ action: 'rebuild' })
  })
})

describe('locus session describer', () => {
  const titled = (title: string) => [{ type: 'session/title', data: { title } }]
  const foldTitle = (events: readonly unknown[]): string | undefined => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i] as { type?: string; data?: { title?: unknown } }
      if (event?.type === 'session/title' && typeof event.data?.title === 'string') {
        return event.data.title
      }
    }
    return undefined
  }

  it('reports an unloaded but readable session as available, not missing', async () => {
    // The regression: a Host restart leaves every locus main unloaded, and
    // reading existence from the live registry reported them all unavailable.
    const inspect = vi.fn(async () => ({ events: titled('Locus 主会话 · oc_project') }))
    const describe = createLocusSessionDescriber({
      inspect,
      archivedSessionIds: () => [],
      foldTitle,
    })

    await expect(describe('session-cold')).resolves.toEqual({
      availability: 'available',
      title: 'Locus 主会话 · oc_project',
    })
    expect(inspect).toHaveBeenCalledWith('session-cold')
  })

  it('reports an archived session as archived without inspecting it', async () => {
    // Archived must outrank readability: its log still inspects fine, so
    // checking readability first would call it ordinarily available.
    const inspect = vi.fn(async () => ({ events: titled('Archived') }))
    const describe = createLocusSessionDescriber({
      inspect,
      archivedSessionIds: () => ['session-archived'],
      foldTitle,
    })

    await expect(describe('session-archived')).resolves.toEqual({ availability: 'archived' })
    expect(inspect).not.toHaveBeenCalled()
  })

  it('reports an unreadable session as missing', async () => {
    const describe = createLocusSessionDescriber({
      inspect: vi.fn(async () => {
        throw new Error('session "session-gone" not found')
      }),
      archivedSessionIds: () => [],
      foldTitle,
    })

    await expect(describe('session-gone')).resolves.toEqual({ availability: 'missing' })
  })

  it('omits availability when the Host cannot cold-read at all', async () => {
    // A Host limitation is not evidence about the session; claiming `missing`
    // here would invent a fact.
    const describe = createLocusSessionDescriber({
      inspect: undefined,
      archivedSessionIds: () => [],
      foldTitle,
    })

    await expect(describe('session-any')).resolves.toBeUndefined()
  })

  it('reports a readable but untitled session as available without a title', async () => {
    const describe = createLocusSessionDescriber({
      inspect: vi.fn(async () => ({ events: [] })),
      archivedSessionIds: () => [],
      foldTitle,
    })

    await expect(describe('session-untitled')).resolves.toEqual({ availability: 'available' })
  })

  it('does not let load state change the answer for the same session', async () => {
    // The live-registry answer flipped as sessions loaded and unloaded, which
    // made it useless as acceptance evidence.
    const describe = createLocusSessionDescriber({
      inspect: vi.fn(async () => ({ events: titled('Stable') })),
      archivedSessionIds: () => [],
      foldTitle,
    })

    const first = await describe('session-stable')
    const second = await describe('session-stable')
    expect(first).toEqual(second)
  })
})
