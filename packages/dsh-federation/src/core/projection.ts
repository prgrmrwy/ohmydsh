import { encodeSessionId, encodeWorkspaceId } from './id.js'
import type {
  FederatedSessionId,
  FederatedWorkspaceId,
  NativeSessionId,
  NativeWorkspaceId,
  NodeDescriptor,
  NodeId,
  SessionProjection,
  WorkspaceProjection,
} from './types.js'

export interface NativeWorkspaceSnapshot {
  readonly id: NativeWorkspaceId
  readonly title: string
  readonly path: string
  readonly sessionIds: readonly NativeSessionId[]
  readonly order: number
}

export interface NativeSessionSnapshot {
  readonly id: NativeSessionId
  readonly workspaceId?: NativeWorkspaceId
  readonly title: string
  readonly path: string
  readonly status: string
  readonly seq?: number
  readonly archived: boolean
}

export interface NodeProjectionInput {
  readonly node: NodeDescriptor
  readonly workspaces: readonly NativeWorkspaceSnapshot[]
  readonly sessions: readonly NativeSessionSnapshot[]
}

export interface NodeProjection {
  readonly node: NodeDescriptor
  readonly workspaces: readonly WorkspaceProjection[]
  readonly ungroupedSessionIds: readonly FederatedSessionId[]
  readonly archivedSessionIds: readonly FederatedSessionId[]
  readonly sessions: ReadonlyMap<FederatedSessionId, SessionProjection>
}

export interface FederationProjection {
  readonly nodes: readonly NodeProjection[]
  readonly workspaceById: ReadonlyMap<FederatedWorkspaceId, WorkspaceProjection>
  readonly sessionById: ReadonlyMap<FederatedSessionId, SessionProjection>
  readonly runningCount: number
}

export function projectNode(input: NodeProjectionInput): NodeProjection {
  const sessionMap = new Map<FederatedSessionId, SessionProjection>()
  const workspaceMembership = new Map<NativeSessionId, FederatedWorkspaceId>()
  for (const workspace of input.workspaces) {
    const workspaceId = encodeWorkspaceId({ nodeId: input.node.nodeId, nativeId: workspace.id })
    for (const sessionId of workspace.sessionIds) workspaceMembership.set(sessionId, workspaceId)
  }
  for (const session of input.sessions) {
    const id = encodeSessionId({ nodeId: input.node.nodeId, nativeId: session.id })
    const membership = session.workspaceId === undefined
      ? workspaceMembership.get(session.id)
      : encodeWorkspaceId({ nodeId: input.node.nodeId, nativeId: session.workspaceId })
    sessionMap.set(id, {
      ref: { nodeId: input.node.nodeId, nativeId: session.id },
      id,
      ...(membership === undefined ? {} : { workspaceId: membership }),
      title: session.title,
      path: session.path,
      status: session.status,
      ...(session.seq === undefined ? {} : { seq: session.seq }),
      archived: session.archived,
    })
  }
  const workspaces = [...input.workspaces]
    .sort((a, b) => a.order - b.order)
    .map(workspace => {
      const id = encodeWorkspaceId({ nodeId: input.node.nodeId, nativeId: workspace.id })
      return {
        ref: { nodeId: input.node.nodeId, nativeId: workspace.id },
        id,
        title: workspace.title,
        path: workspace.path,
        sessionIds: workspace.sessionIds
          .map(sessionId => encodeSessionId({ nodeId: input.node.nodeId, nativeId: sessionId }))
          .filter(sessionId => sessionMap.has(sessionId) && !sessionMap.get(sessionId)!.archived),
        archivedSessionIds: workspace.sessionIds
          .map(sessionId => encodeSessionId({ nodeId: input.node.nodeId, nativeId: sessionId }))
          .filter(sessionId => sessionMap.get(sessionId)?.archived === true),
        order: workspace.order,
      }
    })
  const ungroupedSessionIds = [...sessionMap.values()]
    .filter(session => session.workspaceId === undefined && !session.archived)
    .map(session => session.id)
  const archivedSessionIds = [...sessionMap.values()].filter(session => session.archived).map(session => session.id)
  return Object.freeze({
    node: input.node,
    workspaces: Object.freeze(workspaces),
    ungroupedSessionIds: Object.freeze(ungroupedSessionIds),
    archivedSessionIds: Object.freeze(archivedSessionIds),
    sessions: sessionMap,
  })
}

export function aggregateProjection(inputs: readonly NodeProjectionInput[]): FederationProjection {
  const nodes = [...inputs]
    .sort((a, b) => a.node.order - b.node.order)
    .map(projectNode)
  const workspaceById = new Map<FederatedWorkspaceId, WorkspaceProjection>()
  const sessionById = new Map<FederatedSessionId, SessionProjection>()
  let runningCount = 0
  for (const node of nodes) {
    for (const workspace of node.workspaces) workspaceById.set(workspace.id, workspace)
    for (const session of node.sessions.values()) {
      sessionById.set(session.id, session)
      if (session.status === 'running') runningCount++
    }
  }
  return Object.freeze({ nodes: Object.freeze(nodes), workspaceById, sessionById, runningCount })
}

export function assertNodeOwnedPath(nodeId: NodeId, path: string): { readonly nodeId: NodeId; readonly path: string } {
  if (path.length === 0 || path.includes('\0')) throw new Error('invalid node-owned path')
  return Object.freeze({ nodeId, path })
}
