/**
 * Pet's single proxy member `pet` in each main session's Locus collaboration
 * space (`pet-locus-collab-integration` design D1, D2, D4, D5).
 *
 * Owns: the in-memory routing projection (child session → locus identity),
 * which spaces are established, the dsh-collab integrator adapter, space
 * establishment, and the inbox where deliveries are registered.
 *
 * Never: opens a model turn, sends anything to Feishu, or resumes a main
 * session to establish its space. `deliver` only registers.
 */
import { endpointKeyOf, type LocusEndpoint } from '../locus/aggregate.js'
import {
  MAIN_MEMBER, PET_COLLAB_CHANNEL, PET_MEMBER, PET_RECIPIENTS,
  admitCmdId, establishCmdId, locusIdentity, locusSpaceId, locusSpacePurpose, parentOfPetAddress, petAddress,
} from './naming.js'
import { isVisibleToLocus, locusStamp, routeToLocus, type LocusRoute } from './routing.js'
import {
  isHandleError,
  type CollabCommitRecord, type CollabEvent, type CollabExt, type CollabIntegratorAdapter, type CollabIntegrationHandle,
  type CollabItem, type CollabLookup, type CollabSubject, type CollabMessage, type CollabPointer, type CollabRecordAt, type CollabService,
  type CollabTarget,
} from './types.js'

/** The durable locus facts the proxy projects; a subset of `LocusRecord`. */
export interface ProxyLocusRecord {
  readonly id: string
  readonly generation: number
  readonly endpoint: LocusEndpoint
  readonly parentSessionId: string
  readonly childSessionId?: string
  readonly state: string
}

export interface LocusCollabProxyDeps {
  /** Every durable locus generation, history included. */
  listLoci(): readonly ProxyLocusRecord[]
  /** The Host's CURRENT live Agent object for a session, or undefined when not loaded. Never resumes. */
  liveAgent(sessionId: string): unknown
  /** Main session title for the space purpose; optional. */
  mainTitle?(parentSessionId: string): string | undefined
  log?(message: string): void
}

/** One child's routing facts. */
export interface ChildRoute {
  readonly parentSessionId: string
  readonly locusId: string
  readonly generation: number
  readonly recordId: string
}

/** A delivery registered for the owner/management surface. No turn is opened. */
export interface ProxyInboxEntry {
  readonly spaceId: string
  readonly parentSessionId: string
  readonly seq: number
  readonly at?: number
  readonly subject: 'message' | 'request-terminal'
  readonly messageId?: string
  readonly itemId?: string
  readonly progress?: string
  readonly route: LocusRoute
}

export type EnsureSpaceOutcome =
  | { readonly ok: true; readonly spaceId: string }
  | { readonly ok: false; readonly reason: 'collab-unavailable' | 'main-not-loaded' | 'no-active-locus' | 'establish-failed'; readonly code?: string }

/** Folded view of one space, from `readManaged` records. */
interface FoldedSpace {
  readonly items: Map<string, CollabItem>
  readonly itemSeq: Map<string, number>
  readonly messages: Map<number, CollabMessage>
  leader?: string
  managers: Set<string>
  readonly members: Map<string, { status: string; managedBy?: string; address: string }>
}

function fold(records: readonly CollabCommitRecord[]): FoldedSpace {
  const space: FoldedSpace = { items: new Map(), itemSeq: new Map(), messages: new Map(), managers: new Set(), members: new Map() }
  for (const record of records) {
    for (const event of record.events as readonly CollabEvent[]) {
      const e = event as Record<string, any>
      switch (e.type) {
        case 'space/created': space.leader = e.leader; break
        case 'leader/changed': space.leader = e.leader; break
        case 'manager/allowed': space.managers.add(e.channel); break
        case 'manager/revoked': space.managers.delete(e.channel); break
        case 'member/joined': case 'member/invited':
          space.members.set(e.member.name, { status: e.member.status, ...(e.member.managedBy === undefined ? {} : { managedBy: e.member.managedBy }), address: e.member.binding?.address })
          break
        case 'member/status': { const m = space.members.get(e.name); if (m) m.status = e.status; break }
        case 'item/created': space.itemSeq.set(e.item.id, record.seq); space.items.set(e.item.id, e.item); break
        case 'item/revised': case 'item/acked': space.items.set(e.item.id, e.item); break
        case 'request/progressed': { const item = space.items.get(e.itemId); if (item) space.items.set(e.itemId, { ...item, progress: e.progress }); break }
        case 'message/sent': space.messages.set(record.seq, e.message); break
      }
    }
  }
  return space
}

