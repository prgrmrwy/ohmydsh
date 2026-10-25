import { createHash } from 'node:crypto'
import { CollabError, principals, reduce, type CollabEvent, type CollabService, type CommitRecord, type Delivery, type Ext, type Item, type Message, type Overview, type ReadContext, type SpaceState } from 'collab-kernel'
import type { CollabHost } from './host.js'
import type { Caller } from './session-provider.js'

/**
 * Stamped managed callers (design D3 of pet-locus-collab-integration). Several
 * agents may resolve to one managed address; the integrator-derived stamp tells
 * them apart. Everything here is pure: the stamp itself, the cmdId namespace,
 * write-target authorization and the visible projection of reads.
 */
export type Subject = { kind: 'item'; item: Item } | { kind: 'message'; message: Message } | { kind: 'statusText'; name: string }
/** Synchronous view of the same fully replayed state the projection or check uses. */
export interface Lookup { recordAt(seq: number): { kind: 'item'; item: Item } | { kind: 'message'; message: Message } | undefined }
export interface StampView {
  stamp: Ext
  /** Canonical JSON of the stamp; equality of stamps is equality of keys. */
  key: string
  /** Present only when the integrator provides `visible`; throwing counts as invisible. */
  visible?: (subject: Subject, lookup: Lookup) => boolean
  recipients?: readonly string[]
}

export const STAMP_LIMIT = 1024

const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)
/** Sorted-key JSON of plain JSON values; anything else throws. */
export function canonicalJson(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('number'); return JSON.stringify(value) }
  if (typeof value !== 'object' || seen.has(value)) throw new TypeError('not JSON')
  seen.add(value)
  try {
    if (Array.isArray(value)) return `[${Array.from(value, v => canonicalJson(v, seen)).join(',')}]`
    if (!plain(value)) throw new TypeError('not plain')
    const entries = Object.keys(value).sort().map(k => { const v = value[k]; if (v === undefined) throw new TypeError('undefined'); return `${JSON.stringify(k)}:${canonicalJson(v, seen)}` })
    return `{${entries.join(',')}}`
  } finally { seen.delete(value) }
}

/** A usable stamp is a plain JSON object of at most 1024 canonical UTF-8 bytes; otherwise undefined. */
export function stampKey(stamp: unknown): string | undefined {
  if (!plain(stamp)) return
  let key: string
  try { key = canonicalJson(stamp) } catch { return }
  return Buffer.byteLength(key, 'utf8') <= STAMP_LIMIT ? key : undefined
}

/** Receipt namespace per stamp: retries of one stamp replay, other stamps never collide. */
export const namespacedCmdId = (key: string, cmdId: string) => `${createHash('sha256').update(key).digest('hex').slice(0, 16)}:${cmdId}`

/**
 * Write-target ownership: the record's ext equals the caller's stamp exactly
 * (spec). Records whose ext carries integrator facts beside the stamp, such as
 * Pet's tracked todos, are therefore read-only to the child as well.
 */
const sameStamp = (ext: unknown, view: StampView) => { if (ext === undefined) return false; try { return canonicalJson(ext) === view.key } catch { return false } }
/** Stamp merged over integrator facts written through a handle: the stamp always wins, so a handle cannot forge another stamp. */
const merge = (base: unknown, stamp: unknown): unknown => plain(base) && plain(stamp) ? Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(stamp)])].map(k => [k, Object.hasOwn(stamp, k) ? merge(base[k], stamp[k]) : base[k]])) : stamp
/** Business subject created at `seq`: an item's creation or a sent message; nothing else. */
export function lookupOf(state: SpaceState): Lookup {
  return {
    recordAt(seq: number) {
      if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1) return
      const message = state.messages.find(m => m.id === String(seq))
      if (message) return { kind: 'message', message: structuredClone(message) }
      const id = Object.keys(state.itemSeq).find(key => state.itemSeq[key] === seq)
      // Revisions keep their creation seq; the current item stands for the record.
      if (id !== undefined && Object.hasOwn(state.items, id)) return { kind: 'item', item: structuredClone(state.items[id]!) }
    },
  }
}
export const seen = (view: StampView, subject: Subject, state: SpaceState) => { try { return view.visible?.(subject, lookupOf(state)) === true } catch { return false } }

/** Item written by this very stamp: authored by the caller's member and carrying exactly its stamp. */
export const ownItem = (item: Item | undefined, self: string, view: StampView) => !!item && item.author === self && sameStamp(item.ext, view)

export type Target = { op: string; input: Record<string, any> }
/**
 * Write-target authorization for a stamped caller whose integrator provides
 * `visible`. Returns an error code, or undefined when allowed. Item and message
 * facts it reads are immutable once committed, so the same snapshot answers
 * both at entry and again in the commit guard (only `visible` is asked anew).
 */
