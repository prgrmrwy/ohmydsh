import { describe, expect, it, vi } from 'vitest'
import {
  CommandRouter,
  encodeSessionId,
  encodeWorkspaceId,
  parseNodeId,
  type DshNodePort,
  type NativeSessionId,
  type NativeWorkspaceId,
  type NodeCapability,
  type NodeDescriptor,
  type NodeId,
  type NodeProjectionInput,
} from '../src/core/index.js'
import {
  ActivationConflictError,
  CentralLocalTransport,
  CentralUplink,
  HostActivationCoordinator,
  NodeDeletionRequiresConfirmation,
  createRpcIdMinter,
  projectCentralRuntimeView,
  toCentralFrame,
  type RouteRegistration,
} from '../src/host/index.js'

const local = parseNodeId('this-mac')
const vmA = parseNodeId('vm-a')
const vmB = parseNodeId('vm-b')
const known = new Set<NodeId>([local, vmA, vmB])

const allCapabilities = new Set<NodeCapability>([
  'workspace.read', 'workspace.write', 'session.read', 'session.write', 'session.search',
  'session.attachment', 'directory.read', 'directory.write', 'events.mux', 'events.host', 'interaction.respond',
])

function descriptor(nodeId: NodeId, kind: 'local' | 'remote', order: number, capabilities = allCapabilities): NodeDescriptor {
  return { nodeId, kind, displayName: nodeId, enabled: true, order, capabilities, compatibility: 'SUPPORTED', state: 'READY' }
}

function port(nodeId: NodeId, calls: [string, unknown][], capabilities = allCapabilities, kind: 'local' | 'remote' = 'remote'): DshNodePort {
  const record = (name: string, value: unknown = { ok: true }) => (...args: unknown[]) => {
    calls.push([`${nodeId}:${name}`, args[0]])
    return Promise.resolve(value)
  }
  return {
    node: descriptor(nodeId, kind, 0, capabilities),
    capabilities,
    listWorkspaces: record('workspace.list', []),
    createWorkspace: record('workspace.create'),
    renameWorkspace: record('workspace.rename'),
    deleteWorkspace: record('workspace.delete'),
    reorderWorkspace: record('workspace.insertBefore'),
    reorderSession: record('workspace.insertSessionBefore'),
    listSessions: record('session.list', []),
    createSession: record('session.create', 'native-new'),
    history: record('session.history'),
    models: record('session.models'),
    prompt: record('session.prompt'),
    cancel: record('session.cancel'),
    renameSession: record('session.rename', { title: 't', seq: 1 }),
    forkSession: record('session.fork', 'native-fork'),
    selectModel: record('session.selectModel'),
    updateQueue: record('session.updateQueue'),
    attachment: record('session.attachment'),
    search: record('session.search', []),
    archiveSession: record('workspace.archiveSession'),
    respond: record('respond'),
    listDirectory: record('host.listDirectory'),
    createDirectory: record('host.createDirectory'),
  } as unknown as DshNodePort
}

function uplink(calls: [string, unknown][], capabilities = allCapabilities) {
  const router = new CommandRouter(new Map([
    [local, port(local, calls, capabilities, 'local')],
    [vmA, port(vmA, calls, capabilities)],
    [vmB, port(vmB, calls, capabilities)],
  ]))
  return new CentralUplink(router, known, local)
}

const remoteSession = encodeSessionId({ nodeId: vmA, nativeId: 'shared' as NativeSessionId })
const remoteWorkspace = encodeWorkspaceId({ nodeId: vmA, nativeId: 'shared' as NativeWorkspaceId })
const otherWorkspace = encodeWorkspaceId({ nodeId: vmB, nativeId: 'shared' as NativeWorkspaceId })
const remoteAnchorSession = encodeSessionId({ nodeId: vmA, nativeId: 'anchor' as NativeSessionId })
const otherSession = encodeSessionId({ nodeId: vmB, nativeId: 'shared' as NativeSessionId })

