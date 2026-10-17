import type { CollabEvent, Item, Member } from '../../src/index.js'
import { member, world } from './world.js'

export const dispatchMembers = (): Member[] => [
  member('aily', 'a:1', 'agent', 'active', 1),
  member('doubao', 'a:2', 'agent', 'active', 2),
  member('bob', 'a:9', 'agent', 'invited', 3),
  member('pm', 'a:pm', 'human', 'active', 4),
  member('qa', 'a:qa', 'human', 'active', 5),
]

export async function dispatchWorld(extra: CollabEvent[] = [], members = dispatchMembers()) {
  return world(extra, members)
}

export const dispatchItem = (patch: { id?: string; requiredAcks?: string[]; deciders?: string[] } = {}): Item => ({
  id: 'C1', kind: 'charter', author: 'aily', title: 'C1', body: '', requiredAcks: [], deciders: ['pm'], revision: 1, status: 'escalated', acks: {}, agentEditCount: 4, ...patch,
})
