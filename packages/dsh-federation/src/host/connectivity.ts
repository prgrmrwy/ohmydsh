import type { SocketFactory } from './carrier/events.js'
import { CarrierError, HttpUnaryCarrier } from './carrier/http.js'
import { DshRc2NodeAdapter, type Rc2ProbeResult } from './remote-adapter/rc2/index.js'
import {
  OpenSshTunnelManager,
  TunnelError,
  validateSshAlias,
  type TunnelManagerOptions,
  type TunnelReadiness,
} from './ssh.js'
import { WriteLedger } from '../core/ledger.js'
import type { DshNodePort } from '../core/port.js'
import type { NodeId, NodeState } from '../core/types.js'
import { establishRc2NodeSession, type Rc2NodeSession, type Rc2NodeSnapshot } from './rc2-node-session.js'
import { NodeReconnectBackoff } from './node-lifecycle.js'

/** Loopback endpoint a tunnel exposes for one node. */
export type NodeEndpoint = URL

export interface RegistryNodeEntry {
  readonly nodeId: NodeId
  readonly displayName: string
  readonly sshAlias: string
  readonly remoteDshPort: number
}

/** One node's live connection facts, published to the inventory. */
export interface NodeConnectionStatus {
  readonly state: NodeState
  readonly compatibility: 'SUPPORTED' | 'EXPERIMENTAL' | 'INCOMPATIBLE'
  readonly diagnostic: string
  readonly endpoint?: NodeEndpoint
}

export interface ConnectRegistryNodesOptions {
  readonly nodes: readonly RegistryNodeEntry[]
  /** Tunnel readiness probe; production performs a real host.describe. */
  readonly readinessProbe?: (endpoint: URL, signal: AbortSignal) => Promise<TunnelReadiness>
  readonly sshExecutable?: string
  readonly tunnel?: Omit<TunnelManagerOptions, 'readinessProbe'>
  readonly timeoutMs?: number
  /** Overrides the platform WebSocket factory; internal test seam only. */
  readonly createSocket?: SocketFactory
  /**
   * Pre-created tunnel manager. Callers that must bind signal cleanup before any
   * ssh child can exist supply it here, so a signal arriving during startup can
   * still reach the children this call spawns.
   */
  readonly tunnels?: OpenSshTunnelManager
}

export interface NodeConnections {
  readonly ports: ReadonlyMap<NodeId, DshNodePort>
  readonly statuses: ReadonlyMap<NodeId, NodeConnectionStatus>
  readonly snapshots: ReadonlyMap<NodeId, () => Rc2NodeSnapshot>
  readonly ledger: WriteLedger
  readonly tunnels: OpenSshTunnelManager
  /** Starts owning a node registered after startup; failures schedule retries. */
  attach(entry: RegistryNodeEntry): Promise<void>
  /** Stops owning a node that was disabled or deleted. */
  detach(nodeId: NodeId): Promise<void>
  dispose(): Promise<void>
}

export interface Rc2ReadinessOptions {
  readonly retryDelayMs?: number
  readonly probe?: (carrier: HttpUnaryCarrier, signal: AbortSignal) => Promise<Rc2ProbeResult>
}

/** Waits for an owned tunnel to answer the conservative unary rc.2 probe. */
export async function waitForRc2Readiness(
  endpoint: URL,
  signal: AbortSignal,
  options: Rc2ReadinessOptions = {},
): Promise<TunnelReadiness> {
  const retryDelayMs = options.retryDelayMs ?? 50
  const carrier = new HttpUnaryCarrier({ endpoint, generation: 1, currentGeneration: () => 1, timeoutMs: 2_000 })
  const probe = options.probe ?? ((transport, currentSignal) => DshRc2NodeAdapter.probeUnary(
    transport, { signal: currentSignal },
  ))
  for (;;) {
    try {
      const result = await probe(carrier, signal)
      if (result.compatibility === 'SUPPORTED' || result.compatibility === 'EXPERIMENTAL') {
        return { ok: true, state: 'READY', diagnostic: `rc.2 probe reported ${result.compatibility}` }
      }
      return { ok: false, state: 'INCOMPATIBLE', diagnostic: result.diagnostic }
    } catch (cause) {
      if (signal.aborted) return { ok: false, state: 'DSH_UNAVAILABLE', diagnostic: 'readiness probe aborted' }
      if (!(cause instanceof CarrierError) || !cause.retryable || (cause.kind !== 'Transport' && cause.kind !== 'Aborted')) {
        return {
          ok: false,
          state: cause instanceof CarrierError && cause.kind === 'Protocol' ? 'NON_DSH_SERVICE' : 'DSH_UNAVAILABLE',
          diagnostic: cause instanceof Error ? cause.message : 'probe failed',
        }
      }
      await abortableDelay(retryDelayMs, signal)
    }
  }
}