describe('federation node management routes', () => {
  it('routes add/update/reorder/remove to the registry manager and reports confirmation refusal', async () => {
    const calls: [string, unknown][] = []
    const router = new CommandRouter(new Map([[local, port(local, calls, allCapabilities, 'local')]]))
    const seen: unknown[] = []
    const uplink = new CentralUplink(router, new Set([local]), local, {
      async nodes() { return [] },
      async baseline() { return {} },
      async operations() { return [] },
      manager: {
        async addNode(request) { seen.push(['add', request]); return { nodeId: 'node-1', kind: 'remote' } },
        async updateNode(nodeId, update) { seen.push(['update', nodeId, update]); return { nodeId, kind: 'remote' } },
        async reorderNode(nodeId, before) { seen.push(['reorder', nodeId, before]); return { nodes: [] } },
        async removeNode(nodeId, confirmed) {
          seen.push(['remove', nodeId, confirmed])
          if (!confirmed) throw new NodeDeletionRequiresConfirmation(nodeId as never, 2)
          return { retainedDiagnostics: [] }
        },
      },
    })

    await expect(uplink.handle({ path: '/api/federation/node.add', rpcId: 'r1', payload: { displayName: 'VM A', sshAlias: 'vm-a', remoteDshPort: 3080 } }))
      .resolves.toMatchObject({ kind: 'ok' })
    await expect(uplink.handle({ path: '/api/federation/node.update', rpcId: 'r2', payload: { nodeId: 'node-1', enabled: false } }))
      .resolves.toMatchObject({ kind: 'ok' })
    await expect(uplink.handle({ path: '/api/federation/node.reorder', rpcId: 'r3', payload: { nodeId: 'node-1' } }))
      .resolves.toMatchObject({ kind: 'ok' })
    await expect(uplink.handle({ path: '/api/federation/node.remove', rpcId: 'r4', payload: { nodeId: 'node-1' } }))
      .resolves.toMatchObject({ kind: 'error', status: 409, code: 'federation-node-deletion-unconfirmed' })
    await expect(uplink.handle({ path: '/api/federation/node.remove', rpcId: 'r5', payload: { nodeId: 'node-1', confirmed: true } }))
      .resolves.toMatchObject({ kind: 'ok' })

    expect(seen).toEqual([
      ['add', { displayName: 'VM A', sshAlias: 'vm-a', remoteDshPort: 3080 }],
      ['update', 'node-1', { enabled: false }],
      ['reorder', 'node-1', undefined],
      ['remove', 'node-1', false],
      ['remove', 'node-1', true],
    ])
    expect(calls).toEqual([])
  })

  it('refuses node management when no manager is attached', async () => {
    const calls: [string, unknown][] = []
    const bare = uplink(calls)
    await expect(bare.handle({ path: '/api/federation/node.add', rpcId: 'r1', payload: { displayName: 'X', sshAlias: 'x', remoteDshPort: 3080 } }))
      .resolves.toMatchObject({ kind: 'error', status: 503, code: 'federation-inventory-unavailable' })
  })
})

describe('federation inventory error boundary', () => {
  it('returns structured 503 outcomes when node or baseline providers fail', async () => {
    const calls: [string, unknown][] = []
    const router = new CommandRouter(new Map([
      [local, port(local, calls, allCapabilities, 'local')],
      [vmA, port(vmA, calls)],
      [vmB, port(vmB, calls)],
    ]))
    const provider = new CentralUplink(router, known, local, {
      async nodes() { throw new Error('registry unavailable') },
      async baseline() { throw new Error('node snapshot unavailable') },
      async operations() { throw new Error('operation snapshot unavailable') },
    })
    await expect(provider.handle({ path: '/api/federation/nodes', rpcId: 'nodes', payload: {} }))
      .resolves.toMatchObject({ kind: 'error', status: 503, code: 'federation-inventory-unavailable', message: 'registry unavailable' })
    await expect(provider.handle({ path: '/api/federation/baseline', rpcId: 'baseline', payload: { nodeId: vmA } }))
      .resolves.toMatchObject({ kind: 'error', status: 503, code: 'federation-inventory-unavailable', message: 'node snapshot unavailable' })
    await expect(provider.handle({ path: '/api/federation/operations', rpcId: 'operations', payload: {} }))
      .resolves.toMatchObject({ kind: 'error', status: 503, code: 'federation-inventory-unavailable', message: 'operation snapshot unavailable' })
  })
})

