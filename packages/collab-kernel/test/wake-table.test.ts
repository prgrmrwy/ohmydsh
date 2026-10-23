import { expect, it } from 'vitest'
import { decideDispatch } from '../src/domain/decide.js'
import { world } from './support/world.js'
import type { CollabEvent, Item, Presence, SpaceState } from '../src/index.js'

const baseItem: Item = { id: 'C', kind: 'request', assignee: 'doubao', progress: 'accepted', author: 'aily', title: 'SECRET-TITLE', body: 'SECRET-BODY', revision: 1, status: 'draft', requiredAcks: ['doubao'], acks: {} }
async function state() { const w = await world([{ type: 'item/created', actor: 'aily', item: baseItem }]); return w.service.overview(w.read()) }
const context = { presence: {} as Record<string, Presence>, providers: new Map([['test-a', 'P1']]) }
function recipients(s: SpaceState, events: CollabEvent[]) {
  return decideDispatch(s, events, context).filter((e): e is Extract<CollabEvent, { type: 'dispatch/intended' }> => e.type === 'dispatch/intended' && e.delivery.kind === 'wake')
}

it('pure wake table wakes only on needsReply messages, invitations and terminal request progress', async () => {
  const s = await state()
  const cases: { event: CollabEvent; names: string[] }[] = [
    { event: { type: 'item/acked', actor: 'doubao', item: { ...baseItem, status: 'agreed', acks: { doubao: 1 } } }, names: [] },
    { event: { type: 'item/revised', actor: 'aily', item: { ...baseItem, revision: 2 } }, names: [] },
    { event: { type: 'request/progressed', actor: 'doubao', itemId: 'C', progress: 'accepted' }, names: [] },
    { event: { type: 'request/progressed', actor: 'doubao', itemId: 'C', progress: 'done' }, names: ['aily'] },
    { event: { type: 'request/progressed', actor: 'doubao', itemId: 'C', progress: 'rejected' }, names: ['aily'] },
    { event: { type: 'leader/changed', actor: 'aily', leader: 'doubao' }, names: [] },
    { event: { type: 'member/joined', actor: 'bob', member: { ...s.members.bob!, status: 'active' } }, names: [] },
    { event: { type: 'member/status', actor: 'aily', name: 'doubao', status: 'gone' }, names: [] },
    { event: { type: 'message/sent', actor: 'aily', message: { id: 'm', actor: 'aily', to: 'doubao', body: 'x', needsReply: false } }, names: [] },
    { event: { type: 'message/sent', actor: 'aily', message: { id: 'm', actor: 'aily', to: 'doubao', body: 'x', needsReply: true } }, names: ['doubao'] },
    { event: { type: 'item/created', actor: 'aily', item: baseItem }, names: [] },
  ]
  for (const { event, names } of cases) expect(recipients(s, [event]).map(e => e.delivery.member), `${event.type} ${JSON.stringify(event).slice(0, 80)}`).toEqual(names)
})

it('recipient union excludes initiator/inactive names and carries exact content-free counts', async () => {
  const s = await state()
  const business: CollabEvent[] = [
    { type: 'item/revised', actor: 'aily', item: { ...baseItem, revision: 2, requiredAcks: ['aily', 'doubao', 'doubao', 'bob'] } },
    { type: 'message/sent', actor: 'aily', message: { id: `${s.lastSeq + 1}`, actor: 'aily', to: 'doubao', body: 'SECRET-BODY', needsReply: true } },
  ]
  const before = structuredClone(s), input = structuredClone(business)
  const wakes = recipients(s, business)
  expect(wakes.map(e => e.delivery.member)).toEqual(['doubao'])
  expect(wakes[0]!.delivery.pointer).toEqual({ spaceId: 's', toSeq: s.lastSeq + 1, from: 'aily', counts: { message: 1, item: 1, decision: 0, member: 0 }, thread: s.lastSeq + 1 })
  expect(JSON.stringify(wakes)).not.toContain('SECRET')
  expect(s).toEqual(before)
  expect(business).toEqual(input)
})
