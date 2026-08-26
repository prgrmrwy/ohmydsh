import {
  decodeSessionId,
  decodeWorkspaceId,
  type FederatedSessionId,
  type FederatedWorkspaceId,
  type NativeSessionId,
  type NativeWorkspaceId,
  type NodeId,
} from '../../core/index.js'

/** CSS-safe, collision-free namespace for one mounted node's portals/overlays. */
export function overlayNamespaceOf(nodeId: NodeId): string {
  const namespace = `n-${[...nodeId].map(char => (/[A-Za-z0-9_-]/.test(char) ? char : '-')).join('')}`
  if (namespace.length > 80) throw new Error('node overlay namespace exceeds the CSS-safe bound')
  return namespace
}

/** Stable React key for a node section; identity, never a display name. */
export function nodeSectionKey(nodeId: NodeId): string {
  return `fed1-node:${nodeId}`
}

export interface NodeScopedActions {
  startSession(workspaceId: FederatedWorkspaceId): void
  open(sessionId: FederatedSessionId): void
  renameSession(sessionId: FederatedSessionId, title: string): Promise<void>
  forkSession(sessionId: FederatedSessionId): void
  renameWorkspace(workspaceId: FederatedWorkspaceId, title: string): Promise<void>
  deleteWorkspace(workspaceId: FederatedWorkspaceId): Promise<void>
  insertWorkspaceBefore(workspaceId: FederatedWorkspaceId, before: FederatedWorkspaceId | undefined): Promise<void>
  archiveSession(sessionId: FederatedSessionId): Promise<void>
  insertSessionBefore(workspaceId: FederatedWorkspaceId, sessionId: FederatedSessionId, before: FederatedSessionId | undefined): Promise<void>
}

export interface NodeCommandSink {
  startSession(nodeId: NodeId, workspaceId: FederatedWorkspaceId): void
  open(nodeId: NodeId, sessionId: FederatedSessionId): void
  renameSession(nodeId: NodeId, sessionId: FederatedSessionId, title: string): Promise<void>
  forkSession(nodeId: NodeId, sessionId: FederatedSessionId): void
  renameWorkspace(nodeId: NodeId, workspaceId: FederatedWorkspaceId, title: string): Promise<void>
  deleteWorkspace(nodeId: NodeId, workspaceId: FederatedWorkspaceId): Promise<void>
  insertWorkspaceBefore(nodeId: NodeId, workspaceId: FederatedWorkspaceId, before: FederatedWorkspaceId | undefined): Promise<void>
  archiveSession(nodeId: NodeId, sessionId: FederatedSessionId): Promise<void>
  insertSessionBefore(nodeId: NodeId, workspaceId: FederatedWorkspaceId, sessionId: FederatedSessionId, before: FederatedSessionId | undefined): Promise<void>
}

export class NodeBindingError extends Error {
  constructor(readonly code: 'FOREIGN_ID' | 'NOT_WRITABLE', message: string) {
    super(message)
    this.name = 'NodeBindingError'
  }
}

export interface NodeBindingOptions {
  readonly nodeId: NodeId
  readonly knownNodes: ReadonlySet<NodeId>
  readonly writable: boolean
  readonly sink: NodeCommandSink
}

/**
 * Binds one official node section's action props to its owning node.
 *
 * Every id is decoded and proven to belong to this node before a command is
 * emitted, so a section can never act on another node's workspace or session,
 * and a non-writable node offers no mutation at all.
 */
export function bindNodeActions(options: NodeBindingOptions): NodeScopedActions {
  const { nodeId, knownNodes, writable, sink } = options

  const workspace = (id: FederatedWorkspaceId): NativeWorkspaceId => {
    const decoded = decodeWorkspaceId(id, knownNodes)
    if (decoded.nodeId !== nodeId) throw new NodeBindingError('FOREIGN_ID', `workspace ${id} is not owned by node ${nodeId}`)
    return decoded.nativeId
  }
  const session = (id: FederatedSessionId): NativeSessionId => {
    const decoded = decodeSessionId(id, knownNodes)
    if (decoded.nodeId !== nodeId) throw new NodeBindingError('FOREIGN_ID', `session ${id} is not owned by node ${nodeId}`)
    return decoded.nativeId
  }
  const mutable = () => {
    if (!writable) throw new NodeBindingError('NOT_WRITABLE', `node ${nodeId} is not currently writable`)
  }

  return {
    startSession(workspaceId) {
      workspace(workspaceId)
      mutable()
      sink.startSession(nodeId, workspaceId)
    },
    open(sessionId) {
      session(sessionId)
      sink.open(nodeId, sessionId)
    },
    async renameSession(sessionId, title) {
      session(sessionId)
      mutable()
      await sink.renameSession(nodeId, sessionId, title)
    },
    forkSession(sessionId) {
      session(sessionId)
      mutable()
      sink.forkSession(nodeId, sessionId)
    },
    async renameWorkspace(workspaceId, title) {
      workspace(workspaceId)
      mutable()
      await sink.renameWorkspace(nodeId, workspaceId, title)
    },
    async deleteWorkspace(workspaceId) {
      workspace(workspaceId)
      mutable()
      await sink.deleteWorkspace(nodeId, workspaceId)
    },
    async insertWorkspaceBefore(workspaceId, before) {
      workspace(workspaceId)
      if (before !== undefined) workspace(before)
      mutable()
      await sink.insertWorkspaceBefore(nodeId, workspaceId, before)
    },
    async archiveSession(sessionId) {
      session(sessionId)
      mutable()
      await sink.archiveSession(nodeId, sessionId)
    },
    async insertSessionBefore(workspaceId, sessionId, before) {
      workspace(workspaceId)
      session(sessionId)
      if (before !== undefined) session(before)
      mutable()
      await sink.insertSessionBefore(nodeId, workspaceId, sessionId, before)
    },
  }
}
