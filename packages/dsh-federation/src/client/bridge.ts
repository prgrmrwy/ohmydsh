import type { NodeId, NodeState } from '../core/types.js'
import type { FederationClientBridge } from './entry.js'
import type { NodeSectionBinding } from './shell/NodeShell.js'

/** Node facts the Host publishes to a federated browser. */
export interface FederatedNodeFacts {
  readonly nodeId: NodeId
  readonly displayName: string
  readonly kind: 'local' | 'remote'
  readonly enabled: boolean
  readonly order: number
  readonly state: NodeState
  readonly compatibility: 'SUPPORTED' | 'EXPERIMENTAL' | 'INCOMPATIBLE'
  readonly runningSessionCount: number
  readonly pendingInteractionCount: number
  readonly outcomeUnknownCount: number
  readonly home?: string
}

/** The generic Connection channel the bridge uses; no official route is touched. */
export interface FederationRpcChannel {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{
    readonly ok: boolean
    readonly value?: unknown
    readonly error?: { readonly message?: string }
  }>
}

/** Per-node runtime hooks the official subtree consumes, minus shell-owned props. */
export type NodeRuntimeBinding = Omit<NodeSectionBinding, 'row' | 'home'>

export interface FederationBridgeOptions {
  readonly rpc: FederationRpcChannel
  /**
   * Builds the node-scoped runtime hooks/actions for one node. Supplied by the
   * federated runtime layer, which owns the projections and command routing.
   */
  bindingFor(node: FederatedNodeFacts): NodeRuntimeBinding | undefined
  /** Notified whenever the node set changes, so the shell can re-render. */
  onChange?: () => void
  readonly channel?: string
  readonly endpoint?: string
}

function parseNodes(value: unknown): readonly FederatedNodeFacts[] {
  if (typeof value !== 'object' || value === null) return []
  const nodes = (value as { nodes?: unknown }).nodes
  if (!Array.isArray(nodes)) return []
  const parsed: FederatedNodeFacts[] = []
  for (const entry of nodes) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    if (typeof record.nodeId !== 'string' || record.nodeId === '') continue
    if (record.kind !== 'local' && record.kind !== 'remote') continue
    parsed.push({
      nodeId: record.nodeId as NodeId,
      displayName: typeof record.displayName === 'string' ? record.displayName : record.nodeId,
      kind: record.kind,
      enabled: record.enabled === true,
      order: typeof record.order === 'number' ? record.order : 0,
      state: typeof record.state === 'string' ? record.state as NodeState : 'CONNECTING',
      compatibility: record.compatibility === 'SUPPORTED' || record.compatibility === 'EXPERIMENTAL'
        ? record.compatibility
        : 'INCOMPATIBLE',
      runningSessionCount: typeof record.runningSessionCount === 'number' ? record.runningSessionCount : 0,
      pendingInteractionCount: typeof record.pendingInteractionCount === 'number' ? record.pendingInteractionCount : 0,
      outcomeUnknownCount: typeof record.outcomeUnknownCount === 'number' ? record.outcomeUnknownCount : 0,
      ...(typeof record.home === 'string' ? { home: record.home } : {}),
    })
  }
  return parsed
}

/**
 * Browser-side federated bridge.
 *
 * It asks the Host — over the generic Connection channel, never an official
 * route — for the node set, and pairs each node with runtime hooks supplied by
 * the federated runtime layer. Readiness is deliberately strict: the bridge is
 * ready only after a successful refresh that yielded at least one enabled node
 * *and* a usable binding for every enabled node, so a partial baseline can never
 * shadow the official UI.
 */
export class FederationBridge implements FederationClientBridge {
  #nodes: readonly FederatedNodeFacts[] = []
  #ready = false
  #diagnostic: string | undefined
  readonly #options: FederationBridgeOptions

  constructor(options: FederationBridgeOptions) {
    this.#options = options
  }

  get diagnostic(): string | undefined { return this.#diagnostic }

  ready(): boolean { return this.#ready }

  nodes(): readonly FederatedNodeFacts[] { return this.#nodes }

  bindingFor(nodeId: NodeId): NodeRuntimeBinding | undefined {
    const node = this.#nodes.find(candidate => candidate.nodeId === nodeId)
    return node === undefined ? undefined : this.#options.bindingFor(node)
  }

  /** Pulls the node set and recomputes readiness. Never throws. */
  async refresh(signal?: AbortSignal): Promise<boolean> {
    const channel = this.#options.channel ?? '/api'
    const endpoint = this.#options.endpoint ?? 'federation/nodes'
    try {
      const result = await this.#options.rpc.call(channel, endpoint, {}, signal)
      if (!result.ok) {
        this.#fail(result.error?.message ?? 'federation node query failed')
        return false
      }
      const nodes = parseNodes(result.value)
      const enabled = nodes.filter(node => node.enabled)
      if (enabled.length === 0) {
        this.#nodes = nodes
        this.#fail('no enabled federation node')
        return false
      }
      const missing = enabled.filter(node => this.#options.bindingFor(node) === undefined)
      if (missing.length > 0) {
        this.#nodes = nodes
        this.#fail(`missing runtime binding for ${missing.map(node => node.nodeId).join(', ')}`)
        return false
      }
      this.#nodes = nodes
      this.#ready = true
      this.#diagnostic = undefined
      this.#options.onChange?.()
      return true
    } catch (cause) {
      this.#fail(cause instanceof Error ? cause.message : 'federation node query failed')
      return false
    }
  }

  /** Drops readiness without discarding the last known node list. */
  invalidate(reason: string): void {
    this.#fail(reason)
  }

  #fail(reason: string): void {
    this.#ready = false
    this.#diagnostic = reason
    this.#options.onChange?.()
  }
}
