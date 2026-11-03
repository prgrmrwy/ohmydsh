import type { DeliveryRecord } from './delivery.js'
import type { LocusClaimedDelivery } from './turn-observer.js'

/** Association only, not reply authorization: a mixed/refused turn can still be closed. */
export interface RefusedReplyExecutionProof {
  readonly sessionId: string
  readonly turn: number
  readonly scope: { readonly kind: 'child'; readonly locusId: string; readonly generation: number }
}

export interface DeliveryExecutionProofPorts {
  currentForChild(childSessionId: string): readonly DeliveryRecord[]
  findByInboxMessageId(messageId: string): DeliveryRecord | undefined
  deliveryForTurn(childSessionId: string, turn: number): LocusClaimedDelivery | undefined
  isActive(record: DeliveryRecord): boolean
}

/** Prove the actual live tool caller against its unique current and exact inbox/execution binding. */
export function createDeliveryExecutionProof(ports: DeliveryExecutionProofPorts) {
  return (execution: { readonly agent?: { readonly id: unknown; readonly session: { snapshotEvents(): readonly { readonly type: string; readonly data: unknown }[] } } }): RefusedReplyExecutionProof | undefined => {
    try {
      const agent = execution.agent
      if (agent === undefined || typeof agent.id !== 'string' || agent.id === '') return undefined
      let turn: number | undefined
      for (const event of agent.session.snapshotEvents()) {
        if (event.type !== 'turn/start' && event.type !== 'turn/end') continue
        const value = (event.data as { turn?: unknown } | null)?.turn
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return undefined
        if (event.type === 'turn/start') {
          if (turn !== undefined) return undefined
          turn = value
        } else {
          if (turn !== value) return undefined
          turn = undefined
        }
      }
      if (turn === undefined) return undefined
      const currents = ports.currentForChild(agent.id).filter(record => record.status === 'current' && record.queueState === 'current')
      if (currents.length !== 1) return undefined
      const current = currents[0]!
      if (current.childSessionId !== agent.id || !current.executionId || !current.inboxMessageId || !ports.isActive(current)) return undefined
      const bound = ports.findByInboxMessageId(current.inboxMessageId)
      const observed = ports.deliveryForTurn(agent.id, turn)
      if (bound?.deliveryId !== current.deliveryId || bound.executionId !== current.executionId ||
          bound.status !== 'current' || bound.queueState !== 'current' || bound.inboxMessageId !== current.inboxMessageId ||
          bound.locusId !== current.locusId || bound.generation !== current.generation ||
          bound.endpoint.chatId !== current.endpoint.chatId || bound.endpoint.threadId !== current.endpoint.threadId ||
          bound.childSessionId !== agent.id || observed?.deliveryId !== current.deliveryId ||
          observed.executionId !== current.executionId || observed.correlation.childSessionId !== agent.id ||
          observed.correlation.locusId !== current.locusId || observed.correlation.generation !== current.generation ||
          observed.correlation.endpoint.chatId !== current.endpoint.chatId ||
          observed.correlation.endpoint.threadId !== current.endpoint.threadId) return undefined
      return { sessionId: agent.id, turn, scope: { kind: 'child', locusId: current.locusId, generation: current.generation } }
    } catch {
      return undefined
    }
  }
}