function lookupOver(space: FoldedSpace): CollabLookup {
  const itemAt = new Map<number, string>()
  for (const [id, seq] of space.itemSeq) itemAt.set(seq, id)
  return {
    recordAt(seq) {
      const message = space.messages.get(seq)
      if (message !== undefined) return { kind: 'message', message }
      const id = itemAt.get(seq)
      const item = id === undefined ? undefined : space.items.get(id)
      return item === undefined ? undefined : { kind: 'item', item }
    },
  }
}

/** Whether the folded space meets D1's "established" definition for this parent. */
function establishedIn(space: FoldedSpace, parentSessionId: string): boolean {
  const pet = space.members.get(PET_MEMBER)
  return space.leader === MAIN_MEMBER
    && space.managers.has(PET_COLLAB_CHANNEL)
    && pet !== undefined && pet.status === 'active' && pet.managedBy === PET_COLLAB_CHANNEL
    && pet.address === petAddress(parentSessionId)
}

export class LocusCollabProxy {
  private children = new Map<string, ChildRoute>()
  private lociByParent = new Map<string, readonly string[]>()
  private activeParents = new Set<string>()
  private readonly established = new Set<string>()
  /** Parents whose `admit` is in flight; `holds` must answer true during it. */
  private readonly admitting = new Set<string>()
  private readonly inFlight = new Map<string, Promise<EnsureSpaceOutcome>>()
  private readonly cursors = new Map<string, number>()
  private readonly entries: ProxyInboxEntry[] = []
  private handle: CollabIntegrationHandle | undefined

  constructor(private readonly deps: LocusCollabProxyDeps) {
    this.refresh()
  }

  /** Rebuild the routing projection from durable locus records (after commits and at startup). */
  refresh(): void {
    const children = new Map<string, ChildRoute>()
    const lociByParent = new Map<string, Set<string>>()
    const keysByIdentity = new Map<string, Map<string, Set<string>>>() // parent → identity → endpoint keys
    const activeParents = new Set<string>()
    for (const record of this.deps.listLoci()) {
      let key: string
      try { key = endpointKeyOf(record.endpoint) } catch { continue }
      const identity = locusIdentity(key)
      const parent = record.parentSessionId
      if (!lociByParent.has(parent)) lociByParent.set(parent, new Set())
      lociByParent.get(parent)!.add(identity)
      const byIdentity = keysByIdentity.get(parent) ?? new Map<string, Set<string>>()
      keysByIdentity.set(parent, byIdentity)
      const keys = byIdentity.get(identity) ?? new Set<string>()
      keys.add(key)
      byIdentity.set(identity, keys)
      if (record.state === 'active' && record.childSessionId !== undefined && record.childSessionId !== '') {
        activeParents.add(parent)
        children.set(record.childSessionId, {
          parentSessionId: parent, locusId: identity, generation: record.generation, recordId: record.id,
        })
      }
    }
    // Two DIFFERENT endpoints of one parent hashing to one identity: claim neither (AMD-2).
    for (const [childId, route] of [...children]) {
      const keys = keysByIdentity.get(route.parentSessionId)?.get(route.locusId)
      if (keys === undefined || keys.size !== 1) children.delete(childId)
    }
    const collided = new Map<string, readonly string[]>()
    for (const [parent, identities] of lociByParent) {
      collided.set(parent, [...identities].filter(id => keysByIdentity.get(parent)?.get(id)?.size === 1))
    }
    this.children = children
    this.lociByParent = collided
    this.activeParents = activeParents
  }

  /** Every locus identity of one parent, retired included, collisions excluded. */
  parentLoci(parentSessionId: string): readonly string[] {
    return this.lociByParent.get(parentSessionId) ?? []
  }

