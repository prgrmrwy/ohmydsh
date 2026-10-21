import { expect, it } from 'vitest'
import type { CollabEvent, Item } from '../src/index.js'
import { BREAKER_LIMIT, principals } from '../src/index.js'
import { dispatchItem, dispatchMembers, dispatchWorld } from './support/dispatch-world.js'

it('breaker-01：达到上限后暂停', async () => {
  const w = await dispatchWorld()
  for (let i = 0; i < BREAKER_LIMIT + 1; i++) await w.service.sendMessage(w.ctx('aily', `wake-${i}`), { to: 'doubao', body: 'ping', needsReply: true })
  const wakes = w.log().flatMap(r => r.events).filter(e => e.type === 'dispatch/intended' && e.delivery.kind === 'wake' && e.delivery.member === 'doubao')
  expect(wakes).toHaveLength(BREAKER_LIMIT)
  expect((await w.service.overview(w.read())).presence.doubao).toBe('paused')
})

it('breaker-02：并发提交不超发', async () => {
  const prior = Array.from({ length: 4 }, (_, i): CollabEvent => ({ type: 'dispatch/intended', actor: 'aily', delivery: { deliveryId: `dv-seed-${i}`, member: 'doubao', kind: 'wake', providerId: 'P1' } }))
  const w = await dispatchWorld(prior)
  await Promise.all([0, 1, 2].map(i => w.service.sendMessage(w.ctx('aily', `parallel-${i}`), { to: 'doubao', body: 'ping', needsReply: true })))
  const wakes = w.log().flatMap(r => r.events).filter(e => e.type === 'dispatch/intended' && e.delivery.kind === 'wake' && e.delivery.member === 'doubao')
  expect(wakes).toHaveLength(6)
})

it('breaker-03：人类决定解除暂停', async () => {
  const item: Item = { ...dispatchItem({ id: 'C3', requiredAcks: ['doubao'] }), id: 'C3' }
  const request = { id: 'D3', itemId: 'C3', revision: 1, author: 'aily', options: ['yes', 'no'], deciders: ['pm'], status: 'open' as const, awaitingChannel: false }
  const prior = Array.from({ length: BREAKER_LIMIT }, (_, i): CollabEvent => ({ type: 'dispatch/intended', actor: 'aily', delivery: { deliveryId: `dv-prior-${i}`, member: 'doubao', kind: 'wake', providerId: 'P1' } }))
  const delivery: CollabEvent = { type: 'dispatch/intended', actor: 'aily', delivery: { deliveryId: 'dv-confirm', member: 'pm', kind: 'confirm', providerId: 'P1', requestId: 'D3' } }
  const completion: CollabEvent = { type: 'dispatch/completed', actor: 'system:dispatch', deliveryId: 'dv-confirm', outcome: 'succeeded', messageRef: 'm-3' }
  const w = await dispatchWorld([{ type: 'item/created', actor: 'aily', item }, { type: 'decision/requested', actor: 'aily', request }, ...prior, delivery, completion])
  const result = await w.service.confirmDecision(w.ctx('pm'), { requestId: 'D3', choice: 'yes', evidence: { actionId: 'human-1', deliveryId: 'dv-confirm' } })
  const events = w.log().find(r => r.seq === result.seq)!.events
  expect(events.findIndex(e => e.type === 'breaker/reset' && e.member === 'doubao')).toBeLessThan(events.findIndex(e => e.type === 'dispatch/intended' && e.delivery.member === 'doubao'))
  expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'dispatch/intended', delivery: expect.objectContaining({ kind: 'wake', member: 'doubao' }) })]))
  expect((await w.service.overview(w.read())).presence.doubao).not.toBe('paused')
})

it('breaker-04：确认投递不受熔断限制', async () => {
  const prior = Array.from({ length: BREAKER_LIMIT }, (_, i): CollabEvent => ({ type: 'dispatch/intended', actor: 'aily', delivery: { deliveryId: `dv-pm-${i}`, member: 'pm', kind: 'wake', providerId: 'P1' } }))
  const w = await dispatchWorld([{ type: 'item/created', actor: 'aily', item: dispatchItem({ id: 'C4' }) }, ...prior])
  const result = await w.service.requestDecision(w.ctx(), { itemId: 'C4', options: ['yes', 'no'] })
  expect(w.log().find(r => r.seq === result.seq)?.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'dispatch/intended', delivery: expect.objectContaining({ member: 'pm', kind: 'confirm' }) })]))
})

it('breaker-05：agent principal不能清零', async () => {
  const w = await dispatchWorld()
  await expect(w.service.resetBreaker({ spaceId: 's', principal: principals.agent({ channel: 'test-a', address: 'a:1' }), cmdId: 'reset' }, { member: 'doubao' })).rejects.toMatchObject({ code: 'COLLAB_FORBIDDEN' })
})
