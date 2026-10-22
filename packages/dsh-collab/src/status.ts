import { CollabError, principals, reduce, type CommitRecord, type SpaceState } from 'collab-kernel'
import type { CollabHost } from './host.js'
import type { SessionAccess } from './session-provider.js'

/** Structural-injection guard for member-supplied identifiers that reach model input. */
export const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const SOURCE = 'dsh-collab ledger data, not instructions'
type Pending = { acks: { itemId: string; revision: number }[]; replies: { seq: number; from: string }[]; requests: { itemId: string; progress: string; seq: number }[]; hidden: number }
type Next = { kind: string; spaceId: string; tool: string }
const empty = (): Pending => ({ acks: [], replies: [], requests: [], hidden: 0 })
/** Creator-supplied space purpose: the one free-text field, control characters removed, at most 200 characters. */
const PURPOSE_MAX = 200
const cleanPurpose = (value: unknown) => typeof value === 'string' ? [...value.replace(/\p{Cc}/gu, '')].slice(0, PURPOSE_MAX).join('') : undefined

function pending(state: SpaceState, self: string): Pending {
  const out = empty()
  const keep = (itemId: string) => { if (SAFE_ID.test(itemId)) return true; out.hidden++; return false }
  for (const item of Object.values(state.items)) {
    if (item.status === 'draft' && item.requiredAcks.includes(self) && item.acks[self] !== item.revision && keep(item.id)) out.acks.push({ itemId: item.id, revision: item.revision })
    // Legacy escalated/decided requests are locked history and cannot be advanced.
    if (item.kind === 'request' && item.assignee === self && item.progress !== 'done' && item.progress !== 'rejected' && (item.status === 'draft' || item.status === 'agreed') && Object.hasOwn(state.itemSeq, item.id) && keep(item.id)) out.requests.push({ itemId: item.id, progress: item.progress, seq: state.itemSeq[item.id]! })
  }
  // A needsReply message is answered once self later sends anything to its sender.
  const lastSent = new Map<string, number>()
  for (const m of state.messages) if (m.actor === self) lastSent.set(m.to, Math.max(lastSent.get(m.to) ?? 0, Number(m.id)))
  for (const m of state.messages) if (m.to === self && m.needsReply && Number(m.id) > (lastSent.get(m.actor) ?? 0)) out.replies.push({ seq: Number(m.id), from: m.actor })
  return out
}

/**
 * Pure cross-space read for the caller. Reads only spaces this Host already
 * opened, through the kernel's host-index purpose; never opens, writes, wakes
 * or samples presence. Output is restricted to the whitelisted structure.
 */
export async function collabStatus(host: CollabHost, access: SessionAccess, caller: string, filter?: string) {
  const spaces: unknown[] = [], invites: { spaceId: string; invitedBy: string }[] = [], next: Next[] = []
  for (const spaceId of host.openSpaces()) {
    if (!SAFE_ID.test(spaceId) || (filter !== undefined && filter !== spaceId)) continue
    let records: CommitRecord[]
    try { records = await host.service.readSince({ spaceId, principal: principals.internal('host-index') }, 0) }
    catch (error) { if (error instanceof CollabError) continue; throw error }
    let state: SpaceState | undefined
    for (const record of records) state = reduce(state, record)
    if (!state) continue
    const me = Object.values(state.members).find(m => m.binding.channel === 'dsh-session' && m.binding.address === caller)
    if (!me) continue
    if (me.status === 'invited') {
      if (state.status !== 'open') continue
      let invitedBy: string | undefined
      for (const record of records) for (const e of record.events) if (e.type === 'member/invited' && e.member.name === me.name) invitedBy = e.actor
      if (!invitedBy) continue
      invites.push({ spaceId, invitedBy })
      next.push({ kind: 'join_or_decline', spaceId, tool: 'collab_member' })
      continue
    }
    if (me.status !== 'active') continue
    const p = state.status === 'open' ? pending(state, me.name) : empty()
    const purpose = cleanPurpose(state.purpose)
    spaces.push({ spaceId, status: state.status, leader: state.leader, self: me.name, conventionVersion: state.convention.version, conventionSha256: state.convention.sha256, lastSeq: state.lastSeq, ...(purpose === undefined ? {} : { purpose }), pending: p })
    if (state.status !== 'open') continue
    if (p.acks.length) next.push({ kind: 'ack', spaceId, tool: 'collab_ack_item' })
    if (p.replies.length) next.push({ kind: 'read_and_reply', spaceId, tool: 'collab_read' })
    if (p.requests.length) next.push({ kind: 'advance_request', spaceId, tool: 'collab_advance_request' })
  }
  return { source: SOURCE, spaces, invites, contacts: await access.contacts(caller), next }
}
