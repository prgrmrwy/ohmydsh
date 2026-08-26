import { describe, expect, it } from 'vitest'
import {
  aggregateProjection,
  parseNodeId,
  type NativeSessionId,
  type NativeWorkspaceId,
  type NodeDescriptor,
  type NodeId,
  type NodeProjectionInput,
} from '../src/core/index.js'
import {
  mergeSearchOutcomes,
  partitionFlatSessions,
  type FlatSessionInput,
} from '../src/client/shell/index.js'

const local = parseNodeId('this-mac')
const vmA = parseNodeId('vm-a')
const vmB = parseNodeId('vm-b')

function descriptor(nodeId: NodeId, order: number, state: NodeDescriptor['state']): NodeDescriptor {
  return {
    nodeId, kind: nodeId === local ? 'local' : 'remote', displayName: nodeId, enabled: true, order,
    capabilities: new Set(), compatibility: 'SUPPORTED', state,
  }
}

/** Three nodes, 20 workspaces each, 15 sessions per workspace, one node offline. */
function scaleInputs(): readonly NodeProjectionInput[] {
  const nodes: [NodeId, NodeDescriptor['state']][] = [[local, 'READY'], [vmA, 'READY'], [vmB, 'SSH_UNREACHABLE']]
  return nodes.map(([nodeId, state], nodeIndex) => {
    const workspaces = Array.from({ length: 20 }, (_, w) => ({
      // Native ids deliberately collide across nodes.
      id: `workspace-${w}` as NativeWorkspaceId,
      title: `workspace-${w}`,
      path: `/synthetic/${nodeId}/workspace-${w}`,
      sessionIds: Array.from({ length: 15 }, (_, s) => `session-${w}-${s}` as NativeSessionId),
      order: w,
    }))
    const sessions = workspaces.flatMap(workspace => workspace.sessionIds.map((id, s) => ({
      id,
      title: `session ${id}`,
      path: workspace.path,
      status: s === 0 ? 'running' : 'idle',
      archived: s === 14,
      seq: s,
    })))
    return { node: descriptor(nodeId, nodeIndex, state), workspaces, sessions }
  })
}

describe('sidebar scale baseline (9.5)', () => {
  it('aggregates 900 sessions across three nodes with no id collisions and bounded time', () => {
    const inputs = scaleInputs()
    const started = performance.now()
    const projection = aggregateProjection(inputs)
    const elapsed = performance.now() - started

    expect(projection.nodes).toHaveLength(3)
    expect(projection.workspaceById.size).toBe(60)
    expect(projection.sessionById.size).toBe(900)
    // Every native id repeats on all three nodes yet stays distinct federated.
    expect(projection.runningCount).toBe(60)
    // Node order is preserved, including the offline node.
    expect(projection.nodes.map(node => node.node.nodeId)).toEqual([local, vmA, vmB])
    expect(projection.nodes[2]!.node.state).toBe('SSH_UNREACHABLE')
    // Archived sessions are separated per node rather than mixed into the tree.
    expect(projection.nodes[0]!.archivedSessionIds).toHaveLength(20)
    expect(elapsed).toBeLessThan(500)
  })

  it('partitions a flat 900-session list per node without unbounded work', () => {
    const projection = aggregateProjection(scaleInputs())
    const flat: FlatSessionInput[] = [...projection.sessionById.values()].map((session, index) => ({
      sessionId: session.id,
      nodeId: session.ref.nodeId,
      ...(session.workspaceId === undefined ? {} : { workspaceId: session.workspaceId }),
      updatedAt: index,
      blank: false,
    }))
    const started = performance.now()
    const partitions = partitionFlatSessions(flat, [local, vmA, vmB], 'updated')
    const elapsed = performance.now() - started
    expect(partitions).toHaveLength(3)
    expect(partitions.reduce((total, partition) => total + partition.sessionIds.length, 0)).toBe(900)
    expect(partitions.every(partition => partition.sessionIds.every(id => id.startsWith(`fed1:${partition.nodeId}:`)))).toBe(true)
    expect(elapsed).toBeLessThan(500)
  })

  it('caps merged search output regardless of per-node volume', () => {
    const projection = aggregateProjection(scaleInputs())
    const outcomes = [local, vmA].map(nodeId => ({
      nodeId,
      results: [...projection.nodes.find(node => node.node.nodeId === nodeId)!.sessions.values()]
        .slice(0, 300)
        .map(session => ({ session, snippet: 'synthetic' })),
      failed: false,
    }))
    const merged = mergeSearchOutcomes('session', [
      ...outcomes,
      { nodeId: vmB, results: [], failed: true, diagnostic: 'node offline' },
    ], {
      nodeDisplayName: nodeId => nodeId,
      workspaceTitle: () => undefined,
    })
    expect(merged.rows).toHaveLength(20)
    expect(merged.hasMore).toBe(true)
    expect(merged.failedNodes).toEqual([{ nodeId: vmB, diagnostic: 'node offline' }])
  })
})
