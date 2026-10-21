import { describe, expect, it, vi } from 'vitest'
import { createRefusedReplyTracker } from '../src/host/locus/refused-reply.js'
import { abandonRefusedDelivery, acceptDelivery, claimCurrentDelivery, createDeliveryLedger, expireDelivery, completeDelivery } from '../src/host/locus/delivery.js'
const scope = { endpoint: { chatId: 'chat' }, locusId: 'locus', generation: 1, childSessionId: 'child' }
function fixture() {
  const a = acceptDelivery(createDeliveryLedger(), { ...scope, messageId: 'a', acceptedAt: 1 })
  const current = claimCurrentDelivery(a.state, { ...scope, now: 2 })
  let state = acceptDelivery(current.state, { ...scope, messageId: 'b', acceptedAt: 3 }).state
  let active = true
  const advance = vi.fn(async () => { state = claimCurrentDelivery(state, { ...scope, now: 5 }).state })
  const tracker = createRefusedReplyTracker({
    getDelivery: id => state.byDeliveryId[id], isActive: () => active,
    abandonRefusedDelivery: async input => { const result = abandonRefusedDelivery(state, input); state = result.state; return result },
    withDispatchLane: async (_scope, operation) => operation(), finishAndAdvance: advance, now: () => 4,
  })
  return { tracker, a: current.record!, advance, get: () => state, complete() { state = completeDelivery(state, { ...scope, deliveryId: current.record!.deliveryId, outcome: 'no-reply', reason: 'done', now: 4 }).state }, deactivate: () => { active = false }, expire() { state = expireDelivery(state, { ...scope, deliveryId: current.record!.deliveryId, now: current.record!.deadlineAt! }).state; state = claimCurrentDelivery(state, { ...scope, now: current.record!.deadlineAt! + 1 }).state } }
}
describe('refused reply end-of-turn settlement', () => {
  it('fails exactly A and advances B once on duplicate end', async () => {
    const f = fixture()
    f.tracker.refused(f.a, 1)
    await f.tracker.end('child', 1)
    await f.tracker.end('child', 1)
    expect(f.get().byDeliveryId[f.a.deliveryId].failureReason).toBe('reply-refused')
    expect(Object.values(f.get().byDeliveryId).find(row => row.messageId === 'b')?.status).toBe('current')
    expect(f.advance).toHaveBeenCalledTimes(1)
  })
  it.each(['before', 'after'])('keeps the current if wait succeeded %s refusal', async order => {
    const f = fixture()
    if (order === 'before') f.tracker.continued('child', 1)
    f.tracker.refused(f.a, 1)
    if (order === 'after') f.tracker.continued('child', 1)
    await f.tracker.end('child', 1)
    expect(f.get().byDeliveryId[f.a.deliveryId].status).toBe('current')
    expect(f.advance).not.toHaveBeenCalled()
  })
  it('drops pending refusal on actor release and ignores completed A', async () => {
    const released = fixture()
    released.tracker.refused(released.a, 1)
    released.tracker.release('child')
    await released.tracker.end('child', 1)
    expect(released.advance).not.toHaveBeenCalled()
    const completed = fixture()
    completed.tracker.refused(completed.a, 1)
    completed.complete()
    await completed.tracker.end('child', 1)
    expect(completed.advance).not.toHaveBeenCalled()
  })
  it('does not settle ordinary ends, another turn, stale A, or a retired generation', async () => {
    const f = fixture()
    await f.tracker.end('child', 1)
    f.tracker.refused(f.a, 1)
    await f.tracker.end('child', 2)
    expect(f.advance).not.toHaveBeenCalled()
    f.expire()
    await f.tracker.end('child', 1)
    expect(f.advance).not.toHaveBeenCalled()
    expect(Object.values(f.get().byDeliveryId).find(row => row.messageId === 'b')?.status).toBe('current')
    const retired = fixture()
    retired.tracker.refused(retired.a, 1)
    retired.deactivate()
    await retired.tracker.end('child', 1)
    expect(retired.advance).not.toHaveBeenCalled()
  })
})
