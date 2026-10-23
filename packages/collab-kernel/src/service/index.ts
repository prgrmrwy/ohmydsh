import { createHash } from 'node:crypto'
import { authorization, isPrincipal, type CommandName, type Principal } from '../auth/index.js'
import { reduce } from '../domain/reduce.js'
import { decideDispatch } from '../domain/decide.js'
import { CollabError, TOPIC_LIMIT, type DispatchCompletedEvent, type Presence } from '../model/index.js'
import { checkedItem, checkFields, checkRevision, rejectDeciders } from '../domain/items.js'
import { fail, type Ext, type Address, type Binding, type CollabEvent, type CommandResult, type CommitRecord, type CreateItemInput, type Item, type Member, type MemberKind, type Overview, type Progress, type ReceiptScope, type ReviseItemInput, type SpaceState } from '../model/index.js'
import type { ChannelProvider } from '../spi/index.js'
import type { CollabStore } from '../store/interface.js'
import { conventions, defaultConvention } from '../convention/index.js'
import { project } from '../projection/index.js'
import { canonicalJson } from '../store/canonical.js'
const EXT_LIMIT = 4096
const plainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)
/** Recursively only JSON values; an own `undefined` entry is not JSON and is refused rather than dropped. */
const jsonValue = (v: unknown, seen = new Set<object>()): boolean => {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true
  if (typeof v === 'number') return Number.isFinite(v)
  if (typeof v !== 'object' || seen.has(v)) return false
  if (!Array.isArray(v) && !plainObject(v)) return false
  seen.add(v)
  try { return Array.isArray(v) ? Array.from(v).every(x => jsonValue(x, seen)) : Object.values(v).every(x => jsonValue(x, seen)) } finally { seen.delete(v) }
}
/** Opaque integrator data: a plain JSON object of at most 4096 canonical UTF-8 bytes (the store's row normalization). */
function checkExt(ext: unknown): void {
  if (ext === undefined) return
  if (!plainObject(ext) || !jsonValue(ext)) fail('COLLAB_BAD_EXT')
  let bytes: number
  try { bytes = Buffer.byteLength(canonicalJson(ext), 'utf8') } catch { return fail('COLLAB_BAD_EXT') }
  if (bytes > EXT_LIMIT) fail('COLLAB_BAD_EXT')
}
/** Stands in for an ext that cannot be cloned or serialized; checkExt rejects it. */
const UNSERIALIZABLE_EXT = '\u0000unserializable-ext'
/**
 * Input snapshot and payload hash run before business checks. An `ext` that
 * cannot be cloned or serialized (bigint, cycles, functions) is replaced by a
 * placeholder here, so the error surfaces as COLLAB_BAD_EXT at ext's own
 * position (after existing business checks, before ref) instead of as a raw
 * exception that would jump ahead of guard, membership and business errors.
 */
function cloneInput<T extends object>(input: T): T {
  if (input && typeof input === 'object' && Object.hasOwn(input, 'ext')) {
    const ext = (input as { ext?: unknown }).ext
    let usable = true
    try { JSON.stringify(ext); structuredClone(ext) } catch { usable = false }
    if (!usable) return { ...structuredClone({ ...input, ext: undefined }), ext: UNSERIALIZABLE_EXT } as T
  }
  return structuredClone(input)
}
const MODE_FORMAT = /^[a-z][a-z0-9-]{0,31}:[a-z][a-z0-9-]{0,31}$/
/**
 * `guard` is created by the host per call and re-checked synchronously at the
 * final commit/read boundary; false or throwing rejects with COLLAB_CALLER_STALE.
 */
