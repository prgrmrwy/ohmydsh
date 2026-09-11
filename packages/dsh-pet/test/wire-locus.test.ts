import { describe, expect, it } from 'vitest'
import {
  LOCUS_ACTION_ROUTE,
  LOCUS_BIND_ROUTE,
  LOCUS_DEFAULT_QA_ROUTE,
  LOCUS_DISCOVERY_ROUTE,
  LOCUS_REBUILD_ROUTE,
  LOCUS_ARCHIVE_ROUTE,
  LOCUS_STOP_ROUTE,
  LOCUS_ROUTES,
  LOCUS_SCOPE_ROUTE,
  LOCUS_UNBIND_ROUTE,
  LOCUS_VIEW_ROUTE,
  ROUTES,
  type PetLocusActionRequest,
  type PetLocusManagementView,
  type PetLocusRecordView,
} from '../src/wire.js'

describe('unified locus wire contract', () => {
  it('keeps locus routes additive and legacy routes unchanged', () => {
    expect(LOCUS_ROUTES).toEqual({
      view: '/dsh-pet/api/locus',
      discovery: '/dsh-pet/api/locus-discovery',
      action: '/dsh-pet/api/locus-action',
      defaultQa: '/dsh-pet/api/locus-default-qa',
      bind: '/dsh-pet/api/locus-bind',
      unbind: '/dsh-pet/api/locus-unbind',
      archive: '/dsh-pet/api/locus-archive',
      stop: '/dsh-pet/api/locus-stop',
      scope: '/dsh-pet/api/locus-scope',
      rebuild: '/dsh-pet/api/locus-rebuild',
    })
    expect(LOCUS_VIEW_ROUTE).toBe(LOCUS_ROUTES.view)
    expect(LOCUS_DISCOVERY_ROUTE).toBe(LOCUS_ROUTES.discovery)
    expect(LOCUS_ACTION_ROUTE).toBe(LOCUS_ROUTES.action)
    expect(LOCUS_DEFAULT_QA_ROUTE).toBe(LOCUS_ROUTES.defaultQa)
    expect(LOCUS_BIND_ROUTE).toBe(LOCUS_ROUTES.bind)
    expect(LOCUS_UNBIND_ROUTE).toBe(LOCUS_ROUTES.unbind)
    expect(LOCUS_SCOPE_ROUTE).toBe(LOCUS_ROUTES.scope)
    expect(LOCUS_REBUILD_ROUTE).toBe(LOCUS_ROUTES.rebuild)
    expect(LOCUS_ARCHIVE_ROUTE).toBe(LOCUS_ROUTES.archive)
    expect(LOCUS_STOP_ROUTE).toBe(LOCUS_ROUTES.stop)
    expect(Object.values(ROUTES)).not.toContain(LOCUS_ROUTES.view)
  })

  it('serializes aggregate, nested view and discovery fields without secrets', () => {
    const record: PetLocusRecordView = {
      id: 'locus-1',
      generation: 2,
      endpoint: { chatId: 'oc_chat', threadId: 'omt_thread' },
      parentSessionId: 'session-main',
      childSessionId: 'session-child',
      workspaceId: 'workspace-1',
      source: 'inherited',
      state: 'active',
      permission: { desired: 'read', effective: 'read' },
      busy: false,
      createdAt: 1,
      updatedAt: 2,
      contextAnchor: { status: 'confirmed', executionRoot: '/repo/project' },
    }
    const view: PetLocusManagementView = {
      generation: 4,
      loci: [
        {
          locusId: record.id,
          generation: record.generation,
          endpoint: record.endpoint,
          main: { sessionId: record.parentSessionId, source: record.source },
          child: { sessionId: record.childSessionId },
          workspace: { workspaceId: record.workspaceId, executionRoot: '/repo/project' },
          contextAnchor: record.contextAnchor,
          permission: record.permission,
          state: {
            state: record.state,
            busy: record.busy,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          },
          source: record.source,
          isDefaultQa: true,
        },
      ],
      defaultQa: [{ parentSessionId: record.parentSessionId }],
      discovery: {
        byEndpoint: [{ endpoint: record.endpoint, history: [] }],
        byParent: [{ parentSessionId: record.parentSessionId, loci: [] }],
        byChild: [{ childSessionId: record.childSessionId! }],
      },
    }

    const wire = JSON.stringify({ record, view })
    expect(wire).toContain('oc_chat')
    expect(wire).toContain('omt_thread')
    expect(wire).toContain('inherited')
    expect(wire).toContain('defaultQa')
    expect(wire).toContain('discovery')
    for (const secret of ['appSecret', 'token', 'password', 'apiKey']) {
      expect(wire).not.toContain(secret)
    }
  })

  it('keeps mutation actions discriminated and excludes generated child/permission input', () => {
    const actions: readonly PetLocusActionRequest[] = [
      {
        action: 'bind',
        endpoint: { chatId: 'oc_chat' },
        parentSessionId: 'session-main',
      },
      { action: 'unbind', endpoint: { chatId: 'oc_chat' }, locusId: 'locus-1', expectedGeneration: 2 },
      { action: 'scope', locusId: 'locus-1', mode: 'write', expectedLocusId: 'locus-1' },
      {
        action: 'rebuild',
        endpoint: { chatId: 'oc_chat', threadId: 'omt_thread' },
        parentSessionId: 'session-main',
        asDefaultQa: true,
      },
    ]
    expect(actions.map(item => item.action)).toEqual(['bind', 'unbind', 'scope', 'rebuild'])
    expect(JSON.stringify(actions)).not.toContain('childSessionId')
    expect(JSON.stringify(actions)).not.toContain('permission')
  })
})