export function refusal(state: SpaceState, self: string, view: StampView, target: Target): string | undefined {
  const { op, input } = target
  if (op === 'reviseItem' || op === 'ackItem' || op === 'advanceRequest') {
    const id = input.itemId
    const item = typeof id === 'string' && Object.hasOwn(state.items, id) ? state.items[id] : undefined
    return ownItem(item, self, view) ? undefined : 'COLLAB_ITEM_NOT_FOUND'
  }
  if ((op === 'createItem' || op === 'sendMessage') && input.ref !== undefined) {
    const ref = input.ref
    if (typeof ref !== 'number' || !Number.isSafeInteger(ref)) return // the kernel rejects malformed refs itself
    const message = state.messages.find(m => m.id === String(ref))
    if (message) {
      if (message.actor === self && sameStamp(message.ext, view)) return
      const author = Object.hasOwn(state.members, message.actor) ? state.members[message.actor] : undefined
      if (author && author.managedBy === undefined && message.to === self && seen(view, { kind: 'message', message }, state)) return
      return 'COLLAB_BAD_REF'
    }
    const itemId = Object.keys(state.itemSeq).find(id => state.itemSeq[id] === ref)
    if (itemId !== undefined) return ownItem(state.items[itemId], self, view) ? undefined : 'COLLAB_BAD_REF'
    return 'COLLAB_BAD_REF'
  }
}

type Business = { item?: Item; message?: Message; statusText?: string }
/**
 * The subject that caused each wake, by deliveryId: a needsReply message to the
 * recipient, a terminal request notice to its author, or an invitation
 * (structural). Built from the complete log so completions find their intent.
 */
function wakeSources(records: CommitRecord[], state: SpaceState): Map<string, Business | 'structural'> {
  const sources = new Map<string, Business | 'structural'>()
  for (const record of records) for (const e of record.events) {
    if (e.type !== 'dispatch/intended') continue
    const member = e.delivery.member
    let source: Business | 'structural' | undefined
    for (const b of record.events) {
      if (b.type === 'message/sent' && b.message.needsReply && b.message.to === member) source = { message: b.message }
      else if (b.type === 'member/invited' && b.member.name === member) source = 'structural'
      else if (b.type === 'request/progressed' && state.items[b.itemId]?.author === member) source = { item: state.items[b.itemId] }
      if (source) break
    }
    if (source) sources.set(e.delivery.deliveryId, source)
  }
  return sources
}

class Projector {
  private readonly sources: Map<string, Business | 'structural'>
  constructor(readonly view: StampView, readonly records: CommitRecord[], readonly state: SpaceState) { this.sources = wakeSources(records, state) }
  item(item: Item | undefined) { return !!item && seen(this.view, { kind: 'item', item }, this.state) }
  message(message: Message) { return seen(this.view, { kind: 'message', message }, this.state) }
  statusText(name: string) { return seen(this.view, { kind: 'statusText', name }, this.state) }
  delivery(id: string) {
    const source = this.sources.get(id)
    if (source === 'structural') return true
    if (!source) return false
    return source.message ? this.message(source.message) : this.item(source.item)
  }
  event(e: CollabEvent): boolean {
    switch (e.type) {
      case 'item/created': case 'item/revised': case 'item/acked': return this.item(e.item)
      case 'request/progressed': return this.item(this.state.items[e.itemId])
      case 'message/sent': return this.message(e.message)
      case 'member/statusText': return this.statusText(e.name)
      case 'dispatch/intended': return this.delivery(e.delivery.deliveryId)
      case 'dispatch/completed': return this.delivery(e.deliveryId)
      default: return true
    }
  }
}

/** Full records through the Host's own index read; never the caller's principal. */
const indexRecords = (host: CollabHost, spaceId: string) => host.service.readSince({ spaceId, principal: principals.internal('host-index') }, 0)

export type WriteOp = 'createItem' | 'reviseItem' | 'ackItem' | 'sendMessage' | 'setStatus' | 'advanceRequest'
/**
 * Entry of every member write. For a stamped caller: recipients, write-target
 * authorization (checked now and again in the commit guard), `ext` set to the
 * stamp, and the cmdId namespace. Anyone else passes through unchanged.
 */
export async function prepareWrite(host: CollabHost, caller: Caller, spaceId: string, cmdId: string, op: WriteOp, input: Record<string, any>): Promise<{ caller: Caller; cmdId: string; input: Record<string, any> } | { error: string }> {
  const view = caller.stamped
  if (!view) return { caller, cmdId, input }
  if (op === 'sendMessage' && !(typeof input.to === 'string' && (view.recipients ?? []).includes(input.to))) return { error: 'COLLAB_BAD_RECIPIENT' }
  let guard = caller.guard
  const targeted = op === 'reviseItem' || op === 'ackItem' || op === 'advanceRequest' || ((op === 'createItem' || op === 'sendMessage') && input.ref !== undefined)
  if (view.visible && targeted) {
    let state: SpaceState | undefined
    for (const record of await indexRecords(host, spaceId)) state = reduce(state, record)
    const self = state && Object.values(state.members).find(m => m.binding.channel === caller.channel && m.binding.address === caller.address)?.name
    // Not a member: the kernel refuses it without revealing the space.
    if (state && self !== undefined) {
      const snapshot = state, target = { op, input }
      const refused = refusal(snapshot, self, view, target)
      if (refused) return { error: refused }
      // Item and message facts are immutable once committed; visibility is asked anew.
      guard = () => caller.guard() && refusal(snapshot, self, view, target) === undefined
    }
  }
  const next = op === 'createItem' || op === 'sendMessage' ? { ...input, ext: merge(input.ext, view.stamp) } : input
  return { caller: { ...caller, guard }, cmdId: namespacedCmdId(view.key, cmdId), input: next }
}

