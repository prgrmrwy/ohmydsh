import { describe, expect, it } from 'vitest'
import {
  encodeSessionId,
  encodeWorkspaceId,
  parseNodeId,
  type FederatedSessionId,
  type FederatedWorkspaceId,
  type NativeSessionId,
  type NativeWorkspaceId,
  type NodeId,
} from '../src/core/index.js'
import {
  FederatedHeroPicker,
  FederatedViewControls,
  partitionFlatSessions,
  type FlatSessionInput,
} from '../src/client/shell/index.js'

const local = parseNodeId('this-mac')
const vmA = parseNodeId('vm-a')
const vmB = parseNodeId('vm-b')

const wsLocal = encodeWorkspaceId({ nodeId: local, nativeId: 'shared' as NativeWorkspaceId })
const wsA = encodeWorkspaceId({ nodeId: vmA, nativeId: 'shared' as NativeWorkspaceId })
const wsB = encodeWorkspaceId({ nodeId: vmB, nativeId: 'shared' as NativeWorkspaceId })

function session(nodeId: NodeId, native: string, updatedAt: number, workspaceId?: FederatedWorkspaceId, blank = false): FlatSessionInput {
  return {
    sessionId: encodeSessionId({ nodeId, nativeId: native as NativeSessionId }),
    nodeId,
    ...(workspaceId === undefined ? {} : { workspaceId }),
    updatedAt,
    blank,
  }
}

describe('global view controls (7.3)', () => {
  it('keeps node partitions in flat mode with identical native ids intact', () => {
    const sessions = [
      session(vmA, 'shared', 300, wsA),
      session(vmB, 'shared', 400, wsB),
      session(local, 'shared', 200, wsLocal),
    ]
    const partitions = partitionFlatSessions(sessions, [local, vmA, vmB], 'updated')
    expect(partitions.map(partition => partition.nodeId)).toEqual([local, vmA, vmB])
    expect(partitions.every(partition => partition.sessionIds.length === 1)).toBe(true)
    expect(new Set(partitions.flatMap(partition => [...partition.sessionIds])).size).toBe(3)
  })

  it('orders by updated descending or by stored manual order per node', () => {
    const sessions = [
      session(vmA, 'a', 100, wsA),
      session(vmA, 'b', 300, wsA),
      session(vmA, 'c', 200, wsA),
    ]
    const byUpdated = partitionFlatSessions(sessions, [vmA], 'updated')[0]!
    expect(byUpdated.sessionIds).toEqual([
      encodeSessionId({ nodeId: vmA, nativeId: 'b' as NativeSessionId }),
      encodeSessionId({ nodeId: vmA, nativeId: 'c' as NativeSessionId }),
      encodeSessionId({ nodeId: vmA, nativeId: 'a' as NativeSessionId }),
    ])
    const stored = [encodeSessionId({ nodeId: vmA, nativeId: 'c' as NativeSessionId })]
    const byManual = partitionFlatSessions(sessions, [vmA], 'manual', () => stored)[0]!
    expect(byManual.sessionIds[0]).toBe(stored[0])
    expect(byManual.sessionIds.length).toBe(3)
  })

  it('shares one grouping/ordering/query shape and disables manual drag while searching', () => {
    const controls = new FederatedViewControls()
    expect(controls.state).toEqual({ groupBy: 'workspace', orderBy: 'manual', query: '' })
    expect(controls.manualDragEnabled).toBe(true)
    controls.setGroupBy('flat')
    controls.setOrderBy('updated')
    expect(controls.manualDragEnabled).toBe(false)
    controls.setOrderBy('manual')
    controls.setQuery('  shared ')
    expect(controls.searching).toBe(true)
    expect(controls.manualDragEnabled).toBe(false)
    controls.setQuery('   ')
    expect(controls.searching).toBe(false)
    expect(controls.state.groupBy).toBe('flat')
  })
})

describe('federated hero picker (7.6)', () => {
  const blankA: FederatedSessionId = encodeSessionId({ nodeId: vmA, nativeId: 'blank' as NativeSessionId })
  function picker() {
    return new FederatedHeroPicker({
      nodes: [
        { nodeId: local, displayName: 'This Mac', writable: true, directoryMode: 'native' },
        { nodeId: vmA, displayName: 'VM A', writable: true, directoryMode: 'browse' },
        { nodeId: vmB, displayName: 'VM B', writable: false, directoryMode: 'browse' },
      ],
      workspaces: [
        { workspaceId: wsLocal, nodeId: local, title: 'Local', path: '/local' },
        { workspaceId: wsA, nodeId: vmA, title: 'Remote', path: '/remote' },
        { workspaceId: wsB, nodeId: vmB, title: 'Offline', path: '/offline' },
      ],
      blankSessions: [{ sessionId: blankA, workspaceId: wsA, nodeId: vmA }],
    })
  }

  it('offers only writable nodes and node-scoped workspaces with the right directory mode', () => {
    const hero = picker()
    expect(hero.selectableNodes().map(node => node.nodeId)).toEqual([local, vmA])
    expect(hero.workspacesOf(vmA).map(workspace => workspace.workspaceId)).toEqual([wsA])
    expect(hero.directoryModeOf(local)).toBe('native')
    expect(hero.directoryModeOf(vmA)).toBe('browse')
  })

  it('reuses an existing blank session and otherwise creates on the owning node', () => {
    const hero = picker()
    expect(hero.choose(wsA)).toEqual({ kind: 'reuse-blank', sessionId: blankA })
    expect(hero.choose(wsLocal)).toEqual({ kind: 'create-session', nodeId: local, workspaceId: wsLocal })
  })

  it('rejects unknown workspaces and non-writable nodes identically for both surfaces', () => {
    const hero = picker()
    expect(hero.choose(wsB)).toEqual({ kind: 'rejected', reason: 'not-writable' })
    expect(hero.choose('fed1:ghost:w:c2hhcmVk' as FederatedWorkspaceId)).toEqual({ kind: 'rejected', reason: 'unknown-workspace' })
  })
})
