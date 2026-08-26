import type { DeliveryState, NodeId, OperationId, RpcId } from './types.js'

export type WriteKind = 'prompt' | 'cancel' | 'selectModel' | 'revisioned'

export interface WriteOperation {
  readonly operationId: OperationId
  readonly nodeId: NodeId
  readonly kind: WriteKind
  readonly state: DeliveryState
  readonly rpcId?: RpcId
  readonly expectedRevision?: number
  readonly rejection?: string
}

export type ReconciliationEvidence =
  | { readonly kind: 'prompt-rpc-id'; readonly rpcId: RpcId }
  | { readonly kind: 'revision'; readonly revision: number }
  | { readonly kind: 'ambiguous-state' }

const transitions: Readonly<Record<DeliveryState, ReadonlySet<DeliveryState>>> = {
  NOT_SENT: new Set(['SENT_AWAITING_RESPONSE', 'REJECTED']),
  SENT_AWAITING_RESPONSE: new Set(['ACCEPTED', 'REJECTED', 'OUTCOME_UNKNOWN']),
  ACCEPTED: new Set(),
  REJECTED: new Set(),
  OUTCOME_UNKNOWN: new Set(['ACCEPTED']),
}

export class WriteLedger {
  readonly #operations = new Map<OperationId, WriteOperation>()

  create(operation: Omit<WriteOperation, 'state' | 'rejection'>): WriteOperation {
    if (this.#operations.has(operation.operationId)) throw new Error(`duplicate operation ${operation.operationId}`)
    if (operation.kind === 'prompt' && operation.rpcId === undefined) throw new Error('prompt ledger entry requires persistent rpcId')
    if (operation.kind === 'revisioned' && operation.expectedRevision === undefined) throw new Error('revisioned ledger entry requires expected revision')
    const created: WriteOperation = Object.freeze({ ...operation, state: 'NOT_SENT' })
    this.#operations.set(operation.operationId, created)
    return created
  }

  get(operationId: OperationId): WriteOperation | undefined {
    return this.#operations.get(operationId)
  }

  markSent(operationId: OperationId): WriteOperation {
    return this.#transition(operationId, 'SENT_AWAITING_RESPONSE')
  }

  markAccepted(operationId: OperationId): WriteOperation {
    return this.#transition(operationId, 'ACCEPTED')
  }

  markRejected(operationId: OperationId, rejection: string): WriteOperation {
    return this.#transition(operationId, 'REJECTED', rejection)
  }

  markConnectionLost(operationId: OperationId): WriteOperation {
    const current = this.#required(operationId)
    if (current.state === 'NOT_SENT') return current
    if (current.state !== 'SENT_AWAITING_RESPONSE') return current
    return this.#transition(operationId, 'OUTCOME_UNKNOWN')
  }

  reconcile(operationId: OperationId, evidence: ReconciliationEvidence): WriteOperation {
    const operation = this.#required(operationId)
    if (operation.state !== 'OUTCOME_UNKNOWN') return operation
    const proven = operation.kind === 'prompt'
      ? evidence.kind === 'prompt-rpc-id' && evidence.rpcId === operation.rpcId
      : operation.kind === 'revisioned'
        ? evidence.kind === 'revision' && evidence.revision === operation.expectedRevision
        : false
    return proven ? this.#transition(operationId, 'ACCEPTED') : operation
  }

  replayable(): readonly WriteOperation[] {
    // Only writes proven never sent may be offered for an explicit fresh send.
    // SENT/UNKNOWN operations are never automatically replayable.
    return [...this.#operations.values()].filter(operation => operation.state === 'NOT_SENT')
  }

  unknownForNode(nodeId: NodeId): readonly WriteOperation[] {
    return [...this.#operations.values()].filter(operation => operation.nodeId === nodeId && operation.state === 'OUTCOME_UNKNOWN')
  }

  #required(operationId: OperationId): WriteOperation {
    const operation = this.#operations.get(operationId)
    if (operation === undefined) throw new Error(`unknown operation ${operationId}`)
    return operation
  }

  #transition(operationId: OperationId, next: DeliveryState, rejection?: string): WriteOperation {
    const current = this.#required(operationId)
    if (!transitions[current.state].has(next)) throw new Error(`invalid delivery transition ${current.state} -> ${next}`)
    const updated = Object.freeze({ ...current, state: next, ...(rejection === undefined ? {} : { rejection }) })
    this.#operations.set(operationId, updated)
    return updated
  }
}
