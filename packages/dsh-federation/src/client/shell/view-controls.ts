import type { FederatedSessionId, FederatedWorkspaceId, NodeId } from '../../core/index.js'

export type SessionGroupBy = 'workspace' | 'flat'
export type SessionOrderBy = 'manual' | 'updated'

export interface ViewControlsState {
  readonly groupBy: SessionGroupBy
  readonly orderBy: SessionOrderBy
  readonly query: string
}

export interface FlatSessionInput {
  readonly sessionId: FederatedSessionId
  readonly nodeId: NodeId
  readonly workspaceId?: FederatedWorkspaceId
  readonly updatedAt: number
  readonly blank: boolean
}

export interface NodePartition {
  readonly nodeId: NodeId
  readonly sessionIds: readonly FederatedSessionId[]
}

/**
 * Flat mode flattens workspaces but never nodes: each node keeps its own
 * partition so two nodes can hold identical native ids and titles without the
 * list becoming ambiguous.
 */
export function partitionFlatSessions(
  sessions: readonly FlatSessionInput[],
  nodeOrder: readonly NodeId[],
  orderBy: SessionOrderBy,
  manualOrder: (nodeId: NodeId) => readonly FederatedSessionId[] = () => [],
): readonly NodePartition[] {
  const byNode = new Map<NodeId, FlatSessionInput[]>(nodeOrder.map(nodeId => [nodeId, []]))
  for (const session of sessions) {
    const bucket = byNode.get(session.nodeId)
    if (bucket !== undefined) bucket.push(session)
  }
  return Object.freeze(nodeOrder.map(nodeId => {
    const bucket = byNode.get(nodeId) ?? []
    const sessionIds = orderBy === 'updated'
      ? [...bucket].sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId)).map(session => session.sessionId)
      : applyManualOrder(bucket.map(session => session.sessionId), manualOrder(nodeId))
    return Object.freeze({ nodeId, sessionIds: Object.freeze(sessionIds) })
  }))
}

/** Known manual order first, then any session the stored order has not seen yet. */
function applyManualOrder(present: readonly FederatedSessionId[], stored: readonly FederatedSessionId[]): FederatedSessionId[] {
  const remaining = new Set(present)
  const ordered: FederatedSessionId[] = []
  for (const sessionId of stored) {
    if (remaining.delete(sessionId)) ordered.push(sessionId)
  }
  for (const sessionId of present) {
    if (remaining.has(sessionId)) ordered.push(sessionId)
  }
  return ordered
}

/**
 * Global view controls owned by the federated shell. Grouping, ordering and the
 * search query are one shared shape across every node section, so a node cannot
 * drift into a different list mode.
 */
export class FederatedViewControls {
  #state: ViewControlsState

  constructor(initial: Partial<ViewControlsState> = {}) {
    this.#state = {
      groupBy: initial.groupBy ?? 'workspace',
      orderBy: initial.orderBy ?? 'manual',
      query: initial.query ?? '',
    }
  }

  get state(): ViewControlsState { return this.#state }
  /** Search results replace the tree for every node at once. */
  get searching(): boolean { return this.#state.query.trim() !== '' }

  setGroupBy(groupBy: SessionGroupBy): ViewControlsState {
    this.#state = { ...this.#state, groupBy }
    return this.#state
  }

  setOrderBy(orderBy: SessionOrderBy): ViewControlsState {
    this.#state = { ...this.#state, orderBy }
    return this.#state
  }

  setQuery(query: string): ViewControlsState {
    this.#state = { ...this.#state, query }
    return this.#state
  }

  /** Manual drag reordering is only meaningful while manual order is selected. */
  get manualDragEnabled(): boolean {
    return this.#state.orderBy === 'manual' && !this.searching
  }
}
