import {
  NodeReconciler,
  type DshNodePort,
  type NativeSessionId,
  type NativeWorkspaceId,
  type NodeDescriptor,
  type SessionProjection,
  type WorkspaceProjection,
  WriteLedger,
} from '../core/index.js'
import { DualEventCarrier, type SocketFactory, type StreamDisconnect } from './carrier/index.js'
import { LedgeredNodePort } from './ledgered-port.js'
import {
  DshRc2NodeAdapter,
  validateRc2EventEnvelope,
  type Rc2StableEvent,
} from './remote-adapter/rc2/index.js'
import type { Rc2UnaryTransport } from './carrier/index.js'

export interface Rc2NodeWorkspaceView extends WorkspaceProjection {
  readonly workspaceId: WorkspaceProjection['id']
  readonly createdAt: string
  readonly updatedAt: string
}

export interface Rc2NodeSessionSummary extends SessionProjection {
  readonly displayTitle: string
  readonly cwd: string
  readonly running: boolean
  readonly blank: boolean
  readonly updatedAt: number
}

export interface Rc2NodeSnapshot {
  readonly workspaces: readonly Rc2NodeWorkspaceView[]
  readonly sessions: readonly Rc2NodeSessionSummary[]
  readonly archivedSessionIds: readonly string[]
}

export interface EstablishRc2NodeSessionOptions {
  readonly node: NodeDescriptor
  readonly endpoint: URL
  readonly generation: number
  readonly currentGeneration: () => number
  readonly transport: Rc2UnaryTransport
  readonly ledger: WriteLedger
  readonly createSocket: SocketFactory
  readonly timeoutMs?: number
  readonly onEvent?: (event: Rc2StableEvent) => void | Promise<void>
  readonly onDisconnect?: (disconnect: StreamDisconnect) => void
}

export interface Rc2NodeSession {
  readonly port: DshNodePort
  readonly reconciler: NodeReconciler<WorkspaceProjection, { readonly running: boolean }, unknown>
  isAuthoritative(): boolean
  snapshot(): Rc2NodeSnapshot
  dispose(): Promise<void>
}

/**
 * Establishes one authoritative rc.2 generation. Nothing is returned to the
 * caller (and therefore no port can be published) until both physical streams,
 * baseline replay and every required initial host refresh have converged.
 */
