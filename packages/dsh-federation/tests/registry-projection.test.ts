import { describe, expect, it } from 'vitest'
import {
  NodeRegistryModel,
  aggregateProjection,
  assertNodeOwnedPath,
  parseNodeId,
  type NativeSessionId,
  type NativeWorkspaceId,
  type NodeCapability,
  type NodeDescriptor,
} from '../src/core/index.js'

const local = parseNodeId('local-node')
const vmA = parseNodeId('vm-a')
const vmB = parseNodeId('vm-b')
const noCapabilities = new Set<NodeCapability>()

function descriptor(nodeId = local, order = 0): NodeDescriptor {
  return {
    nodeId,
    kind: nodeId === local ? 'local' : 'remote',
    displayName: nodeId,
    enabled: true,
    order,
    capabilities: noCapabilities,
    compatibility: 'SUPPORTED',
    state: 'READY',
    ...(nodeId === local ? {} : { sshAlias: nodeId, remoteDshPort: 3080 }),
  }
}

describe('Node registry domain model', () => {
  it('keeps local/remote IDs immutable while metadata and order change', () => {
    const registry = NodeRegistryModel.create(local)
    registry.addRemote({ nodeId: vmA, displayName: 'VM A', sshAlias: 'old-a', remoteDshPort: 3080 })
    registry.addRemote({ nodeId: vmB, displayName: 'VM B', sshAlias: 'vm-b', remoteDshPort: 3080, enabled: false })
    registry.updateRemote(vmA, { displayName: 'Renamed VM', sshAlias: 'new-a', enabled: false })
    registry.reorderRemote(vmB, vmA)
    expect(registry.snapshot.nodes.map(node => node.nodeId)).toEqual([local, vmB, vmA])
    expect(registry.snapshot.nodes.map(node => node.order)).toEqual([0, 0, 1])
    expect(registry.snapshot.nodes[2]).toMatchObject({ nodeId: vmA, displayName: 'Renamed VM', sshAlias: 'new-a', enabled: false })
    expect(() => registry.updateRemote(local, { displayName: 'not allowed' })).toThrow(/local node identity is immutable/)
    expect(() => registry.removeRemote(local)).toThrow(/local node identity is immutable/)
    expect(registry.snapshot.generation).toBe(4)
  })

  it('allows duplicate alias+port as warning without merging logical nodes', () => {
    const registry = NodeRegistryModel.create(local)
    registry.addRemote({ nodeId: vmA, displayName: 'A', sshAlias: 'shared', remoteDshPort: 3080 })
    registry.addRemote({ nodeId: vmB, displayName: 'B', sshAlias: 'shared', remoteDshPort: 3080 })
    expect(registry.duplicateEndpointWarnings().get(vmA)).toEqual([vmB])
    expect(registry.duplicateEndpointWarnings().get(vmB)).toEqual([vmA])
    expect(registry.snapshot.nodes).toHaveLength(3)
  })

  it('rejects malformed metadata and duplicate node IDs', () => {
    const registry = NodeRegistryModel.create(local)
    expect(() => registry.addRemote({ nodeId: vmA, displayName: '', sshAlias: 'a', remoteDshPort: 3080 })).toThrow(/display name/)
    expect(() => registry.addRemote({ nodeId: vmA, displayName: 'A', sshAlias: '-oBad', remoteDshPort: 3080 })).toThrow(/SSH alias/)
    expect(() => registry.addRemote({ nodeId: vmA, displayName: 'A', sshAlias: 'a', remoteDshPort: 0 })).toThrow(/port/)
    registry.addRemote({ nodeId: vmA, displayName: 'A', sshAlias: 'a', remoteDshPort: 3080 })
    expect(() => registry.addRemote({ nodeId: vmA, displayName: 'again', sshAlias: 'b', remoteDshPort: 3081 })).toThrow(/duplicate node id/)
  })
})

describe('federated projection', () => {
  it('preserves per-node workspace, ungrouped and archived ownership under collisions', () => {
    const inputs = [local, vmA].map((nodeId, order) => ({
      node: descriptor(nodeId, order),
      workspaces: [{
        id: 'workspace-collision' as NativeWorkspaceId,
        title: 'backend',
        path: order === 0 ? '/fixture/local/backend' : '/fixture/remote/backend',
        sessionIds: ['session-collision' as NativeSessionId, 'archived' as NativeSessionId],
        order: 0,
      }],
      sessions: [
        { id: 'session-collision' as NativeSessionId, workspaceId: 'workspace-collision' as NativeWorkspaceId, title: 'active', path: '/fixture/session', status: order === 0 ? 'idle' : 'running', archived: false },
        { id: 'archived' as NativeSessionId, workspaceId: 'workspace-collision' as NativeWorkspaceId, title: 'old', path: '/fixture/old', status: 'idle', archived: true },
        { id: 'ungrouped' as NativeSessionId, title: 'loose', path: '/fixture/loose', status: 'idle', archived: false },
      ],
    }))
    const projection = aggregateProjection(inputs)
    expect(projection.nodes).toHaveLength(2)
    expect(projection.workspaceById.size).toBe(2)
    expect(projection.sessionById.size).toBe(6)
    expect(projection.runningCount).toBe(1)
    expect(new Set(projection.nodes.map(node => node.workspaces[0]!.id)).size).toBe(2)
    for (const node of projection.nodes) {
      expect(node.ungroupedSessionIds).toHaveLength(1)
      expect(node.archivedSessionIds).toHaveLength(1)
      expect(node.workspaces[0]!.sessionIds).toHaveLength(1)
      expect(node.workspaces[0]!.archivedSessionIds).toHaveLength(1)
      expect(node.workspaces[0]!.ref.nodeId).toBe(node.node.nodeId)
    }
  })

  it('carries a path only with explicit node ownership and never normalizes it locally', () => {
    const remote = assertNodeOwnedPath(vmA, '/home/remote/project')
    expect(remote).toEqual({ nodeId: vmA, path: '/home/remote/project' })
    expect(() => assertNodeOwnedPath(vmA, 'bad\0path')).toThrow(/invalid node-owned path/)
  })
})