describe('central local transport (6.1, 6.5)', () => {
  it('routes This Mac through the effective composed handler without rebuilding rc.2 composition', async () => {
    const seen: { url: string; method: string; body: string | null }[] = []
    const transport = new CentralLocalTransport({
      async fetch(request) {
        seen.push({ url: request.url, method: request.method, body: await request.text() })
        return Response.json({ type: 'server-response', rpcId: 'r1', result: { ok: true, value: { items: [] } } })
      },
    })
    await expect(transport.request({ path: '/api/workspace.list', body: { type: 'client-request', rpcId: 'r1', method: 'workspace.list', payload: {} } }))
      .resolves.toMatchObject({ result: { ok: true } })
    expect(seen[0]!.url).toBe('http://127.0.0.1/api/workspace.list')
    expect(seen[0]!.method).toBe('POST')
    expect(JSON.parse(seen[0]!.body!)).toMatchObject({ type: 'client-request', method: 'workspace.list' })
  })

  it('classifies local dispatch failures and refuses a non-loopback origin', async () => {
    const failing = new CentralLocalTransport({ fetch: async () => { throw new Error('composition unavailable') } })
    await expect(failing.request({ path: '/api/host.describe' })).rejects.toMatchObject({ kind: 'Transport' })
    const notJson = new CentralLocalTransport({ fetch: async () => new Response('nope') })
    await expect(notJson.request({ path: '/api/host.describe' })).rejects.toMatchObject({ kind: 'Protocol' })
    expect(() => new CentralLocalTransport({ fetch: async () => new Response('{}') }, { origin: 'http://10.0.0.4' })).toThrow(/loopback/)
  })
})

describe('central runtime view (6.2)', () => {
  it('keeps colliding native ids distinct and preserves archived, ungrouped, current and blank', () => {
    const inputs: readonly NodeProjectionInput[] = [
      {
        node: descriptor(local, 'local', 0),
        workspaces: [{ id: 'shared' as NativeWorkspaceId, title: 'Local', path: '/local', sessionIds: ['shared' as NativeSessionId], order: 0 }],
        sessions: [
          { id: 'shared' as NativeSessionId, title: 'Local session', path: '/local', status: 'running', archived: false },
          { id: 'loose' as NativeSessionId, title: 'Loose', path: '/local', status: 'idle', archived: false },
        ],
      },
      {
        node: descriptor(vmA, 'remote', 1),
        workspaces: [{ id: 'shared' as NativeWorkspaceId, title: 'Remote', path: '/remote', sessionIds: ['shared' as NativeSessionId, 'gone' as NativeSessionId], order: 0 }],
        sessions: [
          { id: 'shared' as NativeSessionId, title: 'Remote session', path: '/remote', status: 'idle', seq: 9, archived: false },
          { id: 'gone' as NativeSessionId, title: 'Archived', path: '/remote', status: 'idle', archived: true },
        ],
      },
    ]
    const view = projectCentralRuntimeView(inputs, { currentSessionId: remoteSession, blankSessionIds: [remoteSession] })
    expect(view.workspaces.map(workspace => workspace.workspaceId)).toEqual([
      encodeWorkspaceId({ nodeId: local, nativeId: 'shared' as NativeWorkspaceId }),
      remoteWorkspace,
    ])
    expect(new Set(view.sessions.map(session => session.sessionId)).size).toBe(3)
    expect(view.sessions.find(session => session.sessionId === remoteSession)).toMatchObject({ blank: true, seq: 9, running: false })
    expect(view.archivedSessionIds).toEqual([encodeSessionId({ nodeId: vmA, nativeId: 'gone' as NativeSessionId })])
    expect(view.ungroupedSessionIds).toEqual([encodeSessionId({ nodeId: local, nativeId: 'loose' as NativeSessionId })])
    expect(view.currentSessionId).toBe(remoteSession)
    expect(view.runningCount).toBe(1)
  })

  it('drops a current id that no longer resolves to a visible session', () => {
    const view = projectCentralRuntimeView([{ node: descriptor(vmA, 'remote', 0), workspaces: [], sessions: [] }], { currentSessionId: remoteSession })
    expect(view.currentSessionId).toBeUndefined()
  })
})

