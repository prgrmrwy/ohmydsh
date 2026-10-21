import { expect, it, vi } from 'vitest'
import type { CollabEvent } from '../src/index.js'
import { CollabService } from '../src/index.js'
import { dispatchItem, dispatchWorld } from './support/dispatch-world.js'

async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve() }
const intended = (w: Awaited<ReturnType<typeof dispatchWorld>>, after = 0) => w.log().slice(after).flatMap(r => r.events).filter((event): event is Extract<CollabEvent, { type: 'dispatch/intended' }> => event.type === 'dispatch/intended')

it('dispatch-01：意图与命令同提交', async () => {
  const w = await dispatchWorld()
  const result = await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'hello', needsReply: true })
  const command = w.log().find(r => r.seq === result.seq)!
  expect(command.events.map(e => e.type)).toContain('message/sent')
  expect(command.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'dispatch/intended', delivery: expect.objectContaining({ member: 'doubao', kind: 'wake' }) })]))
})

it('dispatch-02：正常返回记为成功', async () => {
  const w = await dispatchWorld()
  await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'hello', needsReply: true })
  await vi.waitFor(() => expect(w.log().flatMap(r => r.events).some(e => e.type === 'dispatch/completed')).toBe(true))
  const delivery = intended(w)[0]!.delivery
  expect(w.log().at(-1)?.events).toContainEqual({ type: 'dispatch/completed', actor: 'system:dispatch', deliveryId: delivery.deliveryId, outcome: 'succeeded' })
})

it('dispatch-03：provider抛错记为失败', async () => {
  const w = await dispatchWorld()
  vi.spyOn(w.provider, 'deliver').mockRejectedValueOnce(new Error('provider failure'))
  await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'hello', needsReply: true })
  await vi.waitFor(() => expect(w.log().flatMap(r => r.events).some(e => e.type === 'dispatch/completed')).toBe(true))
  expect(w.log().at(-1)?.events).toContainEqual(expect.objectContaining({ type: 'dispatch/completed', outcome: 'failed', actor: 'system:dispatch' }))
  expect(w.log()[1]?.events.some(e => e.type === 'message/sent')).toBe(true)
})

it('dispatch-04：确认缺messageRef记为失败', async () => {
  const w = await dispatchWorld([{ type: 'item/created', actor: 'aily', item: dispatchItem() }])
  vi.spyOn(w.provider, 'requestConfirmation').mockResolvedValueOnce({} as never)
  await w.service.requestDecision(w.ctx(), { itemId: 'C1', options: ['yes', 'no'] })
  await vi.waitFor(() => expect(w.log().flatMap(r => r.events).some(e => e.type === 'dispatch/completed')).toBe(true))
  const delivery = intended(w).find(x => x.delivery.kind === 'confirm')!.delivery
  expect(w.log().at(-1)?.events).toContainEqual({ type: 'dispatch/completed', actor: 'system:dispatch', deliveryId: delivery.deliveryId, outcome: 'failed' })
  await expect(w.service.confirmDecision(w.ctx('pm'), { requestId: delivery.requestId!, choice: 'yes', evidence: { actionId: 'x', deliveryId: delivery.deliveryId } })).rejects.toMatchObject({ code: 'COLLAB_DELIVERY_UNKNOWN' })
})

it('dispatch-05：慢投递在结束前不写结果', async () => {
  vi.useFakeTimers()
  try {
    let finish!: (value: { messageRef: string }) => void
    const w = await dispatchWorld([{ type: 'item/created', actor: 'aily', item: dispatchItem() }])
    vi.spyOn(w.provider, 'requestConfirmation').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await w.service.requestDecision(w.ctx(), { itemId: 'C1', options: ['yes', 'no'] })
    expect(intended(w).filter(x => x.delivery.kind === 'confirm')).toHaveLength(1)
    const delivery = intended(w).find(x => x.delivery.kind === 'confirm')!.delivery
    await vi.advanceTimersByTimeAsync(30_000)
    expect(w.log().flatMap(r => r.events).some(e => e.type === 'dispatch/completed' && e.deliveryId === delivery.deliveryId)).toBe(false)
    expect((await w.service.overview(w.read())).inFlightDeliveries).toContainEqual(expect.objectContaining({ deliveryId: delivery.deliveryId }))
    await vi.advanceTimersByTimeAsync(30_000)
    finish({ messageRef: 'm-9' })
    await flush()
    expect(w.log().at(-1)?.events).toContainEqual({ type: 'dispatch/completed', actor: 'system:dispatch', deliveryId: delivery.deliveryId, outcome: 'succeeded', messageRef: 'm-9' })
    await expect(w.service.confirmDecision(w.ctx('pm'), { requestId: delivery.requestId!, choice: 'yes', evidence: { actionId: 'e-9', deliveryId: delivery.deliveryId } })).resolves.toBeDefined()
  } finally { vi.useRealTimers() }
})

it('dispatch-07：重启后未完成投递不重发', async () => {
  const w = await dispatchWorld()
  await w.service.close('s')
  const records = w.store.records.get('s')!
  const seq = records.at(-1)!.seq + 1
  records.push({ kind: 'command', seq, events: [{ type: 'dispatch/intended', actor: 'aily', delivery: { deliveryId: 'dv-pending', member: 'doubao', kind: 'wake', providerId: 'P1', pointer: { spaceId: 's', toSeq: seq, counts: { message: 1, item: 0, decision: 0, member: 0 }, from: 'aily' } } }], receipt: { cmdId: 'fixture-pending', scope: { kind: 'member', name: 'aily' }, payloadHash: 'fixture', result: { seq, spaceId: 's' } } })
  const before = w.provider.deliveries.length
  const service = new CollabService({ serviceId: 'service-2', store: w.store, providers: [w.provider] })
  await service.open('s')
  expect(w.provider.deliveries).toHaveLength(before)
  expect((await service.overview(w.read())).pendingDeliveries).toContainEqual(expect.objectContaining({ deliveryId: 'dv-pending' }))
})

it('dispatch-09：failed后不写投递完成提交', async () => {
  let finish!: () => void
  const w = await dispatchWorld()
  vi.spyOn(w.provider, 'deliver').mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'hello', needsReply: true })
  const deliveryId = intended(w)[0]?.delivery.deliveryId
  expect(deliveryId).toBeDefined()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  const commit = vi.spyOn(w.store, 'commit').mockRejectedValueOnce(new Error('disk failure'))
  finish()
  await vi.waitFor(() => expect(commit).toHaveBeenCalled())
  expect(w.log().flatMap(r => r.events).some(e => e.type === 'dispatch/completed' && e.deliveryId === deliveryId)).toBe(false)
  await expect(w.service.overview(w.read())).rejects.toMatchObject({ code: 'COLLAB_STORE_FAILED' })
})

it('dispatch-close-late：close后旧实例回调不追加完成且不影响重开实例', async () => {
  let finish!: () => void
  const w = await dispatchWorld()
  vi.spyOn(w.provider, 'deliver').mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'hello', needsReply: true })
  const deliveryId = intended(w)[0]!.delivery.deliveryId
  const oldCount = w.log().length
  await w.service.close('s')
  const next = new CollabService({ serviceId: 'service-2', store: w.store, providers: [w.provider] })
  await next.open('s')
  finish()
  await flush()
  expect(w.log()).toHaveLength(oldCount)
  expect((await next.overview(w.read())).pendingDeliveries).toContainEqual(expect.objectContaining({ deliveryId }))
})