  /** Projection entry for a child session, if it is an active current-generation child. */
  childRoute(childSessionId: string): ChildRoute | undefined {
    return this.children.get(childSessionId)
  }

  isEstablished(parentSessionId: string): boolean {
    return this.established.has(parentSessionId)
  }

  /** Registered deliveries, oldest first. */
  inbox(): readonly ProxyInboxEntry[] {
    return [...this.entries]
  }

  /** The current handle, for later task groups (todo backend). */
  currentHandle(): CollabIntegrationHandle | undefined {
    return this.handle
  }

  /** The adapter Pet registers with dsh-collab. */
  readonly adapter: CollabIntegratorAdapter = Object.freeze({
    recipients: PET_RECIPIENTS,
    resolveCaller: (agent: unknown) => {
      const id = (agent as { id?: unknown } | undefined)?.id
      if (typeof id !== 'string') return undefined
      const route = this.children.get(id)
      if (route === undefined) return undefined
      if (this.deps.liveAgent(id) !== agent) return undefined
      if (!this.established.has(route.parentSessionId)) return undefined
      return { address: petAddress(route.parentSessionId), stamp: locusStamp(route.locusId) }
    },
    holds: (address: string) => this.holdsAddress(address),
    claim: (address: string) => this.holdsAddress(address),
    presence: (target: CollabTarget) => this.holdsAddress(target.address) ? 'reachable' : 'unreachable',
    // A stamped caller is always a child of the space's parent, so its own
    // identity is the only rule-2 match that can make a message visible to it.
    visible: (stamp: CollabExt, subject: CollabSubject, lookup: CollabLookup) => {
      const own = (stamp as { pet?: { locusId?: unknown } }).pet?.locusId
      return typeof own === 'string' && isVisibleToLocus(stamp, subject, lookup, [own])
    },
    deliver: (target: CollabTarget, pointer: CollabPointer) => this.deliver(target, pointer),
  })

  private holdsAddress(address: string): boolean {
    const parent = parentOfPetAddress(address)
    return parent !== undefined && (this.established.has(parent) || this.admitting.has(parent))
  }

  /** Attach to dsh-collab; returns a disposer. Spaces are re-probed afterwards by the caller. */
  attach(service: CollabService): () => void {
    const handle = service.attach(PET_COLLAB_CHANNEL, this.adapter)
    this.handle = handle
    return () => {
      if (this.handle === handle) this.handle = undefined
      this.established.clear()
      this.admitting.clear()
      this.cursors.clear()
      try { handle.dispose() } catch { /* already detached */ }
    }
  }

  /**
   * Make sure one parent's space is established (D1/D2), without ever loading
   * the main session: an unloaded main yields `main-not-loaded`.
   */
  ensureSpace(parentSessionId: string): Promise<EnsureSpaceOutcome> {
    const running = this.inFlight.get(parentSessionId)
    if (running !== undefined) return running
    const attempt = this.establish(parentSessionId).finally(() => this.inFlight.delete(parentSessionId))
    this.inFlight.set(parentSessionId, attempt)
    return attempt
  }

  /** Startup/attach: mark spaces that already meet D1 as established; never creates or loads anything. */
  async probe(parentSessionId: string): Promise<boolean> {
    const handle = this.handle
    if (handle === undefined) return false
    const records = await handle.readManaged(locusSpaceId(parentSessionId))
    if (isHandleError(records) || this.handle !== handle) return false
    if (!establishedIn(fold(records), parentSessionId)) return false
    this.established.add(parentSessionId)
    return true
  }

  /** Establish every parent that has an active locus and a loaded main session. */
  async ensureAll(): Promise<void> {
    for (const parent of this.activeParents) {
      await this.ensureSpace(parent).catch(error => this.deps.log?.(`dsh-pet collab: ensure ${parent} failed: ${String(error)}`))
    }
  }

