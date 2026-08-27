import {
  CommandRouter,
  FederatedIdError,
  RoutingError,
  parseNodeId,
  type FederatedSessionId,
  type FederatedWorkspaceId,
  type NodeId,
  type RpcId,
} from '../../core/index.js'
import { NodeDeletionRequiresConfirmation } from '../node-lifecycle.js'

/**
 * Federation-owned inventory the browser reads.
 *
 * It is intentionally narrow: node facts and a per-node baseline. No settings,
 * credentials or subscription data crosses this seam.
 */
export interface FederationInventory {
  nodes(options?: { readonly signal?: AbortSignal }): Promise<readonly unknown[]>
  baseline(nodeId: NodeId, options?: { readonly signal?: AbortSignal }): Promise<unknown>
  operations(options?: { readonly signal?: AbortSignal }): Promise<readonly unknown[]>
  /** Explicit operator clear of retained diagnostics; omitting ids clears all. */
  clearOperations?(operationIds?: readonly string[], options?: { readonly signal?: AbortSignal }): Promise<readonly unknown[]>
  /**
   * Node lifecycle management. Absent means the deployment does not expose node
   * editing, and every management route fails closed instead of reaching a
   * native handler.
   */
  readonly manager?: FederationNodeManager
}

/** The node-management surface the browser is allowed to drive. */
export interface FederationNodeManager {
  addNode(request: { readonly displayName: string; readonly sshAlias: string; readonly remoteDshPort: number; readonly enabled?: boolean }): Promise<unknown>
  updateNode(nodeId: string, update: { readonly displayName?: string; readonly sshAlias?: string; readonly remoteDshPort?: number; readonly enabled?: boolean }): Promise<unknown>
  reorderNode(nodeId: string, beforeNodeId?: string): Promise<unknown>
  removeNode(nodeId: string, confirmed: boolean): Promise<unknown>
}

const FEDERATED_PREFIX = 'fed1:'
/**
 * The whole `fed<N>:` namespace is reserved for federated identities. A value
 * carrying an unsupported federation version must fail closed rather than be
 * handed to the local handler, which would read it as a bare native id.
 */
const RESERVED_FEDERATION_NAMESPACE = /^fed\d+:/

export interface UplinkRequest {
  readonly path: string
  readonly rpcId: string
  readonly payload: Record<string, unknown>
}

export type UplinkOutcome =
  | { readonly kind: 'ok'; readonly value: unknown }
  | { readonly kind: 'error'; readonly status: number; readonly code: string; readonly message: string }
  | { readonly kind: 'local-passthrough' }

/** One stable kebab-case diagnostic vocabulary for every rejected uplink call. */
function diagnosticCode(code: string): string {
  return code.toLowerCase().replaceAll('_', '-')
}

function reject(code: string, message: string, status = 400): UplinkOutcome {
  return { kind: 'error', status, code, message }
}

function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  if (typeof value !== 'string' || value === '') throw new FederatedIdError('MALFORMED', `${key} must be a non-empty string`)
  return value
}

function requireInteger(payload: Record<string, unknown>, key: string): number {
  const value = payload[key]
  if (!Number.isInteger(value)) throw new FederatedIdError('MALFORMED', `${key} must be an integer`)
  return value as number
}

function isFederated(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(FEDERATED_PREFIX)
}

/**
 * Central uplink handlers for the federation-owned exact routes.
 *
 * Ordering is deliberate: identity shape, then owner decoding, then node
 * readiness and capability (both enforced by the Core router), and only then a
 * decoded call into the owning node port. Bare native ids belong to This Mac and
 * are handed back to the composed local handler untouched.
 */
export class CentralUplink {
  readonly #router: CommandRouter
  readonly #knownNodes: ReadonlySet<NodeId>
  readonly #localNodeId: NodeId

  readonly #inventory: FederationInventory | undefined

