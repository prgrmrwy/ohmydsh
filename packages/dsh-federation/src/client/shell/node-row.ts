import type { NodeId, NodeState } from '../../core/index.js'

export type NodeRowStatus =
  | 'online'
  | 'connecting'
  | 'degraded'
  | 'incompatible'
  | 'offline'
  | 'stale'
  | 'disabled'

export interface NodeRowInput {
  readonly nodeId: NodeId
  readonly displayName: string
  readonly kind: 'local' | 'remote'
  readonly enabled: boolean
  readonly order: number
  readonly state: NodeState
  readonly compatibility: 'SUPPORTED' | 'EXPERIMENTAL' | 'INCOMPATIBLE'
  readonly runningSessionCount: number
  readonly pendingInteractionCount: number
  readonly diagnostic?: string
}

export interface NodeRow {
  readonly nodeId: NodeId
  readonly displayName: string
  readonly kind: 'local' | 'remote'
  readonly order: number
  readonly status: NodeRowStatus
  /** Writes are only offered where the node is authoritative and compatible. */
  readonly writable: boolean
  /** A stale/offline node keeps its last known tree as a read-only skeleton. */
  readonly showsSkeleton: boolean
  readonly runningSessionCount: number
  readonly pendingInteractionCount: number
  readonly expandable: boolean
  readonly diagnostic?: string
}

const STATUS_BY_STATE: Readonly<Record<NodeState, NodeRowStatus>> = {
  DISABLED: 'disabled',
  SSH_UNREACHABLE: 'offline',
  TUNNEL_ERROR: 'offline',
  DSH_UNAVAILABLE: 'offline',
  NON_DSH_SERVICE: 'offline',
  INCOMPATIBLE: 'incompatible',
  CONNECTING: 'connecting',
  DEGRADED: 'degraded',
  READY: 'online',
  STALE: 'stale',
}

/**
 * Derives one sidebar Node row. Status, writability and skeleton visibility are
 * all decided here so no row can advertise an action the node cannot serve.
 */
export function deriveNodeRow(input: NodeRowInput): NodeRow {
  const status: NodeRowStatus = input.enabled ? STATUS_BY_STATE[input.state] : 'disabled'
  const writable = status === 'online' || status === 'degraded'
  return Object.freeze({
    nodeId: input.nodeId,
    displayName: input.displayName,
    kind: input.kind,
    order: input.order,
    status,
    writable: writable && input.compatibility !== 'INCOMPATIBLE',
    showsSkeleton: status === 'stale' || status === 'offline',
    runningSessionCount: input.runningSessionCount,
    pendingInteractionCount: input.pendingInteractionCount,
    expandable: status !== 'disabled',
    ...(input.diagnostic === undefined ? {} : { diagnostic: input.diagnostic }),
  })
}

/** Central persisted order wins; ties fall back to a stable node-id compare. */
export function orderNodeRows(rows: readonly NodeRow[]): readonly NodeRow[] {
  return Object.freeze([...rows].sort((a, b) => a.order - b.order || a.nodeId.localeCompare(b.nodeId)))
}

export interface NodeAggregate {
  readonly runningSessionCount: number
  readonly pendingInteractionCount: number
  readonly onlineNodeCount: number
  readonly failingNodeCount: number
}

export function aggregateNodeRows(rows: readonly NodeRow[]): NodeAggregate {
  let running = 0
  let pending = 0
  let online = 0
  let failing = 0
  for (const row of rows) {
    running += row.runningSessionCount
    pending += row.pendingInteractionCount
    if (row.status === 'online' || row.status === 'degraded') online++
    if (row.status === 'offline' || row.status === 'incompatible') failing++
  }
  return Object.freeze({ runningSessionCount: running, pendingInteractionCount: pending, onlineNodeCount: online, failingNodeCount: failing })
}
