import { BREAKER_LIMIT, type CollabEvent, type Pointer, type Presence, type SpaceState } from '../model/index.js'
import { wakeRecipients } from './wake.js'

export interface DispatchContext { presence: Record<string, Presence>; providers: ReadonlyMap<string, string> }

// Pure scheduling decision: runtime calls and mutable provider state stay in the service.
export function decideDispatch(state: SpaceState, business: CollabEvent[], ctx: DispatchContext): CollabEvent[] {
  const events = structuredClone(business)
  const recipients = wakeRecipients(state, events)
  const decided = events.find(e => e.type === 'decision/decided')
  if (decided) for (const name of recipients.keys()) events.push({ type: 'breaker/reset', actor: decided.actor, member: name })
  const counts: Pointer['counts'] = { message: 0, item: 0, decision: 0, member: 0 }
  for (const e of business) {
    if (e.type === 'message/sent') counts.message++
    else if (e.type.startsWith('item/') || e.type === 'request/progressed') counts.item++
    else if (e.type.startsWith('decision/')) counts.decision++
    else if (e.type.startsWith('member/') || e.type === 'leader/changed') counts.member++
  }
  const actor = business[0]?.actor ?? ''
  let index = 0
  for (const [name, { member, invited }] of recipients) {
    const providerId = ctx.providers.get(member.binding.channel)
    if (!providerId || !member.binding.supports.wake || ctx.presence[name] === 'unreachable' || (!decided && member.wakeCount >= BREAKER_LIMIT)) continue
    const pointer: Pointer = { spaceId: state.spaceId, toSeq: state.lastSeq + 1, counts: { ...counts }, from: actor, ...(invited ? { invited: true as const } : {}) }
    events.push({ type: 'dispatch/intended', actor, delivery: { deliveryId: `delivery-${state.lastSeq + 1}-${++index}`, member: name, kind: 'wake', providerId, pointer } })
  }
  for (const e of events.filter(e => e.type === 'decision/requested')) {
    if (e.type !== 'decision/requested') continue
    const capable = e.request.deciders.filter(name => state.members[name]!.binding.supports.confirm && ctx.providers.has(state.members[name]!.binding.channel))
    e.request.awaitingChannel = capable.length === 0
    for (const name of capable) events.push({ type: 'dispatch/intended', actor: e.actor, delivery: { deliveryId: `delivery-${state.lastSeq + 1}-${++index}`, member: name, kind: 'confirm', providerId: ctx.providers.get(state.members[name]!.binding.channel)!, requestId: e.request.id } })
  }
  return events
}
