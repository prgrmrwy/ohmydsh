/**
 * Folded view of one Locus space from `readManaged` records.
 *
 * Pure: no storage, no clock. The handle returns the full log on every read,
 * so callers that care about cost keep their own cursor on top of {@link applyRecord}.
 */
import type { CollabCommitRecord, CollabEvent, CollabItem } from './types.js'

export interface FoldedMember {
  status: string
  /** Binding channel and address as recorded in the invite/join event. */
  channel?: string
  address: string
}

export interface FoldedSpace {
  readonly items: Map<string, CollabItem>
  /** Creation commit of each item: seq, `at` and the item exactly as created (later revisions never change it). */
  readonly itemCreated: Map<string, { readonly seq: number; readonly at: number | undefined; readonly item: CollabItem }>
  /** Latest `request/progressed` commit of each item. */
  readonly itemProgressed: Map<string, { readonly seq: number; readonly at: number | undefined }>
  leader?: string
  managers: Set<string>
  readonly members: Map<string, FoldedMember>
  cursor: number
}

export function emptySpace(): FoldedSpace {
  return {
    items: new Map(), itemCreated: new Map(), itemProgressed: new Map(),
    managers: new Set(), members: new Map(), cursor: 0,
  }
}

/** Apply one commit record onto a folded space. */
export function applyRecord(space: FoldedSpace, record: CollabCommitRecord): void {
  for (const event of record.events as readonly CollabEvent[]) {
    const e = event as Record<string, any>
    switch (e.type) {
      case 'space/created': space.leader = e.leader; break
      case 'leader/changed': space.leader = e.leader; break
      case 'manager/allowed': space.managers.add(e.channel); break
      case 'manager/revoked': space.managers.delete(e.channel); break
      case 'member/joined': case 'member/invited':
        space.members.set(e.member.name, {
          status: e.member.status,
          ...(e.member.binding?.channel === undefined ? {} : { channel: e.member.binding.channel }),
          address: e.member.binding?.address,
        })
        break
      case 'member/status': { const m = space.members.get(e.name); if (m) m.status = e.status; break }
      case 'item/created':
        space.itemCreated.set(e.item.id, { seq: record.seq, at: record.at, item: e.item })
        space.items.set(e.item.id, e.item)
        break
      case 'item/revised': case 'item/acked': space.items.set(e.item.id, e.item); break
      case 'request/progressed': {
        const item = space.items.get(e.itemId)
        if (item) space.items.set(e.itemId, { ...item, progress: e.progress })
        space.itemProgressed.set(e.itemId, { seq: record.seq, at: record.at })
        break
      }
    }
  }
  space.cursor = Math.max(space.cursor, record.seq)
}

/** Fold a whole log. */
export function foldSpace(records: readonly CollabCommitRecord[]): FoldedSpace {
  const space = emptySpace()
  for (const record of records) applyRecord(space, record)
  return space
}
