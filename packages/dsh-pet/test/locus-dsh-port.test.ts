import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { describe, expect, it, vi } from 'vitest'
import {
  createProductionLocusDshPort,
  LocusDshCapabilityUnavailableError,
  type LocusWorkspaceEntity,
  type ProductionLocusDshPortDeps,
} from '../src/host/locus/dsh-port.js'

function fakeSession(id: string): Session {
  return { id: SessionId(id) } as unknown as Session
}

function fakeEvents(events: readonly unknown[]): readonly SessionEvent[] {
  return events as readonly SessionEvent[]
}

function workspace(
  id: string,
  options: {
    readonly sessions?: readonly string[]
    readonly status?: 'ok' | 'missing-dir'
    readonly order?: string[]
  } = {},
): LocusWorkspaceEntity {
  const order = options.order
  return {
    id: WorkspaceId(id),
    path: `/workspaces/${id}`,
    title: `Workspace ${id}`,
    sessionIds: (options.sessions ?? []).map(SessionId),
    status: vi.fn(async () => options.status ?? 'ok'),
    attachSession: vi.fn(async () => {
      order?.push('attach')
    }),
    detachSession: vi.fn(async () => {
      order?.push('detach')
    }),
  }
}

function harness(
  overrides: Partial<ProductionLocusDshPortDeps> = {},
): ProductionLocusDshPortDeps {
  const defaultWorkspace = workspace('ws-default')
  return {
    repository: {
      getChannelConfig: () => ({ defaultWorkspaceId: 'ws-default' }),
    },
    sessionController: {
      inspect: vi.fn(async sessionId => ({
        meta: { id: sessionId },
        events: [],
      })),
    },
    workspaceRegistry: {
      get: id => (id === defaultWorkspace.id ? defaultWorkspace : undefined),
      list: () => [defaultWorkspace],
      archivedSessionIds: [],
    },
    agents: {
      create: vi.fn(async options => {
        await options.setup?.({ scope: 'agent' } as unknown as Context)
        return {
          agent: { session: fakeSession(String(options.sessionId)) },
          dispose: vi.fn(async () => undefined),
        }
      }),
    },
    agentPresets: {
      defaultId: 'standard',
      mount: vi.fn(async () => undefined),
    },
    agentDefaultModel: {
      currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
    },
    sessions: {
      flush: vi.fn(async () => true),
    },
    sessionTitle: {
      rename: vi.fn((_session, title) => ({ title })),
    },
    foldSessionTitle: vi.fn(() => undefined),
    createSessionId: () => 'session-created-main',
    ...overrides,
  }
}

describe('production LocusDshPort session resolution', () => {
  it('cold-inspects a session, requires Workspace membership and folds its durable title', async () => {
    const events = fakeEvents([{ type: 'session/title', data: { title: 'Cold title' } }])
    const ws = workspace('ws-project', { sessions: ['session-cold'] })
    const inspect = vi.fn(async () => ({
      meta: { id: SessionId('session-cold') },
      events,
    }))
    const foldSessionTitle = vi.fn(() => ({ title: 'Cold title' }))
    const deps = harness({
      sessionController: { inspect },
      workspaceRegistry: {
        get: id => (id === ws.id ? ws : undefined),
        list: () => [ws],
        archivedSessionIds: [],
      },
      foldSessionTitle,
    })

    await expect(createProductionLocusDshPort(deps).resolveSession('session-cold')).resolves.toEqual({
      id: 'session-cold',
      workspaceId: 'ws-project',
      title: 'Cold title',
      state: 'active',
    })
    expect(inspect).toHaveBeenCalledWith('session-cold')
    expect(foldSessionTitle).toHaveBeenCalledWith(events)
  })

  it('preserves archived state instead of treating history as active', async () => {
    const ws = workspace('ws-project', { sessions: ['session-archived'] })
    const deps = harness({
      sessionController: {
        inspect: vi.fn(async () => ({
          meta: { id: SessionId('session-archived') },
          events: [],
        })),
      },
      workspaceRegistry: {
        get: id => (id === ws.id ? ws : undefined),
        list: () => [ws],
        archivedSessionIds: [SessionId('session-archived')],
      },
    })

    await expect(createProductionLocusDshPort(deps).resolveSession('session-archived')).resolves.toEqual({
      id: 'session-archived',
      workspaceId: 'ws-project',
      state: 'archived',
    })
  })

  it('returns unavailable for a missing persisted session', async () => {
    const deps = harness({
      sessionController: {
        inspect: vi.fn(async () => {
          throw new Error('session not found')
        }),
      },
    })

    await expect(createProductionLocusDshPort(deps).resolveSession('session-missing')).resolves.toBeUndefined()
  })

  it('fails closed when no Workspace owns the session', async () => {
    const deps = harness({
      workspaceRegistry: {
        get: () => undefined,
        list: () => [],
        archivedSessionIds: [],
      },
    })

    await expect(createProductionLocusDshPort(deps).resolveSession('session-unfiled')).resolves.toBeUndefined()
  })

  it('fails closed when several Workspaces claim the same session', async () => {
    const first = workspace('ws-one', { sessions: ['session-conflict'] })
    const second = workspace('ws-two', { sessions: ['session-conflict'] })
    const deps = harness({
      workspaceRegistry: {
        get: () => undefined,
        list: () => [first, second],
        archivedSessionIds: [],
      },
    })

    await expect(createProductionLocusDshPort(deps).resolveSession('session-conflict')).resolves.toBeUndefined()
  })

  it('fails closed when the owning Workspace directory is missing', async () => {
    const ws = workspace('ws-project', {
      sessions: ['session-dead-workspace'],
      status: 'missing-dir',
    })
    const deps = harness({
      workspaceRegistry: {
        get: id => (id === ws.id ? ws : undefined),
        list: () => [ws],
        archivedSessionIds: [],
      },
    })

    await expect(
      createProductionLocusDshPort(deps).resolveSession('session-dead-workspace'),
    ).resolves.toBeUndefined()
    expect(ws.status).toHaveBeenCalledOnce()
  })

  it('projects child lineage so the controller can reject it as a main', async () => {
    const ws = workspace('ws-project', { sessions: ['session-child'] })
    const deps = harness({
      sessionController: {
        inspect: vi.fn(async () => ({
          meta: {
            id: SessionId('session-child'),
            parentSession: SessionId('session-parent'),
          },
          events: [],
        })),
      },
      workspaceRegistry: {
        get: id => (id === ws.id ? ws : undefined),
        list: () => [ws],
        archivedSessionIds: [],
      },
    })

    await expect(createProductionLocusDshPort(deps).resolveSession('session-child')).resolves.toMatchObject({
      parentSessionId: 'session-parent',
    })
  })
})

