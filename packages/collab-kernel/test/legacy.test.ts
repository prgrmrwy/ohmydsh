import { expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { CollabEvent, CommitRecord, Item } from '../src/index.js'
import { intents, member, rawCommand, seedRecord, world, worldFrom } from './support/world.js'

const legacyItem = (id: string, status: Item['status'], patch: Record<string, unknown> = {}): Item => ({ id, kind: 'other', author: 'aily', title: `title ${id}`, body: '', revision: 3, status, requiredAcks: ['doubao'], acks: {}, deciders: ['pm'], agentEditCount: 4, ...patch } as Item)
const legacyMembers = () => [member('aily', 'a:1'), member('doubao', 'a:2', 'agent', 'active', 2), { ...member('pm', 'a:pm', 'human', 'active', 3), binding: { channel: 'test-a', address: 'a:pm', supports: { wake: true, confirm: true } } }]

/** A pre-change log: breaker reset, a decision with its confirm delivery, and an escalated item. */
export function legacyRecords(): CommitRecord[] {
  const request = { id: 'decision-3', itemId: 'D1', revision: 3, author: 'aily', options: ['ship', 'wait'], deciders: ['pm'], status: 'open' as const, awaitingChannel: false }
  return [
    seedRecord(legacyMembers()),
    rawCommand(2, [{ type: 'item/created', actor: 'aily', item: legacyItem('D1', 'draft') }, { type: 'item/created', actor: 'aily', item: legacyItem('E1', 'escalated', { revision: 5 }) }]),
    rawCommand(3, [{ type: 'decision/requested', actor: 'aily', request }, { type: 'dispatch/intended', actor: 'aily', delivery: { deliveryId: 'delivery-3-1', member: 'pm', kind: 'confirm', providerId: 'P1', requestId: 'decision-3' } }]),
    { kind: 'completion', seq: 4, events: [{ type: 'dispatch/completed', actor: 'system:dispatch', deliveryId: 'delivery-3-1', outcome: 'succeeded', messageRef: 'm-1' }] },
    rawCommand(5, [
      { type: 'decision/decided', actor: 'pm', decision: { requestId: 'decision-3', itemId: 'D1', actor: 'pm', choice: 'ship', providerId: 'P1', actionId: 'click-1', deliveryId: 'delivery-3-1', messageRef: 'm-1' } },
      { type: 'breaker/reset', actor: 'pm', member: 'doubao' },
    ], { scope: { kind: 'member', name: 'pm' } }),
    rawCommand(6, [{ type: 'breaker/reset', actor: 'internal:breaker-reset', member: 'aily' }], { scope: { kind: 'internal', purpose: 'breaker-reset' }, cmdId: 'reset-1' }),
  ]
}

it('legacy-01：含决策与熔断事件的旧日志可加载', async () => {
  const w = await worldFrom(legacyRecords(), legacyMembers())
  const o = await w.service.overview(w.read())
  expect(o.items.D1).toMatchObject({ status: 'decided', revision: 3 })
  expect(o.items.E1).toMatchObject({ status: 'escalated', revision: 5 })
  const text = await w.service.project(w.read())
  const history = text.slice(text.indexOf('## 历史条目'))
  expect(text).toContain('## 历史条目')
  expect(history).toContain('D1')
  expect(history).toContain('E1')
  expect(fromMarkdown(text).children.some(node => node.type === 'html' || node.type === 'code')).toBe(false)
  const sent = await w.service.sendMessage(w.ctx('aily'), { to: 'doubao', body: 'after upgrade', needsReply: true })
  expect(intents(w.events(sent.seq)).map(e => e.delivery.member)).toEqual(['doubao'])
})

it('legacy-02：新内核不写已移除事件', async () => {
  const w = await world()
  const charter = await w.service.createItem(w.ctx('aily'), { itemId: 'C1', kind: 'charter', title: 'C1', body: '', requiredAcks: ['doubao'] })
  await w.service.reviseItem(w.ctx('aily'), { itemId: 'C1', expectedRevision: 1, changes: { title: 'C1 v2' } })
  await w.service.ackItem(w.ctx('doubao'), { itemId: 'C1', revision: 2 })
  await w.service.createItem(w.ctx('aily'), { itemId: 'R1', kind: 'request', assignee: 'doubao', title: 'R1', body: '', requiredAcks: [], ref: charter.seq })
  await w.service.advanceRequest(w.ctx('doubao'), { itemId: 'R1', progress: 'accepted' })
  await w.service.advanceRequest(w.ctx('doubao'), { itemId: 'R1', progress: 'done' })
  await w.service.sendMessage(w.ctx('aily'), { to: 'doubao', body: 'thanks', needsReply: true })
  await w.service.transferLeader(w.ctx('aily'), { member: 'doubao' })
  await w.service.leave(w.ctx('qa'))
  await w.service.leave(w.ctx('doubao'))
  await w.settle()
  const events: CollabEvent[] = (await w.service.readSince(w.host(), 1)).flatMap(r => r.events)
  expect(events.length).toBeGreaterThan(0)
  expect(events.some(e => e.type === 'breaker/reset' || e.type.startsWith('decision/'))).toBe(false)
  expect(intents(events).some(e => e.delivery.kind !== 'wake')).toBe(false)
})
