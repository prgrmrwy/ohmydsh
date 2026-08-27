import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { FederationBridge, type FederatedNodeFacts, type NodeRuntimeBinding } from './bridge.js'
import { NodeProjectionRuntime, type NodeBaseline, type NodeSessionSummary, type NodeWorkspaceView } from './node-runtime.js'

/** Per-node browser projections, keyed by node id. */
export interface NodeRuntimeRegistry {
  get(nodeId: FederatedNodeFacts['nodeId']): NodeProjectionRuntime | undefined
}

/** The Connection surface this module needs; kept minimal on purpose. */
function parseNodeBaseline(nodeId: FederatedNodeFacts['nodeId'], value: unknown): NodeBaseline {
  if (typeof value !== 'object' || value === null) throw new Error('node baseline must be an object')
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.workspaces) || !Array.isArray(record.sessions) || !Array.isArray(record.archivedSessionIds)) {
    throw new Error('node baseline arrays are required')
  }
  const workspacePrefix = `fed1:${nodeId}:w:`
  const sessionPrefix = `fed1:${nodeId}:s:`
  const workspaces = record.workspaces.map((value, index): NodeWorkspaceView => {
    if (typeof value !== 'object' || value === null) throw new Error(`workspace ${index} must be an object`)
    const row = value as Record<string, unknown>
    if (
      typeof row.workspaceId !== 'string' || !row.workspaceId.startsWith(workspacePrefix)
      || typeof row.path !== 'string' || typeof row.title !== 'string'
      || typeof row.createdAt !== 'string' || typeof row.updatedAt !== 'string'
      || !Array.isArray(row.sessionIds)
      || !row.sessionIds.every(id => typeof id === 'string' && id.startsWith(sessionPrefix))
    ) throw new Error(`workspace ${index} is not a valid ${nodeId} baseline row`)
    return row as unknown as NodeWorkspaceView
  })
  const sessions = record.sessions.map((value, index): NodeSessionSummary => {
    if (typeof value !== 'object' || value === null) throw new Error(`session ${index} must be an object`)
    const row = value as Record<string, unknown>
    if (
      typeof row.id !== 'string' || !row.id.startsWith(sessionPrefix)
      || typeof row.displayTitle !== 'string' || typeof row.cwd !== 'string'
      || typeof row.running !== 'boolean' || typeof row.blank !== 'boolean'
      || typeof row.updatedAt !== 'number' || !Number.isFinite(row.updatedAt)
    ) throw new Error(`session ${index} is not a valid ${nodeId} baseline row`)
    return row as unknown as NodeSessionSummary
  })
  const archivedSessionIds = record.archivedSessionIds.map((id, index) => {
    if (typeof id !== 'string' || !id.startsWith(sessionPrefix)) throw new Error(`archived session ${index} has wrong owner`)
    return id as NodeBaseline['archivedSessionIds'][number]
  })
  return { workspaces, sessions, archivedSessionIds }
}

interface ConnectionLike {
  readonly rpc: {
    call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{
      readonly ok: boolean
      readonly value?: unknown
      readonly error?: { readonly message?: string }
    }>
  }
}

/**
 * Builds the browser-side bridge from the live `ClientContext`.
 *
 * Per-node runtime hooks are only produced for a node the Host has published AND
 * for which the federated projections are available. Until that runtime layer
 * lands for remote nodes, `bindingFor` returns `undefined` for them, so the
 * bridge stays not-ready and the official UI keeps winning — an explicitly
 * conservative default rather than a half-rendered federated sidebar.
 */
export function createRuntimeBridge(ctx: ClientContext): FederationBridge | undefined {
  const connection = ctx.get('connection') as ConnectionLike | undefined
  if (connection?.rpc === undefined) return undefined

  // One projection per remote node, fed by the federated frame pump.
  const runtimes = new Map<string, NodeProjectionRuntime>()
  const registry: NodeRuntimeRegistry = { get: nodeId => runtimes.get(nodeId) }

  const bridge: FederationBridge = new FederationBridge({
    rpc: connection.rpc,
    bindingFor: node => bindingForNode(ctx, node, registry),
    onChange: () => { /* the shell re-reads on render */ },
  })

  // Load each remote node's baseline, then keep it current from central frames.
  const hydrate = async (): Promise<void> => {
    for (const node of bridge.nodes()) {
      if (node.kind === 'local' || !node.enabled) continue
      if (runtimes.has(node.nodeId)) continue
      const runtime = new NodeProjectionRuntime(node.nodeId)
      runtimes.set(node.nodeId, runtime)
      try {
        const result = await connection.rpc.call('/api', 'federation/baseline', { nodeId: node.nodeId })
        if (result.ok) runtime.installBaseline(parseNodeBaseline(node.nodeId, result.value))
      } catch {
        // A failed baseline leaves the node not-ready; the bridge stays official.
      }
    }
  }

  void bridge.refresh().then(async () => {
    await hydrate()
    // Re-evaluate readiness now that remote baselines are installed.
    await bridge.refresh()
  })
  return bridge
}

/**
 * Node-scoped runtime binding.
 *
 * `This Mac` reads the official client stores directly. A remote node reads its
 * own `NodeProjectionRuntime`, which the federated frame pump keeps up to date
 * from central mux/host frames; a remote node with no installed baseline yields
 * `undefined`, so the browser stays official rather than rendering an empty
 * remote subtree.
 */
