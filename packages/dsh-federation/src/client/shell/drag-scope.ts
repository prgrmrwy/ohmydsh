import {
  decodeSessionId,
  decodeWorkspaceId,
  FederatedIdError,
  type FederatedSessionId,
  type FederatedWorkspaceId,
  type NodeId,
} from '../../core/index.js'

export type DragDecision =
  | { readonly allowed: true; readonly kind: 'node'; readonly nodeId: NodeId; readonly beforeNodeId?: NodeId }
  | { readonly allowed: true; readonly kind: 'workspace'; readonly nodeId: NodeId; readonly workspaceId: FederatedWorkspaceId; readonly beforeWorkspaceId?: FederatedWorkspaceId }
  | { readonly allowed: true; readonly kind: 'session'; readonly nodeId: NodeId; readonly workspaceId: FederatedWorkspaceId; readonly sessionId: FederatedSessionId; readonly beforeSessionId?: FederatedSessionId }
  | { readonly allowed: true; readonly kind: 'browser-local' }
  | { readonly allowed: false; readonly reason: 'cross-node' | 'cross-workspace' | 'unknown-id' | 'not-writable' }

/** Reorder within the central node registry. */
export function decideNodeDrag(nodeId: NodeId, beforeNodeId: NodeId | undefined, known: ReadonlySet<NodeId>): DragDecision {
  if (!known.has(nodeId) || (beforeNodeId !== undefined && !known.has(beforeNodeId))) return { allowed: false, reason: 'unknown-id' }
  return beforeNodeId === undefined
    ? { allowed: true, kind: 'node', nodeId }
    : { allowed: true, kind: 'node', nodeId, beforeNodeId }
}

/** Workspace reorder is legal only inside one node's section. */
export function decideWorkspaceDrag(
  workspaceId: FederatedWorkspaceId,
  beforeWorkspaceId: FederatedWorkspaceId | undefined,
  known: ReadonlySet<NodeId>,
  writableNodes: ReadonlySet<NodeId>,
): DragDecision {
  try {
    const target = decodeWorkspaceId(workspaceId, known)
    if (beforeWorkspaceId !== undefined) {
      const anchor = decodeWorkspaceId(beforeWorkspaceId, known)
      if (anchor.nodeId !== target.nodeId) return { allowed: false, reason: 'cross-node' }
    }
    if (!writableNodes.has(target.nodeId)) return { allowed: false, reason: 'not-writable' }
    return beforeWorkspaceId === undefined
      ? { allowed: true, kind: 'workspace', nodeId: target.nodeId, workspaceId }
      : { allowed: true, kind: 'workspace', nodeId: target.nodeId, workspaceId, beforeWorkspaceId }
  } catch (cause) {
    if (cause instanceof FederatedIdError) return { allowed: false, reason: 'unknown-id' }
    throw cause
  }
}

/** Session reorder is legal only inside one workspace of one node. */
export function decideSessionDrag(
  workspaceId: FederatedWorkspaceId,
  sessionId: FederatedSessionId,
  beforeSessionId: FederatedSessionId | undefined,
  membership: (id: FederatedSessionId) => FederatedWorkspaceId | undefined,
  known: ReadonlySet<NodeId>,
  writableNodes: ReadonlySet<NodeId>,
): DragDecision {
  try {
    const workspace = decodeWorkspaceId(workspaceId, known)
    const session = decodeSessionId(sessionId, known)
    if (session.nodeId !== workspace.nodeId) return { allowed: false, reason: 'cross-node' }
    if (membership(sessionId) !== workspaceId) return { allowed: false, reason: 'cross-workspace' }
    if (beforeSessionId !== undefined) {
      const anchor = decodeSessionId(beforeSessionId, known)
      if (anchor.nodeId !== workspace.nodeId) return { allowed: false, reason: 'cross-node' }
      if (membership(beforeSessionId) !== workspaceId) return { allowed: false, reason: 'cross-workspace' }
    }
    if (!writableNodes.has(workspace.nodeId)) return { allowed: false, reason: 'not-writable' }
    return beforeSessionId === undefined
      ? { allowed: true, kind: 'session', nodeId: workspace.nodeId, workspaceId, sessionId }
      : { allowed: true, kind: 'session', nodeId: workspace.nodeId, workspaceId, sessionId, beforeSessionId }
  } catch (cause) {
    if (cause instanceof FederatedIdError) return { allowed: false, reason: 'unknown-id' }
    throw cause
  }
}

/** Ungrouped and flat lists reorder only browser-local state; no RPC is sent. */
export function decideUngroupedDrag(): DragDecision {
  return { allowed: true, kind: 'browser-local' }
}

/** A drop marker may only be shown where the drag would actually be accepted. */
export function showsDropMarker(decision: DragDecision): boolean {
  return decision.allowed
}