describe('central frame conversion (6.3)', () => {
  it('rewrites session, workspace, status and interaction identities for the browser', () => {
    const context = createRpcIdMinter(vmA)
    expect(toCentralFrame({ kind: 'reconciliation', frame: { domain: 'session', sessionId: 'shared' as NativeSessionId, seq: 4, value: { type: 'session/event', sessionId: 'shared', event: {} } } }, context))
      .toMatchObject({ stream: 'mux', payload: { type: 'session/event', sessionId: remoteSession } })
    expect(toCentralFrame({ kind: 'reconciliation', frame: { domain: 'workspace-upsert', workspaceId: 'shared' as NativeWorkspaceId, value: {
      ref: { nodeId: vmA, nativeId: 'shared' as NativeWorkspaceId }, id: remoteWorkspace, title: 'W', path: '/remote', sessionIds: [remoteSession], archivedSessionIds: [], order: 0,
    } } }, context))
      .toMatchObject({ stream: 'host', payload: { type: 'host/workspace-changed', workspace: { workspaceId: remoteWorkspace, sessionIds: [remoteSession] } } })
    expect(toCentralFrame({ kind: 'reconciliation', frame: { domain: 'status', sessionId: 'shared' as NativeSessionId, value: { running: true } } }, context))
      .toMatchObject({ stream: 'host', payload: { type: 'host/session-status', sessionId: remoteSession, running: true } })
    expect(toCentralFrame({ kind: 'reconciliation', frame: { domain: 'status-remove', sessionId: 'shared' as NativeSessionId } }, context))
      .toMatchObject({ payload: { type: 'host/session-removed', sessionId: remoteSession } })
    expect(toCentralFrame({ kind: 'reconciliation', frame: { domain: 'workspace-remove', workspaceId: 'shared' as NativeWorkspaceId } }, context))
      .toMatchObject({ payload: { type: 'host/workspace-removed', workspaceId: remoteWorkspace } })
  })

  it('preserves the remote rpcId for answerable interactions and suppresses refresh markers', () => {
    const context = createRpcIdMinter(vmA)
    expect(toCentralFrame({ kind: 'interaction', rpcId: 'remote-approval-1' as never, sessionId: 'shared' as NativeSessionId, interaction: 'approval', payload: { type: 'approval/requested', sessionId: 'shared', approvalId: 'a1' } }, context))
      .toEqual({ stream: 'mux', rpcId: 'remote-approval-1', payload: { type: 'approval/requested', sessionId: remoteSession, approvalId: 'a1' } })
    expect(toCentralFrame({ kind: 'refresh-required', reason: 'host/workspace-order-changed' }, context)).toBeUndefined()
  })
})

