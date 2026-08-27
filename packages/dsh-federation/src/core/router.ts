import { decodeSessionId, decodeWorkspaceId } from './id.js'
import type { AbortOptions, DshNodePort, PromptCommand } from './port.js'
import type {
  FederatedSessionId,
  FederatedWorkspaceId,
  NativeSessionId,
  NodeCapability,
  NodeId,
  RpcId,
  SearchQuery,
} from './types.js'

function abortOptions(signal?: AbortSignal): AbortOptions {
  return signal === undefined ? {} : { signal }
}

export class RoutingError extends Error {
  constructor(readonly code: 'UNKNOWN_NODE' | 'CAPABILITY_DENIED' | 'PORT_UNAVAILABLE', message: string) {
    super(message)
    this.name = 'RoutingError'
  }
}

export class CommandRouter {
  readonly #ports: ReadonlyMap<NodeId, DshNodePort>
  readonly #knownNodes: ReadonlySet<NodeId>

  /**
   * @param ports - nodes with a live, connected port.
   * @param knownNodes - every node the registry knows, connected or not.
   *
   * The two sets differ on purpose: a registered node whose tunnel is not up yet
   * must produce a routing error (`UNKNOWN_NODE` from the port lookup), not an
   * identity error that would mislabel a legitimate id as forged. Omitting
   * `knownNodes` keeps the previous port-derived behaviour.
   */
  constructor(ports: ReadonlyMap<NodeId, DshNodePort>, knownNodes?: Iterable<NodeId>) {
    // Keep the live port registry by reference. Connectivity removes a port as
    // soon as either owned event stream disconnects; copying here would leave a
    // stale adapter routable after the node has left READY.
    this.#ports = ports
    this.#knownNodes = knownNodes === undefined ? new Set(ports.keys()) : new Set(knownNodes)
  }

  workspaceList(nodeId: NodeId, signal?: AbortSignal) {
    return this.#node(nodeId, 'workspace.read').listWorkspaces(abortOptions(signal))
  }

  workspaceCreate(nodeId: NodeId, path: string, signal?: AbortSignal) {
    return this.#node(nodeId, 'workspace.write').createWorkspace(path, abortOptions(signal))
  }

