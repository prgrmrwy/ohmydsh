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

/**
 * The lifecycle a catchable signal must terminate.
 *
 * Disposing only the tunnel manager is not terminal: the per-node reconnect
 * loop survives and immediately spawns replacement ssh children, so the signal
 * handler must abort the whole connection lifecycle first and only then release
 * any tunnel the loop had not yet adopted.
 */
export interface ShutdownTarget {
  readonly tunnels: Pick<OpenSshTunnelManager, 'disposeAll'>
  dispose(): Promise<void>
  /**
   * Whether the full lifecycle owner exists yet. While false, a signal still
   * releases already-spawned children but must not consume the one-shot latch.
   */
  ready?(): boolean
}

export function bindCatchableShutdown(target: ShutdownTarget, source: SignalSource = process): () => void {
  let started = false
  const dispose = () => {
    if (started) return
    // The latch may only be set once cleanup has a real target. During startup
    // the owner may not exist yet; latching on that no-op signal would silently
    // disable every later signal.
    if (target.ready !== undefined && !target.ready()) {
      void target.tunnels.disposeAll().catch(() => {})
      return
    }
    started = true
    void (async () => {
      // Ordering matters: dispose() aborts reconnect loops and awaits their
      // in-flight rounds, so no new child can appear after the final sweep.
      await target.dispose().catch(() => {})
      await target.tunnels.disposeAll().catch(() => {})
    })()
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
