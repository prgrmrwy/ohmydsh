import { describe, expect, it } from 'vitest'
import { abandonRefusedDelivery, acceptDelivery, claimCurrentDelivery, createDeliveryLedger, expireDelivery } from '../src/host/locus/delivery.js'

const scope = { endpoint: { chatId: 'chat-test' }, locusId: 'locus-test', generation: 1, childSessionId: 'child-test' }
function current() {
  const accepted = acceptDelivery(createDeliveryLedger(), { ...scope, messageId: 'message-a', acceptedAt: 100 })
  return claimCurrentDelivery(accepted.state, { ...scope, now: 101 })
}
describe('abandon refused current Delivery', () => {
  it('fails A once, preserves its evidence, and frees the current slot for B', () => {
    const a = current()
    const queued = acceptDelivery(a.state, { ...scope, messageId: 'message-b', acceptedAt: 102 })
    const input = { ...scope, deliveryId: a.record!.deliveryId, expectedRevision: a.record!.revision, now: 103 }
    const result = abandonRefusedDelivery(queued.state, input)
    expect(result.changed).toBe(true)
    expect(result.record).toMatchObject({ status: 'failed', failureReason: 'reply-refused', failedAt: 103, messageId: 'message-a' })
    expect(result.record!.queueState).toBeUndefined()
    expect(result.record!.startupDisposition).toBeUndefined()
    expect(result.record!.revision).toBe(a.record!.revision! + 1)
    expect(abandonRefusedDelivery(result.state, { ...input, expectedRevision: result.record!.revision }).changed).toBe(false)
    expect(claimCurrentDelivery(result.state, { ...scope, now: 104 }).record!.messageId).toBe('message-b')
  })
  it('refuses stale revisions, another generation, backlog, and missing rows', () => {
    const a = current()
    const base = { ...scope, deliveryId: a.record!.deliveryId, now: 103 }
    expect(abandonRefusedDelivery(a.state, { ...base, expectedRevision: 999 }).changed).toBe(false)
    expect(abandonRefusedDelivery(a.state, { ...base, generation: 2 }).changed).toBe(false)
    expect(abandonRefusedDelivery(a.state, { ...base, deliveryId: 'missing' }).changed).toBe(false)
    const backlog = acceptDelivery(a.state, { ...scope, messageId: 'b', acceptedAt: 102 })
    expect(abandonRefusedDelivery(backlog.state, { ...base, deliveryId: backlog.record.deliveryId }).changed).toBe(false)
  })
  it('cannot consume B when A expires before the refusal is settled', () => {
    const a = current()
    const queued = acceptDelivery(a.state, { ...scope, messageId: 'message-b', acceptedAt: 102 })
    const expired = expireDelivery(queued.state, { ...scope, deliveryId: a.record!.deliveryId, now: a.record!.deadlineAt! })
    const b = claimCurrentDelivery(expired.state, { ...scope, now: a.record!.deadlineAt! + 1 })
    const result = abandonRefusedDelivery(b.state, { ...scope, deliveryId: a.record!.deliveryId, now: a.record!.deadlineAt! + 2 })
    expect(result.changed).toBe(false)
    expect(result.state.byDeliveryId[b.record!.deliveryId].status).toBe('current')
  })
})
