import { fail, messageNotifies, type Address, type CollabEvent, type Pointer, type Presence, type SpaceState } from '../model/index.js'
import { wakeRecipients } from './wake.js'

/**
 * `bindings`, when given, is the exact `{channel, address}` each presence sample
 * was taken for. A wake recipient whose current binding differs (rebound after
 * sampling) or that was never sampled cannot be judged: COLLAB_BINDING_CHANGED.
 */
export interface DispatchContext { presence: Record<string, Presence>; providers: ReadonlyMap<string, string>; bindings?: Record<string, Address> }

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
    if (ctx.bindings) {
      const sampled = Object.hasOwn(ctx.bindings, name) ? ctx.bindings[name] : undefined
      if (!sampled || sampled.channel !== member.binding.channel || sampled.address !== member.binding.address) fail('COLLAB_BINDING_CHANGED')
    }
    const providerId = ctx.providers.get(member.binding.channel)
    if (!providerId || !member.binding.supports.wake || ctx.presence[name] === 'unreachable') continue
    // Only the waking message's own mode travels; invitations and completion notices never carry one.
    const mode = invited ? undefined : business.find((e): e is Extract<CollabEvent, { type: 'message/sent' }> => e.type === 'message/sent' && messageNotifies(e.message) && e.message.to === name)?.message.mode
    const pointer: Pointer = { spaceId: state.spaceId, toSeq: state.lastSeq + 1, counts: { ...counts }, from: actor, ...(invited ? { invited: true as const } : {}), ...(thread === undefined ? {} : { thread }), ...(mode === undefined ? {} : { mode }) }
    events.push({ type: 'dispatch/intended', actor, delivery: { deliveryId: `delivery-${state.lastSeq + 1}-${++index}`, member: name, kind: 'wake', providerId, pointer, ...(thread === undefined ? {} : { thread }), ...(mode === undefined ? {} : { mode }) } })
  }
  return events
}
