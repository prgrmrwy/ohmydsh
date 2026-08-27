import { randomUUID } from 'node:crypto'
import {
  NodeRegistryModel,
  parseNodeId,
  type NodeId,
  type NodeRecord,
  type NodeRegistrySnapshot,
  type WriteLedger,
} from '../core/index.js'
import { NodeRegistryStorage } from './registry-storage.js'
import type { RetainedDiagnosticsStore } from './diagnostics-store.js'
import { NodeDeletionRequiresConfirmation, disposeNodeForDeletion, type NodeDeletionResult } from './node-lifecycle.js'
import { probeSshIdentity, validateSshAlias, type OpenSshTunnelManager } from './ssh.js'

export interface NodeIdentityOutcome {
  readonly ok: boolean
  readonly diagnostic: string
}

export interface NodeRegistryServiceOptions {
  readonly dshHome: string
  readonly ledger: WriteLedger
  readonly tunnels: Pick<OpenSshTunnelManager, 'disposeNode'>
  /** Durable retention for diagnostics that outlive a deleted node. */
  readonly diagnostics?: RetainedDiagnosticsStore
  /** Non-interactive SSH identity gate; production uses system OpenSSH. */
  readonly probeIdentity?: (alias: string) => Promise<NodeIdentityOutcome>
  readonly localNodeId?: NodeId
  readonly localDisplayName?: string
}

export interface AddNodeRequest {
  readonly displayName: string
  readonly sshAlias: string
  readonly remoteDshPort: number
  readonly enabled?: boolean
}

export interface UpdateNodeRequest {
  readonly displayName?: string
  readonly sshAlias?: string
  readonly remoteDshPort?: number
  readonly enabled?: boolean
}

/**
 * Production node management.
 *
 * A node is persisted only after non-interactive SSH identity succeeds, every
 * mutation commits through the registry's generation/CAS storage, and deleting a
 * node that still has outcome-unknown writes requires explicit confirmation and
 * retains minimal redacted diagnostics.
 */
export class NodeRegistryService {
  readonly #storage: NodeRegistryStorage
  readonly #options: NodeRegistryServiceOptions
  #queue: Promise<unknown> = Promise.resolve()

  constructor(options: NodeRegistryServiceOptions) {
    this.#options = options
    this.#storage = new NodeRegistryStorage(options.dshHome)
  }

  async list(): Promise<NodeRegistrySnapshot> {
    return this.#serialize(async () => (await this.#load()).snapshot)
  }

