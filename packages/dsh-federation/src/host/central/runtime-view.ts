import {
  aggregateProjection,
  decodeSessionId,
  decodeWorkspaceId,
  type FederatedSessionId,
  type FederatedWorkspaceId,
  type FederationProjection,
  type NodeId,
  type NodeProjectionInput,
} from '../../core/index.js'

export interface CentralWorkspaceView {
  readonly workspaceId: FederatedWorkspaceId
  readonly nodeId: NodeId
  readonly title: string
  readonly path: string
  readonly sessionIds: readonly FederatedSessionId[]
}

export interface CentralSessionView {
  readonly sessionId: FederatedSessionId
  readonly nodeId: NodeId
  readonly workspaceId?: FederatedWorkspaceId
  readonly title: string
  readonly cwd: string
  readonly running: boolean
  readonly blank: boolean
  readonly seq?: number
}

export interface CentralRuntimeView {
  readonly workspaces: readonly CentralWorkspaceView[]
  readonly sessions: readonly CentralSessionView[]
  readonly archivedSessionIds: readonly FederatedSessionId[]
  readonly ungroupedSessionIds: readonly FederatedSessionId[]
  readonly currentSessionId?: FederatedSessionId
  readonly runningCount: number
}

export interface CentralViewOptions {
  /** Federated current id; kept only when it still resolves to a visible session. */
  readonly currentSessionId?: FederatedSessionId
  /** Sessions with no started turn, keyed by federated id. */
  readonly blankSessionIds?: Iterable<FederatedSessionId>
}

/**
 * Projects the aggregated federation state into the shape the central rc.2
 * runtime view consumes. Only federated ids cross this boundary, so two nodes
 * carrying identical native ids can never collide in one list.
 */
export function projectCentralRuntimeView(
  inputs: readonly NodeProjectionInput[],
  options: CentralViewOptions = {},
): CentralRuntimeView {
  const projection: FederationProjection = aggregateProjection(inputs)
  const blank = new Set(options.blankSessionIds ?? [])
  const workspaces: CentralWorkspaceView[] = []
  const sessions: CentralSessionView[] = []
  const archived: FederatedSessionId[] = []
  const ungrouped: FederatedSessionId[] = []

  for (const node of projection.nodes) {
    for (const workspace of node.workspaces) {
      workspaces.push({
        workspaceId: workspace.id,
        nodeId: node.node.nodeId,
        title: workspace.title,
        path: workspace.path,
        sessionIds: workspace.sessionIds,
      })
    }
    for (const session of node.sessions.values()) {
      if (session.archived) {
        archived.push(session.id)
        continue
      }
      sessions.push({
        sessionId: session.id,
        nodeId: node.node.nodeId,
        ...(session.workspaceId === undefined ? {} : { workspaceId: session.workspaceId }),
        title: session.title,
        cwd: session.path,
        running: session.status === 'running',
        blank: blank.has(session.id),
        ...(session.seq === undefined ? {} : { seq: session.seq }),
      })
    }
    for (const sessionId of node.ungroupedSessionIds) ungrouped.push(sessionId)
  }

  const current = options.currentSessionId !== undefined && sessions.some(session => session.sessionId === options.currentSessionId)
    ? options.currentSessionId
    : undefined

  return Object.freeze({
    workspaces: Object.freeze(workspaces),
    sessions: Object.freeze(sessions),
    archivedSessionIds: Object.freeze(archived),
    ungroupedSessionIds: Object.freeze(ungrouped),
    ...(current === undefined ? {} : { currentSessionId: current }),
    runningCount: sessions.filter(session => session.running).length,
  })
}

/** Resolves the owning node of a federated workspace id, failing closed. */
export function ownerOfWorkspace(id: FederatedWorkspaceId, known: ReadonlySet<NodeId>): NodeId {
  return decodeWorkspaceId(id, known).nodeId
}

/** Resolves the owning node of a federated session id, failing closed. */
export function ownerOfSession(id: FederatedSessionId, known: ReadonlySet<NodeId>): NodeId {
  return decodeSessionId(id, known).nodeId
}
