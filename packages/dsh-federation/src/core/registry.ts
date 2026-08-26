import { parseNodeId } from './id.js'
import type { NodeId } from './types.js'

const MAX_DISPLAY_NAME = 120
const MAX_ALIAS = 128

export interface LocalNodeRecord {
  readonly nodeId: NodeId
  readonly kind: 'local'
  readonly displayName: string
  readonly enabled: true
  readonly order: 0
}

export interface RemoteNodeRecord {
  readonly nodeId: NodeId
  readonly kind: 'remote'
  readonly displayName: string
  readonly sshAlias: string
  readonly remoteDshPort: number
  readonly enabled: boolean
  readonly order: number
}

export type NodeRecord = LocalNodeRecord | RemoteNodeRecord

export interface NodeRegistrySnapshot {
  readonly version: 1
  readonly generation: number
  readonly localNodeId: NodeId
  readonly nodes: readonly NodeRecord[]
}

export interface AddRemoteNodeInput {
  readonly nodeId: NodeId
  readonly displayName: string
  readonly sshAlias: string
  readonly remoteDshPort: number
  readonly enabled?: boolean
}

export interface UpdateRemoteNodeInput {
  readonly displayName?: string
  readonly sshAlias?: string
  readonly remoteDshPort?: number
  readonly enabled?: boolean
}

function displayName(value: string): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > MAX_DISPLAY_NAME || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error('invalid node display name')
  }
  return normalized
}

function sshAlias(value: string): string {
  if (!new RegExp(`^[A-Za-z0-9][A-Za-z0-9._-]{0,${MAX_ALIAS - 1}}$`).test(value)) throw new Error('invalid SSH alias')
  return value
}

function remotePort(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('invalid remote DSH port')
  return value
}

function freezeSnapshot(snapshot: NodeRegistrySnapshot): NodeRegistrySnapshot {
  for (const node of snapshot.nodes) Object.freeze(node)
  Object.freeze(snapshot.nodes)
  return Object.freeze(snapshot)
}

function normalize(snapshot: NodeRegistrySnapshot): NodeRegistrySnapshot {
  const local = snapshot.nodes.find(node => node.kind === 'local')
  if (local === undefined || local.nodeId !== snapshot.localNodeId) throw new Error('registry local node identity mismatch')
  const remotes = snapshot.nodes.filter((node): node is RemoteNodeRecord => node.kind === 'remote')
  return freezeSnapshot({
    ...snapshot,
    nodes: [
      { ...local, order: 0, enabled: true },
      ...remotes.map((node, order) => ({ ...node, order })),
    ],
  })
}

export class NodeRegistryModel {
  #snapshot: NodeRegistrySnapshot

  constructor(snapshot: NodeRegistrySnapshot) {
    if (snapshot.version !== 1 || !Number.isSafeInteger(snapshot.generation) || snapshot.generation < 0) throw new Error('invalid registry snapshot')
    const ids = new Set<NodeId>()
    for (const node of snapshot.nodes) {
      parseNodeId(node.nodeId)
      if (ids.has(node.nodeId)) throw new Error(`duplicate node id ${node.nodeId}`)
      ids.add(node.nodeId)
      displayName(node.displayName)
      if (node.kind === 'remote') {
        sshAlias(node.sshAlias)
        remotePort(node.remoteDshPort)
      }
    }
    this.#snapshot = normalize(snapshot)
  }

  static create(localNodeId: NodeId, localDisplayName = 'This Mac'): NodeRegistryModel {
    return new NodeRegistryModel({
      version: 1,
      generation: 0,
      localNodeId: parseNodeId(localNodeId),
      nodes: [{ nodeId: localNodeId, kind: 'local', displayName: displayName(localDisplayName), enabled: true, order: 0 }],
    })
  }

  get snapshot(): NodeRegistrySnapshot {
    return this.#snapshot
  }

  addRemote(input: AddRemoteNodeInput): NodeRegistrySnapshot {
    parseNodeId(input.nodeId)
    if (this.#snapshot.nodes.some(node => node.nodeId === input.nodeId)) throw new Error(`duplicate node id ${input.nodeId}`)
    return this.#commit([...this.#snapshot.nodes, {
      nodeId: input.nodeId,
      kind: 'remote',
      displayName: displayName(input.displayName),
      sshAlias: sshAlias(input.sshAlias),
      remoteDshPort: remotePort(input.remoteDshPort),
      enabled: input.enabled ?? true,
      order: this.#snapshot.nodes.length - 1,
    }])
  }

  updateRemote(nodeId: NodeId, update: UpdateRemoteNodeInput): NodeRegistrySnapshot {
    const node = this.#remote(nodeId)
    return this.#commit(this.#snapshot.nodes.map(current => current.nodeId !== nodeId ? current : {
      ...node,
      displayName: update.displayName === undefined ? node.displayName : displayName(update.displayName),
      sshAlias: update.sshAlias === undefined ? node.sshAlias : sshAlias(update.sshAlias),
      remoteDshPort: update.remoteDshPort === undefined ? node.remoteDshPort : remotePort(update.remoteDshPort),
      enabled: update.enabled ?? node.enabled,
    }))
  }

  reorderRemote(nodeId: NodeId, beforeId?: NodeId): NodeRegistrySnapshot {
    if (nodeId === beforeId) return this.#snapshot
    const target = this.#remote(nodeId)
    if (beforeId !== undefined) this.#remote(beforeId)
    const remotes = this.#snapshot.nodes.filter((node): node is RemoteNodeRecord => node.kind === 'remote' && node.nodeId !== nodeId)
    const index = beforeId === undefined ? remotes.length : remotes.findIndex(node => node.nodeId === beforeId)
    remotes.splice(index, 0, target)
    const local = this.#snapshot.nodes.find((node): node is LocalNodeRecord => node.kind === 'local')!
    return this.#commit([local, ...remotes])
  }

  removeRemote(nodeId: NodeId): NodeRegistrySnapshot {
    this.#remote(nodeId)
    return this.#commit(this.#snapshot.nodes.filter(node => node.nodeId !== nodeId))
  }

  duplicateEndpointWarnings(): ReadonlyMap<NodeId, readonly NodeId[]> {
    const groups = new Map<string, NodeId[]>()
    for (const node of this.#snapshot.nodes) {
      if (node.kind !== 'remote') continue
      const key = `${node.sshAlias}\u0000${node.remoteDshPort}`
      const ids = groups.get(key) ?? []
      ids.push(node.nodeId)
      groups.set(key, ids)
    }
    return new Map([...groups.values()].filter(ids => ids.length > 1).flatMap(ids => ids.map(id => [id, ids.filter(other => other !== id)] as const)))
  }

  #remote(nodeId: NodeId): RemoteNodeRecord {
    const node = this.#snapshot.nodes.find(candidate => candidate.nodeId === nodeId)
    if (node === undefined) throw new Error(`unknown node ${nodeId}`)
    if (node.kind !== 'remote') throw new Error('local node identity is immutable')
    return node
  }

  #commit(nodes: readonly NodeRecord[]): NodeRegistrySnapshot {
    this.#snapshot = normalize({ ...this.#snapshot, generation: this.#snapshot.generation + 1, nodes })
    return this.#snapshot
  }
}
