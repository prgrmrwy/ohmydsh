import { expect, it } from 'vitest'
import { dispatchItem, dispatchMembers, dispatchWorld } from './support/dispatch-world.js'

it('binding-01：不可达成员不记账', async () => {
  const w = await dispatchWorld()
  w.provider.observedPresence = 'unreachable'
  await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'hello', needsReply: true })
  expect(w.log().at(-1)?.events.some(e => e.type === 'dispatch/intended' && e.delivery.member === 'doubao')).toBe(false)
  expect((await w.service.overview(w.read())).presence.doubao).toBe('unreachable')
})

it('binding-02：无可确认绑定', async () => {
  const members = dispatchMembers().map(member => member.name === 'pm' ? { ...member, binding: { ...member.binding, supports: { ...member.binding.supports, confirm: false } } } : member)
  const w = await dispatchWorld([{ type: 'item/created', actor: 'aily', item: dispatchItem() }], members)
  await w.service.requestDecision(w.ctx(), { itemId: 'C1', options: ['yes', 'no'] })
  expect(w.log().at(-1)?.events.some(e => e.type === 'dispatch/intended' && e.delivery.kind === 'confirm')).toBe(false)
  expect(Object.values((await w.service.overview(w.read())).requests)).toContainEqual(expect.objectContaining({ status: 'open', awaitingChannel: true }))
})

it('binding-03：每位决定人一条确认投递', async () => {
  const w = await dispatchWorld([{ type: 'item/created', actor: 'aily', item: dispatchItem({ deciders: ['pm', 'qa'] }) }])
  const result = await w.service.requestDecision(w.ctx(), { itemId: 'C1', options: ['yes', 'no'] })
  const intended = w.log().find(r => r.seq === result.seq)!.events.filter(e => e.type === 'dispatch/intended' && e.delivery.kind === 'confirm')
  expect(intended).toHaveLength(2)
  expect(intended.map(e => e.type === 'dispatch/intended' ? e.delivery.member : '')).toEqual(['pm', 'qa'])
})
