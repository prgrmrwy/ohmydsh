import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ThreeNodeFederationPrototype,
  decodeFederatedId,
  encodeFederatedId,
} from '../scripts/federation-three-node-prototype.mjs'

const nodes = [
  { nodeId: 'local', label: 'This Mac', calls: [] },
  { nodeId: 'vm-a', label: 'VM A', calls: [] },
  { nodeId: 'vm-b', label: 'VM B', calls: [] },
]

function federation() {
  return new ThreeNodeFederationPrototype(nodes.map(node => ({ ...node, calls: [] })))
}

test('same native workspace and session IDs remain visible under three distinct namespaces', () => {
  const fed = federation()
  const workspaceIds = []
  const sessionIds = []
  for (const node of nodes) {
    const session = fed.projectSession(node.nodeId, { sessionId: 'native-collision', title: node.label })
    const workspace = fed.projectWorkspace(node.nodeId, { workspaceId: 'workspace-collision', title: 'backend', sessionIds: ['native-collision'] })
    sessionIds.push(session.sessionId)
    workspaceIds.push(workspace.workspaceId)
    assert.equal(workspace.sessionIds[0], session.sessionId)
  }
  assert.equal(new Set(sessionIds).size, 3)
  assert.equal(new Set(workspaceIds).size, 3)
  assert.equal(fed.sessions.size, 3)
  assert.equal(fed.workspaces.size, 3)
})

test('federated IDs are reversible, typed and fail closed for unknown nodes', () => {
  const known = new Map(nodes.map(node => [node.nodeId, node]))
  const native = 'session:/native/碰撞'
  const id = encodeFederatedId('vm-a', 's', native)
  assert.deepEqual(decodeFederatedId(id, 's', known), { nodeId: 'vm-a', kind: 's', nativeId: native })
  assert.throws(() => decodeFederatedId(id, 'w', known), /wrong federated id kind/)
  assert.throws(() => decodeFederatedId('fed1:missing:s:bmF0aXZl', 's', known), /unknown node/)
  assert.throws(() => decodeFederatedId('fed2:vm-a:s:bmF0aXZl', 's', known), /malformed federated id/)
  assert.throws(() => decodeFederatedId('native-collision', 's', known), /malformed federated id/)
})

test('commands with colliding native IDs route only to the encoded owner', () => {
  const fed = federation()
  for (const node of nodes) {
    const id = encodeFederatedId(node.nodeId, 's', 'native-collision')
    const routed = fed.routeSession(id)
    routed.node.calls.push({ method: 'session.cancel', sessionId: routed.nativeSessionId })
  }
  for (const node of fed.nodes.values()) {
    assert.deepEqual(node.calls, [{ method: 'session.cancel', sessionId: 'native-collision' }])
  }
  const vmAWorkspace = fed.routeWorkspace(encodeFederatedId('vm-a', 'w', 'workspace-collision'))
  assert.equal(vmAWorkspace.node.nodeId, 'vm-a')
  assert.equal(vmAWorkspace.nativeWorkspaceId, 'workspace-collision')
})

test('mux and host frames rewrite nested IDs without cross-node collision', () => {
  const fed = federation()
  for (const node of nodes) {
    const generation = fed.beginGeneration(node.nodeId)
    assert.equal(fed.acceptFrame({
      nodeId: node.nodeId,
      generation,
      stream: 'mux',
      frame: { type: 'session/event', sessionId: 'native-collision', event: { parentSessionId: 'parent-collision' } },
    }), true)
    assert.equal(fed.acceptFrame({
      nodeId: node.nodeId,
      generation,
      stream: 'host',
      frame: {
        type: 'host/workspace-changed',
        workspace: { workspaceId: 'workspace-collision', sessionIds: ['native-collision'] },
        archivedSessionIds: ['native-collision'],
      },
    }), true)
  }
  const muxIds = fed.frames.filter(frame => frame.stream === 'mux').map(frame => frame.frame.sessionId)
  const workspaceIds = fed.frames.filter(frame => frame.stream === 'host').map(frame => frame.frame.workspace.workspaceId)
  const archivedIds = fed.frames.filter(frame => frame.stream === 'host').map(frame => frame.frame.archivedSessionIds[0])
  assert.equal(new Set(muxIds).size, 3)
  assert.equal(new Set(workspaceIds).size, 3)
  assert.deepEqual(new Set(archivedIds), new Set(muxIds))
})

test('new generation rejects late mux and host frames while other nodes continue', () => {
  const fed = federation()
  const vmAOld = fed.beginGeneration('vm-a')
  const vmB = fed.beginGeneration('vm-b')
  const vmANew = fed.beginGeneration('vm-a')
  assert.equal(fed.acceptFrame({
    nodeId: 'vm-a', generation: vmAOld, stream: 'mux',
    frame: { type: 'session/event', sessionId: 'native-collision', seq: 1 },
  }), false)
  assert.equal(fed.acceptFrame({
    nodeId: 'vm-a', generation: vmAOld, stream: 'host',
    frame: { type: 'host/session-status', sessionId: 'native-collision', status: 'running' },
  }), false)
  assert.equal(fed.acceptFrame({
    nodeId: 'vm-a', generation: vmANew, stream: 'mux',
    frame: { type: 'session/event', sessionId: 'native-collision', seq: 2 },
  }), true)
  assert.equal(fed.acceptFrame({
    nodeId: 'vm-b', generation: vmB, stream: 'host',
    frame: { type: 'host/session-status', sessionId: 'native-collision', status: 'idle' },
  }), true)
  assert.equal(fed.frames.length, 2)
  assert.deepEqual(fed.frames.map(frame => frame.nodeId), ['vm-a', 'vm-b'])
})