/**
 * Read for a stamped caller whose integrator provides `visible`: the kernel's
 * own member read (authorization and guard) first, then the complete log
 * replayed and projected. Undefined means "read as usual".
 */
export function stampedRead(host: CollabHost, service: CollabService, ctx: ReadContext, caller: Caller, view: 'overview' | 'since', sinceSeq: unknown): Promise<unknown> | undefined {
  const stamped = caller.stamped
  if (!stamped?.visible) return
  if (view === 'overview') return (async () => {
    const overview = await service.overview(ctx)
    return projectOverview(stamped, overview, await indexRecords(host, ctx.spaceId), reduce)
  })()
  return (async () => {
    const records = await service.readSince(ctx, 0)
    if (typeof sinceSeq !== 'number' || !Number.isInteger(sinceSeq) || sinceSeq < 0) throw new CollabError('COLLAB_BAD_SEQ')
    return projectSince(stamped, records, sinceSeq, reduce)
  })()
}

/** Status for a stamped caller: only visible items and messages, and only actions it may perform. */
export function statusState(view: StampView | undefined, state: SpaceState, self: string): SpaceState {
  if (!view?.visible) return state
  const projected = projectState(view, state)
  // Write-target authorization: only own items can be acked or advanced.
  const actionable = Object.fromEntries(Object.entries(projected.items).filter(([, item]) => ownItem(item, self, view)))
  return { ...projected, items: actionable, itemSeq: Object.fromEntries(Object.entries(projected.itemSeq).filter(([id]) => Object.hasOwn(actionable, id))) }
}

const replay = (records: CommitRecord[], reduce: (s: SpaceState | undefined, r: CommitRecord) => SpaceState | undefined) => {
  let state: SpaceState | undefined
  for (const record of records) state = reduce(state, record)
  return state
}

/** `since` for a stamped caller: every record keeps its seq and time; events are filtered; no receipts. */
export function projectSince(view: StampView, records: CommitRecord[], sinceSeq: number, reduce: Parameters<typeof replay>[1]) {
  const state = replay(records, reduce)
  if (!state) return []
  const p = new Projector(view, records, state)
  return records.filter(r => r.seq > sinceSeq).map(r => {
    const at = (r as { at?: unknown }).at
    return { seq: r.seq, ...(at === undefined ? {} : { at }), events: structuredClone(r.events.filter(e => p.event(e))) }
  })
}

/** Overview for a stamped caller: a whitelist built over the fully replayed state. */
export function projectOverview(view: StampView, overview: Overview, records: CommitRecord[], reduce: Parameters<typeof replay>[1]) {
  const state = replay(records, reduce) ?? overview
  const p = new Projector(view, records, state)
  const deliveries = (list: Delivery[]) => structuredClone(list.filter(d => p.delivery(d.deliveryId)))
  const members = Object.fromEntries(Object.values(overview.members).map(m => [m.name, {
    name: m.name, kind: m.kind, status: m.status, binding: { channel: m.binding.channel },
    ...(m.managedBy === undefined ? {} : { managedBy: m.managedBy }),
    statusText: p.statusText(m.name) ? m.statusText : '',
  }]))
  return {
    spaceId: overview.spaceId, serviceId: overview.serviceId, status: overview.status, leader: overview.leader,
    convention: { version: overview.convention.version, sha256: overview.convention.sha256 },
    ...(overview.purpose === undefined ? {} : { purpose: overview.purpose }),
    lastSeq: overview.lastSeq,
    members,
    items: structuredClone(Object.fromEntries(Object.entries(overview.items).filter(([, item]) => p.item(item)))),
    messages: structuredClone(overview.messages.filter(m => p.message(m))),
    deliveries: structuredClone(Object.fromEntries(Object.entries(overview.deliveries).filter(([id]) => p.delivery(id)))),
    pendingDeliveries: deliveries(overview.pendingDeliveries),
    inFlightDeliveries: deliveries(overview.inFlightDeliveries),
    presence: structuredClone(overview.presence),
  }
}

/** Space state as a stamped caller may see it, for status: only visible items and messages. */
export function projectState(view: StampView, state: SpaceState): SpaceState {
  const items = Object.fromEntries(Object.entries(state.items).filter(([, item]) => seen(view, { kind: 'item', item }, state)))
  return { ...state, items, itemSeq: Object.fromEntries(Object.entries(state.itemSeq).filter(([id]) => Object.hasOwn(items, id))), messages: state.messages.filter(message => seen(view, { kind: 'message', message }, state)) }
}
