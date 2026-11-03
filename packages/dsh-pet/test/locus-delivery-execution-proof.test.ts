import { describe, expect, it } from 'vitest'
import { createDeliveryExecutionProof } from '../src/host/locus/delivery-execution-proof.js'
import { acceptDelivery, bindQueued, claimCurrentDelivery, createDeliveryLedger } from '../src/host/locus/delivery.js'

const correlation = { endpoint: { chatId: 'chat' }, locusId: 'locus', generation: 1, childSessionId: 'child' }
function fixture() {
  const accepted = acceptDelivery(createDeliveryLedger(), { ...correlation, messageId: 'message', acceptedAt: 1 })
  const current = claimCurrentDelivery(accepted.state, { ...correlation, now: 2 })
  const row = bindQueued(current.state, { ...correlation, deliveryId: accepted.record.deliveryId, executionId: 'execution', inboxMessageId: 'inbox', queuedAt: 3 }).record!
  const events = [{ type: 'turn/start', data: { turn: 1 } }]
  const ports = {
    currentForChild: () => [row],
    findByInboxMessageId: () => row,
    deliveryForTurn: () => ({ deliveryId: row.deliveryId, executionId: 'execution', correlation }),
    isActive: () => true,
  }
  return { row, ports, execution: { agent: { id: 'child', session: { snapshotEvents: () => events } } }, events }
}

describe('refused reply execution association', () => {
  it('proves a refused/mixed caller without granting reply authority', () => {
    const f = fixture()
    expect(createDeliveryExecutionProof(f.ports)(f.execution)).toEqual({ sessionId: 'child', turn: 1, scope: { kind: 'child', locusId: 'locus', generation: 1 } })
  })
  it('rejects missing, duplicate, stale and cross-child current bindings', () => {
    const f = fixture()
    for (const rows of [[], [f.row, f.row], [{ ...f.row, executionId: undefined }], [{ ...f.row, inboxMessageId: undefined }], [{ ...f.row, childSessionId: 'other' }], [{ ...f.row, status: 'failed' }]]) {
      expect(createDeliveryExecutionProof({ ...f.ports, currentForChild: () => rows as never })(f.execution)).toBeUndefined()
    }
    expect(createDeliveryExecutionProof({ ...f.ports, deliveryForTurn: () => ({ deliveryId: f.row.deliveryId, executionId: 'stale', correlation }) })(f.execution)).toBeUndefined()
    expect(createDeliveryExecutionProof({ ...f.ports, isActive: () => false })(f.execution)).toBeUndefined()
    expect(createDeliveryExecutionProof({ ...f.ports, findByInboxMessageId: () => undefined })(f.execution)).toBeUndefined()
  })
  it('rejects ended/ambiguous turns, ordinary callers and unavailable storage', () => {
    const f = fixture()
    f.events.push({ type: 'turn/end', data: { turn: 1 } })
    expect(createDeliveryExecutionProof(f.ports)(f.execution)).toBeUndefined()
    f.events.push({ type: 'turn/start', data: { turn: 2 } }, { type: 'turn/start', data: { turn: 3 } })
    expect(createDeliveryExecutionProof(f.ports)(f.execution)).toBeUndefined()
    expect(createDeliveryExecutionProof(f.ports)({})).toBeUndefined()
    const g = fixture()
    expect(createDeliveryExecutionProof({ ...g.ports, currentForChild: () => { throw new Error('storage') } })(g.execution)).toBeUndefined()
  })
})
