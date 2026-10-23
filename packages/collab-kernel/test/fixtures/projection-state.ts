import type { SpaceState } from '../../src/model/index.js'

export function projectionState(): SpaceState {
  return {
    spaceId: 'space-1', serviceId: 'svc-1', status: 'open', leader: 'lead',
    convention: { version: '1', sha256: 'abc' }, managers: [],
    members: {
      lead: { name: 'lead', kind: 'agent', status: 'active', joinSeq: 1, binding: { channel: 'test', address: 'lead', supports: { wake: true, confirm: false } }, statusText: 'working', wakeCount: 0 },
      bob: { name: 'bob', kind: 'agent', status: 'active', joinSeq: 2, binding: { channel: 'test', address: 'bob', supports: { wake: true, confirm: false } }, statusText: 'reviewing', wakeCount: 0 },
      gone: { name: 'Gone', kind: 'agent', status: 'gone', joinSeq: 3, binding: { channel: 'test', address: 'gone', supports: { wake: true, confirm: false } }, statusText: '', wakeCount: 0 },
    },
    items: {
      charter: { id: 'charter', kind: 'charter', title: 'Rules', body: 'SECRET-CHARTER-BODY', author: 'lead', revision: 2, status: 'agreed', requiredAcks: [], acks: {} },
      ack: { id: 'C2', kind: 'other', title: 'Needs review', body: 'SECRET-ITEM-BODY', author: 'lead', revision: 1, status: 'draft', requiredAcks: ['bob', 'lead'], acks: { lead: 1 } },
      request: { id: 'R1', kind: 'request', title: 'Do work', body: 'SECRET-REQUEST-BODY', author: 'lead', revision: 1, status: 'draft', requiredAcks: [], acks: {}, assignee: 'bob', progress: 'open' },
    },
    itemSeq: { charter: 2, C2: 3, R1: 4 },
    topicOf: { 2: 2, 3: 3, 4: 4, 5: 5 },
    topicWakes: { 5: 1 },
    requests: {},
    decisions: [],
    messages: [{ id: '5', actor: 'lead', to: 'bob', body: 'SECRET-MESSAGE-BODY', needsReply: true }],
    deliveries: {
      'dv-pending': { deliveryId: 'dv-pending', member: 'bob', kind: 'wake', providerId: 'p1' },
    }, lastSeq: 9,
  }
}

/** Old-format state: an escalated item, a decided request and decision records, as replayed from a pre-change log. */
export function legacyProjectionState(): SpaceState {
  const state = projectionState()
  const legacy = (fields: Record<string, unknown>) => ({ body: '', author: 'lead', revision: 1, requiredAcks: [], acks: {}, deciders: ['bob'], agentEditCount: 4, ...fields }) as never
  state.items.E1 = legacy({ id: 'E1', kind: 'other', title: 'Escalated topic', status: 'escalated' })
  state.items.R4 = legacy({ id: 'R4', kind: 'request', title: 'Locked request', status: 'decided', assignee: 'bob', progress: 'open' })
  state.requests = { req1: { id: 'req1', itemId: 'R4', revision: 1, author: 'lead', options: ['A', 'B'], deciders: ['bob'], status: 'closed', awaitingChannel: true } }
  state.decisions = [{ requestId: 'req1', itemId: 'R4', actor: 'bob', choice: 'A', providerId: 'p1', actionId: 'act1', deliveryId: 'dv-done', messageRef: 'm1' }]
  state.deliveries['dv-done'] = { deliveryId: 'dv-done', member: 'bob', kind: 'confirm', providerId: 'p1', outcome: 'succeeded', messageRef: 'm1' }
  return state
}