export async function establishRc2NodeSession(options: EstablishRc2NodeSessionOptions): Promise<Rc2NodeSession> {
  const unary = await DshRc2NodeAdapter.probeUnary(options.transport)
  if (unary.compatibility === 'INCOMPATIBLE') throw new Error(unary.diagnostic)

  let state: NodeDescriptor['state'] = 'CONNECTING'
  let effectiveCapabilities = unary.capabilities
  const descriptor: NodeDescriptor = {
    ...options.node,
    compatibility: unary.compatibility,
    get capabilities() { return effectiveCapabilities },
    get state() { return state },
  }
  const adapter = new DshRc2NodeAdapter(descriptor, options.transport, unary.capabilities)
  const reconciler = new NodeReconciler<WorkspaceProjection, { readonly running: boolean }, unknown>(descriptor.nodeId)
  const generation = reconciler.begin()
  if (generation !== options.generation) {
    // Reconciler generations are local monotonic tokens. For a newly-created
    // owner this is one; external transport generation remains authoritative in
    // Carrier. No identity is inferred from numeric equality.
  }
  let disconnected = false
  let published = false
  let refreshRequested = false
  let authoritativeState: Extract<NodeDescriptor['state'], 'READY' | 'DEGRADED'> = 'DEGRADED'
  let refreshDrain: Promise<void> | undefined
  let baselineSessions = new Map<NativeSessionId, SessionProjection>()

  async function refreshOnce(): Promise<void> {
    const token = reconciler.beginAuthoritativeRefresh(generation)
    if (token === undefined) throw new Error('cannot begin authoritative refresh')
    const [workspaces, sessions] = await Promise.all([
      adapter.listWorkspaces(), adapter.listSessions(),
    ])
    baselineSessions = new Map(sessions.map(session => [session.ref.nativeId, session]))
    if (!reconciler.commitAuthoritativeRefresh(
      generation, token,
      {
        workspaces: workspaces.map(workspace => ({ id: workspace.ref.nativeId, value: workspace })),
        statuses: sessions.map(session => ({ id: session.ref.nativeId, value: { running: session.status === 'running' } })),
      },
      sessions.map(session => ({ id: session.ref.nativeId, seq: session.seq ?? -1, value: session })),
    )) throw new Error('authoritative refresh lost generation ownership')
    if (disconnected || options.currentGeneration() !== options.generation) throw new Error('event stream disconnected during authoritative refresh')
  }

  async function drainRefreshes(): Promise<void> {
    while (reconciler.view()?.refreshRequired === true || refreshRequested) {
      refreshRequested = false
      await refreshOnce()
    }
    if (!disconnected && published) state = authoritativeState
  }

  function requestRefresh(): void {
    refreshRequested = true
    if (state !== 'READY' && state !== 'DEGRADED') return
    state = 'CONNECTING'
    if (refreshDrain !== undefined) return
    refreshDrain = drainRefreshes().catch(cause => {
      disconnected = true
      state = 'STALE'
      options.ledger.markConnectionLostForNode(descriptor.nodeId)
      options.onDisconnect?.({
        generation: options.generation, stream: 'host', code: 1011,
        reason: cause instanceof Error ? cause.message : 'authoritative refresh failed',
      })
    }).finally(() => { refreshDrain = undefined })
  }

  const carrier = new DualEventCarrier({
    endpoint: options.endpoint,
    generation: options.generation,
    currentGeneration: options.currentGeneration,
    createSocket: options.createSocket,
    validate: validateRc2EventEnvelope,
    onFrame: async frame => {
      const event = adapter.convertFrame(frame.stream, frame.value)
      if (event.kind === 'control' && (event.payload as { type?: unknown }).type === 'stream/error') {
        throw new Error(`${frame.stream} event stream reported stream/error`)
      }
      if (event.kind === 'reconciliation') {
        reconciler.accept(generation, event.frame)
      } else if (event.kind === 'refresh-required') {
        requestRefresh()
      }
      await options.onEvent?.(event)
    },
    onDisconnect: disconnect => {
      if (disconnected) return
      disconnected = true
      state = 'STALE'
      options.ledger.markConnectionLostForNode(descriptor.nodeId)
      options.onDisconnect?.(disconnect)
    },
  })

  try {
    const readiness = await carrier.open()
    const finalProbe = DshRc2NodeAdapter.finalizeProbe(unary, readiness)
    if (finalProbe.compatibility === 'INCOMPATIBLE') throw new Error(finalProbe.diagnostic)
    for (const capability of finalProbe.capabilities) (adapter.capabilities as Set<typeof capability>).add(capability)
    effectiveCapabilities = adapter.capabilities

    const install = async (): Promise<void> => {
      const [workspaces, sessions] = await Promise.all([
        adapter.listWorkspaces(), adapter.listSessions(),
      ])
      baselineSessions = new Map(sessions.map(session => [session.ref.nativeId, session]))
      const installed = reconciler.installBaseline(
        generation,
        {
          workspaces: workspaces.map(workspace => ({ id: workspace.ref.nativeId, value: workspace })),
          statuses: sessions.map(session => ({ id: session.ref.nativeId, value: { running: session.status === 'running' } })),
        },
        sessions.map(session => ({ id: session.ref.nativeId, seq: session.seq ?? -1, value: session })),
      )
      if (!installed || !reconciler.markStreamsReady(generation)) throw new Error('stale reconciliation generation')
    }

    await install()
    await carrier.whenIdle()
    if (disconnected || options.currentGeneration() !== options.generation) throw new Error('event stream disconnected before baseline publication')

    // Host frames have no cross-stream sequence. Any baseline-window host frame,
    // or an explicit whole-set marker, requires one authoritative refresh. Frames
    // received during refresh are buffered by NodeReconciler and replayed after
    // the replacement snapshot.
    await drainRefreshes()
    await carrier.whenIdle()
    await drainRefreshes()

    const view = reconciler.view()
    if (view?.ready !== true || view.refreshRequired) throw new Error('node reconciliation did not reach authoritative ready')

    // A prompt is the only rc.2 write with a persistent exact correlation key.
    // Reconcile from authoritative history only; equal content, status or title
    // is never evidence and no unknown write is replayed.
    const unknownPrompts = new Map<NativeSessionId, ReturnType<WriteLedger['unknownForNode']>[number][]>()
    for (const operation of options.ledger.unknownForNode(descriptor.nodeId)) {
      if (operation.kind !== 'prompt' || operation.rpcId === undefined || operation.sessionId === undefined) continue
      const grouped = unknownPrompts.get(operation.sessionId) ?? []
      grouped.push(operation)
      unknownPrompts.set(operation.sessionId, grouped)
    }
    for (const [sessionId, operations] of unknownPrompts) {
      const remaining = new Map(operations.map(operation => [operation.rpcId!, operation]))
      let beforeSeq: number | undefined
      for (let page = 0; page < 20 && remaining.size > 0; page += 1) {
        const history = await adapter.history(sessionId, beforeSeq === undefined ? {} : { beforeSeq })
        const record = history as { events?: unknown[]; hasMore?: unknown }
        const entries = Array.isArray(record.events) ? record.events : []
        let minimumSeq: number | undefined
        for (const entry of entries) {
          const event = (entry as { event?: unknown }).event
          if (typeof event !== 'object' || event === null) continue
          const row = event as { type?: unknown; seq?: unknown; data?: unknown }
          if (Number.isSafeInteger(row.seq)) minimumSeq = minimumSeq === undefined ? row.seq as number : Math.min(minimumSeq, row.seq as number)
          if (row.type !== 'user/message' || typeof row.data !== 'object' || row.data === null) continue
          const source = (row.data as { source?: unknown }).source
          if (typeof source !== 'object' || source === null || (source as { kind?: unknown }).kind !== 'user') continue
          const rpcId = (source as { rpcId?: unknown }).rpcId
          if (typeof rpcId !== 'string') continue
          const operation = remaining.get(rpcId as never)
          if (operation === undefined) continue
          options.ledger.reconcile(operation.operationId, { kind: 'prompt-rpc-id', rpcId: operation.rpcId! })
          remaining.delete(operation.rpcId!)
        }
        if (record.hasMore !== true || minimumSeq === undefined || minimumSeq === beforeSeq) break
        beforeSeq = minimumSeq
      }
    }

    // History reconciliation is the final blocking step before publication.
    // It may overlap a stream close or newly queued host marker, so converge one
    // final time and perform the READY commit synchronously after the last await.
    await carrier.whenIdle()
    await drainRefreshes()
    await carrier.whenIdle()
    await drainRefreshes()
    const finalView = reconciler.view()
    if (
      disconnected
      || options.currentGeneration() !== options.generation
      || finalView?.ready !== true
      || finalView.refreshRequired
    ) throw new Error('event stream disconnected or generation changed before publication')
    authoritativeState = finalProbe.compatibility === 'SUPPORTED' ? 'READY' : 'DEGRADED'
    published = true
    state = authoritativeState

    const snapshot = (): Rc2NodeSnapshot => {
      const current = reconciler.view()
      if (current === undefined) return { workspaces: [], sessions: [], archivedSessionIds: [] }
      const sessions: Rc2NodeSessionSummary[] = []
      for (const [nativeId, baseline] of baselineSessions) {
        if (!current.statuses.has(nativeId)) continue
        const status = current.statuses.get(nativeId)!
        const event = current.sessionEvents.get(nativeId)
        let title = baseline.title
        const payload = event?.value as { type?: string; key?: string; value?: unknown } | undefined
        if (payload?.type === 'session/projection' && payload.key === 'title' && typeof payload.value === 'string') title = payload.value
        sessions.push({
          ...baseline,
          title,
          status: status.running ? 'running' : 'idle',
          ...(event === undefined ? {} : { seq: event.seq }),
          displayTitle: title,
          cwd: baseline.path,
          running: status.running,
          blank: baseline.blank ?? false,
          updatedAt: baseline.updatedAt ?? 0,
        })
      }
      const workspaces: Rc2NodeWorkspaceView[] = [...current.workspaces.values()]
        .sort((a, b) => a.order - b.order)
        .map(workspace => ({
          ...workspace,
          workspaceId: workspace.id,
          createdAt: workspace.createdAt ?? '',
          updatedAt: workspace.updatedAt ?? '',
        }))
      return {
        workspaces,
        sessions,
        archivedSessionIds: workspaces.flatMap(workspace => workspace.archivedSessionIds),
      }
    }

    return {
      port: new LedgeredNodePort(adapter, options.ledger),
      reconciler,
      isAuthoritative: () => published
        && !disconnected
        && (state === 'READY' || state === 'DEGRADED')
        && !refreshRequested
        && refreshDrain === undefined
        && options.currentGeneration() === options.generation
        && reconciler.view()?.ready === true
        && reconciler.view()?.refreshRequired === false,
      snapshot,
      dispose: async () => { carrier.dispose() },
    }
  } catch (cause) {
    carrier.dispose()
    throw cause
  }
}