  workspaceRename(id: FederatedWorkspaceId, title: string, signal?: AbortSignal) {
    const { nodeId, nativeId } = decodeWorkspaceId(id, this.#knownNodes)
    return this.#node(nodeId, 'workspace.write').renameWorkspace(nativeId, title, abortOptions(signal))
  }

  workspaceDelete(id: FederatedWorkspaceId, signal?: AbortSignal) {
    const { nodeId, nativeId } = decodeWorkspaceId(id, this.#knownNodes)
    return this.#node(nodeId, 'workspace.write').deleteWorkspace(nativeId, abortOptions(signal))
  }

  workspaceReorder(id: FederatedWorkspaceId, beforeId?: FederatedWorkspaceId, signal?: AbortSignal) {
    const current = decodeWorkspaceId(id, this.#knownNodes)
    const before = beforeId === undefined ? undefined : decodeWorkspaceId(beforeId, this.#knownNodes)
    if (before !== undefined && before.nodeId !== current.nodeId) throw new RoutingError('CAPABILITY_DENIED', 'cross-node workspace reorder is forbidden')
    return this.#node(current.nodeId, 'workspace.write').reorderWorkspace(current.nativeId, before?.nativeId, abortOptions(signal))
  }

  sessionReorder(workspaceId: FederatedWorkspaceId, sessionId: FederatedSessionId, beforeId?: FederatedSessionId, signal?: AbortSignal) {
    const workspace = decodeWorkspaceId(workspaceId, this.#knownNodes)
    const session = decodeSessionId(sessionId, this.#knownNodes)
    const before = beforeId === undefined ? undefined : decodeSessionId(beforeId, this.#knownNodes)
    if (session.nodeId !== workspace.nodeId || (before !== undefined && before.nodeId !== workspace.nodeId)) {
      throw new RoutingError('CAPABILITY_DENIED', 'cross-node or cross-workspace session reorder is forbidden')
    }
    return this.#node(workspace.nodeId, 'workspace.write').reorderSession(
      workspace.nativeId, session.nativeId, before?.nativeId, abortOptions(signal),
    )
  }

  sessionList(nodeId: NodeId, signal?: AbortSignal) {
    return this.#node(nodeId, 'session.read').listSessions(abortOptions(signal))
  }

  sessionCreate(nodeId: NodeId, workspaceId?: FederatedWorkspaceId, signal?: AbortSignal) {
    const workspace = workspaceId === undefined ? undefined : decodeWorkspaceId(workspaceId, this.#knownNodes)
    if (workspace !== undefined && workspace.nodeId !== nodeId) throw new RoutingError('CAPABILITY_DENIED', 'session workspace belongs to another node')
    return this.#node(nodeId, 'session.write').createSession(workspace?.nativeId, abortOptions(signal))
  }

  history(id: FederatedSessionId, beforeSeq?: number, signal?: AbortSignal) {
    const { nodeId, nativeId } = decodeSessionId(id, this.#knownNodes)
    return this.#node(nodeId, 'session.read').history(nativeId, {
      ...abortOptions(signal),
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
    })
  }

  models(id: FederatedSessionId, signal?: AbortSignal) {
    return this.#session(id, 'session.read', (port, nativeId) => port.models(nativeId, abortOptions(signal)))
  }

  prompt(id: FederatedSessionId, command: Omit<PromptCommand, 'sessionId'>, signal?: AbortSignal) {
    const { nodeId, nativeId } = decodeSessionId(id, this.#knownNodes)
    return this.#node(nodeId, 'session.write').prompt({ ...command, sessionId: nativeId }, abortOptions(signal))
  }

  cancel(id: FederatedSessionId, signal?: AbortSignal) {
    return this.#session(id, 'session.write', (port, nativeId) => port.cancel(nativeId, abortOptions(signal)))
  }

  renameSession(id: FederatedSessionId, title: string, signal?: AbortSignal) {
    return this.#session(id, 'session.write', (port, nativeId) => port.renameSession(nativeId, title, abortOptions(signal)))
  }

  forkSession(id: FederatedSessionId, atSeq?: number, signal?: AbortSignal) {
    return this.#session(id, 'session.write', (port, nativeId) => port.forkSession(nativeId, atSeq, abortOptions(signal)))
  }

  selectModel(id: FederatedSessionId, selection: unknown, signal?: AbortSignal) {
    return this.#session(id, 'session.write', (port, nativeId) => port.selectModel(nativeId, selection, abortOptions(signal)))
  }

  updateQueue(id: FederatedSessionId, update: unknown, signal?: AbortSignal) {
    return this.#session(id, 'session.write', (port, nativeId) => port.updateQueue(nativeId, update, abortOptions(signal)))
  }

  attachment(id: FederatedSessionId, attachmentId: string, signal?: AbortSignal) {
    return this.#session(id, 'session.attachment', (port, nativeId) => port.attachment(nativeId, attachmentId, abortOptions(signal)))
  }

  search(nodeId: NodeId, query: SearchQuery, signal?: AbortSignal) {
    return this.#node(nodeId, 'session.search').search(query, abortOptions(signal))
  }

  archiveSession(id: FederatedSessionId, signal?: AbortSignal) {
    return this.#session(id, 'session.write', (port, nativeId) => port.archiveSession(nativeId, abortOptions(signal)))
  }

  respond(nodeId: NodeId, rpcId: RpcId, response: unknown, signal?: AbortSignal) {
    return this.#node(nodeId, 'interaction.respond').respond(rpcId, response, abortOptions(signal))
  }

  listDirectory(nodeId: NodeId, path: string | undefined, signal?: AbortSignal) {
    const port = this.#node(nodeId, 'directory.read')
    if (port.listDirectory === undefined) throw new RoutingError('CAPABILITY_DENIED', `node ${nodeId} cannot browse directories`)
    return port.listDirectory(path, abortOptions(signal))
  }

  createDirectory(nodeId: NodeId, path: string, name: string, signal?: AbortSignal) {
    const port = this.#node(nodeId, 'directory.write')
    if (port.createDirectory === undefined) throw new RoutingError('CAPABILITY_DENIED', `node ${nodeId} cannot create directories`)
    return port.createDirectory(path, name, abortOptions(signal))
  }

  /** Owner of a federated workspace id; fails closed for unknown nodes. */
  nodeOfWorkspace(id: FederatedWorkspaceId): NodeId {
    return decodeWorkspaceId(id, this.#knownNodes).nodeId
  }

  /** Owner of a federated session id; fails closed for unknown nodes. */
  nodeOfSession(id: FederatedSessionId): NodeId {
    return decodeSessionId(id, this.#knownNodes).nodeId
  }

  #session<T>(id: FederatedSessionId, capability: NodeCapability, action: (port: DshNodePort, nativeId: NativeSessionId) => T): T {
    const { nodeId, nativeId } = decodeSessionId(id, this.#knownNodes)
    return action(this.#node(nodeId, capability), nativeId)
  }

  #node(nodeId: NodeId, capability: NodeCapability): DshNodePort {
    const port = this.#ports.get(nodeId)
    if (port === undefined) throw new RoutingError('UNKNOWN_NODE', `unknown node ${nodeId}`)
    if (!port.node.enabled || (port.node.state !== 'READY' && port.node.state !== 'DEGRADED')) {
      throw new RoutingError('PORT_UNAVAILABLE', `node ${nodeId} is not writable/authoritative`)
    }
    if (!port.capabilities.has(capability)) throw new RoutingError('CAPABILITY_DENIED', `node ${nodeId} lacks ${capability}`)
    return port
  }
}
