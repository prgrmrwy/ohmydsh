import type { DeliveryCorrelation, DeliveryLeaseInput, DeliveryRecord } from './delivery.js'

export interface RefusedReplyPorts {
  getDelivery(id: string): DeliveryRecord | undefined
  abandonRefusedDelivery(input: DeliveryLeaseInput): Promise<{ changed: boolean; record?: DeliveryRecord | undefined }>
  isActive(record: DeliveryRecord): boolean
  withDispatchLane<T>(correlation: DeliveryCorrelation, operation: () => Promise<T>): Promise<T>
  finishAndAdvance(record: DeliveryRecord, correlation: DeliveryCorrelation, outcome: 'failed'): Promise<void>
  now(): number
}

/** Host-only turn bookkeeping; association is independent from reply authorization. */
export function createRefusedReplyTracker(ports: RefusedReplyPorts) {
  const turns = new Map<string, { record?: DeliveryRecord; continued: boolean }>()
  const key = (child: string, turn: number) => `${child}\u0000${turn}`
  return {
    refused(record: DeliveryRecord, turn: number) {
      const id = key(record.childSessionId, turn)
      const previous = turns.get(id)
      if (previous?.continued) return
      turns.set(id, { record, continued: false })
    },
    continued(child: string, turn: number) { turns.set(key(child, turn), { continued: true }) },
    async end(child: string, turn: number) {
      const entry = turns.get(key(child, turn))
      turns.delete(key(child, turn))
      const captured = entry?.record
      if (entry?.continued || captured === undefined) return
      const correlation: DeliveryCorrelation = {
        endpoint: captured.endpoint, locusId: captured.locusId,
        generation: captured.generation, childSessionId: captured.childSessionId,
      }
      await ports.withDispatchLane(correlation, async () => {
        const current = ports.getDelivery(captured.deliveryId)
        if (current === undefined || current.status !== 'current' || current.revision === undefined ||
            current.childSessionId !== child || current.locusId !== captured.locusId ||
            current.generation !== captured.generation || current.executionId !== captured.executionId ||
            !ports.isActive(current)) return
        const result = await ports.abandonRefusedDelivery({ ...correlation, deliveryId: captured.deliveryId, now: ports.now(), expectedRevision: current.revision })
        if (result.changed && result.record !== undefined) await ports.finishAndAdvance(result.record, correlation, 'failed')
      })
    },
    release(child: string) { for (const id of turns.keys()) if (id.startsWith(`${child}\u0000`)) turns.delete(id) },
  }
}
