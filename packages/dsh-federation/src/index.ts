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
import { CommandRouter, NodeRegistryModel, type NodeId } from './core/index.js'
import {
  CentralUplink,
  HostActivationCoordinator,
  NodeRegistryStorage,
  type FederationInventory,
} from './host/index.js'

export const name = 'dsh-federation'
export const inject = ['webServer', 'connection']

export interface FederationHostConfig {
  /** Overrides `$DSH_HOME`; primarily a test seam. */
  readonly dshHome?: string
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

    void (async () => {
      const registry = await readRegistry(home)
      if (disposed || registry === undefined || registry.enabledRemotes === 0) return

      // Ports are populated by the registry/tunnel flow; an empty map still
      // yields a valid uplink that declines every request to the native chain.
      // The router must know every REGISTERED node, not only connected ones, so
      // an id for a node whose tunnel is still down is reported as a routing
      // failure rather than as a forged identity.
      const router = new CommandRouter(new Map(), registry.knownNodes)

      // Inventory the federated browser reads: node facts plus a per-node
      // baseline, derived from the registry and live ports only. No settings,
      // credentials or subscription data crosses this seam.
      const inventory: FederationInventory = {
        nodes: async () => registry.nodes.map(node => ({
          nodeId: node.nodeId,
          displayName: node.displayName,
          kind: node.kind,
          enabled: node.enabled,
          order: node.order,
          // The registry stores durable config only; liveness and compatibility
          // are runtime facts owned by the node lifecycle. Until a connected
          // port publishes them, report the honest "not yet connected" pair
          // rather than an optimistic READY/SUPPORTED.
          state: 'CONNECTING',
          compatibility: 'EXPERIMENTAL',
          runningSessionCount: 0,
          pendingInteractionCount: 0,
        })),
        baseline: async (nodeId, options) => {
          // A node without a live port has no provable baseline; refusing here
          // keeps the browser official instead of showing an empty subtree.
          const workspaces = await router.workspaceList(nodeId, options?.signal)
          const sessions = await router.sessionList(nodeId, options?.signal)
          return { workspaces, sessions, archivedSessionIds: [] }
        },
      }

      const uplink = new CentralUplink(router, registry.knownNodes, registry.localNodeId, inventory)

      const state = await coordinator.activate({ prepare: async () => {} }, [{
        path: '/api',
        register: () => {
          const owner = ctx.get('connection') as ConnectionApiOwner | undefined
          if (owner === undefined) throw new Error('dsh-federation: the patched Connection service is unavailable')
          const dispose = owner.api.use(async (request, next) => {
            const url = new URL(request.url)
            let payload: Record<string, unknown> = {}
            try {
              payload = (await request.clone().json()) as Record<string, unknown>
            } catch {
              // Bodyless or non-JSON requests carry no federated identity.
              return next.fetch(request)
            }
            const outcome = await uplink.handle({
              path: url.pathname,
              rpcId: typeof payload.rpcId === 'string' ? payload.rpcId : 'federation',
              payload,
            })
            // The client's generic RPC channel parses a full server-response and
            // REJECTS a mismatched rpcId, so the reply must echo the request's
            // rpcId. Omitting it makes every federation call throw.
            const rpcId = typeof payload.rpcId === 'string' ? payload.rpcId : 'federation'
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
      void (release?.() ?? coordinator.deactivate())
    }
  }, 'dsh-federation: host activation')
}

export * from './contract/index.js'
export * from './core/index.js'
export * from './host/index.js'