describe('production LocusDshPort default Workspace resolution', () => {
  it.each([
    ['not configured', undefined, undefined, 'ok'],
    ['unknown', 'ws-missing', undefined, 'ok'],
    ['missing directory', 'ws-default', 'present', 'missing-dir'],
  ] as const)('rejects an invalid default Workspace: %s', async (_label, configured, present, status) => {
    const ws = workspace('ws-default', { status })
    const deps = harness({
      repository: {
        getChannelConfig: () => (
          configured === undefined ? {} : { defaultWorkspaceId: configured }
        ),
      },
      workspaceRegistry: {
        get: id => (present === 'present' && id === ws.id ? ws : undefined),
        list: () => present === 'present' ? [ws] : [],
        archivedSessionIds: [],
      },
    })

    await expect(createProductionLocusDshPort(deps).resolveDefaultWorkspace()).resolves.toBeUndefined()
  })

  it('returns the configured Workspace only after its live status succeeds', async () => {
    const ws = workspace('ws-default')
    const deps = harness({
      workspaceRegistry: {
        get: id => (id === ws.id ? ws : undefined),
        list: () => [ws],
        archivedSessionIds: [],
      },
    })

    await expect(createProductionLocusDshPort(deps).resolveDefaultWorkspace()).resolves.toEqual({
      id: 'ws-default',
      title: 'Workspace ws-default',
    })
    expect(ws.status).toHaveBeenCalledOnce()
  })
})