function bindingForNode(
  ctx: ClientContext,
  node: FederatedNodeFacts,
  runtimes?: NodeRuntimeRegistry,
): NodeRuntimeBinding | undefined {
  if (node.kind !== 'local') return remoteBinding(ctx, node, runtimes)
  const runtime = ctx as unknown as {
    sessions?: { list?: { getSnapshot(): unknown; subscribe(listener: () => void): () => void }; open?(id: string): void }
    workspaces?: { list?: { getSnapshot(): unknown; subscribe(listener: () => void): () => void } }
    locale?: { bind(namespace: string): (key: string, params?: Record<string, unknown>) => string }
  }
  const sessions = runtime.sessions?.list
  const workspaces = runtime.workspaces?.list
  if (sessions === undefined || workspaces === undefined) return undefined

  const hookOf = <T>(source: { getSnapshot(): unknown; subscribe(listener: () => void): () => void }) =>
    ((selector: (state: never) => T) => selector(source.getSnapshot() as never)) as never

  const workspaceOps = ctx as unknown as {
    workspaces: {
      startSession(workspaceId: string): void
      rename(workspaceId: string, title: string): Promise<unknown>
      delete(workspaceId: string): Promise<unknown>
      insertBefore(workspaceId: string, before?: string): Promise<unknown>
      archiveSession(sessionId: string): Promise<unknown>
      insertSessionBefore(workspaceId: string, sessionId: string, before?: string): Promise<unknown>
    }
    sessions: {
      open(sessionId: string): void
      fork(input: { sessionId: string; increaseTitle?: boolean }): Promise<string>
      binding(sessionId: string): { session?: { rename(title: string): Promise<{ ok: boolean; error?: { message: string } }> } } | undefined
    }
  }

  return {
    useSessions: hookOf(sessions),
    useWorkspaces: hookOf(workspaces),
    useStore: undefined as never,
    actions: undefined as never,
    startSession: workspaceId => { workspaceOps.workspaces.startSession(workspaceId as unknown as string) },
    open: sessionId => { workspaceOps.sessions.open(sessionId as unknown as string) },
    renameSession: async (sessionId, title) => {
      const session = workspaceOps.sessions.binding(sessionId as unknown as string)?.session
      if (session === undefined) throw new Error(`unknown session "${String(sessionId)}"`)
      const result = await session.rename(title)
      if (!result.ok) throw new Error(result.error?.message ?? 'rename failed')
    },
    forkSession: sessionId => {
      void workspaceOps.sessions.fork({ sessionId: sessionId as unknown as string, increaseTitle: true })
        .then(childId => { workspaceOps.sessions.open(childId) })
        .catch(() => { /* a failed fork keeps the current selection */ })
    },
    renameWorkspace: async (workspaceId, title) => { await workspaceOps.workspaces.rename(workspaceId as unknown as string, title) },
    deleteWorkspace: async workspaceId => { await workspaceOps.workspaces.delete(workspaceId as unknown as string) },
    insertWorkspaceBefore: async (workspaceId, before) => {
      await workspaceOps.workspaces.insertBefore(workspaceId as unknown as string, before as unknown as string | undefined)
    },
    archiveSession: async sessionId => { await workspaceOps.workspaces.archiveSession(sessionId as unknown as string) },
    insertSessionBefore: async (workspaceId, sessionId, before) => {
      await workspaceOps.workspaces.insertSessionBefore(
        workspaceId as unknown as string,
        sessionId as unknown as string,
        before as unknown as string | undefined,
      )
    },
    t: runtime.locale?.bind('workspace') ?? ((key: string) => key),
  } as NodeRuntimeBinding
}

/**
 * Binding for a remote node, backed by its browser projection.
 *
 * Reads come from the node's own `NodeProjectionRuntime`; writes go through the
 * central uplink over the generic Connection channel, so every command carries
 * the federated id and is routed to its owning node by the Host.
 */
function remoteBinding(
  ctx: ClientContext,
  node: FederatedNodeFacts,
  runtimes?: NodeRuntimeRegistry,
): NodeRuntimeBinding | undefined {
  const runtime = runtimes?.get(node.nodeId)
  if (runtime === undefined || !runtime.ready) return undefined

  const connection = ctx.get('connection') as ConnectionLike | undefined
  const call = async (endpoint: string, payload: unknown): Promise<unknown> => {
    if (connection?.rpc === undefined) throw new Error('dsh-federation: no connection channel')
    const result = await connection.rpc.call('/api', endpoint, payload)
    if (!result.ok) throw new Error(result.error?.message ?? `${endpoint} failed`)
    return result.value
  }

  const hook = <T>(read: () => unknown) => ((selector: (state: never) => T) => selector(read() as never)) as never

  return {
    useSessions: hook(() => runtime.sessionsState),
    useWorkspaces: hook(() => runtime.workspacesState),
    useStore: undefined as never,
    actions: undefined as never,
    startSession: workspaceId => { void call('session.create', { workspaceId }) },
    open: sessionId => { void call('session.open', { sessionId }).catch(() => { /* selection is browser-local */ }) },
    renameSession: async (sessionId, title) => { await call('session.rename', { sessionId, title }) },
    forkSession: sessionId => { void call('session.fork', { sessionId }) },
    renameWorkspace: async (workspaceId, title) => { await call('workspace.rename', { workspaceId, title }) },
    deleteWorkspace: async workspaceId => { await call('workspace.delete', { workspaceId }) },
    insertWorkspaceBefore: async (workspaceId, before) => {
      await call('workspace.insertBefore', { workspaceId, ...(before === undefined ? {} : { beforeWorkspaceId: before }) })
    },
    archiveSession: async sessionId => { await call('workspace.archiveSession', { sessionId }) },
    insertSessionBefore: async (workspaceId, sessionId, before) => {
      await call('workspace.insertSessionBefore', {
        workspaceId, sessionId, ...(before === undefined ? {} : { beforeSessionId: before }),
      })
    },
    t: (ctx as unknown as { locale?: { bind(ns: string): (key: string) => string } }).locale?.bind('workspace')
      ?? ((key: string) => key),
  } as NodeRuntimeBinding
}
