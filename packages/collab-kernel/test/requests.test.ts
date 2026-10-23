import { expect, it } from 'vitest'
import type { Item } from '../src/index.js'
import { intents, rawCommand, rejectsCleanly, seedRecord, world, worldFrom } from './support/world.js'
const request = (patch: Record<string, unknown> = {}): Item => ({ id: 'R1', kind: 'request', author: 'aily', assignee: 'doubao', progress: 'open', title: 'request', body: '', revision: 4, status: 'draft', requiredAcks: [], acks: {}, ...patch } as Item)
it('requests-01：承接方正常推进且只在终态通知作者', async () => {
  const w = await world([{ type: 'item/created', actor: 'aily', item: request() }])
  const accepted = await w.service.advanceRequest(w.ctx('doubao'), { itemId: 'R1', progress: 'accepted' })
  const done = await w.service.advanceRequest(w.ctx('doubao'), { itemId: 'R1', progress: 'done' })
  expect((await w.service.overview(w.read())).items.R1).toMatchObject({ progress: 'done', revision: 4, status: 'draft' })
  expect(w.log().slice(1).filter(r => r.events.some(e => e.type === 'request/progressed'))).toHaveLength(2)
  expect(intents(w.events(accepted.seq))).toEqual([])
  expect(intents(w.events(done.seq)).map(e => [e.delivery.member, e.delivery.kind])).toEqual([['aily', 'wake']])
})
it('requests-02：非承接方拒绝', async () => { const w = await world([{ type: 'item/created', actor: 'aily', item: request() }]); await expect(w.service.advanceRequest(w.ctx(), { itemId: 'R1', progress: 'accepted' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' }); expect(w.log()).toHaveLength(1) })
it('requests-03：非法跳转且拒绝为终态', async () => { const w = await world([{ type: 'item/created', actor: 'aily', item: request() }]); await expect(w.service.advanceRequest(w.ctx('doubao'), { itemId: 'R1', progress: 'done' })).rejects.toMatchObject({ code: 'COLLAB_BAD_TRANSITION' }); await w.service.advanceRequest(w.ctx('doubao'), { itemId: 'R1', progress: 'rejected' }); await expect(w.service.advanceRequest(w.ctx('doubao'), { itemId: 'R1', progress: 'accepted' })).rejects.toMatchObject({ code: 'COLLAB_BAD_TRANSITION' }) })
it('requests-04：拒绝也通知作者', async () => {
  const w = await world([{ type: 'item/created', actor: 'aily', item: request({ id: 'R2' }) }])
  const rejected = await w.service.advanceRequest(w.ctx('doubao'), { itemId: 'R2', progress: 'rejected' })
  expect(intents(w.events(rejected.seq)).map(e => [e.delivery.member, e.delivery.kind])).toEqual([['aily', 'wake']])
})
it('requests-05：自己给自己的 request 不唤醒', async () => {
  const w = await world()
  await w.service.createItem(w.ctx('aily'), { itemId: 'R3', kind: 'request', assignee: 'aily', title: 'R3', body: '', requiredAcks: [] })
  const accepted = await w.service.advanceRequest(w.ctx('aily'), { itemId: 'R3', progress: 'accepted' })
  const done = await w.service.advanceRequest(w.ctx('aily'), { itemId: 'R3', progress: 'done' })
  expect(intents(w.events(accepted.seq))).toEqual([]); expect(intents(w.events(done.seq))).toEqual([])
})
it('requests-06：旧日志中锁定的 request 不能推进', async () => {
  const legacy = (id: string, status: string) => request({ id, status, deciders: ['pm'], agentEditCount: status === 'escalated' ? 4 : 0 })
  const w = await worldFrom([seedRecord(), rawCommand(2, [{ type: 'item/created', actor: 'aily', item: legacy('R4', 'decided') }, { type: 'item/created', actor: 'aily', item: legacy('R5', 'escalated') }])])
  for (const [itemId, code] of [['R4', 'COLLAB_DECIDED_LOCKED'], ['R5', 'COLLAB_ITEM_ESCALATED']] as const) {
    const ctx = w.ctx('doubao', `advance-${itemId}`)
    await rejectsCleanly(w, ctx.cmdId, () => w.service.advanceRequest(ctx, { itemId, progress: 'accepted' }), code, itemId)
  }
  expect((await w.service.overview(w.read())).items.R4).toMatchObject({ progress: 'open' })
})
