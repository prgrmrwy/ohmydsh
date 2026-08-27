/**
 * Host entry for the federated DSH control plane.
 *
 * Composition is deliberately conservative. Federation claims the single `/api`
 * outer middleware seam — inside the patched Connection's Host/Origin trust
 * fence and before the composed Typert-first handler — only when a node registry
 * actually exists and declares at least one enabled remote. A registry that is
 * absent, unreadable or remote-free leaves the Host completely untouched, so a
 * deployed-but-unused federation is indistinguishable from an absent one.
 *
 * Node adapters, tunnels and carriers are attached by the operator-facing
 * registry flow; until a node is connected the middleware routes nothing and
 * every request reaches the unmodified native chain.
 */
import type { Context } from '@deepseek-ai/cordis'
import { clientRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { CommandRouter, NodeRegistryModel, type NodeId } from './core/index.js'
import {
  CentralUplink,
  HostActivationCoordinator,
  NodeRegistryStorage,
  NodeRegistryService,
  OpenSshTunnelManager,
  RetainedDiagnosticsStore,
  bindCatchableShutdown,
  connectRegistryNodes,
  probeSshIdentity,
  waitForRc2Readiness,
  type FederationInventory,
  type NodeConnections,
  type SignalSource,
} from './host/index.js'

export const name = 'dsh-federation'
export const inject = ['webServer', 'connection']

export interface FederationHostConfig {
  /** Overrides `$DSH_HOME`; primarily a test seam. */
  readonly dshHome?: string
  /** Overrides `/usr/bin/ssh`; internal real-sshd test seam only. */
  readonly sshExecutable?: string
  /** Overrides the process signal source; internal test seam only. */
  readonly signalSource?: SignalSource
}

/** Minimal view of the patched Connection service this entry depends on. */
interface ConnectionApiOwner {
  readonly api: {
    use(middleware: (request: Request, next: { fetch(request: Request): Promise<Response> }) => Promise<Response>): unknown
  }
}

interface RegistryFacts {
  readonly localNodeId: NodeId
  readonly knownNodes: ReadonlySet<NodeId>
  readonly enabledRemotes: number
  readonly nodes: readonly {
    readonly nodeId: NodeId
    readonly displayName: string
    readonly kind: 'local' | 'remote'
    readonly enabled: boolean
    readonly order: number
    readonly sshAlias?: string
    readonly remoteDshPort?: number
  }[]
}

/** Reads the registry without ever creating or repairing it. */
async function readRegistry(home: string): Promise<RegistryFacts | undefined> {
  try {
    const loaded = await new NodeRegistryStorage(home).load()
    if (loaded.status !== 'loaded' || loaded.snapshot === undefined) return undefined
    const snapshot = new NodeRegistryModel(loaded.snapshot).snapshot
    return {
      localNodeId: snapshot.localNodeId,
      knownNodes: new Set(snapshot.nodes.map(node => node.nodeId)),
      enabledRemotes: snapshot.nodes.filter(node => node.kind === 'remote' && node.enabled).length,
      nodes: snapshot.nodes.map(node => ({
        nodeId: node.nodeId,
        displayName: node.displayName,
        kind: node.kind,
        enabled: node.enabled,
        order: node.order,
        ...(node.kind === 'remote' && typeof node.sshAlias === 'string' ? { sshAlias: node.sshAlias } : {}),
        ...(node.kind === 'remote' ? { remoteDshPort: node.remoteDshPort } : {}),
      })),
    }
  } catch {
    // A corrupt, symlinked or over-permissive registry must not activate
    // federation, and must never be rewritten from here.
    return undefined
  }
}

export function apply(ctx: Context, config?: FederationHostConfig): void {
  const home = config?.dshHome ?? process.env.DSH_HOME
  if (home === undefined || home === '') return

  const coordinator = new HostActivationCoordinator()
  ctx.effect(() => {
    let disposed = false
    let release: (() => Promise<void>) | undefined
    let connections: NodeConnections | undefined
    let unbindShutdown: (() => void) | undefined

    void (async () => {
      const registry = await readRegistry(home)
      if (disposed || registry === undefined || registry.enabledRemotes === 0) return

      // The tunnel manager must exist before any ssh child does, and the signal
      // disposer must be bound to THAT instance. Binding to a closure over a
      // not-yet-assigned `connections` would make a signal during the (multi
      // second) startup window a no-op and orphan every spawned tunnel.
      const tunnels = new OpenSshTunnelManager({
        readinessProbe: waitForRc2Readiness,
        ...(config?.sshExecutable === undefined ? {} : { sshExecutable: config.sshExecutable }),
      })
      unbindShutdown = bindCatchableShutdown({
        tunnels,
        ready: () => connections !== undefined,
        dispose: async () => {
          disposed = true
          await connections?.dispose()
        },
      }, config?.signalSource ?? process)

      // Connect every enabled remote through a real OpenSSH loopback tunnel and
      // probe it structurally. One unreachable node is contained as a status.
      connections = await connectRegistryNodes({
        tunnels,
        nodes: registry.nodes
          .filter(node => node.kind === 'remote' && node.enabled)
          .map(node => ({
            nodeId: node.nodeId,
            displayName: node.displayName,
            sshAlias: node.sshAlias ?? node.displayName,
            remoteDshPort: node.remoteDshPort ?? 3080,
          })),
        ...(config?.sshExecutable === undefined ? {} : { sshExecutable: config.sshExecutable }),
      })
      if (disposed) {
        void connections.dispose()
        return
      }

      // The router must know every REGISTERED node, not only connected ones, so
      // an id for a node whose tunnel is still down is reported as a routing
      // failure rather than as a forged identity.
      // Node management mutates the registry after startup, so the router must
      // consult the live known-node set instead of a startup copy.
      let currentRegistry = registry
      const knownNodes = new Set(registry.knownNodes)
      const router = new CommandRouter(connections.ports, knownNodes)
      const retainedDiagnostics = new RetainedDiagnosticsStore(home)
      const manager = new NodeRegistryService({
        dshHome: home,
        ledger: connections.ledger,
        tunnels: connections.tunnels,
        localNodeId: registry.localNodeId,
        diagnostics: retainedDiagnostics,
        ...(config?.sshExecutable === undefined
          ? {}
          : { probeIdentity: async (alias: string) => {
            const probe = await probeSshIdentity(alias, { sshExecutable: config.sshExecutable! })
            return { ok: probe.ok, diagnostic: probe.diagnostic }
          } }),
      })

      /**
       * Re-reads the persisted registry and reconciles owned connections with
       * it: newly enabled remotes are attached, disabled or deleted ones are
       * released. Reads never trust a stale startup snapshot.
       */
      const refreshRegistry = async (): Promise<RegistryFacts> => {
        const latest = await readRegistry(home)
        if (latest === undefined) return currentRegistry
        currentRegistry = latest
        knownNodes.clear()
        for (const nodeId of latest.knownNodes) knownNodes.add(nodeId)
        if (connections === undefined) return latest
        const live = connections
        const wanted = new Map(latest.nodes
          .filter(node => node.kind === 'remote' && node.enabled)
          .map(node => [node.nodeId, {
            nodeId: node.nodeId,
            displayName: node.displayName,
            sshAlias: node.sshAlias ?? node.displayName,
            remoteDshPort: node.remoteDshPort ?? 3080,
          }]))
        for (const nodeId of [...live.statuses.keys(), ...live.ports.keys()]) {
          if (!wanted.has(nodeId)) await live.detach(nodeId)
        }
        for (const [nodeId, entry] of wanted) {
          if (!live.statuses.has(nodeId) && !live.ports.has(nodeId)) void live.attach(entry)
        }
        return latest
      }

      // Inventory the federated browser reads: node facts plus a per-node
      // baseline, derived from the registry and live connections. A node the
      // tunnel could not reach is reported with its real failure state, never
      // as optimistic READY. No settings, credentials or subscription data
      // crosses this seam.
      const inventory: FederationInventory = {
        nodes: async () => (await refreshRegistry()).nodes.map(node => {
          const live = connections?.statuses.get(node.nodeId)
          return {
            nodeId: node.nodeId,
            displayName: node.displayName,
            kind: node.kind,
            enabled: node.enabled,
            order: node.order,
            state: live?.state ?? (node.kind === 'remote' && node.enabled ? 'CONNECTING' : 'DISABLED'),
            compatibility: live?.compatibility ?? 'INCOMPATIBLE',
            diagnostic: live?.diagnostic,
            runningSessionCount: 0,
            pendingInteractionCount: 0,
            outcomeUnknownCount: node.kind === 'remote'
              ? connections?.ledger.unknownForNode(node.nodeId).length ?? 0
              : 0,
          }
        }),
        // Live unknown writes plus diagnostics retained from deleted nodes, so
        // deleting a node never erases the evidence an outcome was unproven.
        operations: async () => [
          ...(connections?.ledger.unknownDiagnostics() ?? []),
          ...(await retainedDiagnostics.list()),
        ],
        clearOperations: async operationIds => retainedDiagnostics.clear(operationIds),
        // Real node management: identity-gated saves, CAS-committed registry
        // writes, and deletion that refuses without confirmation while
        // outcome-unknown writes remain. Every mutation reconciles the owned
        // connections so the change takes effect without a Host restart.
        manager: {
          addNode: async request => {
            const created = await manager.addNode(request)
            await refreshRegistry()
            return created
          },
          updateNode: async (nodeId, update) => {
            const updated = await manager.updateNode(nodeId, update)
            await refreshRegistry()
            return updated
          },
          reorderNode: async (nodeId, beforeNodeId) => {
            const snapshot = await manager.reorderNode(nodeId, beforeNodeId)
            await refreshRegistry()
            return snapshot
          },
          removeNode: async (nodeId, confirmed) => {
            const result = await manager.removeNode(nodeId, confirmed)
            await refreshRegistry()
            return result
          },
        },
        baseline: async (nodeId, _options) => {
          // Only expose the generation-owned committed snapshot. Re-running raw
          // lists here would bypass NodeReconciler and reopen the list/subscribe
          // race after READY.
          const snapshot = connections?.snapshots.get(nodeId)
          if (snapshot === undefined) throw new Error(`node ${nodeId} has no authoritative baseline`)
          return snapshot()
        },
      }

      const uplink = new CentralUplink(router, knownNodes, registry.localNodeId, inventory)

      const state = await coordinator.activate({ prepare: async () => {} }, [{
        path: '/api',
        register: () => {
          const owner = ctx.get('connection') as ConnectionApiOwner | undefined
          if (owner === undefined) throw new Error('dsh-federation: the patched Connection service is unavailable')
          const dispose = owner.api.use(async (request, next) => {
            const url = new URL(request.url)
            let raw: unknown
            try {
              raw = await request.clone().json()
            } catch {
              // Bodyless or non-JSON requests carry no federated identity.
              return next.fetch(request)
            }
            let envelope
            try {
              envelope = clientRequestSchema.parse(raw)
            } catch {
              // Connection also carries client-response messages. Leave every
              // non-client-request on the official chain unless it attempts to
              // smuggle a reserved federated identity through an unclassified
              // shape.
              if (JSON.stringify(raw).includes('fed1:')) {
                return Response.json({
                  type: 'server-response', rpcId: 'federation',
                  result: { ok: false, error: { code: 'federation-route-unclassified', message: 'malformed request carries a federated identity' } },
                }, { status: 400 })
              }
              return next.fetch(request)
            }
            const expectedPath = `/api/${envelope.method}`
            if (url.pathname !== expectedPath) {
              return Response.json({
                type: 'server-response', rpcId: envelope.rpcId,
                result: { ok: false, error: { code: 'federation-route-unclassified', message: 'request path does not match RPC method' } },
              }, { status: 400 })
            }
            const payload = typeof envelope.payload === 'object' && envelope.payload !== null && !Array.isArray(envelope.payload)
              ? envelope.payload as Record<string, unknown>
              : {}
            const outcome = await uplink.handle({
              path: expectedPath,
              rpcId: envelope.rpcId,
              payload,
            })
            // The client's generic RPC channel parses a full server-response and
            // REJECTS a mismatched rpcId, so the reply must echo the request's
            // rpcId. Omitting it makes every federation call throw.
            const rpcId = envelope.rpcId
            if (outcome.kind === 'ok') {
              return Response.json({ type: 'server-response', rpcId, result: { ok: true, value: outcome.value ?? null } })
            }
            if (outcome.kind === 'error') {
              return Response.json({
                type: 'server-response', rpcId,
                result: { ok: false, error: { code: outcome.code, message: outcome.message } },
              }, { status: outcome.status })
            }
            // Bare native ids belong to This Mac: the untouched native chain.
            return next.fetch(request)
          })
          return async () => { await (dispose as () => unknown | Promise<unknown>)() }
        },
      }])
      if (disposed || state !== 'HOST_READY') return
      release = () => coordinator.deactivate()
    })()

    return () => {
      disposed = true
      unbindShutdown?.()
      unbindShutdown = undefined
      void connections?.dispose()
      void (release?.() ?? coordinator.deactivate())
    }
  }, 'dsh-federation: host activation')
}

export * from './contract/index.js'
export * from './core/index.js'
export * from './host/index.js'
