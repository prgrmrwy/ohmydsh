import { expect, it } from 'vitest'
import { CollabService, principals, type CollabEvent } from '../src/index.js'
import { MemStore } from './support/mem-store.js'
import { FakeProvider } from './support/fake-provider.js'
import { defaultMembers, rawCommand, rejectsCleanly, seedRecord, world, worldFrom } from './support/world.js'

const sent = (events: CollabEvent[]) => events.find((e): e is Extract<CollabEvent, { type: 'message/sent' }> => e.type === 'message/sent')!.message
const created = (events: CollabEvent[]) => { const e = events.find(e => e.type === 'item/created'); if (e?.type !== 'item/created') throw new Error('no item/created'); return e.item }

it('ref-01：引用先前消息', async () => {
  const w = await world()
  const first = await w.service.sendMessage(w.ctx('aily'), { to: 'doubao', body: 'question' })
  const reply = await w.service.sendMessage(w.ctx('doubao'), { to: 'aily', body: 'answer', ref: first.seq })
  expect(sent(w.events(reply.seq)).ref).toBe(first.seq)
})

it('ref-02：引用条目的创建 seq', async () => {
  const w = await world()
  const r1 = await w.service.createItem(w.ctx(), { itemId: 'R1', kind: 'other', title: 'R1', body: '', requiredAcks: [] })
  const message = await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'see R1', ref: r1.seq })
  const r2 = await w.service.createItem(w.ctx(), { itemId: 'R2', kind: 'other', title: 'R2', body: '', requiredAcks: [], ref: r1.seq })
  expect(sent(w.events(message.seq)).ref).toBe(r1.seq)
  expect(created(w.events(r2.seq)).ref).toBe(r1.seq)
  const overview = await w.service.overview(w.read())
  expect(overview.itemSeq.R1).toBe(r1.seq)
  expect(overview.items.R2?.ref).toBe(r1.seq)
})

it('ref-03：不写 ref 时事件形状不变', async () => {
  const w = await world()
  const message = await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'plain' })
  const item = await w.service.createItem(w.ctx(), { itemId: 'I1', kind: 'other', title: 'I1', body: '', requiredAcks: [] })
  expect(Object.hasOwn(sent(w.events(message.seq)), 'ref')).toBe(false)
  expect(Object.hasOwn(created(w.events(item.seq)), 'ref')).toBe(false)
})

it('ref-04：特殊 itemId 的创建 seq 可查', async () => {
  const w = await world()
  const result = await w.service.createItem(w.ctx(), { itemId: '__proto__', kind: 'other', title: 'proto', body: '', requiredAcks: [] })
  const { itemSeq } = await w.service.overview(w.read())
  expect(Object.hasOwn(itemSeq, '__proto__')).toBe(true)
  expect(Object.getOwnPropertyDescriptor(itemSeq, '__proto__')?.value).toBe(result.seq)
})

it('ref-05：消息引用不存在或不可引用的 seq', async () => {
  const wake: CollabEvent = { type: 'dispatch/intended', actor: 'aily', delivery: { deliveryId: 'dv-2', member: 'doubao', kind: 'wake', providerId: 'P1', pointer: { spaceId: 's', toSeq: 2, counts: { message: 1, item: 0, decision: 0, member: 0 }, from: 'aily' } } }
  const w = await worldFrom([
    seedRecord(),
    rawCommand(2, [{ type: 'message/sent', actor: 'aily', message: { id: '2', actor: 'aily', to: 'doubao', body: 'hi', needsReply: true } }, wake]),
    rawCommand(3, [{ type: 'member/statusText', actor: 'aily', name: 'aily', text: 'busy' }]),
    { kind: 'completion', seq: 4, events: [{ type: 'dispatch/completed', actor: 'system:dispatch', deliveryId: 'dv-2', outcome: 'succeeded' }] },
    ...[5, 6, 7, 8, 9].map(seq => rawCommand(seq, [{ type: 'member/statusText', actor: 'aily', name: 'aily', text: `s${seq}` }])),
  ])
  expect((await w.service.overview(w.read())).lastSeq).toBe(9)
  for (const ref of [3, 4, 9999, 0, -1, 1.5, '5', null]) {
    const ctx = w.ctx('aily', `bad-ref-${String(ref)}`)
    await rejectsCleanly(w, ctx.cmdId, () => w.service.sendMessage(ctx, { to: 'doubao', body: 'x', needsReply: true, ref: ref as number }), 'COLLAB_BAD_REF', String(ref))
  }
})

it('ref-06：条目引用非法 seq', async () => {
  const w = await world()
  const ctx = w.ctx('aily', 'bad-item-ref')
  await rejectsCleanly(w, ctx.cmdId, () => w.service.createItem(ctx, { itemId: 'R9', kind: 'other', title: 'R9', body: '', requiredAcks: [], ref: 9999 }), 'COLLAB_BAD_REF')
  expect(Object.hasOwn((await w.service.overview(w.read())).items, 'R9')).toBe(false)
})

it('ref-07：多重错误时先报既有校验', async () => {
  const w = await world()
  await expect(w.service.sendMessage(w.ctx(), { to: 'bob', body: 'x', ref: 9999 })).rejects.toMatchObject({ code: 'COLLAB_BAD_RECIPIENT' })
})

it('ref-08：悬空引用的日志加载失败', async () => {
  const store = new MemStore(), provider = new FakeProvider()
  store.records.set('s1', [seedRecord(), rawCommand(2, [{ type: 'message/sent', actor: 'aily', message: { id: '2', actor: 'aily', to: 'doubao', body: 'edited', needsReply: false, ref: 9999 } }])])
  store.records.set('s2', [seedRecord(), rawCommand(2, [{ type: 'message/sent', actor: 'aily', message: { id: '2', actor: 'aily', to: 'doubao', body: 'fine', needsReply: false } }])])
  const service = new CollabService({ serviceId: 'fresh', store, providers: [provider] })
  const aily = principals.agent(defaultMembers()[0]!.binding)
  await expect(service.open('s1')).rejects.toThrow()
  await expect(service.overview({ spaceId: 's1', principal: aily })).rejects.toBeDefined()
  await expect(service.setStatus({ spaceId: 's1', principal: aily, cmdId: 'after-failure' }, { text: 'x' })).rejects.toBeDefined()
  expect(store.records.get('s1')).toHaveLength(2)
  await service.open('s2')
  expect((await service.overview({ spaceId: 's2', principal: aily })).lastSeq).toBe(2)
})
