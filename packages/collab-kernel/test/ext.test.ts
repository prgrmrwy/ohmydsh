import { expect, it } from 'vitest'
import { principals, type Ext } from '../src/index.js'
import { intents, rejectsCleanly, world } from './support/world.js'

/** An object whose canonical JSON (`{"k":"…"}`) is exactly `bytes` long. */
const sized = (bytes: number): Ext => ({ k: 'x'.repeat(bytes - 8) })

it('ext-01：附加数据原样存储并随修改保留', async () => {
  const w = await world()
  const ext = { source: { chat: 'oc_1', msg: 'om_2' } }
  const created = await w.service.createItem(w.ctx(), { itemId: 'T1', kind: 'other', title: 'T1', body: '', requiredAcks: [], ext })
  const revised = await w.service.reviseItem(w.ctx(), { itemId: 'T1', expectedRevision: 1, changes: { title: 'T1 renamed' } })
  const createdItem = w.events(created.seq).find(e => e.type === 'item/created')
  const revisedItem = w.events(revised.seq).find(e => e.type === 'item/revised')
  expect(createdItem?.type === 'item/created' && createdItem.item.ext).toEqual(ext)
  expect(revisedItem?.type === 'item/revised' && revisedItem.item.ext).toEqual(ext)
  expect((await w.service.overview(w.read())).items.T1!.ext).toEqual(ext)
  const text = await w.service.project(w.read())
  expect(text).not.toContain('oc_1')
  expect(text).not.toContain('om_2')
  // Messages store it the same way; absent ext leaves no key.
  const sent = await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'with ext', ext })
  const plain = await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'without ext' })
  const message = (seq: number) => { const e = w.events(seq).find(e => e.type === 'message/sent'); return e?.type === 'message/sent' ? e.message : undefined }
  expect(message(sent.seq)?.ext).toEqual(ext)
  expect(message(plain.seq)).not.toHaveProperty('ext')
  const other = await w.service.createItem(w.ctx(), { itemId: 'T2', kind: 'other', title: 'T2', body: '', requiredAcks: [] })
  const otherItem = w.events(other.seq).find(e => e.type === 'item/created')
  expect(otherItem?.type === 'item/created' && otherItem.item).not.toHaveProperty('ext')
  // Exactly 4096 canonical bytes is accepted.
  await expect(w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'max', ext: sized(4096) })).resolves.toBeDefined()
})

it('ext-02：非法附加数据被拒', async () => {
  const w = await world()
  const bad: [string, unknown][] = [
    ['array', [1]], ['null', null], ['string', 'x'], ['infinity', { n: Infinity }], ['nan', { n: NaN }], ['undefined', { a: undefined }],
    ['nested-undefined', { a: [1, undefined] }], ['date', { d: new Date(0) }], ['map', new Map()], ['too-big', sized(4097)],
    ['multibyte', { k: '雪'.repeat(1363) }], ['bigint', { n: 1n }], ['cycle', (() => { const o: Record<string, unknown> = {}; o.self = o; return o })()], ['function', { f: () => 1 }],
  ]
  for (const [label, ext] of bad) {
    const ctx = w.ctx('aily', `ext-${label}`)
    await rejectsCleanly(w, ctx.cmdId, () => w.service.sendMessage(ctx, { to: 'doubao', body: 'x', needsReply: true, ext: ext as Ext }), 'COLLAB_BAD_EXT', label)
  }
  const item = w.ctx('aily', 'ext-item')
  await rejectsCleanly(w, item.cmdId, () => w.service.createItem(item, { itemId: 'T9', kind: 'other', title: 'T9', body: '', requiredAcks: [], ext: [1] as never }), 'COLLAB_BAD_EXT')
  // Order: after existing business checks, before ref.
  await expect(w.service.sendMessage(w.ctx(), { to: 'nobody', body: 'x', ext: null as never })).rejects.toMatchObject({ code: 'COLLAB_BAD_RECIPIENT' })
  await expect(w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'x', ext: null as never, ref: 999 })).rejects.toMatchObject({ code: 'COLLAB_BAD_EXT' })
  await expect(w.service.createItem(w.ctx(), { itemId: 'T9', kind: 'other', title: '', body: '', requiredAcks: [], ext: null as never })).rejects.toMatchObject({ code: 'COLLAB_BAD_ITEM', details: { field: 'title' } })
  await expect(w.service.createItem(w.ctx(), { itemId: 'T9', kind: 'other', title: 'T9', body: '', requiredAcks: [], ext: null as never, ref: 999 })).rejects.toMatchObject({ code: 'COLLAB_BAD_EXT' })
})