export interface ReadContext { principal: Principal; spaceId: string; guard?: () => boolean }
export interface CommandContext extends ReadContext { cmdId: string }
type ManagerCommand = 'admitMember' | 'rebindMember' | 'retireMember'
export interface ServiceOptions { serviceId: string; store: CollabStore; providers: ChannelProvider[]; convention?: { version: string; sha256: string; text: string }; project?: (state: Overview) => string }
export function canonical(value: unknown): string {
  const normalize = (v: unknown): unknown => Array.isArray(v) ? v.map(normalize) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, normalize(x)])) : v
  return JSON.stringify(normalize(value))
}
export class CollabService {
  private states = new Map<string, SpaceState>()
  private records = new Map<string, CommitRecord[]>()
  private queues = new Map<string, Promise<unknown>>()
  private opened = new Set<string>()
  private failed = new Set<string>()
  private stopped = new Set<string>()
  private epochs = new Map<string, number>()
  private openings = new Map<string, Promise<void>>()
  private closings = new Map<string, Promise<void>>()
  private commits = new Map<string, Promise<void>>()
  private generations = new Map<string, symbol>()
  private inFlight = new Map<string, Set<string>>()
  constructor(readonly options: ServiceOptions) {}
  private enqueue<T>(spaceId: string, run: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(spaceId) ?? Promise.resolve()).then(run)
    this.queues.set(spaceId, result.catch(() => undefined)); return result
  }
  async open(spaceId: string): Promise<void> {
    if (this.opened.has(spaceId) || this.openings.has(spaceId) || this.closings.has(spaceId)) fail('COLLAB_STORE_FAILED')
    const epoch = this.epochs.get(spaceId) ?? 0
    const opening = (async () => {
      await this.options.store.open(spaceId)
      try {
        if ((this.epochs.get(spaceId) ?? 0) !== epoch) fail('COLLAB_STORE_FAILED')
        const records = await this.options.store.read(spaceId, 0)
        if ((this.epochs.get(spaceId) ?? 0) !== epoch) fail('COLLAB_STORE_FAILED')
        let state: SpaceState | undefined
        for (const record of records) state = reduce(state, record)
        if (state) this.states.set(spaceId, state); else this.states.delete(spaceId)
        this.records.set(spaceId, records); this.opened.add(spaceId); this.failed.delete(spaceId); this.stopped.delete(spaceId)
        this.generations.set(spaceId, Symbol(spaceId)); this.inFlight.set(spaceId, new Set())
      } catch (error) {
        if ((this.epochs.get(spaceId) ?? 0) === epoch) await this.options.store.close(spaceId)
        throw error
      }
    })()
    this.openings.set(spaceId, opening)
    try { await opening } finally { this.openings.delete(spaceId) }
  }
  async close(spaceId: string): Promise<void> {
    const existing = this.closings.get(spaceId)
    if (existing) return existing
    this.stopped.add(spaceId); this.epochs.set(spaceId, (this.epochs.get(spaceId) ?? 0) + 1)
    this.opened.delete(spaceId); this.generations.delete(spaceId); this.inFlight.delete(spaceId)
    // Old queued work is fenced; only storage, never unbounded provider calls, must drain.
    this.queues.delete(spaceId)
    const closing = (async () => {
      await this.openings.get(spaceId)?.catch(() => {})
      await this.commits.get(spaceId)?.catch(() => {})
      await this.options.store.close(spaceId)
    })()
    this.closings.set(spaceId, closing)
    try { await closing } finally { this.closings.delete(spaceId) }
  }
  private snapshot<T extends ReadContext>(ctx: T): T {
    this.entry(ctx)
    const p = ctx.principal
    return { ...ctx, principal: p.kind === 'provider' ? { ...p, on: { ...p.on } } : { ...p } }
  }
  private stable(p: Principal): void {
    if (!isPrincipal(p)) fail('COLLAB_FORBIDDEN')
    if (p.kind === 'provider' && !this.options.providers.some(x => x.id === p.providerId && x.channel === p.on.channel)) fail('COLLAB_FORBIDDEN')
    if (p.kind === 'internal' && p.purpose !== 'host-index') fail('COLLAB_FORBIDDEN')
    if (p.kind === 'manager' && !this.managerProvider(p.providerId)) fail('COLLAB_FORBIDDEN')
  }
  /** Principal check plus the guard requirement, before any provider call. */
  private entry(ctx: ReadContext): void {
    this.stable(ctx.principal)
    const p = ctx.principal
    const managedChannel = p.kind === 'manager' || ((p.kind === 'agent' || p.kind === 'provider') && this.options.providers.some(x => x.managed === true && x.channel === (p.kind === 'agent' ? p.channel : p.on.channel)))
    if (managedChannel && typeof ctx.guard !== 'function') fail('COLLAB_FORBIDDEN')
  }
  /** Synchronous linearization check; callers must not await between it and the commit or return. */
  private guard(ctx: ReadContext): void {
    if (ctx.guard === undefined) return
    let valid = false
    try { valid = ctx.guard() === true } catch { valid = false }
    if (!valid) fail('COLLAB_CALLER_STALE')
  }
  private managerProvider(providerId: string): ChannelProvider | undefined { return this.options.providers.find(x => x.id === providerId && x.managed === true) }
  /** Current and retired bindings both occupy an address forever. */
  private addressTaken(s: SpaceState, b: Address): boolean {
    return Object.values(s.members).some(m => [m.binding, ...(m.previousBindings ?? [])].some(x => x.channel === b.channel && x.address === b.address))
  }
  private address(p: Principal): Address { if (p.kind === 'internal' || p.kind === 'manager') return fail('COLLAB_FORBIDDEN'); return p.kind === 'agent' ? p : p.on }
  private state(spaceId: string): SpaceState {
    const state = this.states.get(spaceId); if (!state) fail('COLLAB_SPACE_NOT_FOUND')
    if (this.failed.has(spaceId) || !this.opened.has(spaceId)) fail('COLLAB_STORE_FAILED')
    return state
  }
  private lookup(s: SpaceState, p: Principal): Member {
    const a = this.address(p), m = Object.values(s.members).find(m => m.binding.channel === a.channel && m.binding.address === a.address)
    return m ?? fail('COLLAB_NOT_MEMBER')
  }
  private receipt(ctx: CommandContext, scope: ReceiptScope, hash: string): CommandResult | undefined {
    for (const r of this.records.get(ctx.spaceId) ?? []) if (r.kind === 'command' && r.receipt.cmdId === ctx.cmdId && canonical(r.receipt.scope) === canonical(scope)) {
      if (r.receipt.payloadHash !== hash) fail('COLLAB_CMD_CONFLICT'); return structuredClone(r.receipt.result)
    }
  }
  private async persist(spaceId: string, record: CommitRecord): Promise<void> {
    if (!this.opened.has(spaceId) || this.failed.has(spaceId)) fail('COLLAB_STORE_FAILED')
    const committing = (async () => {
      try {
        await this.options.store.commit(spaceId, record, (this.records.get(spaceId)?.at(-1)?.seq ?? 0))
        const state = reduce(this.states.get(spaceId), record)
        if (state) this.states.set(spaceId, state)
        this.records.set(spaceId, [...(this.records.get(spaceId) ?? []), structuredClone(record)])
      } catch (error) {
        this.failed.add(spaceId)
        if (error instanceof CollabError && error.code === 'COLLAB_STORE_CONFLICT') throw error
        fail('COLLAB_STORE_FAILED')
      }
    })()
    this.commits.set(spaceId, committing)
    try { await committing } finally { this.commits.delete(spaceId) }
  }
  /** One sample per member name, tied to the exact binding it was taken for. */
  private async samplePresence(members: Member[]): Promise<{ presence: Record<string, Presence>; bindings: Record<string, Address> }> {
    const unique = [...new Map(members.map(member => [member.name, member])).values()]
    const sampled = await Promise.all(unique.map(async member => {
      const provider = this.options.providers.find(p => p.channel === member.binding.channel)
      let presence: Presence = 'unreachable'
      if (member.binding.supports.wake && provider) {
        try { presence = await provider.presence(structuredClone(member)) } catch { presence = 'unreachable' }
      }
      return { name: member.name, presence, binding: { channel: member.binding.channel, address: member.binding.address } }
    }))
    return { presence: Object.fromEntries(sampled.map(x => [x.name, x.presence])), bindings: Object.fromEntries(sampled.map(x => [x.name, x.binding])) }
  }
  private launchDispatch(spaceId: string, events: CollabEvent[], generation: symbol): void {
    if (this.generations.get(spaceId) !== generation || !this.opened.has(spaceId) || this.failed.has(spaceId)) return
    const state = this.states.get(spaceId)!
    for (const event of events) {
      if (event.type !== 'dispatch/intended') continue
      const delivery = event.delivery, member = structuredClone(state.members[delivery.member]!)
      const provider = this.options.providers.find(p => p.id === delivery.providerId)
      this.inFlight.get(spaceId)!.add(delivery.deliveryId)
      // Never await SPI in the serial queue; a hung provider must not block commands or close.
      void (async () => {
        const completed: DispatchCompletedEvent = { type: 'dispatch/completed', actor: 'system:dispatch', deliveryId: delivery.deliveryId, outcome: 'succeeded' }
        try {
          if (!provider) throw new Error('provider unavailable')
          await provider.deliver(member, structuredClone(delivery.pointer!))
        } catch { completed.outcome = 'failed' }
        try {
          await this.enqueue(spaceId, async () => {
            if (this.generations.get(spaceId) !== generation || !this.opened.has(spaceId) || this.failed.has(spaceId)) return
            const current = this.states.get(spaceId)!
            if (current.status === 'closed' || current.deliveries[delivery.deliveryId]?.outcome) return
            await this.persist(spaceId, { kind: 'completion', seq: current.lastSeq + 1, events: [completed] })
          })
        } catch { /* persist marks the space failed; recovery trusts the durable log. */ }
        finally { if (this.generations.get(spaceId) === generation) this.inFlight.get(spaceId)?.delete(delivery.deliveryId) }
      })()
    }
  }
  private authorize(name: CommandName, s: SpaceState, p: Principal, m: Member | undefined): void {
    const rule = authorization[name]
    if (p.kind === 'internal' || p.kind === 'manager' || !m) fail('COLLAB_FORBIDDEN')
    // A managed member's entry and exit belong to its integrator.
    if (m.managedBy !== undefined && (name === 'join' || name === 'declineInvite' || name === 'leave')) fail('COLLAB_FORBIDDEN')
    if (m.status !== (rule === 'invited' ? 'invited' : 'active')) fail('COLLAB_MEMBER_INACTIVE')
    if (rule === 'leader' && s.leader !== m.name) fail('COLLAB_FORBIDDEN')
  }
  private async command(ctx: CommandContext, name: Exclude<CommandName, 'createSpace' | ManagerCommand>, input: unknown, decide: (s: SpaceState, actor: string, member: Member | undefined) => CollabEvent[] | Promise<CollabEvent[]>, replay?: (s: SpaceState, actor: string) => CommandResult | undefined, prepare?: () => Promise<Member[]>): Promise<CommandResult> {
    this.entry(ctx)
    // Internal principals never run member commands; reject before prepare,
    // provider claim, presence sampling or any space-state check.
    if (ctx.principal.kind === 'internal' || ctx.principal.kind === 'manager') fail('COLLAB_FORBIDDEN')
    if (this.failed.has(ctx.spaceId) || this.stopped.has(ctx.spaceId)) fail('COLLAB_STORE_FAILED')
    const generation = this.generations.get(ctx.spaceId)
    const extraMembers = await prepare?.() ?? []
    const samples = await this.samplePresence([...Object.values(this.states.get(ctx.spaceId)?.members ?? {}), ...extraMembers])
    let dispatch: CollabEvent[] = []
    const response = await this.enqueue(ctx.spaceId, async () => {
      if (generation !== this.generations.get(ctx.spaceId)) fail('COLLAB_STORE_FAILED')
      const s = this.state(ctx.spaceId), p = ctx.principal
      if (!ctx.cmdId || typeof ctx.cmdId !== 'string') fail('COLLAB_BAD_CMD_ID')
      const m = this.lookup(s, p)
      const scope: ReceiptScope = { kind: 'member', name: m.name }
      const hash = createHash('sha256').update(canonical({ name, input })).digest('hex')
      const old = this.receipt(ctx, scope, hash); if (old) { this.guard(ctx); return old }
      if (s.status === 'closed') fail('COLLAB_SPACE_CLOSED')
      this.authorize(name, s, p, m)
      const actor = m.name
      const original = replay?.(s, actor)
      const business = original ? [] : await decide(s, actor, m)
      if (generation !== this.generations.get(ctx.spaceId)) fail('COLLAB_STORE_FAILED')
      const events = decideDispatch(s, business, { ...samples, providers: new Map(this.options.providers.map(p => [p.channel, p.id])) }), result: CommandResult = original ?? { seq: s.lastSeq + 1, spaceId: s.spaceId }
      const item = events.find(e => e.type === 'item/created'); if (item?.type === 'item/created') result.itemId = item.item.id
      const record: CommitRecord = { kind: 'command', seq: s.lastSeq + 1, events, receipt: { cmdId: ctx.cmdId, scope, payloadHash: hash, result } }
      this.checkTopicLimit(s, record)
      this.guard(ctx)
      await this.persist(ctx.spaceId, record)
      dispatch = events
      return structuredClone(result)
    })
    if (generation) this.launchDispatch(ctx.spaceId, dispatch, generation)
    return response
  }
  /** Fold the tentative record through the same reduce used on replay; a counted message may not exceed its topic's limit. */
  private checkTopicLimit(s: SpaceState, record: CommitRecord): void {
    if (!record.events.some(e => e.type === 'message/sent')) return
    const tentative = reduce(s, record)!, root = tentative.topicOf[record.seq]!
    const before = s.topicWakes[root] ?? 0
    // Only a message that this commit counts can be refused; a non-waking one never is.
    if ((tentative.topicWakes[root] ?? 0) > before && before >= TOPIC_LIMIT) fail('COLLAB_THREAD_LIMIT')
  }
  /** `ref` must name an existing message seq or item creation seq of this space; no coercion. */
  private checkRef(s: SpaceState, ref: unknown): void {
    if (ref === undefined) return
    if (typeof ref !== 'number' || !Number.isSafeInteger(ref) || ref < 1 || !Object.hasOwn(s.topicOf, ref)) fail('COLLAB_BAD_REF')
  }
  /** Two-phase manager pipeline: claim outside the queue at most once, then decide everything again from current state. */
  private async managerCommand(ctx: CommandContext, name: ManagerCommand, input: unknown, decide: (s: SpaceState, actor: string, channel: string, claimed: Binding | undefined) => CollabEvent[], claimAddress?: unknown): Promise<CommandResult> {
    this.entry(ctx)
    const p = ctx.principal
    if (p.kind !== 'manager') fail('COLLAB_FORBIDDEN')
    const provider = this.managerProvider(p.providerId)!, channel = provider.channel
    if (this.failed.has(ctx.spaceId) || this.stopped.has(ctx.spaceId)) fail('COLLAB_STORE_FAILED')
    const generation = this.generations.get(ctx.spaceId)
    const scope: ReceiptScope = { kind: 'manager', channel }
    const hash = createHash('sha256').update(canonical({ name, input })).digest('hex')
    let claimed: Binding | undefined
    const hasReceipt = (this.records.get(ctx.spaceId) ?? []).some(r => r.kind === 'command' && r.receipt.cmdId === ctx.cmdId && canonical(r.receipt.scope) === canonical(scope))
    if (claimAddress !== undefined && !hasReceipt) {
      try {
        const b = typeof claimAddress === 'string' ? await provider.claim(claimAddress, 'agent') : null
        if (b && b.channel === channel) claimed = structuredClone(b)
      } catch { /* no usable claim: COLLAB_ADDRESS_UNCLAIMED in the queue */ }
    }
    // Nothing decided above is trusted below except the claim result itself.
    return this.enqueue(ctx.spaceId, async () => {
      if (generation !== this.generations.get(ctx.spaceId)) fail('COLLAB_STORE_FAILED')
      const s = this.state(ctx.spaceId)
      if (!ctx.cmdId || typeof ctx.cmdId !== 'string') fail('COLLAB_BAD_CMD_ID')
      const old = this.receipt(ctx, scope, hash); if (old) { this.guard(ctx); return old }
      // Authorization before closure: an unauthorized integrator learns nothing about the space.
      if (!s.managers.includes(channel)) fail('COLLAB_NOT_MEMBER')
      if (s.status === 'closed') fail('COLLAB_SPACE_CLOSED')
      const events = decide(s, `manager:${channel}`, channel, claimed)
      const result: CommandResult = { seq: s.lastSeq + 1, spaceId: s.spaceId }
      this.guard(ctx)
      await this.persist(ctx.spaceId, { kind: 'command', seq: s.lastSeq + 1, events, receipt: { cmdId: ctx.cmdId, scope, payloadHash: hash, result } })
      return structuredClone(result)
    })
  }
  private checkName(s: SpaceState, name: unknown): void {
    if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(name)) fail('COLLAB_BAD_NAME')
    if (Object.hasOwn(s.members, name)) fail('COLLAB_NAME_TAKEN')
  }
  private checkClaimed(s: SpaceState, claimed: Binding | undefined): Binding {
    if (!claimed) fail('COLLAB_ADDRESS_UNCLAIMED')
    if (this.addressTaken(s, claimed)) fail('COLLAB_ADDRESS_TAKEN')
    return claimed
  }
  /** Target of rebind/retire: an active member managed by this very channel. */
  private managedTarget(s: SpaceState, channel: string, name: unknown): Member {
    const m = typeof name === 'string' && Object.hasOwn(s.members, name) ? s.members[name]! : undefined
    if (!m || m.managedBy !== channel) fail('COLLAB_FORBIDDEN')
    if (m.status !== 'active') fail('COLLAB_MEMBER_INACTIVE')
    return m
  }
  /** Synchronous, inside the serial transaction: format, needsReply, and the recipient provider's support. */
  private checkMode(recipient: Member, mode: unknown, needsReply: boolean): void {
    if (typeof mode !== 'string' || !MODE_FORMAT.test(mode) || !needsReply) fail('COLLAB_BAD_MODE')
    const provider = this.options.providers.find(p => p.channel === recipient.binding.channel)
    let supported = false
    try { supported = provider?.supportsMode?.(mode) === true } catch { supported = false }
    if (!supported) fail('COLLAB_MODE_UNSUPPORTED')
  }
  private async claim(address: string, kind: MemberKind): Promise<Binding> {
    // Managed providers' addresses enter only through admitMember.
    const claimed = (await Promise.all(this.options.providers.filter(p => p.managed !== true).map(p => p.claim(address, kind)))).filter((b): b is Binding => b !== null)
    if (claimed.length > 1) fail('COLLAB_ADDRESS_AMBIGUOUS', { candidates: claimed.map(b => b.channel) })
    return claimed[0] ?? fail('COLLAB_ADDRESS_UNCLAIMED')
  }
  async createSpace(ctx: CommandContext, input: { name: string; address: string; kind: MemberKind; purpose?: string }): Promise<CommandResult> {
    ctx = this.snapshot(ctx); input = structuredClone(input)
    const a = this.address(ctx.principal)
    const epoch = this.epochs.get(ctx.spaceId) ?? 0
    const check = () => {
      if ((this.epochs.get(ctx.spaceId) ?? 0) !== epoch || this.stopped.has(ctx.spaceId) || this.failed.has(ctx.spaceId)) fail('COLLAB_STORE_FAILED')
    }
    check()
    return this.enqueue(ctx.spaceId, async () => {
      check()
      if (!ctx.cmdId || typeof ctx.cmdId !== 'string') fail('COLLAB_BAD_CMD_ID')
      const scope: ReceiptScope = { kind: 'create', channel: a.channel, address: a.address }, hash = createHash('sha256').update(canonical({ name: 'createSpace', input })).digest('hex')
      const old = this.receipt(ctx, scope, hash); if (old) { this.guard(ctx); return old }
      if (this.states.has(ctx.spaceId)) fail('COLLAB_SPACE_EXISTS')
      const spaces = await this.options.store.list()
      check()
      if (spaces.includes(ctx.spaceId)) fail('COLLAB_SPACE_EXISTS')
      const binding = await this.claim(input.address, input.kind)
      check()
      if (binding.channel !== a.channel || binding.address !== a.address) fail('COLLAB_FORBIDDEN')
      if (input.kind !== 'agent') fail('COLLAB_BAD_KIND')
      if (!/^[a-z][a-z0-9-]{0,31}$/.test(input.name)) fail('COLLAB_BAD_NAME')
      const purpose = input.purpose === undefined ? undefined : typeof input.purpose === 'string' ? input.purpose.trim() : fail('COLLAB_BAD_PURPOSE')
      if (purpose !== undefined && (/\p{Cc}/u.test(purpose) || [...purpose].length < 1 || [...purpose].length > 200)) fail('COLLAB_BAD_PURPOSE')
      if (!this.opened.has(ctx.spaceId)) await this.open(ctx.spaceId)
      check()
      const member: Member = { name: input.name, kind: input.kind, status: 'active', joinSeq: 1, binding, statusText: '', wakeCount: 0 }
      const convention = this.options.convention ?? defaultConvention
      const events: CollabEvent[] = [{ type: 'space/created', actor: input.name, spaceId: ctx.spaceId, serviceId: this.options.serviceId, leader: input.name, convention: { version: convention.version, sha256: convention.sha256 }, ...(purpose === undefined ? {} : { purpose }) }, { type: 'member/joined', actor: input.name, member }]
      const result = { seq: 1, spaceId: ctx.spaceId }
      this.guard(ctx)
      await this.persist(ctx.spaceId, { kind: 'command', seq: 1, events, receipt: { cmdId: ctx.cmdId, scope, payloadHash: hash, result } }); return result
    })
  }
  async invite(ctx: CommandContext, input: { name: string; address: string; kind: MemberKind }): Promise<CommandResult> {
    ctx = this.snapshot(ctx); input = structuredClone(input)
    let invited: Member | undefined, claimError: unknown
    return this.command(ctx, 'invite', input, (s, actor) => {
    if (input.kind !== 'agent') fail('COLLAB_BAD_KIND')
    if (!invited) throw claimError
    const binding = invited.binding
    this.checkName(s, input.name)
    if (this.addressTaken(s, binding)) fail('COLLAB_ADDRESS_TAKEN')
    return [{ type: 'member/invited', actor, member: invited }]
  }, undefined, async () => {
    try {
      const binding = await this.claim(input.address, input.kind)
      invited = { name: input.name, kind: input.kind, binding, status: 'invited', joinSeq: 0, statusText: '', wakeCount: 0 }
      return [invited]
    } catch (error) { claimError = error; return [] }
  }) }
  async join(ctx: CommandContext): Promise<CommandResult> { ctx = this.snapshot(ctx); return this.command(ctx, 'join', undefined, (s, actor, member) => [{ type: 'member/joined', actor, member: { ...member!, status: 'active', joinSeq: s.lastSeq + 1 } }]) }
  async declineInvite(ctx: CommandContext): Promise<CommandResult> { ctx = this.snapshot(ctx); return this.command(ctx, 'declineInvite', undefined, (_s, actor) => [{ type: 'member/status', actor, name: actor, status: 'declined' }]) }
  async leave(ctx: CommandContext): Promise<CommandResult> { ctx = this.snapshot(ctx); return this.command(ctx, 'leave', undefined, (s, actor) => {
    const events: CollabEvent[] = [{ type: 'member/status', actor, name: actor, status: 'gone' }]
    if (s.leader === actor) {
      const next = Object.values(s.members).filter(m => m.name !== actor && m.status === 'active' && m.managedBy === undefined).sort((a, b) => a.joinSeq - b.joinSeq)[0]
      events.push(next ? { type: 'leader/changed', actor, leader: next.name } : { type: 'space/closed', actor })
    }
    return events
  }) }
  private otherActive(s: SpaceState, actor: string, name: string): void { if (name === actor || s.members[name]?.status !== 'active') fail('COLLAB_FORBIDDEN') }
  async markGone(ctx: CommandContext, input: { member: string }): Promise<CommandResult> { ctx = this.snapshot(ctx); input = structuredClone(input); return this.command(ctx, 'markGone', input, (s, actor) => { this.otherActive(s, actor, input.member); return [{ type: 'member/status', actor, name: input.member, status: 'gone' }] }) }
  async transferLeader(ctx: CommandContext, input: { member: string }): Promise<CommandResult> { ctx = this.snapshot(ctx); input = structuredClone(input); return this.command(ctx, 'transferLeader', input, (s, actor) => { this.otherActive(s, actor, input.member); if (s.members[input.member]!.managedBy !== undefined) fail('COLLAB_FORBIDDEN'); return [{ type: 'leader/changed', actor, leader: input.member }] }) }
  async closeSpace(ctx: CommandContext): Promise<CommandResult> { ctx = this.snapshot(ctx); return this.command(ctx, 'closeSpace', undefined, (_s, actor) => [{ type: 'space/closed', actor }]) }
  async createItem(ctx: CommandContext, input: CreateItemInput): Promise<CommandResult> { ctx = this.snapshot(ctx); input = cloneInput(input); return this.command(ctx, 'createItem', input, (s, actor) => {
    rejectDeciders(input)
    checkFields(s, input)
    if (!['charter', 'request', 'other'].includes(input.kind)) fail('COLLAB_BAD_ITEM', { field: 'kind' })
    if (input.kind === 'request' && (!Object.hasOwn(s.members, input.assignee) || s.members[input.assignee]!.status !== 'active')) fail('COLLAB_BAD_ITEM', { field: 'assignee' })
    if (typeof input.itemId !== 'string' || !input.itemId || Object.hasOwn(s.items, input.itemId)) fail('COLLAB_BAD_ITEM', { field: 'itemId' })
    checkExt(input.ext)
    this.checkRef(s, input.ref)
    const base = { id: input.itemId, author: actor, title: input.title, body: input.body, requiredAcks: [...input.requiredAcks], revision: 1, status: 'draft' as const, acks: {}, ...(input.ref === undefined ? {} : { ref: input.ref }), ...(input.ext === undefined ? {} : { ext: input.ext }) }
    const item: Item = input.kind === 'request' ? { ...base, kind: 'request', assignee: input.assignee, progress: 'open' } : { ...base, kind: input.kind }
    return [{ type: 'item/created', actor, item }]
  }) }
  async reviseItem(ctx: CommandContext, input: ReviseItemInput): Promise<CommandResult> { ctx = this.snapshot(ctx); input = structuredClone(input); return this.command(ctx, 'reviseItem', input, (s, actor) => {
    const current = checkedItem(s, input.itemId, 'reviseItem'); checkRevision(current, input.expectedRevision)
    if (!input.changes || typeof input.changes !== 'object') fail('COLLAB_BAD_ITEM', { field: 'changes' })
    rejectDeciders(input.changes)
    if (Object.keys(input.changes).some(k => !['title', 'body', 'requiredAcks'].includes(k))) fail('COLLAB_BAD_ITEM', { field: 'changes' })
    // Inert legacy fields (deciders, agentEditCount) and ref are carried through unchanged.
    const item: Item = { ...structuredClone(current), ...input.changes, revision: current.revision + 1, status: 'draft', acks: {} }
    checkFields(s, item)
    return [{ type: 'item/revised', actor, item }]
  }) }
  async ackItem(ctx: CommandContext, input: { itemId: string; revision: number }): Promise<CommandResult> { ctx = this.snapshot(ctx); input = structuredClone(input); return this.command(ctx, 'ackItem', input, (s, actor) => {
    const item = structuredClone(checkedItem(s, input.itemId, 'ackItem')); checkRevision(item, input.revision)
    item.acks[actor] = item.revision
    if (item.requiredAcks.length && item.requiredAcks.every(n => item.acks[n] === item.revision)) item.status = 'agreed'
    return [{ type: 'item/acked', actor, item }]
  }) }
  async sendMessage(ctx: CommandContext, input: { to: string; body: string; needsReply?: boolean; ref?: number; ext?: Ext; mode?: string }): Promise<CommandResult> { ctx = this.snapshot(ctx); input = cloneInput(input); return this.command(ctx, 'sendMessage', input, (s, actor) => {
    if (input.to === actor || !Object.hasOwn(s.members, input.to) || s.members[input.to]!.status !== 'active') fail('COLLAB_BAD_RECIPIENT')
    if (typeof input.body !== 'string' || Buffer.byteLength(input.body) < 1 || Buffer.byteLength(input.body) > 16384 || (input.needsReply !== undefined && typeof input.needsReply !== 'boolean')) fail('COLLAB_BAD_MESSAGE')
    checkExt(input.ext)
    this.checkRef(s, input.ref)
    if (input.mode !== undefined) this.checkMode(s.members[input.to]!, input.mode, input.needsReply === true)
    return [{ type: 'message/sent', actor, message: { id: `${s.lastSeq + 1}`, actor, to: input.to, body: input.body, needsReply: input.needsReply === undefined ? false : input.needsReply, ...(input.ref === undefined ? {} : { ref: input.ref }), ...(input.ext === undefined ? {} : { ext: input.ext }), ...(input.mode === undefined ? {} : { mode: input.mode }) } }]
  }) }
  async setStatus(ctx: CommandContext, input: { text: string }): Promise<CommandResult> { ctx = this.snapshot(ctx); input = structuredClone(input); return this.command(ctx, 'setStatus', input, (_s, actor) => { if (typeof input.text !== 'string' || input.text.length > 500) fail('COLLAB_BAD_STATUS'); return [{ type: 'member/statusText', actor, name: actor, text: input.text }] }) }
  async advanceRequest(ctx: CommandContext, input: { itemId: string; progress: Progress }): Promise<CommandResult> { ctx = this.snapshot(ctx); input = structuredClone(input); return this.command(ctx, 'advanceRequest', input, (s, actor) => {
    const item = s.items[input.itemId]
    if (item?.kind !== 'request' || !Object.hasOwn(s.items, input.itemId) || item.assignee !== actor) fail('COLLAB_FORBIDDEN')
    checkedItem(s, input.itemId, 'advanceRequest')
    const transitions: Record<Progress, Progress[]> = { open: ['accepted', 'rejected'], accepted: ['done', 'rejected'], done: [], rejected: [] }
    if (!transitions[item.progress].includes(input.progress)) fail('COLLAB_BAD_TRANSITION')
    return [{ type: 'request/progressed', actor, itemId: item.id, progress: input.progress }]
  }) }
  async allowManager(ctx: CommandContext, input: { channel: string }): Promise<CommandResult> { ctx = this.snapshot(ctx); input = structuredClone(input); return this.command(ctx, 'allowManager', input, (s, actor) => {
    const channel = input.channel
    const valid = typeof channel === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(channel) && this.options.providers.some(p => p.managed === true && p.channel === channel)
    if (!valid || s.managers.includes(channel)) fail('COLLAB_BAD_CHANNEL')
    return [{ type: 'manager/allowed', actor, channel }]
  }) }
  async revokeManager(ctx: CommandContext, input: { channel: string }): Promise<CommandResult> { ctx = this.snapshot(ctx); input = structuredClone(input); return this.command(ctx, 'revokeManager', input, (s, actor) => {
    const channel = input.channel
    if (typeof channel !== 'string' || !s.managers.includes(channel)) fail('COLLAB_BAD_CHANNEL')
    // Retire in the same commit: no active member may outlive its manager's grant.
    const retired = Object.values(s.members).filter(m => m.managedBy === channel && m.status === 'active')
    return [{ type: 'manager/revoked', actor, channel }, ...retired.map(m => ({ type: 'member/status' as const, actor, name: m.name, status: 'gone' as const }))]
  }) }
  async admitMember(ctx: CommandContext, input: { name: string; address: string }): Promise<CommandResult> { ctx = this.snapshot(ctx); input = structuredClone(input); return this.managerCommand(ctx, 'admitMember', input, (s, actor, channel, claimed) => {
    const binding = claimed ?? fail('COLLAB_ADDRESS_UNCLAIMED')
    this.checkName(s, input.name)
    this.checkClaimed(s, binding)
    const member: Member = { name: input.name, kind: 'agent', status: 'active', joinSeq: s.lastSeq + 1, binding, statusText: '', wakeCount: 0, managedBy: channel }
    return [{ type: 'member/joined', actor, member }]
  }, input.address) }
  async rebindMember(ctx: CommandContext, input: { member: string; address: string }): Promise<CommandResult> { ctx = this.snapshot(ctx); input = structuredClone(input); return this.managerCommand(ctx, 'rebindMember', input, (s, actor, channel, claimed) => {
    const target = this.managedTarget(s, channel, input.member)
    return [{ type: 'member/rebound', actor, name: target.name, binding: this.checkClaimed(s, claimed) }]
  }, input.address) }
  async retireMember(ctx: CommandContext, input: { member: string }): Promise<CommandResult> { ctx = this.snapshot(ctx); input = structuredClone(input); return this.managerCommand(ctx, 'retireMember', input, (s, actor, channel) => {
    const target = this.managedTarget(s, channel, input.member)
    return [{ type: 'member/status', actor, name: target.name, status: 'gone' }]
  }) }
  private readState(ctx: ReadContext): SpaceState { this.entry(ctx); const s = this.state(ctx.spaceId); if (ctx.principal.kind !== 'internal' && this.lookup(s, ctx.principal).status !== 'active') fail('COLLAB_MEMBER_INACTIVE'); return s }
  async overview(ctx: ReadContext): Promise<Overview> {
    ctx = this.snapshot(ctx)
    const generation = this.generations.get(ctx.spaceId)
    const observed = await this.samplePresence(Object.values(this.readState(ctx).members))
    if (this.generations.get(ctx.spaceId) !== generation) fail('COLLAB_STORE_FAILED')
    const s = structuredClone(this.readState(ctx))
    // A sample taken for an older binding says nothing about the current one.
    const presence: Overview['presence'] = Object.fromEntries(Object.values(s.members).map(m => {
      const b = Object.hasOwn(observed.bindings, m.name) ? observed.bindings[m.name] : undefined
      return [m.name, b && b.channel === m.binding.channel && b.address === m.binding.address ? observed.presence[m.name]! : 'unknown']
    }))
    const active = this.inFlight.get(ctx.spaceId) ?? new Set<string>()
    const unfinished = Object.values(s.deliveries).filter(d => !d.outcome)
    this.guard(ctx)
    return { ...s, pendingDeliveries: unfinished.filter(d => !active.has(d.deliveryId)), inFlightDeliveries: unfinished.filter(d => active.has(d.deliveryId)), presence }
  }
  async readSince(ctx: ReadContext, seq: number): Promise<CommitRecord[]> { this.readState(ctx); if (!Number.isInteger(seq) || seq < 0) fail('COLLAB_BAD_SEQ'); this.guard(ctx); return structuredClone((this.records.get(ctx.spaceId) ?? []).filter(r => r.seq > seq)) }
  async project(ctx: ReadContext): Promise<string> {
    ctx = this.snapshot(ctx)
    const s = await this.overview(ctx)
    // overview checked the guard before its own return; project resumes after that await, so check again.
    this.guard(ctx)
    return this.options.project?.(s) ?? project(s, s.presence)
  }
  async readConvention(ctx: ReadContext, version: string): Promise<string> {
    this.readState(ctx)
    const custom = this.options.convention
    if (custom) { if (custom.version !== version) fail('COLLAB_CONVENTION_UNKNOWN'); this.guard(ctx); return custom.text }
    // Spaces keep the version recorded at creation; every published version stays readable.
    if (!Object.hasOwn(conventions, version)) fail('COLLAB_CONVENTION_UNKNOWN')
    this.guard(ctx)
    return conventions[version]!.text
  }
}
