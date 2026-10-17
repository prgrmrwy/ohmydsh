import type { CollabEvent, Member, SpaceState } from '../model/index.js'

// Select recipients before capability/presence filtering, so a decision can reset paused members.
export function wakeRecipients(state: SpaceState, events: CollabEvent[]): Map<string, { member: Member; invited: boolean }> {
  const recipients = new Map<string, { member: Member; invited: boolean }>()
  const escalated = events.some(e => e.type === 'item/revised' && e.item.status === 'escalated')
  const add = (name: string, actor: string, invitation?: Member) => {
    const member = invitation ?? state.members[name]
    if (!member || name === actor || (member.status !== 'active' && !invitation) || (escalated && member.kind === 'agent')) return
    recipients.set(name, { member, invited: !!invitation })
  }
  for (const e of events) {
    switch (e.type) {
      case 'message/sent': if (e.message.needsReply) add(e.message.to, e.actor); break
      case 'item/revised': for (const name of e.item.requiredAcks) add(name, e.actor); break
      case 'item/acked': if (e.item.status === 'agreed' && state.items[e.item.id]?.status !== 'agreed') add(e.item.author, e.actor); break
      case 'request/progressed': add(state.items[e.itemId]!.author, e.actor); break
      case 'member/invited': add(e.member.name, e.actor, e.member); break
      case 'leader/changed': add(e.leader, e.actor); break
      case 'decision/decided': {
        add(state.requests[e.decision.requestId]!.author, e.actor)
        for (const name of state.items[e.decision.itemId]!.requiredAcks) add(name, e.actor)
        break
      }
    }
  }
  return recipients
}