it('ext-03：不能通过修改替换附加数据', async () => {
  const w = await world()
  await w.service.createItem(w.ctx(), { itemId: 'T1', kind: 'other', title: 'T1', body: '', requiredAcks: [], ext: { a: 0 } })
  const ctx = w.ctx('aily', 'revise-ext')
  await rejectsCleanly(w, ctx.cmdId, () => w.service.reviseItem(ctx, { itemId: 'T1', expectedRevision: 1, changes: { ext: { a: 1 } } as never }), 'COLLAB_BAD_ITEM')
  await expect(w.service.reviseItem(w.ctx(), { itemId: 'T1', expectedRevision: 1, changes: { ext: { a: 1 } } as never })).rejects.toMatchObject({ details: { field: 'changes' } })
  expect((await w.service.overview(w.read())).items.T1!.ext).toEqual({ a: 0 })
})

it('ext-04：附加数据不进入指针', async () => {
  const w = await world()
  const result = await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'hello', needsReply: true, ext: { secret: 'EXT-SECRET' } })
  await w.settle()
  expect(w.provider.deliveries).toHaveLength(1)
  const pointer = w.provider.deliveries[0]!.pointer
  expect(JSON.stringify(pointer)).not.toContain('EXT-SECRET')
  expect(pointer).not.toHaveProperty('ext')
  expect(Object.keys(pointer).sort()).toEqual(['counts', 'from', 'spaceId', 'thread', 'toSeq'])
  expect(JSON.stringify(intents(w.events(result.seq)))).not.toContain('EXT-SECRET')
})

it('ext-05：附加数据是幂等载荷的一部分', async () => {
  const w = await world()
  const ctx = w.ctx('aily', 'e-1')
  const first = await w.service.sendMessage(ctx, { to: 'doubao', body: 'same', ext: { a: 1 } })
  const length = w.log().length
  await expect(w.service.sendMessage(ctx, { to: 'doubao', body: 'same', ext: { a: 2 } })).rejects.toMatchObject({ code: 'COLLAB_CMD_CONFLICT' })
  await expect(w.service.sendMessage(ctx, { to: 'doubao', body: 'same' })).rejects.toMatchObject({ code: 'COLLAB_CMD_CONFLICT' })
  expect(await w.service.sendMessage(ctx, { to: 'doubao', body: 'same', ext: { a: 1 } })).toEqual(first)
  expect(w.log()).toHaveLength(length)
})

it('ext-02b：不可序列化的附加数据按原有错误优先级报告', async () => {
  const w = await world()
  const ext = { n: 1n } as unknown as Ext
  // Existing business checks come first: bad recipient, bad title.
  const r = w.ctx('aily', 'eb-recipient')
  await rejectsCleanly(w, r.cmdId, () => w.service.sendMessage(r, { to: 'bob', body: 'x', ext }), 'COLLAB_BAD_RECIPIENT')
  const i = w.ctx('aily', 'eb-title')
  await rejectsCleanly(w, i.cmdId, () => w.service.createItem(i, { itemId: 'T7', kind: 'other', title: '', body: '', requiredAcks: [], ext }), 'COLLAB_BAD_ITEM')
  // Then ext, before ref.
  const f = w.ctx('aily', 'eb-ref')
  await rejectsCleanly(w, f.cmdId, () => w.service.sendMessage(f, { to: 'doubao', body: 'x', ref: 9999, ext }), 'COLLAB_BAD_EXT')
  // A non-member still gets the membership error first.
  await expect(w.service.sendMessage({ spaceId: 's', cmdId: 'eb-nm', principal: principals.agent({ channel: 'test-a', address: 'a:404' }) }, { to: 'doubao', body: 'x', ext })).rejects.toMatchObject({ code: 'COLLAB_NOT_MEMBER' })
})
