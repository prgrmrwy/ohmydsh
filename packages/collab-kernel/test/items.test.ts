import { expect, it } from 'vitest'
import type { Item } from '../src/index.js'
import { intents, rawCommand, rejectsCleanly, seedRecord, world, worldFrom } from './support/world.js'
const item = (patch: Partial<Extract<Item, { kind: 'charter' | 'other' }>> = {}): Item => ({ id: 'C1', kind: 'charter', author: 'aily', title: 'title', body: '', revision: 2, status: 'draft', requiredAcks: ['aily', 'doubao'], acks: {}, ...patch })
const seeded = (i: Item) => world([{ type: 'item/created', actor: 'aily', item: i }])
/** A pre-change item snapshot, including the inert legacy fields, seeded through the store. */
const legacy = (patch: Record<string, unknown>) => worldFrom([seedRecord(), rawCommand(2, [{ type: 'item/created', actor: 'aily', item: { ...item(), deciders: ['pm'], agentEditCount: 2, ...patch } as Item }])])
it('items-01：全员ack后agreed', async () => { const w = await seeded(item()); await w.service.ackItem(w.ctx(), { itemId: 'C1', revision: 2 }); expect((await w.service.overview(w.read())).items.C1?.status).toBe('draft'); await w.service.ackItem(w.ctx('doubao'), { itemId: 'C1', revision: 2 }); expect((await w.service.overview(w.read())).items.C1?.status).toBe('agreed') })
it('items-02：修改使旧ack失效', async () => { const w = await seeded(item({ acks: { aily: 2 } })); await w.service.reviseItem(w.ctx('doubao'), { itemId: 'C1', expectedRevision: 2, changes: { title: 'new' } }); expect((await w.service.overview(w.read())).items.C1).toMatchObject({ revision: 3, status: 'draft', acks: {}, title: 'new' }) })
it('items-03：过期revision修改被拒', async () => { const w = await seeded(item({ revision: 4 })); await expect(w.service.reviseItem(w.ctx(), { itemId: 'C1', expectedRevision: 3, changes: { body: 'new' } })).rejects.toMatchObject({ code: 'COLLAB_STALE_REVISION', details: { currentRevision: 4 } }); expect(w.log()).toHaveLength(1) })
it('items-04：过期ack被拒', async () => { const w = await seeded(item({ revision: 3 })); await expect(w.service.ackItem(w.ctx(), { itemId: 'C1', revision: 2 })).rejects.toMatchObject({ code: 'COLLAB_STALE_REVISION' }) })
it('items-05：旧日志中的 escalated 条目只读', async () => {
  const w = await legacy({ id: 'C3', status: 'escalated', revision: 5, agentEditCount: 4 })
  const revise = w.ctx('doubao', 'revise-c3'), ack = w.ctx('doubao', 'ack-c3')
  await rejectsCleanly(w, revise.cmdId, () => w.service.reviseItem(revise, { itemId: 'C3', expectedRevision: 5, changes: { title: 'x' } }), 'COLLAB_ITEM_ESCALATED')
  await rejectsCleanly(w, ack.cmdId, () => w.service.ackItem(ack, { itemId: 'C3', revision: 5 }), 'COLLAB_ITEM_ESCALATED')
  expect((await w.service.overview(w.read())).items.C3).toMatchObject({ status: 'escalated', revision: 5 })
})
it('items-06：旧日志中的 decided 条目只读', async () => {
  const w = await legacy({ id: 'C4', status: 'decided' })
  const before = structuredClone((await w.service.overview(w.read())).items.C4)
  const ack = w.ctx('doubao', 'ack-c4'), revise = w.ctx('doubao', 'revise-c4')
  await rejectsCleanly(w, ack.cmdId, () => w.service.ackItem(ack, { itemId: 'C4', revision: 2 }), 'COLLAB_DECIDED_LOCKED')
  await rejectsCleanly(w, revise.cmdId, () => w.service.reviseItem(revise, { itemId: 'C4', expectedRevision: 2, changes: { title: 'x' } }), 'COLLAB_DECIDED_LOCKED')
  expect((await w.service.overview(w.read())).items.C4).toEqual(before)
})
it('items-07：非法条目字段', async () => {
  const w = await world(); const input = { itemId: 'new', kind: 'charter' as const, title: 'title', body: '', requiredAcks: [] as string[] }
  for (const [i, patch] of [{ title: '' }, { title: 'a'.repeat(201) }, { body: 'é'.repeat(32769) }, { requiredAcks: ['bob'] }, { kind: 'request', assignee: 'bob' }, { deciders: [] }, { deciders: ['aily'] }].entries()) {
    const field = Object.keys(patch)[0] === 'kind' ? 'assignee' : Object.keys(patch)[0]
    const ctx = w.ctx('aily', `bad-${i}`)
    await rejectsCleanly(w, ctx.cmdId, () => w.service.createItem(ctx, { ...input, ...patch } as typeof input), 'COLLAB_BAD_ITEM', field)
    await expect(w.service.createItem(w.ctx(), { ...input, ...patch } as typeof input)).rejects.toMatchObject({ details: { field } })
  }
  await w.service.createItem(w.ctx(), input)
  const created = (await w.service.overview(w.read())).items.new!
  expect(created).toMatchObject({ revision: 1, status: 'draft', acks: {} })
  expect(Object.hasOwn(created, 'deciders')).toBe(false); expect(Object.hasOwn(created, 'agentEditCount')).toBe(false)
  await w.service.createItem(w.ctx(), { ...input, itemId: 'other' })
  await expect(w.service.reviseItem(w.ctx(), { itemId: 'other', expectedRevision: 1, changes: { deciders: [] } } as never)).rejects.toMatchObject({ code: 'COLLAB_BAD_ITEM', details: { field: 'deciders' } })
})
it('items-08：旧快照的条目可正常修改', async () => {
  const w = await legacy({ id: 'C5', revision: 2 })
  await w.service.reviseItem(w.ctx(), { itemId: 'C5', expectedRevision: 2, changes: { title: 'renamed' } })
  expect((await w.service.overview(w.read())).items.C5).toMatchObject({ revision: 3, title: 'renamed', status: 'draft' })
  await w.service.ackItem(w.ctx(), { itemId: 'C5', revision: 3 })
  const ctx = w.ctx('aily', 'legacy-deciders')
  await rejectsCleanly(w, ctx.cmdId, () => w.service.reviseItem(ctx, { itemId: 'C5', expectedRevision: 3, changes: { deciders: [] } } as never), 'COLLAB_BAD_ITEM')
  await expect(w.service.reviseItem(ctx, { itemId: 'C5', expectedRevision: 3, changes: { deciders: [] } } as never)).rejects.toMatchObject({ details: { field: 'deciders' } })
})
it('items-09：修改与达成共识不唤醒', async () => {
  const w = await seeded(item({ requiredAcks: ['doubao'], revision: 1 }))
  const revise = await w.service.reviseItem(w.ctx('aily'), { itemId: 'C1', expectedRevision: 1, changes: { title: 'v2' } })
  const ack = await w.service.ackItem(w.ctx('doubao'), { itemId: 'C1', revision: 2 })
  expect(intents(w.events(revise.seq))).toEqual([]); expect(intents(w.events(ack.seq))).toEqual([])
  expect((await w.service.overview(w.read())).items.C1?.status).toBe('agreed')
})
it('任意条目id作为自身属性不触发原型setter', async () => { const w = await world(); await w.service.createItem(w.ctx(), { itemId: '__proto__', kind: 'other', title: 'ordinary', body: '', requiredAcks: [] }); const s = await w.service.overview(w.read()); expect(Object.hasOwn(s.items, '__proto__')).toBe(true); expect(s.items['__proto__']?.title).toBe('ordinary') })
it('不存在的原型键条目不能被修改', async () => { const w = await world(); await expect(w.service.reviseItem(w.ctx(), { itemId: 'constructor', expectedRevision: 1, changes: { title: 'x' } })).rejects.toMatchObject({ code: 'COLLAB_ITEM_NOT_FOUND' }) })
it('agreed修改回draft且ack拒绝', async () => { const w = await seeded(item({ status: 'agreed' })); await expect(w.service.ackItem(w.ctx(), { itemId: 'C1', revision: 2 })).rejects.toMatchObject({ code: 'COLLAB_ITEM_SETTLED' }); await w.service.reviseItem(w.ctx(), { itemId: 'C1', expectedRevision: 2, changes: { body: 'x' } }); expect((await w.service.overview(w.read())).items.C1?.status).toBe('draft') })
