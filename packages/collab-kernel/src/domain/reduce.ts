import type { CommitRecord, SpaceState } from '../model/index.js'
export function reduce(previous: SpaceState | undefined, record: CommitRecord): SpaceState | undefined {
  let state = previous ? structuredClone(previous) : undefined
  for (const e of record.events) {
    if (e.type === 'space/created') state = { spaceId: e.spaceId, serviceId: e.serviceId, leader: e.leader, convention: e.convention, status: 'open', members: {}, items: {}, requests: {}, decisions: [], messages: [], deliveries: {}, lastSeq: 0 }
    if (!state) throw new Error('event before space/created')
    switch (e.type) {
      case 'space/closed': state.status = 'closed'; break
      case 'leader/changed': state.leader = e.leader; break
      case 'member/invited': case 'member/joined': state.members[e.member.name] = structuredClone(e.member); break
      case 'member/status': state.members[e.name]!.status = e.status; break
      case 'member/statusText': state.members[e.name]!.statusText = e.text; break
      case 'item/created': case 'item/revised': case 'item/acked': Object.defineProperty(state.items, e.item.id, { value: structuredClone(e.item), enumerable: true, configurable: true, writable: true }); break
      case 'request/progressed': { const item = state.items[e.itemId]; if (item?.kind === 'request') item.progress = e.progress; break }
      case 'message/sent': state.messages.push(structuredClone(e.message)); break
      case 'decision/requested': state.requests[e.request.id] = structuredClone(e.request); break
      case 'decision/superseded': state.requests[e.requestId]!.status = 'superseded'; break
      case 'decision/decided': state.decisions.push(structuredClone(e.decision)); state.requests[e.decision.requestId]!.status = 'closed'; state.items[e.decision.itemId]!.status = 'decided'; break
      case 'dispatch/intended': state.deliveries[e.delivery.deliveryId] = structuredClone(e.delivery); if (e.delivery.kind === 'wake') state.members[e.delivery.member]!.wakeCount++; break
      case 'dispatch/completed': { const d = state.deliveries[e.deliveryId]!; d.outcome = e.outcome; if (e.messageRef !== undefined) d.messageRef = e.messageRef; break }
      case 'breaker/reset': state.members[e.member]!.wakeCount = 0; break
    }
  }
  if (state) state.lastSeq = record.seq
  return state
}
