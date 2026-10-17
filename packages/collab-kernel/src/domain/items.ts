import { fail, type Item, type ItemFields, type ItemStatus, type SpaceState } from '../model/index.js'
export const itemTransitions: Record<ItemStatus, { reviseItem: string | null; ackItem: string | null; requestDecision: string | null }> = {
  draft: { reviseItem: null, ackItem: null, requestDecision: null },
  agreed: { reviseItem: null, ackItem: 'COLLAB_ITEM_SETTLED', requestDecision: null },
  escalated: { reviseItem: 'COLLAB_ITEM_ESCALATED', ackItem: 'COLLAB_ITEM_ESCALATED', requestDecision: null },
  decided: { reviseItem: 'COLLAB_DECIDED_LOCKED', ackItem: 'COLLAB_DECIDED_LOCKED', requestDecision: 'COLLAB_DECIDED_LOCKED' },
}
export function checkedItem(s: SpaceState, id: string, command: keyof typeof itemTransitions.draft): Item { const item = (Object.hasOwn(s.items, id) ? s.items[id] : undefined) ?? fail('COLLAB_ITEM_NOT_FOUND'); const error = itemTransitions[item.status][command]; if (error) fail(error); return item }
export function checkFields(s: SpaceState, fields: ItemFields): void {
  const bad = (field: string): never => fail('COLLAB_BAD_ITEM', { field })
  if (typeof fields.title !== 'string' || fields.title.length < 1 || fields.title.length > 200) bad('title')
  if (typeof fields.body !== 'string' || Buffer.byteLength(fields.body) > 65536) bad('body')
  if (!Array.isArray(fields.requiredAcks) || fields.requiredAcks.some(n => s.members[n]?.status !== 'active')) bad('requiredAcks')
  if (!Array.isArray(fields.deciders) || fields.deciders.some(n => s.members[n]?.status !== 'active' || s.members[n]?.kind !== 'human')) bad('deciders')
}
export function checkRevision(item: Item, revision: number): void { if (item.revision !== revision) fail('COLLAB_STALE_REVISION', { currentRevision: item.revision }) }
