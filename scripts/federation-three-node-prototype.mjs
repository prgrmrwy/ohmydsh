const NODE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

function base64url(value) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function unbase64url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('malformed native id encoding')
  const decoded = Buffer.from(value, 'base64url').toString('utf8')
  if (decoded.length === 0 || base64url(decoded) !== value) throw new Error('non-canonical native id encoding')
  return decoded
}

export function encodeFederatedId(nodeId, kind, nativeId) {
  if (!NODE_ID.test(nodeId)) throw new Error('invalid node id')
  if (kind !== 'w' && kind !== 's') throw new Error('invalid object kind')
  if (typeof nativeId !== 'string' || nativeId.length === 0 || nativeId.length > 4096) throw new Error('invalid native id')
  return `fed1:${nodeId}:${kind}:${base64url(nativeId)}`
}

export function decodeFederatedId(id, expectedKind, knownNodes) {
  if (typeof id !== 'string') throw new Error('federated id must be a string')
  const match = /^fed1:([^:]+):([ws]):([^:]+)$/.exec(id)
  if (!match) throw new Error('malformed federated id')
  const [, nodeId, kind, encoded] = match
  if (!NODE_ID.test(nodeId) || !knownNodes.has(nodeId)) throw new Error('unknown node')
  if (kind !== expectedKind) throw new Error('wrong federated id kind')
  return { nodeId, kind, nativeId: unbase64url(encoded) }
}

export class ThreeNodeFederationPrototype {
  constructor(nodes) {
    this.nodes = new Map(nodes.map(node => [node.nodeId, node]))
    if (this.nodes.size !== nodes.length) throw new Error('duplicate node id')
    this.generations = new Map(nodes.map(node => [node.nodeId, 0]))
    this.sessions = new Map()
    this.workspaces = new Map()
    this.frames = []
  }

  beginGeneration(nodeId) {
    this.requireNode(nodeId)
    const generation = (this.generations.get(nodeId) ?? 0) + 1
    this.generations.set(nodeId, generation)
    return generation
  }

  projectWorkspace(nodeId, workspace) {
    const id = encodeFederatedId(nodeId, 'w', workspace.workspaceId)
    const sessionIds = workspace.sessionIds.map(sessionId => encodeFederatedId(nodeId, 's', sessionId))
    this.workspaces.set(id, { ...workspace, workspaceId: id, sessionIds, nodeId })
    return this.workspaces.get(id)
  }

  projectSession(nodeId, session) {
    const id = encodeFederatedId(nodeId, 's', session.sessionId)
    this.sessions.set(id, { ...session, sessionId: id, nodeId })
    return this.sessions.get(id)
  }

  routeSession(id) {
    const ref = decodeFederatedId(id, 's', this.nodes)
    return { node: this.nodes.get(ref.nodeId), nativeSessionId: ref.nativeId }
  }

  routeWorkspace(id) {
    const ref = decodeFederatedId(id, 'w', this.nodes)
    return { node: this.nodes.get(ref.nodeId), nativeWorkspaceId: ref.nativeId }
  }

  acceptFrame({ nodeId, generation, stream, frame }) {
    this.requireNode(nodeId)
    if (generation !== this.generations.get(nodeId)) return false
    if (stream !== 'mux' && stream !== 'host') throw new Error('unknown event stream')
    const rewritten = rewriteIds(frame, nodeId)
    this.frames.push({ nodeId, generation, stream, frame: rewritten })
    return true
  }

  requireNode(nodeId) {
    if (!this.nodes.has(nodeId)) throw new Error(`unknown node ${nodeId}`)
  }
}

function rewriteIds(value, nodeId, key) {
  if (typeof value === 'string') {
    if (key === 'workspaceId') return encodeFederatedId(nodeId, 'w', value)
    if (key === 'sessionId' || key === 'parentSessionId' || key === 'childSessionId') {
      return encodeFederatedId(nodeId, 's', value)
    }
    return value
  }
  if (Array.isArray(value)) {
    if (key === 'sessionIds' || key === 'archivedSessionIds') return value.map(item => encodeFederatedId(nodeId, 's', item))
    return value.map(item => rewriteIds(item, nodeId))
  }
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, rewriteIds(child, nodeId, childKey)]))
}