describe('central uplink routing (6.4, 6.9)', () => {
  it('routes federated ids to their owner and passes bare local ids through', async () => {
    const calls: [string, unknown][] = []
    const central = uplink(calls)
    await expect(central.handle({ path: '/api/session.prompt', rpcId: 'rpc-1', payload: { sessionId: remoteSession, mode: 'queue', content: [] } }))
      .resolves.toMatchObject({ kind: 'ok' })
    await expect(central.handle({ path: '/api/session.prompt', rpcId: 'rpc-2', payload: { sessionId: 'bare-native', mode: 'queue', content: [] } }))
      .resolves.toEqual({ kind: 'local-passthrough' })
    await expect(central.handle({ path: '/api/workspace.insertSessionBefore', rpcId: 'rpc-3', payload: {
      workspaceId: remoteWorkspace, sessionId: remoteSession, beforeSessionId: remoteAnchorSession,
    } })).resolves.toMatchObject({ kind: 'ok' })
    expect(calls.map(([name]) => name)).toEqual(['vm-a:session.prompt', 'vm-a:workspace.insertSessionBefore'])
  })

  it('rejects unknown, forged, wrong-type and cross-node anchor requests', async () => {
    const central = uplink([])
    await expect(central.handle({ path: '/api/session.cancel', rpcId: 'r', payload: { sessionId: 'fed1:ghost:s:c2hhcmVk' } }))
      .resolves.toMatchObject({ kind: 'error', code: 'federation-id-unknown-node' })
    await expect(central.handle({ path: '/api/session.cancel', rpcId: 'r', payload: { sessionId: 'fed1:vm-a:!!!' } }))
      .resolves.toMatchObject({ kind: 'error' })
    await expect(central.handle({ path: '/api/session.cancel', rpcId: 'r', payload: { sessionId: remoteWorkspace } }))
      .resolves.toMatchObject({ kind: 'error', code: 'federation-id-wrong-kind' })
    await expect(central.handle({ path: '/api/workspace.insertBefore', rpcId: 'r', payload: { workspaceId: remoteWorkspace, beforeWorkspaceId: otherWorkspace } }))
      .resolves.toMatchObject({ kind: 'error', code: 'federation-capability-denied' })
    await expect(central.handle({ path: '/api/workspace.insertBefore', rpcId: 'r', payload: { workspaceId: remoteWorkspace, beforeWorkspaceId: 'bare-native' } }))
      .resolves.toMatchObject({ kind: 'error', code: 'federation-cross-node-anchor' })
    await expect(central.handle({ path: '/api/workspace.insertBefore', rpcId: 'r', payload: { workspaceId: 'bare-native', beforeWorkspaceId: remoteWorkspace } }))
      .resolves.toMatchObject({ kind: 'error', code: 'federation-cross-node-anchor' })
    await expect(central.handle({ path: '/api/workspace.insertSessionBefore', rpcId: 'r', payload: {
      workspaceId: remoteWorkspace, sessionId: otherSession,
    } })).resolves.toMatchObject({ kind: 'error', code: 'federation-capability-denied' })
    await expect(central.handle({ path: '/api/workspace.insertSessionBefore', rpcId: 'r', payload: {
      workspaceId: remoteWorkspace, sessionId: remoteSession, beforeSessionId: otherSession,
    } })).resolves.toMatchObject({ kind: 'error', code: 'federation-capability-denied' })
  })

  it('enforces capability and node readiness before dispatch', async () => {
    const readOnly = new Set<NodeCapability>(['workspace.read', 'session.read', 'events.mux', 'events.host'])
    const central = uplink([], readOnly)
    await expect(central.handle({ path: '/api/session.cancel', rpcId: 'r', payload: { sessionId: remoteSession } }))
      .resolves.toMatchObject({ kind: 'error', code: 'federation-capability-denied', status: 403 })
    await expect(central.handle({ path: '/api/host.createDirectory', rpcId: 'r', payload: { nodeId: vmA, path: '/remote', name: 'child' } }))
      .resolves.toMatchObject({ kind: 'error', code: 'federation-capability-denied' })
  })

  it('binds directory requests to an explicit node and never routes openPath', async () => {
    const calls: [string, unknown][] = []
    const central = uplink(calls)
    await expect(central.handle({ path: '/api/host.listDirectory', rpcId: 'r', payload: { path: '/x' } }))
      .resolves.toMatchObject({ kind: 'error', code: 'federation-node-required' })
    await expect(central.handle({ path: '/api/host.listDirectory', rpcId: 'r', payload: { nodeId: local, path: '/x' } }))
      .resolves.toEqual({ kind: 'local-passthrough' })
    await expect(central.handle({ path: '/api/host.listDirectory', rpcId: 'r', payload: { nodeId: vmA, path: '/x' } }))
      .resolves.toMatchObject({ kind: 'ok' })
    await expect(central.handle({ path: '/api/host.openPath', rpcId: 'r', payload: { nodeId: vmA, path: '/x' } }))
      .resolves.toMatchObject({ kind: 'error', code: 'federation-forbidden-surface', status: 403 })
    expect(calls.map(([name]) => name)).toEqual(['vm-a:host.listDirectory'])
  })

  it('rejects an unclassified route that still carries a federated identity', async () => {
    const central = uplink([])
    await expect(central.handle({ path: '/api/subagent.prompt', rpcId: 'r', payload: { parentSessionId: remoteSession } }))
      .resolves.toMatchObject({ kind: 'error', code: 'federation-route-unclassified' })
    await expect(central.handle({ path: '/api/subagent.prompt', rpcId: 'r', payload: { parentSessionId: 'bare-native' } }))
      .resolves.toEqual({ kind: 'local-passthrough' })
  })
})