  async addNode(request: AddNodeRequest): Promise<NodeRecord> {
    validateSshAlias(request.sshAlias)
    const identity = await (this.#options.probeIdentity ?? defaultIdentity)(request.sshAlias)
    if (!identity.ok) throw new Error(`SSH identity verification failed: ${identity.diagnostic}`)
    return this.#serialize(async () => {
      const current = await this.#load()
      const nodeId = parseNodeId(`node-${randomUUID().slice(0, 8)}`)
      const next = new NodeRegistryModel(current.snapshot).addRemote({
        nodeId,
        displayName: request.displayName,
        sshAlias: request.sshAlias,
        remoteDshPort: request.remoteDshPort,
        ...(request.enabled === undefined ? {} : { enabled: request.enabled }),
      })
      const saved = await this.#storage.save(next, current.expected)
      return saved.nodes.find(node => node.nodeId === nodeId)!
    })
  }

  async updateNode(nodeId: string, update: UpdateNodeRequest): Promise<NodeRecord> {
    const id = parseNodeId(nodeId)
    if (update.sshAlias !== undefined) {
      validateSshAlias(update.sshAlias)
      // An alias change is a new identity claim and must re-verify before it is
      // persisted; a failed probe leaves the saved node untouched.
      const identity = await (this.#options.probeIdentity ?? defaultIdentity)(update.sshAlias)
      if (!identity.ok) throw new Error(`SSH identity verification failed: ${identity.diagnostic}`)
    }
    return this.#serialize(async () => {
      const current = await this.#load()
      const next = new NodeRegistryModel(current.snapshot).updateRemote(id, update)
      const saved = await this.#storage.save(next, current.expected)
      return saved.nodes.find(node => node.nodeId === id)!
    })
  }

  async reorderNode(nodeId: string, beforeNodeId?: string): Promise<NodeRegistrySnapshot> {
    const id = parseNodeId(nodeId)
    const before = beforeNodeId === undefined ? undefined : parseNodeId(beforeNodeId)
    return this.#serialize(async () => {
      const current = await this.#load()
      const next = new NodeRegistryModel(current.snapshot).reorderRemote(id, before)
      return this.#storage.save(next, current.expected)
    })
  }

  async removeNode(nodeId: string, confirmed: boolean): Promise<NodeDeletionResult> {
    const id = parseNodeId(nodeId)
    return this.#serialize(async () => {
      const current = await this.#load()
      if (!current.snapshot.nodes.some(node => node.nodeId === id && node.kind === 'remote')) {
        throw new Error(`unknown remote node ${nodeId}`)
      }
      // Confirmation is checked before anything is disposed or written, so a
      // refused deletion leaves both the tunnel and the registry untouched.
      const unknown = this.#options.ledger.unknownForNode(id)
      if (unknown.length > 0 && !confirmed) throw new NodeDeletionRequiresConfirmation(id, unknown.length)

      // Commit the registry BEFORE releasing the tunnel. Disposing first means a
      // failed commit (lock contention, CAS conflict, permissions) leaves a
      // still-registered node whose tunnel is already dead — a split the caller
      // cannot detect. Committing first fails closed: the node stays connected.
      const record = current.snapshot.nodes.find(node => node.nodeId === id)
      const next = new NodeRegistryModel(current.snapshot).removeRemote(id)
      await this.#storage.save(next, current.expected)
      // The registry entry is already committed as removed, so from here every
      // step must run regardless of the others' failures: the node is gone, and
      // leaving its tunnel alive or its ledger rows visible is worse than the
      // original error. Retaining first preserves the evidence a dispose failure
      // would otherwise strand.
      let disposeAttempted = false
      try {
        if (this.#options.diagnostics !== undefined) {
          const redacted = this.#options.ledger.unknownDiagnostics().filter(entry => entry.nodeId === id)
          if (redacted.length > 0) {
            await this.#options.diagnostics.retain(redacted.map(entry => ({
              operationId: entry.operationId,
              nodeId: entry.nodeId,
              kind: entry.kind,
              state: 'OUTCOME_UNKNOWN' as const,
              ...(record === undefined ? {} : { nodeDisplayName: record.displayName }),
            })))
          }
        }
        disposeAttempted = true
        return await disposeNodeForDeletion(id, this.#options.ledger, this.#options.tunnels as OpenSshTunnelManager, confirmed)
      } finally {
        // Release the tunnel even if retention failed before the normal dispose
        // could run, so a storage fault cannot leak an ssh child for a node that
        // no longer exists. Skipped when dispose was already attempted.
        if (!disposeAttempted) await this.#options.tunnels.disposeNode(id).catch(() => {})
        // Live ledger rows must not keep surfacing next to the persisted copies;
        // retention is the single source of truth once the node is gone.
        this.#options.ledger.forgetNode(id)
      }
    })
  }

  async #load(): Promise<{ snapshot: NodeRegistrySnapshot; expected: number | 'missing' }> {
    const loaded = await this.#storage.load()
    if (loaded.status === 'loaded' && loaded.snapshot !== undefined) {
      return { snapshot: loaded.snapshot, expected: loaded.snapshot.generation }
    }
    // Bootstrapping a missing registry commits the local-only snapshot first;
    // the persisted generation it returns is the only valid CAS expectation.
    const created = NodeRegistryModel.create(
      this.#options.localNodeId ?? parseNodeId('this-mac'),
      this.#options.localDisplayName ?? 'This Mac',
    ).snapshot
    const persisted = await this.#storage.save(created, 'missing')
    return { snapshot: persisted, expected: persisted.generation }
  }

  #serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(action, action)
    this.#queue = next.then(() => undefined, () => undefined)
    return next
  }
}

async function defaultIdentity(alias: string): Promise<NodeIdentityOutcome> {
  const probe = await probeSshIdentity(alias)
  return { ok: probe.ok, diagnostic: probe.diagnostic }
}