  private async establish(parentSessionId: string): Promise<EnsureSpaceOutcome> {
    const handle = this.handle
    if (handle === undefined) return { ok: false, reason: 'collab-unavailable' }
    const spaceId = locusSpaceId(parentSessionId)
    if (this.established.has(parentSessionId)) return { ok: true, spaceId }
    if (await this.probe(parentSessionId)) return { ok: true, spaceId }
    if (!this.activeParents.has(parentSessionId)) return { ok: false, reason: 'no-active-locus' }
    const main = this.deps.liveAgent(parentSessionId)
    if (main === undefined) return { ok: false, reason: 'main-not-loaded' }

    const created = await handle.establish({ agent: main }, spaceId, establishCmdId(parentSessionId), {
      name: MAIN_MEMBER, purpose: locusSpacePurpose(this.deps.mainTitle?.(parentSessionId)),
    })
    if (isHandleError(created)) return { ok: false, reason: 'establish-failed', code: created.error.code }

    this.admitting.add(parentSessionId)
    try {
      const admitted = await handle.admit(spaceId, admitCmdId(parentSessionId), { name: PET_MEMBER, address: petAddress(parentSessionId) })
      // A redelivered admit replays its receipt; a name already taken by an
      // earlier admit is verified by the probe below rather than trusted.
      if (isHandleError(admitted) && admitted.error.code !== 'COLLAB_NAME_TAKEN') {
        return { ok: false, reason: 'establish-failed', code: admitted.error.code }
      }
    } finally {
      this.admitting.delete(parentSessionId)
    }
    if (!(await this.probe(parentSessionId))) return { ok: false, reason: 'establish-failed' }
    this.deps.log?.(`dsh-pet collab: established ${spaceId}`)
    return { ok: true, spaceId }
  }

  /**
   * Register every new wake source up to `pointer.toSeq` (D4/D5): needsReply
   * messages to `pet`, and terminal progress of requests authored by `pet`.
   * Registration only — no turn, no outbound message.
   */
  private async deliver(target: CollabTarget, pointer: CollabPointer): Promise<void> {
    const parent = parentOfPetAddress(target.address)
    const handle = this.handle
    if (parent === undefined || target.name !== PET_MEMBER || handle === undefined) throw new Error('not a pet target')
    const spaceId = locusSpaceId(parent)
    if (pointer.spaceId !== spaceId) throw new Error('pointer space mismatch')
    const records = await handle.readManaged(spaceId)
    if (isHandleError(records)) throw new Error(records.error.code)
    const space = fold(records)
    const lookup = lookupOver(space)
    const loci = this.parentLoci(parent)
    const from = this.cursors.get(spaceId) ?? 0
    let last = from
    for (const record of records) {
      if (record.seq <= from || record.seq > pointer.toSeq) continue
      last = Math.max(last, record.seq)
      for (const event of record.events as readonly Record<string, any>[]) {
        if (event.type === 'message/sent' && event.message.to === PET_MEMBER && event.message.needsReply === true && event.actor !== PET_MEMBER) {
          const subject: CollabRecordAt = { kind: 'message', message: event.message }
          this.register({ spaceId, parentSessionId: parent, seq: record.seq, ...(record.at === undefined ? {} : { at: record.at }), subject: 'message', messageId: event.message.id, route: routeToLocus(subject, lookup, loci) })
        } else if (event.type === 'request/progressed' && (event.progress === 'done' || event.progress === 'rejected')) {
          const item = space.items.get(event.itemId)
          if (item === undefined || item.author !== PET_MEMBER) continue
          this.register({ spaceId, parentSessionId: parent, seq: record.seq, ...(record.at === undefined ? {} : { at: record.at }), subject: 'request-terminal', itemId: item.id, progress: event.progress, route: routeToLocus({ kind: 'item', item }, lookup, loci) })
        }
      }
    }
    this.cursors.set(spaceId, last)
  }

  private register(entry: ProxyInboxEntry): void {
    this.entries.push(Object.freeze(entry))
    const where = entry.route.kind === 'locus' ? `${entry.route.locusId} (${entry.route.via})` : 'unroutable'
    this.deps.log?.(`dsh-pet collab: registered ${entry.subject} seq ${entry.seq} in ${entry.spaceId} → ${where}`)
  }
}
