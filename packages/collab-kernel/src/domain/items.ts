import { fail, type Item, type ItemFields, type ItemStatus, type SpaceState } from '../model/index.js'
/** Item status table. `escalated` and `decided` only come from pre-change logs and are read-only. */
export const itemTransitions: Record<ItemStatus, { reviseItem: string | null; ackItem: string | null; advanceRequest: string | null }> = {
  draft: { reviseItem: null, ackItem: null, advanceRequest: null },
  agreed: { reviseItem: null, ackItem: 'COLLAB_ITEM_SETTLED', advanceRequest: null },
  escalated: { reviseItem: 'COLLAB_ITEM_ESCALATED', ackItem: 'COLLAB_ITEM_ESCALATED', advanceRequest: 'COLLAB_ITEM_ESCALATED' },
  decided: { reviseItem: 'COLLAB_DECIDED_LOCKED', ackItem: 'COLLAB_DECIDED_LOCKED', advanceRequest: 'COLLAB_DECIDED_LOCKED' },
}
export function checkedItem(s: SpaceState, id: string, command: keyof typeof itemTransitions.draft): Item { const item = (Object.hasOwn(s.items, id) ? s.items[id] : undefined) ?? fail('COLLAB_ITEM_NOT_FOUND'); const error = itemTransitions[item.status][command]; if (error) fail(error); return item }
/** Caller input may never carry the removed `deciders` field. */
export function rejectDeciders(input: object): void { if (Object.hasOwn(input, 'deciders')) fail('COLLAB_BAD_ITEM', { field: 'deciders' }) }
/** Validates only the active fields; inert legacy fields on old snapshots are carried through untouched. */
export function checkFields(s: SpaceState, fields: ItemFields): void {
  const bad = (field: string): never => fail('COLLAB_BAD_ITEM', { field })
  if (typeof fields.title !== 'string' || fields.title.length < 1 || fields.title.length > 200) bad('title')
  if (typeof fields.body !== 'string' || Buffer.byteLength(fields.body) > 65536) bad('body')
  if (!Array.isArray(fields.requiredAcks) || fields.requiredAcks.some(n => !Object.hasOwn(s.members, n) || s.members[n]!.status !== 'active')) bad('requiredAcks')
}
export function checkRevision(item: Item, revision: number): void { if (item.revision !== revision) fail('COLLAB_STALE_REVISION', { currentRevision: item.revision }) }
