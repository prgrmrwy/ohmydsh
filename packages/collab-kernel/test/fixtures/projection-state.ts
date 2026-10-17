import type { SpaceState } from '../../src/model/index.js'

export function projectionState(): SpaceState {
  return {
    spaceId: 'space-1', serviceId: 'svc-1', status: 'open', leader: 'lead',
    convention: { version: '1', sha256: 'abc' },
    members: {
      lead: { name: 'lead', kind: 'agent', status: 'active', joinSeq: 1, binding: { channel: 'test', address: 'lead', supports: { wake: true, confirm: false } }, statusText: 'working', wakeCount: 0 },
      bob: { name: 'bob', kind: 'human', status: 'active', joinSeq: 2, binding: { channel: 'test', address: 'bob', supports: { wake: true, confirm: true } }, statusText: 'reviewing', wakeCount: 0 },
      gone: { name: 'Gone', kind: 'agent', status: 'gone', joinSeq: 3, binding: { channel: 'test', address: 'gone', supports: { wake: true, confirm: false } }, statusText: '', wakeCount: 0 },
    },
    items: {
      charter: { id: 'charter', kind: 'charter', title: 'Rules', body: 'SECRET-CHARTER-BODY', author: 'lead', revision: 2, status: 'agreed', requiredAcks: [], acks: {}, deciders: [], agentEditCount: 0 },
      ack: { id: 'C2', kind: 'other', title: 'Needs review', body: 'SECRET-ITEM-BODY', author: 'lead', revision: 1, status: 'draft', requiredAcks: ['bob', 'lead'], acks: { lead: 1 }, deciders: [], agentEditCount: 0 },
      request: { id: 'R1', kind: 'request', title: 'Do work', body: 'SECRET-REQUEST-BODY', author: 'lead', revision: 1, status: 'draft', requiredAcks: [], acks: {}, deciders: [], agentEditCount: 0, assignee: 'bob', progress: 'open' },
      escalated: { id: 'E1', kind: 'other', title: 'Escalated topic', body: '', author: 'lead', revision: 1, status: 'escalated', requiredAcks: [], acks: {}, deciders: [], agentEditCount: 4 },
      decided: { id: 'D-ITEM', kind: 'other', title: 'Chosen option', body: '', author: 'lead', revision: 1, status: 'decided', requiredAcks: [], acks: {}, deciders: [], agentEditCount: 0 },
    },
    requests: { req1: { id: 'req1', itemId: 'D-ITEM', revision: 1, author: 'lead', options: ['A', 'B'], deciders: ['bob'], status: 'open', awaitingChannel: true } },
    decisions: [{ requestId: 'old-request', itemId: 'D-ITEM', actor: 'bob', choice: 'A', providerId: 'p1', actionId: 'act1', deliveryId: 'dv-done', messageRef: 'm1' }],
    messages: [{ id: 'm', actor: 'lead', to: 'bob', body: 'SECRET-MESSAGE-BODY', needsReply: true }],
    deliveries: {
      'dv-pending': { deliveryId: 'dv-pending', member: 'bob', kind: 'wake', providerId: 'p1' },
      'dv-done': { deliveryId: 'dv-done', member: 'bob', kind: 'confirm', providerId: 'p1', outcome: 'succeeded', messageRef: 'm1' },
    }, lastSeq: 9,
  }
}