  /**
   * @param inventory - serves the federated browser's node/baseline queries.
   *   Omitting it keeps those endpoints unavailable (fail closed) rather than
   *   silently letting them fall through to This Mac.
   */
  constructor(
    router: CommandRouter,
    knownNodes: ReadonlySet<NodeId>,
    localNodeId: NodeId,
    inventory?: FederationInventory,
  ) {
    this.#router = router
    this.#knownNodes = new Set(knownNodes)
    this.#localNodeId = localNodeId
    this.#inventory = inventory
    if (!this.#knownNodes.has(localNodeId)) throw new Error('local node must be registered')
  }

  async handle(request: UplinkRequest, signal?: AbortSignal): Promise<UplinkOutcome> {
    try {
      // Reserved-but-unsupported federation versions never reach a handler or
      // the local fallback, on any route.
      const reserved = this.#reservedNonCurrent(request.payload)
      if (reserved !== undefined) {
        return reject('federation-route-unclassified', `identity ${reserved} uses a reserved federation namespace this build cannot route`)
      }
      return await this.#dispatch(request, signal)
    } catch (cause) {
      if (cause instanceof FederatedIdError) return reject(`federation-id-${diagnosticCode(cause.code)}`, cause.message)
      if (cause instanceof RoutingError) {
        return reject(`federation-${diagnosticCode(cause.code)}`, cause.message, cause.code === 'PORT_UNAVAILABLE' ? 409 : 403)
      }
      throw cause
    }
  }

  async #dispatch(request: UplinkRequest, signal?: AbortSignal): Promise<UplinkOutcome> {
    const payload = request.payload
    switch (request.path) {
      case '/api/workspace.list':
      case '/api/session.list':
        return reject('federation-aggregate-only', `${request.path} is served by the federated aggregate, not per-node uplink`, 400)

      // Federation-owned inventory endpoints. They are the browser's only way to
      // learn the node set and each node's baseline, and they are refused when
      // no inventory is attached so they can never reach a native handler.
      case '/api/federation/nodes': {
        if (this.#inventory === undefined) {
          return reject('federation-inventory-unavailable', 'federation inventory is not attached', 503)
        }
        try {
          return { kind: 'ok', value: { nodes: await this.#inventory.nodes(signal === undefined ? {} : { signal }) } }
        } catch (cause) {
          return reject(
            'federation-inventory-unavailable',
            cause instanceof Error ? cause.message : 'federation node inventory is unavailable',
            503,
          )
        }
      }

      case '/api/federation/node.add':
      case '/api/federation/node.update':
      case '/api/federation/node.reorder':
      case '/api/federation/node.remove': {
        const manager = this.#inventory?.manager
        if (manager === undefined) {
          return reject('federation-inventory-unavailable', 'federation node management is not attached', 503)
        }
        try {
          return { kind: 'ok', value: await this.#manage(manager, request.path, payload) }
        } catch (cause) {
          if (cause instanceof NodeDeletionRequiresConfirmation) {
            return reject('federation-node-deletion-unconfirmed', cause.message, 409)
          }
          return reject('federation-node-management-failed', cause instanceof Error ? cause.message : 'node management failed', 400)
        }
      }

      case '/api/federation/operations': {
        if (this.#inventory === undefined) return reject('federation-inventory-unavailable', 'federation inventory is not attached', 503)
        try {
          return { kind: 'ok', value: { operations: await this.#inventory.operations(signal === undefined ? {} : { signal }) } }
        } catch (cause) {
          return reject('federation-inventory-unavailable', cause instanceof Error ? cause.message : 'federation operation inventory is unavailable', 503)
        }
      }

      case '/api/federation/operations.clear': {
        // Retained diagnostics persist until the operator clears them, so the
        // clear must be an explicit, addressable action.
        const clear = this.#inventory?.clearOperations
        if (clear === undefined) return reject('federation-inventory-unavailable', 'federation diagnostics retention is not attached', 503)
        try {
          const ids = Array.isArray(payload.operationIds)
            ? payload.operationIds.filter((id): id is string => typeof id === 'string')
            : undefined
          return { kind: 'ok', value: { operations: await clear(ids, signal === undefined ? {} : { signal }) } }
        } catch (cause) {
          return reject('federation-inventory-unavailable', cause instanceof Error ? cause.message : 'federation diagnostics clear failed', 503)
        }
      }

      case '/api/federation/baseline': {
        if (this.#inventory === undefined) {
          return reject('federation-inventory-unavailable', 'federation inventory is not attached', 503)
        }
        const nodeId = parseNodeId(requireString(payload, 'nodeId'))
        if (!this.#knownNodes.has(nodeId)) {
          return reject('federation-id-unknown-node', `unknown federation node ${nodeId}`, 400)
        }
        try {
          return { kind: 'ok', value: await this.#inventory.baseline(nodeId, signal === undefined ? {} : { signal }) }
        } catch (cause) {
          return reject(
            'federation-inventory-unavailable',
            cause instanceof Error ? cause.message : 'federation baseline is unavailable',
            503,
          )
        }
      }

      case '/api/workspace.create': {
        const nodeId = this.#nodeFromPayload(payload)
        return { kind: 'ok', value: await this.#router.workspaceCreate(nodeId, requireString(payload, 'path'), signal) }
      }
      case '/api/workspace.rename': {
        const id = this.#workspace(payload, 'workspaceId')
        if (id === undefined) return { kind: 'local-passthrough' }
        return { kind: 'ok', value: await this.#router.workspaceRename(id, requireString(payload, 'title'), signal) }
      }
      case '/api/workspace.delete': {
        const id = this.#workspace(payload, 'workspaceId')
        if (id === undefined) return { kind: 'local-passthrough' }
        return { kind: 'ok', value: await this.#router.workspaceDelete(id, signal) }
      }
      case '/api/workspace.insertBefore': {
        const id = this.#workspace(payload, 'workspaceId')
        const anchorRaw = payload.beforeWorkspaceId
        if (id === undefined) {
          if (isFederated(anchorRaw)) return reject('federation-cross-node-anchor', 'a local workspace cannot be reordered against a federated anchor')
          return { kind: 'local-passthrough' }
        }
        const anchor = anchorRaw === undefined || anchorRaw === null ? undefined : this.#workspace(payload, 'beforeWorkspaceId')
        if (anchorRaw !== undefined && anchorRaw !== null && anchor === undefined) {
          return reject('federation-cross-node-anchor', 'a federated workspace cannot be reordered against a local anchor')
        }
        return { kind: 'ok', value: await this.#router.workspaceReorder(id, anchor, signal) }
      }
      case '/api/workspace.insertSessionBefore': {
        const workspace = this.#workspace(payload, 'workspaceId')
        const session = this.#session(payload, 'sessionId')
        const beforeRaw = payload.beforeSessionId
        const before = beforeRaw === undefined || beforeRaw === null ? undefined : this.#session(payload, 'beforeSessionId')
        if (workspace === undefined && session === undefined && before === undefined) return { kind: 'local-passthrough' }
        if (workspace === undefined || session === undefined || (beforeRaw !== undefined && beforeRaw !== null && before === undefined)) {
          return reject('federation-cross-node-anchor', 'workspace, session and anchor must all belong to the same federated node')
        }
        return { kind: 'ok', value: await this.#router.sessionReorder(workspace, session, before, signal) }
      }
      case '/api/workspace.archiveSession': {
        const id = this.#session(payload, 'sessionId')
        if (id === undefined) return { kind: 'local-passthrough' }
        return { kind: 'ok', value: await this.#router.archiveSession(id, signal) }
      }

      case '/api/session.create': {
        const workspaceRaw = payload.workspaceId
        if (workspaceRaw === undefined || workspaceRaw === null) return { kind: 'local-passthrough' }
        const workspaceId = this.#workspace(payload, 'workspaceId')
        if (workspaceId === undefined) return { kind: 'local-passthrough' }
        const nodeId = this.#router.nodeOfWorkspace(workspaceId)
        return { kind: 'ok', value: await this.#router.sessionCreate(nodeId, workspaceId, signal) }
      }
      case '/api/session.history': {
        const id = this.#session(payload, 'sessionId')
        if (id === undefined) return { kind: 'local-passthrough' }
        const beforeSeq = typeof payload.beforeSeq === 'number' ? payload.beforeSeq : undefined
        return { kind: 'ok', value: await this.#router.history(id, beforeSeq, signal) }
      }
      case '/api/session.models': {
        const id = this.#session(payload, 'sessionId')
        if (id === undefined) return { kind: 'local-passthrough' }
        return { kind: 'ok', value: await this.#router.models(id, signal) }
      }
      case '/api/session.prompt': {
        const id = this.#session(payload, 'sessionId')
        if (id === undefined) return { kind: 'local-passthrough' }
        const mode = payload.mode === 'steer' ? 'steer' : 'queue'
        if (!Array.isArray(payload.content)) return reject('federation-bad-request', 'prompt content must be an array')
        return {
          kind: 'ok',
          value: await this.#router.prompt(id, {
            rpcId: request.rpcId as RpcId,
            mode,
            content: payload.content,
            ...(typeof payload.clientTimeZone === 'string' ? { clientTimeZone: payload.clientTimeZone } : {}),
          }, signal),
        }
      }
      case '/api/session.cancel': {
        const id = this.#session(payload, 'sessionId')
        if (id === undefined) return { kind: 'local-passthrough' }
        return { kind: 'ok', value: await this.#router.cancel(id, signal) }
      }
      case '/api/session.rename': {
        const id = this.#session(payload, 'sessionId')
        if (id === undefined) return { kind: 'local-passthrough' }
        return { kind: 'ok', value: await this.#router.renameSession(id, requireString(payload, 'title'), signal) }
      }
      case '/api/session.fork': {
        const id = this.#session(payload, 'sessionId')
        if (id === undefined) return { kind: 'local-passthrough' }
        const atSeq = typeof payload.atSeq === 'number' ? payload.atSeq : undefined
        return { kind: 'ok', value: await this.#router.forkSession(id, atSeq, signal) }
      }
      case '/api/session.selectModel': {
        const id = this.#session(payload, 'sessionId')
        if (id === undefined) return { kind: 'local-passthrough' }
        const { sessionId: _ignored, ...selection } = payload
        return { kind: 'ok', value: await this.#router.selectModel(id, selection, signal) }
      }
      case '/api/session.updateQueue': {
        const id = this.#session(payload, 'sessionId')
        if (id === undefined) return { kind: 'local-passthrough' }
        const { sessionId: _ignored, ...update } = payload
        return { kind: 'ok', value: await this.#router.updateQueue(id, update, signal) }
      }
      case '/api/session.attachment': {
        const id = this.#session(payload, 'sessionId')
        if (id === undefined) return { kind: 'local-passthrough' }
        return { kind: 'ok', value: await this.#router.attachment(id, requireString(payload, 'attachmentId'), signal) }
      }
      case '/api/session.search': {
        const nodeId = this.#nodeFromPayload(payload)
        const limit = typeof payload.limit === 'number' ? payload.limit : 20
        return { kind: 'ok', value: await this.#router.search(nodeId, { query: requireString(payload, 'query'), limit }, signal) }
      }

      case '/api/host.listDirectory':
      case '/api/host.createDirectory': {
        const nodeRaw = payload.nodeId
        if (nodeRaw === undefined) return reject('federation-node-required', 'directory requests must bind an explicit node id')
        const nodeId = this.#nodeFromPayload(payload)
        if (nodeId === this.#localNodeId) return { kind: 'local-passthrough' }
        return {
          kind: 'ok',
          value: request.path === '/api/host.listDirectory'
            ? await this.#router.listDirectory(nodeId, typeof payload.path === 'string' ? payload.path : undefined, signal)
            : await this.#router.createDirectory(nodeId, requireString(payload, 'path'), requireString(payload, 'name'), signal),
        }
      }

      case '/api/respond': {
        const owner = payload.nodeId
        if (owner === undefined) return { kind: 'local-passthrough' }
        const nodeId = this.#nodeFromPayload(payload)
        if (nodeId === this.#localNodeId) return { kind: 'local-passthrough' }
        const { nodeId: _ignored, ...message } = payload
        return { kind: 'ok', value: await this.#router.respond(nodeId, requireString(payload, 'rpcId') as RpcId, message, signal) }
      }

      case '/api/host.openPath':
        return reject('federation-forbidden-surface', 'host.openPath is never routed across nodes', 403)

      default:
        return this.#anyFederatedIdentity(payload)
          ? reject('federation-route-unclassified', `${request.path} carries a federated identity but has no federated handler`)
          : { kind: 'local-passthrough' }
    }
  }

  /** Finds a reserved `fed<N>:` identity whose version this build does not support. */
  async #manage(manager: FederationNodeManager, path: string, payload: Record<string, unknown>): Promise<unknown> {
    switch (path) {
      case '/api/federation/node.add':
        return manager.addNode({
          displayName: requireString(payload, 'displayName'),
          sshAlias: requireString(payload, 'sshAlias'),
          remoteDshPort: requireInteger(payload, 'remoteDshPort'),
          ...(payload.enabled === undefined ? {} : { enabled: payload.enabled === true }),
        })
      case '/api/federation/node.update':
        return manager.updateNode(requireString(payload, 'nodeId'), {
          ...(payload.displayName === undefined ? {} : { displayName: requireString(payload, 'displayName') }),
          ...(payload.sshAlias === undefined ? {} : { sshAlias: requireString(payload, 'sshAlias') }),
          ...(payload.remoteDshPort === undefined ? {} : { remoteDshPort: requireInteger(payload, 'remoteDshPort') }),
          ...(payload.enabled === undefined ? {} : { enabled: payload.enabled === true }),
        })
      case '/api/federation/node.reorder':
        return manager.reorderNode(
          requireString(payload, 'nodeId'),
          payload.beforeNodeId === undefined ? undefined : requireString(payload, 'beforeNodeId'),
        )
      default:
        // Deleting a node is never implicit: an unconfirmed request must be
        // refused while outcome-unknown writes exist.
        return manager.removeNode(requireString(payload, 'nodeId'), payload.confirmed === true)
    }
  }

  #reservedNonCurrent(value: unknown, seen = new Set<unknown>()): string | undefined {
    if (typeof value === 'string') {
      return RESERVED_FEDERATION_NAMESPACE.test(value) && !value.startsWith(FEDERATED_PREFIX) ? value : undefined
    }
    if (typeof value !== 'object' || value === null || seen.has(value)) return undefined
    seen.add(value)
    for (const item of Object.values(value as Record<string, unknown>)) {
      const found = this.#reservedNonCurrent(item, seen)
      if (found !== undefined) return found
    }
    return undefined
  }

  #anyFederatedIdentity(value: unknown, seen = new Set<unknown>()): boolean {
    if (typeof value === 'string' && RESERVED_FEDERATION_NAMESPACE.test(value)) return true
    if (typeof value !== 'object' || value === null || seen.has(value)) return false
    seen.add(value)
    return Object.values(value as Record<string, unknown>).some(item => this.#anyFederatedIdentity(item, seen))
  }

  #nodeFromPayload(payload: Record<string, unknown>): NodeId {
    const nodeId = requireString(payload, 'nodeId') as NodeId
    if (!this.#knownNodes.has(nodeId)) throw new FederatedIdError('UNKNOWN_NODE', `unknown node ${nodeId}`)
    return nodeId
  }

  #workspace(payload: Record<string, unknown>, key: string): FederatedWorkspaceId | undefined {
    const value = payload[key]
    if (!isFederated(value)) return undefined
    return value as FederatedWorkspaceId
  }

  #session(payload: Record<string, unknown>, key: string): FederatedSessionId | undefined {
    const value = payload[key]
    if (!isFederated(value)) return undefined
    return value as FederatedSessionId
  }
}