const defaultReadiness = waitForRc2Readiness

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise(resolve => {
    const timer = setTimeout(done, milliseconds)
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

/**
 * Connects enabled remotes and owns their complete generation/reconnect loop.
 * Reconnect only recreates central-owned SSH/WebSocket resources; it never
 * installs, starts or stops a remote DSH and never replays an unknown write.
 */
export async function connectRegistryNodes(options: ConnectRegistryNodesOptions): Promise<NodeConnections> {
  const tunnels = options.tunnels ?? new OpenSshTunnelManager({
    ...(options.tunnel === undefined ? {} : options.tunnel),
    readinessProbe: options.readinessProbe ?? defaultReadiness,
    ...(options.sshExecutable === undefined ? {} : { sshExecutable: options.sshExecutable }),
  })
  const statuses = new Map<NodeId, NodeConnectionStatus>()
  const ports = new Map<NodeId, DshNodePort>()
  const snapshots = new Map<NodeId, () => Rc2NodeSnapshot>()
  const ledger = new WriteLedger()
  const activeGenerations = new Map<NodeId, number>()
  const currentSessions = new Map<NodeId, Rc2NodeSession>()
  const reconnectJobs = new Map<NodeId, Promise<void>>()
  const detached = new Set<NodeId>()
  const shutdown = new AbortController()
  const backoff = new NodeReconnectBackoff(tunnels)
  const createSocket: SocketFactory = options.createSocket ?? (url => new WebSocket(url))

  const classify = (entry: RegistryNodeEntry, cause: unknown): void => {
    statuses.set(entry.nodeId, {
      state: cause instanceof TunnelError ? cause.state : 'SSH_UNREACHABLE',
      compatibility: 'INCOMPATIBLE',
      diagnostic: cause instanceof TunnelError
        ? cause.diagnostic
        : cause instanceof Error ? cause.message : String(cause),
    })
  }

  const connectOne = async (entry: RegistryNodeEntry): Promise<void> => {
    validateSshAlias(entry.sshAlias)
    const handle = await tunnels.connect({
      nodeId: entry.nodeId,
      sshAlias: entry.sshAlias,
      remoteDshPort: entry.remoteDshPort,
    })
    if (shutdown.signal.aborted) { await handle.dispose(); return }
    activeGenerations.set(entry.nodeId, handle.generation)
    const transport = new HttpUnaryCarrier({
      endpoint: handle.endpoint,
      generation: handle.generation,
      currentGeneration: () => activeGenerations.get(entry.nodeId) ?? -1,
      timeoutMs: options.timeoutMs ?? 30_000,
    })
    let compatibility: NodeConnectionStatus['compatibility'] = 'INCOMPATIBLE'
    const session = await establishRc2NodeSession({
      node: {
        nodeId: entry.nodeId, kind: 'remote', displayName: entry.displayName,
        enabled: true, order: 0, capabilities: new Set(), state: 'CONNECTING',
        compatibility: 'INCOMPATIBLE', sshAlias: entry.sshAlias,
        remoteDshPort: entry.remoteDshPort,
      },
      endpoint: handle.endpoint,
      generation: handle.generation,
      currentGeneration: () => activeGenerations.get(entry.nodeId) ?? -1,
      transport,
      ledger,
      createSocket,
      onDisconnect: disconnect => {
        if (activeGenerations.get(entry.nodeId) !== disconnect.generation) return
        activeGenerations.delete(entry.nodeId)
        ports.delete(entry.nodeId)
        snapshots.delete(entry.nodeId)
        statuses.set(entry.nodeId, {
          state: 'STALE', compatibility,
          diagnostic: `${disconnect.stream} event stream disconnected (${disconnect.code}${disconnect.reason === '' ? '' : `: ${disconnect.reason}`})`,
        })
        scheduleReconnect(entry)
      },
    })
    compatibility = session.port.node.compatibility
    if (shutdown.signal.aborted || !session.isAuthoritative()) {
      await session.dispose()
      await handle.dispose()
      if (!shutdown.signal.aborted) throw new Error('node generation lost authority before port publication')
      return
    }
    const previous = currentSessions.get(entry.nodeId)
    currentSessions.set(entry.nodeId, session)
    if (previous !== undefined && previous !== session) await previous.dispose()
    ports.set(entry.nodeId, session.port)
    snapshots.set(entry.nodeId, () => {
      if (!session.isAuthoritative()) throw new Error(`node ${entry.nodeId} is not authoritative`)
      return session.snapshot()
    })
    statuses.set(entry.nodeId, {
      state: session.port.node.state,
      compatibility: session.port.node.compatibility,
      diagnostic: `connected through ${entry.sshAlias}:${entry.remoteDshPort}; baseline and dual streams authoritative`,
      endpoint: handle.endpoint,
    })
    backoff.reset(entry.nodeId)
  }

  function scheduleReconnect(entry: RegistryNodeEntry): void {
    if (shutdown.signal.aborted || detached.has(entry.nodeId) || reconnectJobs.has(entry.nodeId)) return
    const job = (async () => {
      while (!shutdown.signal.aborted && !detached.has(entry.nodeId) && !ports.has(entry.nodeId)) {
        const delay = backoff.next(entry.nodeId)
        statuses.set(entry.nodeId, {
          state: 'CONNECTING', compatibility: statuses.get(entry.nodeId)?.compatibility ?? 'INCOMPATIBLE',
          diagnostic: `reconnecting after ${delay}ms backoff`,
        })
        await abortableDelay(delay, shutdown.signal)
        if (shutdown.signal.aborted || detached.has(entry.nodeId)) return
        await currentSessions.get(entry.nodeId)?.dispose()
        currentSessions.delete(entry.nodeId)
        await tunnels.disposeNode(entry.nodeId)
        try {
          await connectOne(entry)
          return
        } catch (cause) {
          if (!shutdown.signal.aborted) classify(entry, cause)
        }
      }
    })().finally(() => { reconnectJobs.delete(entry.nodeId) })
    reconnectJobs.set(entry.nodeId, job)
  }

  await Promise.all(options.nodes.map(async entry => {
    try {
      await connectOne(entry)
    } catch (cause) {
      classify(entry, cause)
      scheduleReconnect(entry)
    }
  }))

  return {
    ports, statuses, snapshots, ledger, tunnels,
    attach: async entry => {
      if (shutdown.signal.aborted || ports.has(entry.nodeId)) return
      try {
        await connectOne(entry)
      } catch (cause) {
        classify(entry, cause)
        scheduleReconnect(entry)
      }
    },
    detach: async nodeId => {
      // Deleting or disabling a node must stop its reconnect loop and release
      // the resources this Host owns for it.
      detached.add(nodeId)
      activeGenerations.delete(nodeId)
      ports.delete(nodeId)
      snapshots.delete(nodeId)
      statuses.delete(nodeId)
      const session = currentSessions.get(nodeId)
      currentSessions.delete(nodeId)
      await session?.dispose()
      await tunnels.disposeNode(nodeId)
      await reconnectJobs.get(nodeId)?.catch(() => {})
      detached.delete(nodeId)
    },
    dispose: async () => {
      shutdown.abort(new Error('node connections disposed'))
      activeGenerations.clear()
      await Promise.allSettled([...currentSessions.values()].map(session => session.dispose()))
      await tunnels.disposeAll()
      await Promise.allSettled(reconnectJobs.values())
    },
  }
}
