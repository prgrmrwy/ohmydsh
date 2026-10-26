import { messageNotifies, type CommitRecord, type SpaceState } from '../model/index.js'

const own = <T>(target: Record<string, T>, key: string, value: T) => Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true })

/**
 * Pure fold of one commit. Besides the business state it derives the topic of
 * every message and item creation from `ref`, and counts a topic's waking
 * messages: a notifying `message/sent` counts when the same commit holds a
 * `wake` intent for its recipient. `delivery.thread` is never consulted, so
 * pre-change logs count the same way. A dangling `ref` throws: the space
 * fails closed instead of loading with a broken chain.
 */
export function reduce(previous: SpaceState | undefined, record: CommitRecord): SpaceState | undefined {
  let state = previous ? structuredClone(previous) : undefined
  const topicOf = (seq: number, ref: number | undefined): number => {
    if (ref === undefined) return seq
    const root = state!.topicOf[ref]
    if (root === undefined || !(ref < seq)) throw new Error(`dangling ref ${ref} at seq ${seq}`)
    return root
  }
  for (const e of record.events) {
    if (e.type === 'space/created') state = { spaceId: e.spaceId, serviceId: e.serviceId, leader: e.leader, convention: e.convention, ...(e.purpose === undefined ? {} : { purpose: e.purpose }), status: 'open', managers: [], members: {}, items: {}, itemSeq: {}, topicOf: {}, topicWakes: {}, requests: {}, decisions: [], messages: [], deliveries: {}, lastSeq: 0 }
    if (!state) throw new Error('event before space/created')
    switch (e.type) {
      case 'space/closed': state.status = 'closed'; break
      case 'leader/changed': state.leader = e.leader; break
      case 'member/invited': case 'member/joined': state.members[e.member.name] = structuredClone(e.member); break
      case 'member/status': state.members[e.name]!.status = e.status; break
      case 'member/statusText': state.members[e.name]!.statusText = e.text; break
      case 'member/rebound': {
        const m = state.members[e.name]!
        m.previousBindings = [...(m.previousBindings ?? []), { channel: m.binding.channel, address: m.binding.address }]
        m.binding = structuredClone(e.binding); break
      }
      case 'manager/allowed': if (!state.managers.includes(e.channel)) state.managers.push(e.channel); break
      case 'manager/revoked': state.managers = state.managers.filter(c => c !== e.channel); break
      case 'item/created':
        state.topicOf[record.seq] = topicOf(record.seq, e.item.ref)
        own(state.itemSeq, e.item.id, record.seq)
        own(state.items, e.item.id, structuredClone(e.item)); break
      case 'item/revised': case 'item/acked': own(state.items, e.item.id, structuredClone(e.item)); break
      case 'request/progressed': { const item = state.items[e.itemId]; if (item?.kind === 'request') item.progress = e.progress; break }
      case 'message/sent': {
        const root = topicOf(record.seq, e.message.ref)
        state.topicOf[record.seq] = root
        state.messages.push(structuredClone(e.message))
        const counted = messageNotifies(e.message) && record.events.some(d => d.type === 'dispatch/intended' && d.delivery.kind === 'wake' && d.delivery.member === e.message.to)
        if (counted) state.topicWakes[root] = (state.topicWakes[root] ?? 0) + 1
        break
      }
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
