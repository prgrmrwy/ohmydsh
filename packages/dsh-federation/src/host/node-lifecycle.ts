import type { NodeId } from '../core/index.js'
import { WriteLedger } from '../core/index.js'
import type { OpenSshTunnelManager } from './ssh.js'

export class NodeDeletionRequiresConfirmation extends Error {
  constructor(readonly nodeId: NodeId, readonly unknownOperationCount: number) {
    super(`node ${nodeId} has ${unknownOperationCount} outcome-unknown operation(s)`)
    this.name = 'NodeDeletionRequiresConfirmation'
  }
}

export interface NodeDeletionResult {
  readonly retainedDiagnostics: readonly { readonly operationId: string; readonly kind: string; readonly state: 'OUTCOME_UNKNOWN' }[]
}

export async function disposeNodeForDeletion(
  nodeId: NodeId,
  ledger: WriteLedger,
  tunnels: OpenSshTunnelManager,
  confirmed: boolean,
): Promise<NodeDeletionResult> {
  const unknown = ledger.unknownForNode(nodeId)
  if (unknown.length > 0 && !confirmed) throw new NodeDeletionRequiresConfirmation(nodeId, unknown.length)
  await tunnels.disposeNode(nodeId)
  return {
    retainedDiagnostics: unknown.map(operation => ({
      operationId: operation.operationId,
      kind: operation.kind,
      state: 'OUTCOME_UNKNOWN',
    })),
  }
}

export interface SignalSource {
  on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
  off(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
}

export function bindCatchableShutdown(tunnels: OpenSshTunnelManager, source: SignalSource = process): () => void {
  let started = false
  const dispose = () => {
    if (started) return
    started = true
    void tunnels.disposeAll()
  }
  source.on('SIGINT', dispose)
  source.on('SIGTERM', dispose)
  return () => {
    source.off('SIGINT', dispose)
    source.off('SIGTERM', dispose)
  }
}

export class NodeReconnectBackoff {
  readonly #attempts = new Map<NodeId, number>()
  constructor(readonly manager: Pick<OpenSshTunnelManager, 'reconnectDelay'>) {}

  next(nodeId: NodeId): number {
    const attempt = this.#attempts.get(nodeId) ?? 0
    this.#attempts.set(nodeId, attempt + 1)
    return this.manager.reconnectDelay(attempt)
  }

  reset(nodeId: NodeId): void {
    this.#attempts.delete(nodeId)
  }

  attempt(nodeId: NodeId): number {
    return this.#attempts.get(nodeId) ?? 0
  }
}
