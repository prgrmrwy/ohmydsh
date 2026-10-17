import { createHash } from 'node:crypto'
import { authorization, isPrincipal, type CommandName, type Principal } from '../auth/index.js'
import { reduce } from '../domain/reduce.js'
import { decideDispatch } from '../domain/decide.js'
import { CollabError, BREAKER_LIMIT, type DispatchCompletedEvent, type Presence } from '../model/index.js'
import { checkedItem, checkFields, checkRevision } from '../domain/items.js'
import { fail, ESCALATE_AFTER, type Address, type Binding, type CollabEvent, type CommandResult, type CommitRecord, type CreateItemInput, type Item, type Member, type MemberKind, type Overview, type Progress, type ReceiptScope, type ReviseItemInput, type SpaceState } from '../model/index.js'
import type { ChannelProvider } from '../spi/index.js'
import type { CollabStore } from '../store/interface.js'
import { defaultConvention } from '../convention/index.js'
import { project } from '../projection/index.js'
export interface ReadContext { principal: Principal; spaceId: string }
export interface CommandContext extends ReadContext { cmdId: string }
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
    this.stable(ctx.principal)
    const p = ctx.principal
    return { ...ctx, principal: p.kind === 'provider' ? { ...p, on: { ...p.on } } : { ...p } }
  }
  private stable(p: Principal): void {
    if (!isPrincipal(p)) fail('COLLAB_FORBIDDEN')
    if (p.kind === 'provider' && !this.options.providers.some(x => x.id === p.providerId && x.channel === p.on.channel)) fail('COLLAB_FORBIDDEN')
    if (p.kind === 'internal' && p.purpose !== 'breaker-reset') fail('COLLAB_FORBIDDEN')
  }
  private address(p: Principal): Address { if (p.kind === 'internal') return fail('COLLAB_FORBIDDEN'); return p.kind === 'agent' ? p : p.on }
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
  private async samplePresence(members: Member[]): Promise<Record<string, Presence>> {
    const unique = [...new Map(members.map(member => [member.name, member])).values()]
    return Object.fromEntries(await Promise.all(unique.map(async member => {
      const provider = this.options.providers.find(p => p.channel === member.binding.channel)
      let presence: Presence = 'unreachable'
      if (member.binding.supports.wake && provider) {
        try { presence = await provider.presence(structuredClone(member)) } catch { presence = 'unreachable' }
      }
      return [member.name, presence] as const
    })))
  }
  private launchDispatch(spaceId: string, events: CollabEvent[], generation: symbol): void {
    if (this.generations.get(spaceId) !== generation || !this.opened.has(spaceId) || this.failed.has(spaceId)) return
    const state = this.states.get(spaceId)!
    for (const event of events) {
      if (event.type !== 'dispatch/intended') continue
      const delivery = event.delivery, member = structuredClone(state.members[delivery.member]!)
      const provider = this.options.providers.find(p => p.id === delivery.providerId)
      const request = delivery.requestId ? structuredClone(state.requests[delivery.requestId]!) : undefined
      this.inFlight.get(spaceId)!.add(delivery.deliveryId)
      // Never await SPI in the serial queue; a hung provider must not block commands or close.
      void (async () => {
        const completed: DispatchCompletedEvent = { type: 'dispatch/completed', actor: 'system:dispatch', deliveryId: delivery.deliveryId, outcome: 'succeeded' }
        try {
          if (!provider) throw new Error('provider unavailable')
          if (delivery.kind === 'wake') await provider.deliver(member, structuredClone(delivery.pointer!))
          else {
            const result = await provider.requestConfirmation(member, request!, delivery.deliveryId)
            if (typeof result?.messageRef !== 'string' || !result.messageRef) throw new Error('missing messageRef')
            completed.messageRef = result.messageRef
          }
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
    if (rule === 'internal') { if (p.kind !== 'internal' || p.purpose !== 'breaker-reset') fail('COLLAB_FORBIDDEN'); return }
    if (!m) fail('COLLAB_FORBIDDEN')
    if (m.status !== (rule === 'invited' ? 'invited' : 'active')) fail('COLLAB_MEMBER_INACTIVE')
    if (rule === 'leader' && s.leader !== m.name) fail('COLLAB_FORBIDDEN')
    if (rule === 'human-provider' && (p.kind !== 'provider' || m.kind !== 'human')) fail('COLLAB_FORBIDDEN')
  }
  private async command(ctx: CommandContext, name: Exclude<CommandName, 'createSpace'>, input: unknown, decide: (s: SpaceState, actor: string, member: Member | undefined) => CollabEvent[] | Promise<CollabEvent[]>, replay?: (s: SpaceState, actor: string) => CommandResult | undefined, prepare?: () => Promise<Member[]>): Promise<CommandResult> {
    this.stable(ctx.principal)
    if (this.failed.has(ctx.spaceId) || this.stopped.has(ctx.spaceId)) fail('COLLAB_STORE_FAILED')
    const generation = this.generations.get(ctx.spaceId)
    const extraMembers = await prepare?.() ?? []
    const presence = await this.samplePresence([...Object.values(this.states.get(ctx.spaceId)?.members ?? {}), ...extraMembers])
    let dispatch: CollabEvent[] = []
    const response = await this.enqueue(ctx.spaceId, async () => {
      if (generation !== this.generations.get(ctx.spaceId)) fail('COLLAB_STORE_FAILED')
      const s = this.state(ctx.spaceId), p = ctx.principal
      if (!ctx.cmdId || typeof ctx.cmdId !== 'string') fail('COLLAB_BAD_CMD_ID')
      const m = p.kind === 'internal' ? undefined : this.lookup(s, p)
      const scope: ReceiptScope = p.kind === 'internal' ? { kind: 'internal', purpose: p.purpose } : { kind: 'member', name: m!.name }
      const hash = createHash('sha256').update(canonical({ name, input })).digest('hex')
      const old = this.receipt(ctx, scope, hash); if (old) return old
      if (s.status === 'closed') fail('COLLAB_SPACE_CLOSED')
      if (p.kind === 'internal' && name !== 'resetBreaker') fail('COLLAB_FORBIDDEN')
      this.authorize(name, s, p, m)
      const actor = m?.name ?? `internal:${p.kind === 'internal' ? p.purpose : ''}`
      const original = replay?.(s, actor)
      const business = original ? [] : await decide(s, actor, m)
      if (generation !== this.generations.get(ctx.spaceId)) fail('COLLAB_STORE_FAILED')
      const events = decideDispatch(s, business, { presence, providers: new Map(this.options.providers.map(p => [p.channel, p.id])) }), result: CommandResult = original ?? { seq: s.lastSeq + 1, spaceId: s.spaceId }
      const item = events.find(e => e.type === 'item/created'); if (item?.type === 'item/created') result.itemId = item.item.id
      const request = events.find(e => e.type === 'decision/requested'); if (request?.type === 'decision/requested') result.requestId = request.request.id
      await this.persist(ctx.spaceId, { kind: 'command', seq: s.lastSeq + 1, events, receipt: { cmdId: ctx.cmdId, scope, payloadHash: hash, result } })
      dispatch = events
      return structuredClone(result)
    })
    if (generation) this.launchDispatch(ctx.spaceId, dispatch, generation)
    return response
  }
  private async claim(address: string, kind: MemberKind): Promise<Binding> {
    const claimed = (await Promise.all(this.options.providers.map(p => p.claim(address, kind)))).filter((b): b is Binding => b !== null)
    if (claimed.length > 1) fail('COLLAB_ADDRESS_AMBIGUOUS', { candidates: claimed.map(b => b.channel) })
    return claimed[0] ?? fail('COLLAB_ADDRESS_UNCLAIMED')
  }
  async createSpace(ctx: CommandContext, input: { name: string; address: string; kind: MemberKind }): Promise<CommandResult> {
    ctx = this.snapshot(ctx); input = structuredClone(input)
    this.stable(ctx.principal); const a = this.address(ctx.principal)
    const epoch = this.epochs.get(ctx.spaceId) ?? 0
    const check = () => {
      if ((this.epochs.get(ctx.spaceId) ?? 0) !== epoch || this.stopped.has(ctx.spaceId) || this.failed.has(ctx.spaceId)) fail('COLLAB_STORE_FAILED')
    }
    check()
    return this.enqueue(ctx.spaceId, async () => {
      check()
      if (!ctx.cmdId || typeof ctx.cmdId !== 'string') fail('COLLAB_BAD_CMD_ID')
      const scope: ReceiptScope = { kind: 'create', channel: a.channel, address: a.address }, hash = createHash('sha256').update(canonical({ name: 'createSpace', input })).digest('hex')
      const old = this.receipt(ctx, scope, hash); if (old) return old
      if (this.states.has(ctx.spaceId)) fail('COLLAB_SPACE_EXISTS')
      const spaces = await this.options.store.list()
      check()
      if (spaces.includes(ctx.spaceId)) fail('COLLAB_SPACE_EXISTS')
      const binding = await this.claim(input.address, input.kind)
      check()
      if (binding.channel !== a.channel || binding.address !== a.address) fail('COLLAB_FORBIDDEN')
      if (ctx.principal.kind === 'agent' && input.kind !== 'agent') fail('COLLAB_BAD_KIND')
      if (!/^[a-z][a-z0-9-]{0,31}$/.test(input.name)) fail('COLLAB_BAD_NAME')
      if (!this.opened.has(ctx.spaceId)) await this.open(ctx.spaceId)
      check()
      const member: Member = { name: input.name, kind: input.kind, status: 'active', joinSeq: 1, binding, statusText: '', wakeCount: 0 }
      const convention = this.options.convention ?? defaultConvention
      const events: CollabEvent[] = [{ type: 'space/created', actor: input.name, spaceId: ctx.spaceId, serviceId: this.options.serviceId, leader: input.name, convention: { version: convention.version, sha256: convention.sha256 } }, { type: 'member/joined', actor: input.name, member }]
      const result = { seq: 1, spaceId: ctx.spaceId }
      await this.persist(ctx.spaceId, { kind: 'command', seq: 1, events, receipt: { cmdId: ctx.cmdId, scope, payloadHash: hash, result } }); return result
    })
  }
  async invite(ctx: CommandContext, input: { name: string; address: string; kind: MemberKind }): Promise<CommandResult> {
    ctx = this.snapshot(ctx); input = structuredClone(input)
    let invited: Member | undefined, claimError: unknown
    return this.command(ctx, 'invite', input, (s, actor) => {
    if (!invited) throw claimError
    const binding = invited.binding
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(input.name)) fail('COLLAB_BAD_NAME')
    if (Object.hasOwn(s.members, input.name)) fail('COLLAB_NAME_TAKEN')
    if (Object.values(s.members).some(m => m.binding.channel === binding.channel && m.binding.address === binding.address)) fail('COLLAB_ADDRESS_TAKEN')
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
      const next = Object.values(s.members).filter(m => m.name !== actor && m.status === 'active').sort((a, b) => a.joinSeq - b.joinSeq)[0]
      events.push(next ? { type: 'leader/changed', actor, leader: next.name } : { type: 'space/closed', actor })
    }
    return events
  }) }
  private otherActive(s: SpaceState, actor: string, name: string): void { if (name === actor || s.members[name]?.status !== 'active') fail('COLLAB_FORBIDDEN') }
  async markGone(ctx: CommandContext, input: { member: string }): Promise<CommandResult> { ctx = this.snapshot(ctx); input = structuredClone(input); return this.command(ctx, 'markGone', input, (s, actor) => { this.otherActive(s, actor, input.member); return [{ type: 'member/status', actor, name: input.member, status: 'gone' }] }) }
  async transferLeader(ctx: CommandContext, input: { member: string }): Promise<CommandResult> { ctx = this.snapshot(ctx); input = structuredClone(input); return this.command(ctx, 'transferLeader', input, (s, actor) => { this.otherActive(s, actor, input.member); return [{ type: 'leader/changed', actor, leader: input.member }] }) }
  async closeSpace(ctx: CommandContext): Promise<CommandResult> { ctx = this.snapshot(ctx); return this.command(ctx, 'closeSpace', undefined, (_s, actor) => [{ type: 'space/closed', actor }]) }
  async createItem(ctx: CommandContext, input: CreateItemInput): Promise<CommandResult> { ctx = this.snapshot(ctx); input = structuredClone(input); return this.command(ctx, 'createItem', input, (s, actor) => {
    checkFields(s, input)
    if (!['charter', 'request', 'other'].includes(input.kind)) fail('COLLAB_BAD_ITEM', { field: 'kind' })
    if (input.kind === 'request' && s.members[input.assignee]?.status !== 'active') fail('COLLAB_BAD_ITEM', { field: 'assignee' })
    if (!input.itemId || Object.hasOwn(s.items, input.itemId)) fail('COLLAB_BAD_ITEM', { field: 'itemId' })
    const base = { id: input.itemId, author: actor, title: input.title, body: input.body, requiredAcks: [...input.requiredAcks], deciders: [...input.deciders], revision: 1, status: 'draft' as const, acks: {}, agentEditCount: 0 }
    const item: Item = input.kind === 'request' ? { ...base, kind: 'request', assignee: input.assignee, progress: 'open' } : { ...base, kind: input.kind }
    return [{ type: 'item/created', actor, item }]
  }) }
  async reviseItem(ctx: CommandContext, input: ReviseItemInput): Promise<CommandResult> { ctx = this.snapshot(ctx); input = structuredClone(input); return this.command(ctx, 'reviseItem', input, (s, actor) => {
    const current = checkedItem(s, input.itemId, 'reviseItem'); checkRevision(current, input.expectedRevision)
    if (Object.keys(input.changes).some(k => !['title', 'body', 'requiredAcks', 'deciders'].includes(k))) fail('COLLAB_BAD_ITEM', { field: 'changes' })
    const item: Item = { ...structuredClone(current), ...input.changes, revision: current.revision + 1, status: 'draft', acks: {} }
    checkFields(s, item)
    if (s.members[actor]?.kind === 'agent') item.agentEditCount++
    if (item.agentEditCount > ESCALATE_AFTER) item.status = 'escalated'
    return [{ type: 'item/revised', actor, item }]
  }) }
  async ackItem(ctx: CommandContext, input: { itemId: string; revision: number }): Promise<CommandResult> { ctx = this.snapshot(ctx); input = structuredClone(input); return this.command(ctx, 'ackItem', input, (s, actor) => {
    const item = structuredClone(checkedItem(s, input.itemId, 'ackItem')); checkRevision(item, input.revision)
    item.acks[actor] = item.revision
    if (item.requiredAcks.length && item.requiredAcks.every(n => item.acks[n] === item.revision)) { item.status = 'agreed'; item.agentEditCount = 0 }
    return [{ type: 'item/acked', actor, item }]
  }) }
  async sendMessage(ctx: CommandContext, input: { to: string; body: string; needsReply?: boolean }): Promise<CommandResult> { ctx = this.snapshot(ctx); input = structuredClone(input); return this.command(ctx, 'sendMessage', input, (s, actor) => {
    if (input.to === actor || s.members[input.to]?.status !== 'active') fail('COLLAB_BAD_RECIPIENT')
    if (typeof input.body !== 'string' || Buffer.byteLength(input.body) < 1 || Buffer.byteLength(input.body) > 16384 || (input.needsReply !== undefined && typeof input.needsReply !== 'boolean')) fail('COLLAB_BAD_MESSAGE')
    return [{ type: 'message/sent', actor, message: { id: `${s.lastSeq + 1}`, actor, to: input.to, body: input.body, needsReply: input.needsReply === undefined ? false : input.needsReply } }]
  }) }
  async setStatus(ctx: CommandContext, input: { text: string }): Promise<CommandResult> { ctx = this.snapshot(ctx); input = structuredClone(input); return this.command(ctx, 'setStatus', input, (_s, actor) => { if (typeof input.text !== 'string' || input.text.length > 500) fail('COLLAB_BAD_STATUS'); return [{ type: 'member/statusText', actor, name: actor, text: input.text }] }) }
  async advanceRequest(ctx: CommandContext, input: { itemId: string; progress: Progress }): Promise<CommandResult> { ctx = this.snapshot(ctx); input = structuredClone(input); return this.command(ctx, 'advanceRequest', input, (s, actor) => {
    const item = s.items[input.itemId]
    if (item?.kind !== 'request' || item.assignee !== actor) fail('COLLAB_FORBIDDEN')
    const transitions: Record<Progress, Progress[]> = { open: ['accepted', 'rejected'], accepted: ['done', 'rejected'], done: [], rejected: [] }
    if (!transitions[item.progress].includes(input.progress)) fail('COLLAB_BAD_TRANSITION')
    return [{ type: 'request/progressed', actor, itemId: item.id, progress: input.progress }]
  }) }
  async requestDecision(ctx: CommandContext, input: { itemId: string; options: string[] }): Promise<CommandResult> { ctx = this.snapshot(ctx); input = structuredClone(input); return this.command(ctx, 'requestDecision', input, (s, actor) => {
    const item = checkedItem(s, input.itemId, 'requestDecision')
    if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 8 || new Set(input.options).size !== input.options.length || input.options.some(o => typeof o !== 'string' || !o.length || o.length > 100)) fail('COLLAB_BAD_OPTIONS')
    const deciders = Object.values(s.members).filter(m => m.status === 'active' && m.kind === 'human' && (!item.deciders.length || item.deciders.includes(m.name))).map(m => m.name)
    if (!deciders.length) fail('COLLAB_NO_DECIDER')
    const events: CollabEvent[] = Object.values(s.requests).filter(r => r.itemId === item.id && r.status === 'open').map(r => ({ type: 'decision/superseded', actor, requestId: r.id }))
    events.push({ type: 'decision/requested', actor, request: { id: `decision-${s.lastSeq + 1}`, itemId: item.id, revision: item.revision, author: actor, options: [...input.options], deciders, status: 'open', awaitingChannel: false } })
    return events
  }) }
  async confirmDecision(ctx: CommandContext, input: { requestId: string; choice: string; evidence: { actionId: string; deliveryId: string } }): Promise<CommandResult> { ctx = this.snapshot(ctx); input = structuredClone(input); return this.command(ctx, 'confirmDecision', input, (s, actor) => {
    const request = s.requests[input.requestId]
    if (!request || request.status !== 'open') fail('COLLAB_DECISION_CLOSED')
    if (!request.deciders.includes(actor)) fail('COLLAB_FORBIDDEN')
    const item = s.items[request.itemId]!
    checkRevision(item, request.revision)
    const d = s.deliveries[input.evidence?.deliveryId]
    if (typeof input.evidence?.actionId !== 'string' || !input.evidence.actionId || typeof input.evidence.deliveryId !== 'string' || !input.evidence.deliveryId || !request.options.includes(input.choice) || !d || d.kind !== 'confirm' || d.requestId !== request.id || d.member !== actor || ctx.principal.kind !== 'provider' || d.providerId !== ctx.principal.providerId || d.outcome !== 'succeeded' || typeof d.messageRef !== 'string' || !d.messageRef) fail('COLLAB_DELIVERY_UNKNOWN')
    return [{ type: 'decision/decided', actor, decision: { requestId: request.id, itemId: item.id, actor, choice: input.choice, providerId: ctx.principal.providerId, actionId: input.evidence.actionId, deliveryId: d.deliveryId, messageRef: d.messageRef } }]
  }, (s, actor) => {
    if (ctx.principal.kind !== 'provider') fail('COLLAB_FORBIDDEN')
    const providerId = ctx.principal.providerId
    const decision = s.decisions.find(d => d.providerId === providerId && d.actionId === input.evidence?.actionId)
    if (!decision) return undefined
    if (decision.requestId !== input.requestId || decision.actor !== actor || decision.choice !== input.choice) fail('COLLAB_ACTION_CONFLICT')
    for (const r of this.records.get(ctx.spaceId) ?? []) if (r.kind === 'command' && r.events.some(e => e.type === 'decision/decided' && e.decision.providerId === providerId && e.decision.actionId === decision.actionId)) return r.receipt.result
    throw new Error('decision missing receipt')
  }) }
  async resetBreaker(ctx: CommandContext, input: { member: string }): Promise<CommandResult> { ctx = this.snapshot(ctx); input = structuredClone(input); return this.command(ctx, 'resetBreaker', input, (s, actor) => { if (s.members[input.member]?.status !== 'active') fail('COLLAB_MEMBER_INACTIVE'); return [{ type: 'breaker/reset', actor, member: input.member }] }) }
  private readState(ctx: ReadContext): SpaceState { this.stable(ctx.principal); const s = this.state(ctx.spaceId); if (ctx.principal.kind !== 'internal' && this.lookup(s, ctx.principal).status !== 'active') fail('COLLAB_MEMBER_INACTIVE'); return s }
  async overview(ctx: ReadContext): Promise<Overview> {
    ctx = this.snapshot(ctx)
    const generation = this.generations.get(ctx.spaceId)
    const observed = await this.samplePresence(Object.values(this.readState(ctx).members))
    if (this.generations.get(ctx.spaceId) !== generation) fail('COLLAB_STORE_FAILED')
    const s = structuredClone(this.readState(ctx))
    const presence: Overview['presence'] = Object.fromEntries(Object.values(s.members).map(m => [m.name, m.wakeCount >= BREAKER_LIMIT ? 'paused' : observed[m.name]!]))
    const active = this.inFlight.get(ctx.spaceId) ?? new Set<string>()
    const unfinished = Object.values(s.deliveries).filter(d => !d.outcome)
    return { ...s, pendingDeliveries: unfinished.filter(d => !active.has(d.deliveryId)), inFlightDeliveries: unfinished.filter(d => active.has(d.deliveryId)), presence }
  }
  async readSince(ctx: ReadContext, seq: number): Promise<CommitRecord[]> { this.readState(ctx); if (!Number.isInteger(seq) || seq < 0) fail('COLLAB_BAD_SEQ'); return structuredClone((this.records.get(ctx.spaceId) ?? []).filter(r => r.seq > seq)) }
  async project(ctx: ReadContext): Promise<string> { const s = await this.overview(ctx); return this.options.project?.(s) ?? project(s, s.presence) }
  async readConvention(ctx: ReadContext, version: string): Promise<string> { this.readState(ctx); const convention = this.options.convention ?? defaultConvention; if (convention.version !== version) fail('COLLAB_CONVENTION_UNKNOWN'); return convention.text }
}