describe('production LocusDshPort main creation', () => {
  it('freezes the default preset, awaits mount, attaches, then renames', async () => {
    const order: string[] = []
    const ws = workspace('ws-default', { order })
    let preset = 'standard-v1'
    let releaseMount!: () => void
    const mountGate = new Promise<void>(resolve => {
      releaseMount = resolve
    })
    const mount = vi.fn(async (_scope: Context, id: string) => {
      order.push(`mount-start:${id}`)
      await mountGate
      order.push(`mount-end:${id}`)
      preset = 'standard-v2'
    })
    const dispose = vi.fn(async () => {
      order.push('dispose')
    })
    const create = vi.fn(async options => {
      order.push('create')
      await options.setup?.({ scope: 'main' } as unknown as Context)
      order.push('published')
      return { agent: { session: fakeSession(String(options.sessionId)) }, dispose }
    })
    const rename = vi.fn((_session: Session, title: string) => {
      order.push('rename')
      return { title }
    })
    const flush = vi.fn(async () => {
      order.push('flush')
      return true
    })
    const base = harness()
    const deps = harness({
      workspaceRegistry: {
        get: id => (id === ws.id ? ws : undefined),
        list: () => [ws],
        archivedSessionIds: [],
      },
      agents: { create },
      agentPresets: {
        get defaultId() {
          return preset
        },
        mount,
      },
      sessionTitle: { rename },
      sessions: { flush },
      agentDefaultModel: base.agentDefaultModel,
    })

    const creation = createProductionLocusDshPort(deps).createMainSession({
      workspaceId: 'ws-default',
      label: 'Locus 主会话 · Project',
      chatId: 'oc_project',
    })
    await vi.waitFor(() => {
      expect(order).toEqual(['create', 'mount-start:standard-v1'])
    })
    releaseMount()
    const created = await creation

    expect(order).toEqual([
      'create',
      'mount-start:standard-v1',
      'mount-end:standard-v1',
      'published',
      'attach',
      'rename',
      'flush',
    ])
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-created-main',
      meta: {
        cwd: '/workspaces/ws-default',
        agentPreset: 'standard-v1',
      },
      agentOptions: { provider: 'deepseek', model: 'deepseek-chat' },
    }))
    expect(created).toMatchObject({
      id: 'session-created-main',
      workspaceId: 'ws-default',
      title: 'Locus 主会话 · Project',
    })
    expect('releaseSession' in createProductionLocusDshPort(deps)).toBe(false)
  })

  it('returns an ownership-bound rollback that attempts detach and handle disposal', async () => {
    const order: string[] = []
    const detachFailure = new Error('detach failed')
    const disposeFailure = new Error('dispose failed')
    const ws = workspace('ws-default', { order })
    ws.detachSession = vi.fn(async () => {
      order.push('detach')
      throw detachFailure
    })
    const dispose = vi.fn(async () => {
      order.push('dispose')
      throw disposeFailure
    })
    const deps = harness({
      workspaceRegistry: {
        get: id => (id === ws.id ? ws : undefined),
        list: () => [ws],
        archivedSessionIds: [],
      },
      agents: {
        create: vi.fn(async options => {
          await options.setup?.({} as Context)
          return { agent: { session: fakeSession(String(options.sessionId)) }, dispose }
        }),
      },
    })

    const created = await createProductionLocusDshPort(deps).createMainSession({
      workspaceId: 'ws-default',
      label: 'Main',
      chatId: 'oc_project',
    })

    await expect(created.rollback?.()).rejects.toSatisfy((error: unknown) => {
      return error instanceof AggregateError &&
        error.errors.includes(detachFailure) &&
        error.errors.includes(disposeFailure)
    })
    expect(order.slice(-2)).toEqual(['detach', 'dispose'])
  })

  it('rolls back the owned Agent when post-create rename fails', async () => {
    const order: string[] = []
    const ws = workspace('ws-default', { order })
    const dispose = vi.fn(async () => {
      order.push('dispose')
    })
    const deps = harness({
      workspaceRegistry: {
        get: id => (id === ws.id ? ws : undefined),
        list: () => [ws],
        archivedSessionIds: [],
      },
      agents: {
        create: vi.fn(async options => {
          await options.setup?.({} as Context)
          return { agent: { session: fakeSession(String(options.sessionId)) }, dispose }
        }),
      },
      sessionTitle: {
        rename: vi.fn(() => {
          order.push('rename')
          throw new Error('rename failed')
        }),
      },
    })

    await expect(createProductionLocusDshPort(deps).createMainSession({
      workspaceId: 'ws-default',
      label: 'Main',
      chatId: 'oc_project',
    })).rejects.toThrow('rename failed')
    expect(order).toEqual(['attach', 'rename', 'detach', 'dispose'])
  })
})

describe('production LocusDshPort child capability gate', () => {
  it('delegates to the reviewed idle child provisioner when composed', async () => {
    const commit = vi.fn()
    const rollback = vi.fn(async () => undefined)
    const create = vi.fn(async () => ({
      childSessionId: 'child-reserved',
      commit,
      rollback,
    }))
    const port = createProductionLocusDshPort(harness({ idleChildren: { create } }))

    const child = await port.createChildSession({
      parentSessionId: 'main-1',
      workspaceId: 'ws-default',
      locusId: 'locus-1',
      generation: 1,
      label: '项目子会话',
      endpoint: { chatId: 'oc-project' },
      permission: 'read',
    })

    expect(create).toHaveBeenCalledWith({
      parentSessionId: 'main-1',
      workspaceId: 'ws-default',
      locusId: 'locus-1',
      generation: 1,
      label: '项目子会话',
      permission: 'read',
    })
    expect(child).toMatchObject({
      id: 'child-reserved',
      parentSessionId: 'main-1',
      workspaceId: 'ws-default',
      commit,
      rollback,
    })
  })

  it('is explicitly unavailable until the idle-runtime patch is connected', async () => {
    const port = createProductionLocusDshPort(harness())

    await expect(port.createChildSession({
      parentSessionId: 'session-parent',
      workspaceId: 'ws-default',
      locusId: 'locus-1',
      generation: 1,
      label: 'Locus child',
      endpoint: { chatId: 'oc_project' },
      permission: 'read',
    })).rejects.toMatchObject({
      name: 'LocusDshCapabilityUnavailableError',
      code: 'CAPABILITY_UNAVAILABLE',
    } satisfies Partial<LocusDshCapabilityUnavailableError>)
  })
})
