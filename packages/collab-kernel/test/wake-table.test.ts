import { expect, it } from 'vitest'
import { decideDispatch } from '../src/domain/decide.js'
import { world } from './support/world.js'
import type { CollabEvent, DecisionRequest, Item, Presence, SpaceState } from '../src/index.js'

const baseItem: Item = { id: 'C', kind: 'other', author: 'aily', title: 'SECRET-TITLE', body: 'SECRET-BODY', revision: 1, status: 'draft', requiredAcks: ['doubao'], deciders: ['pm'], acks: {}, agentEditCount: 0 }
const request: DecisionRequest = { id: 'D', itemId: 'C', revision: 1, author: 'aily', options: ['a', 'b'], deciders: ['pm'], status: 'open', awaitingChannel: false }
async function state() { const w = await world([{ type: 'item/created', actor: 'aily', item: baseItem }, { type: 'decision/requested', actor: 'aily', request }]); return w.service.overview(w.read()) }
const context = { presence: {} as Record<string, Presence>, providers: new Map([['test-a', 'P1']]) }
function recipients(s: SpaceState, events: CollabEvent[]) {
  return decideDispatch(s, events, context).filter((e): e is Extract<CollabEvent, { type: 'dispatch/intended' }> => e.type === 'dispatch/intended' && e.delivery.kind === 'wake')
}

it('pure wake table covers author acknowledgments, request progress and leadership', async () => {
  const s = await state()
  const cases: { event: CollabEvent; names: string[] }[] = [
    { event: { type: 'item/acked', actor: 'doubao', item: { ...baseItem, status: 'agreed', acks: { doubao: 1 } } }, names: ['aily'] },
    { event: { type: 'request/progressed', actor: 'doubao', itemId: 'C', progress: 'accepted' }, names: ['aily'] },
    { event: { type: 'leader/changed', actor: 'aily', leader: 'doubao' }, names: ['doubao'] },
    { event: { type: 'member/joined', actor: 'bob', member: { ...s.members.bob!, status: 'active' } }, names: [] },
    { event: { type: 'member/status', actor: 'aily', name: 'doubao', status: 'gone' }, names: [] },
    { event: { type: 'message/sent', actor: 'aily', message: { id: 'm', actor: 'aily', to: 'doubao', body: 'x', needsReply: false } }, names: [] },
    { event: { type: 'item/created', actor: 'aily', item: baseItem }, names: [] },
  ]
  for (const { event, names } of cases) expect(recipients(s, [event]).map(e => e.delivery.member), event.type).toEqual(names)
})

it('recipient union excludes initiator/inactive names and carries exact content-free counts', async () => {
  const s = await state()
  const business: CollabEvent[] = [
    { type: 'item/revised', actor: 'aily', item: { ...baseItem, revision: 2, requiredAcks: ['aily', 'doubao', 'doubao', 'bob'] } },
    { type: 'message/sent', actor: 'aily', message: { id: 'm', actor: 'aily', to: 'doubao', body: 'SECRET-BODY', needsReply: true } },
  ]
  const before = structuredClone(s), input = structuredClone(business)
  const wakes = recipients(s, business)
  expect(wakes.map(e => e.delivery.member)).toEqual(['doubao'])
  expect(wakes[0]!.delivery.pointer).toEqual({ spaceId: 's', toSeq: s.lastSeq + 1, from: 'aily', counts: { message: 1, item: 1, decision: 0, member: 0 } })
  expect(JSON.stringify(wakes)).not.toContain('SECRET')
  expect(s).toEqual(before)
  expect(business).toEqual(input)
})

it('escalation suppresses agent wake while retaining required human wake', async () => {
  const s = await state()
  expect(recipients(s, [{ type: 'item/revised', actor: 'aily', item: { ...baseItem, revision: 4, status: 'escalated', requiredAcks: ['doubao', 'pm'] } }]).map(e => e.delivery.member)).toEqual(['pm'])
})

it('human decision resets affected members even when capability or reachability forbids wake', async () => {
  const s = await state()
  s.members.doubao!.wakeCount = 6
  s.members.aily!.wakeCount = 6
  s.members.doubao!.binding.supports.wake = false
  const event: CollabEvent = { type: 'decision/decided', actor: 'pm', decision: { requestId: 'D', itemId: 'C', actor: 'pm', choice: 'a', providerId: 'P1', actionId: 'click', deliveryId: 'confirm', messageRef: 'm' } }
  const result = decideDispatch(s, [event], { ...context, presence: { aily: 'unreachable' } })
  expect(result.filter(e => e.type === 'breaker/reset')).toEqual([{ type: 'breaker/reset', actor: 'pm', member: 'aily' }, { type: 'breaker/reset', actor: 'pm', member: 'doubao' }])
  expect(result.some(e => e.type === 'dispatch/intended')).toBe(false)
})
