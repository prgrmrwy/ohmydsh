import { expect, it } from 'vitest'
import type { CollabEvent, Item } from '../src/index.js'
import { principals } from '../src/index.js'
import { world } from './support/world.js'

it('wake-01：需回复消息叫醒收件人', async () => {
  const w = await world()
  w.provider.deliveries.length = 0
  await w.service.sendMessage(w.ctx(), { to: 'doubao', body: 'SECRET-BODY', needsReply: true })
  expect(w.provider.deliveries).toHaveLength(1)
  expect(w.provider.deliveries[0]?.member.name).toBe('doubao')
  const pointer = w.provider.deliveries[0]!.pointer
  expect(Object.keys(pointer).sort()).toEqual(['counts', 'from', 'spaceId', 'toSeq'])
  expect(JSON.stringify(pointer)).not.toContain('SECRET-BODY')
})

it('wake-02：状态更新不叫醒', async () => {
  const w = await world()
  await w.service.setStatus(w.ctx(), { text: 'working' })
  expect(w.provider.deliveries).toEqual([])
})

it('wake-03：不叫醒自己', async () => {
  const item: Item = { id: 'C1', kind: 'charter', author: 'aily', title: 'C1', body: '', requiredAcks: ['aily', 'doubao'], deciders: [], revision: 1, status: 'draft', acks: {}, agentEditCount: 0 }
  const w = await world([{ type: 'item/created', actor: 'aily', item } as CollabEvent], [
    { name: 'aily', kind: 'agent', status: 'active', joinSeq: 1, binding: { channel: 'test-a', address: 'a:1', supports: { wake: true, confirm: true } }, statusText: '', wakeCount: 0 },
    { name: 'doubao', kind: 'agent', status: 'active', joinSeq: 2, binding: { channel: 'test-a', address: 'a:2', supports: { wake: true, confirm: true } }, statusText: '', wakeCount: 0 },
    { name: 'bob', kind: 'agent', status: 'invited', joinSeq: 3, binding: { channel: 'test-a', address: 'a:9', supports: { wake: true, confirm: true } }, statusText: '', wakeCount: 0 },
    { name: 'pm', kind: 'human', status: 'active', joinSeq: 4, binding: { channel: 'test-a', address: 'a:pm', supports: { wake: true, confirm: true } }, statusText: '', wakeCount: 0 },
    { name: 'qa', kind: 'human', status: 'active', joinSeq: 5, binding: { channel: 'test-a', address: 'a:qa', supports: { wake: true, confirm: true } }, statusText: '', wakeCount: 0 },
  ]); w.provider.deliveries.length = 0
  await w.service.reviseItem(w.ctx(), { itemId: 'C1', expectedRevision: 1, changes: { title: 'updated' } })
  expect(w.provider.deliveries.map(x => x.member.name)).toEqual(['doubao'])
})

it('wake-04：邀请叫醒被邀请者但不授予读取权限', async () => {
  const w = await world([], [
    { name: 'aily', kind: 'agent', status: 'active', joinSeq: 1, binding: { channel: 'test-a', address: 'a:1', supports: { wake: true, confirm: true } }, statusText: '', wakeCount: 0 },
    { name: 'doubao', kind: 'agent', status: 'active', joinSeq: 2, binding: { channel: 'test-a', address: 'a:2', supports: { wake: true, confirm: true } }, statusText: '', wakeCount: 0 },
    { name: 'pm', kind: 'human', status: 'active', joinSeq: 3, binding: { channel: 'test-a', address: 'a:pm', supports: { wake: true, confirm: true } }, statusText: '', wakeCount: 0 },
    { name: 'qa', kind: 'human', status: 'active', joinSeq: 4, binding: { channel: 'test-a', address: 'a:qa', supports: { wake: true, confirm: true } }, statusText: '', wakeCount: 0 },
  ])
  const result = await w.service.invite(w.ctx(), { name: 'bob', address: 'a:9', kind: 'agent' })
  const invitation = w.log().find(r => r.seq === result.seq)!
  expect(invitation.events.filter(e => e.type === 'dispatch/intended' && e.delivery.kind === 'wake' && e.delivery.member === 'bob')).toHaveLength(1)
  expect(w.provider.deliveries.at(-1)).toMatchObject({ member: { name: 'bob', status: 'invited' }, pointer: { invited: true } })
  await expect(w.service.overview({ spaceId: 's', principal: principals.provider('P1', { channel: 'test-a', address: 'a:9' }) })).rejects.toMatchObject({ code: 'COLLAB_MEMBER_INACTIVE' })
})