describe('host activation transaction (6.6, 6.7)', () => {
  function routes(paths: readonly string[], failAt?: number, order: string[] = []): RouteRegistration[] {
    return paths.map((path, index) => ({
      path,
      register() {
        if (index === failAt) throw new ActivationConflictError(path)
        order.push(`register:${path}`)
        return async () => { order.push(`dispose:${path}`) }
      },
    }))
  }

  it('commits READY once and stays idempotent', async () => {
    const coordinator = new HostActivationCoordinator()
    const prepare = vi.fn(async () => {})
    expect(await coordinator.activate({ prepare }, routes(['/api/a', '/api/b']))).toBe('HOST_READY')
    expect(await coordinator.activate({ prepare }, routes(['/api/a', '/api/b']))).toBe('HOST_READY')
    expect(coordinator.applyCount).toBe(1)
    expect(prepare).toHaveBeenCalledTimes(1)
  })

  it('rolls back in reverse order at every conflict position and publishes no partial takeover', async () => {
    const paths = ['/api/a', '/api/b', '/api/c']
    for (let failAt = 0; failAt < paths.length; failAt++) {
      const order: string[] = []
      const coordinator = new HostActivationCoordinator()
      expect(await coordinator.activate({ prepare: async () => {} }, routes(paths, failAt, order))).toBe('HOST_CONFLICT')
      expect(order.filter(entry => entry.startsWith('register:'))).toEqual(paths.slice(0, failAt).map(path => `register:${path}`))
      expect(order.filter(entry => entry.startsWith('dispose:'))).toEqual(paths.slice(0, failAt).reverse().map(path => `dispose:${path}`))
      expect(coordinator.state).toBe('HOST_CONFLICT')
    }
  })

  it('fails without registering when prerequisites are not ready, and deactivates in reverse', async () => {
    const order: string[] = []
    const coordinator = new HostActivationCoordinator()
    expect(await coordinator.activate({ prepare: async () => { throw new Error('core not ready') } }, routes(['/api/a'], undefined, order))).toBe('HOST_FAILED')
    expect(order).toEqual([])
    expect(coordinator.diagnostic).toMatch(/core not ready/)

    const ready = new HostActivationCoordinator()
    const disposeOrder: string[] = []
    expect(await ready.activate({ prepare: async () => {} }, routes(['/api/a', '/api/b'], undefined, disposeOrder))).toBe('HOST_READY')
    await ready.deactivate()
    expect(disposeOrder.filter(entry => entry.startsWith('dispose:'))).toEqual(['dispose:/api/b', 'dispose:/api/a'])
    expect(ready.state).toBe('HOST_DISABLED')
  })
})
