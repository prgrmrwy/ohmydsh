import type { CollabEvent, Member, SpaceState } from '../model/index.js'

export interface Recipient { member: Member; invited: boolean; thread?: number }

/**
 * The three wake triggers: a needsReply message wakes its recipient, an
 * invitation wakes the invitee, and terminal request progress notifies the
 * request's author. Every other event, including item edits, acks, agreement,
 * `accepted` and leader changes, wakes nobody. The actor never wakes itself.
 */
export function wakeRecipients(state: SpaceState, events: CollabEvent[]): Map<string, Recipient> {
  const recipients = new Map<string, Recipient>()
  const seq = state.lastSeq + 1
  const add = (name: string, actor: string, extra: { invitation?: Member; thread?: number } = {}) => {
    const member = extra.invitation ?? state.members[name]
    if (!member || name === actor || (member.status !== 'active' && !extra.invitation)) return
    recipients.set(name, { member, invited: !!extra.invitation, ...(extra.thread === undefined ? {} : { thread: extra.thread }) })
  }
  for (const e of events) {
    switch (e.type) {
      case 'message/sent': if (e.message.needsReply) add(e.message.to, e.actor, { thread: e.message.ref === undefined ? seq : state.topicOf[e.message.ref]! }); break
      case 'member/invited': add(e.member.name, e.actor, { invitation: e.member }); break
      case 'request/progressed': {
        if (e.progress !== 'done' && e.progress !== 'rejected') break
        const item = state.items[e.itemId]!
        add(item.author, e.actor, { thread: state.topicOf[state.itemSeq[e.itemId]!]! })
        break
      }
    }
  }
  return recipients
}
