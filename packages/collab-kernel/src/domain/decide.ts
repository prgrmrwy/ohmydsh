import type { CollabEvent, Pointer, Presence, SpaceState } from '../model/index.js'
import { wakeRecipients } from './wake.js'

export interface DispatchContext { presence: Record<string, Presence>; providers: ReadonlyMap<string, string> }

// Pure scheduling decision: runtime calls and mutable provider state stay in the service.
export function decideDispatch(state: SpaceState, business: CollabEvent[], ctx: DispatchContext): CollabEvent[] {
  const events = structuredClone(business)
  const recipients = wakeRecipients(state, events)
  const counts: Pointer['counts'] = { message: 0, item: 0, decision: 0, member: 0 }
  for (const e of business) {
    if (e.type === 'message/sent') counts.message++
    else if (e.type.startsWith('item/') || e.type === 'request/progressed') counts.item++
    else if (e.type.startsWith('member/') || e.type === 'leader/changed') counts.member++
  }
  const actor = business[0]?.actor ?? ''
  let index = 0
  for (const [name, { member, invited, thread }] of recipients) {
    const providerId = ctx.providers.get(member.binding.channel)
    if (!providerId || !member.binding.supports.wake || ctx.presence[name] === 'unreachable') continue
    const pointer: Pointer = { spaceId: state.spaceId, toSeq: state.lastSeq + 1, counts: { ...counts }, from: actor, ...(invited ? { invited: true as const } : {}), ...(thread === undefined ? {} : { thread }) }
    events.push({ type: 'dispatch/intended', actor, delivery: { deliveryId: `delivery-${state.lastSeq + 1}-${++index}`, member: name, kind: 'wake', providerId, pointer, ...(thread === undefined ? {} : { thread }) } })
  }
  return events
}
