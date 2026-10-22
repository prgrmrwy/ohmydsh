import { expect, it } from 'vitest'
import { principals } from '../src/index.js'
import { intents, member, world } from './support/world.js'

it('wake-01：需回复消息叫醒收件人', async () => {
  const w = await world()
  const result = await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'SECRET-BODY', needsReply: true })
  await w.settle()
  expect(w.provider.deliveries).toHaveLength(1)
  expect(w.provider.deliveries[0]?.member.name).toBe('doubao')
  const pointer = w.provider.deliveries[0]!.pointer
  expect(Object.keys(pointer).sort()).toEqual(['counts', 'from', 'spaceId', 'thread', 'toSeq'])
  expect(pointer.thread).toBe(result.seq)
  expect(pointer.counts.decision).toBe(0)
  expect(intents(w.events(result.seq))[0]!.delivery.thread).toBe(result.seq)
  expect(JSON.stringify(pointer)).not.toContain('SECRET-BODY')
})

it('wake-02：状态更新不叫醒', async () => {
  const w = await world()
  await w.service.setStatus(w.ctx(), { text: 'working' })
  expect(w.provider.deliveries).toEqual([])
})

it('wake-03：不叫醒自己', async () => {
  const w = await world()
  await w.service.createItem(w.ctx('aily'), { itemId: 'R1', kind: 'request', assignee: 'aily', title: 'R1', body: '', requiredAcks: [] })
  await w.service.advanceRequest(w.ctx('aily'), { itemId: 'R1', progress: 'accepted' })
  await w.service.advanceRequest(w.ctx('aily'), { itemId: 'R1', progress: 'done' })
  await w.settle()
  expect(w.provider.deliveries).toEqual([])
})

it('wake-04：邀请叫醒被邀请者但不授予读取权限', async () => {
  const w = await world([], [member('aily', 'a:1'), member('doubao', 'a:2', 'agent', 'active', 2)])
  const result = await w.service.invite(w.ctx(), { name: 'bob', address: 'a:9', kind: 'agent' })
  const wakes = intents(w.events(result.seq))
  expect(wakes).toHaveLength(1)
  expect(wakes[0]!.delivery).toMatchObject({ member: 'bob', kind: 'wake' })
  expect(Object.hasOwn(wakes[0]!.delivery, 'thread')).toBe(false)
  await w.settle()
  expect(w.provider.deliveries.at(-1)).toMatchObject({ member: { name: 'bob', status: 'invited' }, pointer: { invited: true } })
  expect(Object.hasOwn(w.provider.deliveries.at(-1)!.pointer, 'thread')).toBe(false)
  await expect(w.service.overview({ spaceId: 's', principal: principals.agent({ channel: 'test-a', address: 'a:9' }) })).rejects.toMatchObject({ code: 'COLLAB_MEMBER_INACTIVE' })
})
