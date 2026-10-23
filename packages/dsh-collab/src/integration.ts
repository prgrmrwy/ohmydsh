import type { Agent } from '@deepseek-ai/dsh-agent'
import { CollabError, principals, type Binding, type ChannelProvider, type CollabService, type CommandContext, type CommandResult, type Member, type MemberKind, type Pointer, type Presence } from 'collab-kernel'
import type { CollabHost } from './host.js'
import type { Caller, SessionAccess } from './session-provider.js'
import { safeError } from './tools.js'

/** Kernel mode format; the channel prefix is enforced per handle. */
const MODE = /^[a-z][a-z0-9-]{0,31}:[a-z][a-z0-9-]{0,31}$/
const PRESENCE: readonly Presence[] = ['reachable', 'unreachable', 'unknown']

/** What a managed member looks like to its integrator. */
export interface ManagedTarget { name: string; address: string }
/**
 * Integrator adapter. `resolveCaller` and `holds` are synchronous and must read
 * an in-memory projection the integrator already verified asynchronously.
 */
export interface IntegratorAdapter {
  claim(address: string): boolean | Promise<boolean>
  presence(target: ManagedTarget): Presence | Promise<Presence>
  deliver(target: ManagedTarget, pointer: Pointer): void | Promise<void>
  resolveCaller(agent: Agent): string | undefined
  holds(address: string): boolean
  /** Delivery modes (`<channel>:<name>`) this integrator's members accept. */
  modes?: readonly string[]
}
export type SessionModeHandler = (sessionId: string, pointer: Pointer) => void | Promise<void>
export type Exec = { agent?: Agent }
export type HandleResult<T> = T | { error: { code: string; details?: Record<string, unknown> } }
type MemberOp = 'createItem' | 'reviseItem' | 'ackItem' | 'sendMessage' | 'setStatus' | 'advanceRequest'
export interface IntegrationHandle {
  admit(spaceId: string, cmdId: string, input: { name: string; address: string }): Promise<HandleResult<CommandResult>>
  rebind(spaceId: string, cmdId: string, input: { member: string; address: string }): Promise<HandleResult<CommandResult>>
  retire(spaceId: string, cmdId: string, input: { member: string }): Promise<HandleResult<CommandResult>>
  command(exec: Exec, spaceId: string, cmdId: string, op: { op: MemberOp; input: any }): Promise<HandleResult<CommandResult>>
  read(exec: Exec, spaceId: string, view: 'overview' | 'since', sinceSeq?: number): Promise<HandleResult<unknown>>
  registerSessionMode(mode: string, handler: SessionModeHandler): void
  dispose(): void
}
export interface DshCollabService { attach(channel: string, adapter: IntegratorAdapter): IntegrationHandle }

declare module '@deepseek-ai/cordis' {
  interface Context { dshCollab: DshCollabService }
}

/** Member commands a handle may run as the actual execution session; anything else is refused. */
const MEMBER_OPS: Readonly<Record<string, (service: CollabService, ctx: CommandContext, input: any) => Promise<CommandResult>>> = Object.freeze(Object.assign(Object.create(null), {
  createItem: (s: CollabService, c: CommandContext, i: any) => s.createItem(c, i),
  reviseItem: (s: CollabService, c: CommandContext, i: any) => s.reviseItem(c, i),
  ackItem: (s: CollabService, c: CommandContext, i: any) => s.ackItem(c, i),
  sendMessage: (s: CollabService, c: CommandContext, i: any) => s.sendMessage(c, i),
  setStatus: (s: CollabService, c: CommandContext, i: any) => s.setStatus(c, i),
  advanceRequest: (s: CollabService, c: CommandContext, i: any) => s.advanceRequest(c, i),
}))

/** Whitelisted pointer handed to integrators and mode handlers. */
export function safePointer(pointer: Pointer): Pointer {
  return {
    spaceId: pointer.spaceId, toSeq: pointer.toSeq,
    counts: { message: pointer.counts.message, item: pointer.counts.item, decision: pointer.counts.decision, member: pointer.counts.member },
    from: pointer.from,
    ...(pointer.invited ? { invited: true as const } : {}),
    ...(Number.isSafeInteger(pointer.thread) ? { thread: pointer.thread } : {}),
    ...(typeof pointer.mode === 'string' ? { mode: pointer.mode } : {}),
  }
}

interface Attachment { channel: string; adapter: IntegratorAdapter; epoch: number }
export interface ManagedClaim { channel: string; address: string; epoch: number }

/**
 * Host-declared integrator channels, their current attachment and attach
 * epoch, and the session-mode registry for ordinary recipients.
 */
export class Integrations {
  private readonly attached = new Map<string, Attachment>()
  private readonly modes = new Map<string, { handler: SessionModeHandler; owner: Attachment }>()
  private epoch = 0
  private closed = false
  readonly providers: RelayProvider[]
  readonly service: DshCollabService
  host?: () => CollabHost | undefined
  access?: SessionAccess
  constructor(readonly channels: readonly string[]) {
    this.providers = channels.map(channel => new RelayProvider(channel, this))
    this.service = Object.freeze({ attach: (channel: string, adapter: IntegratorAdapter) => this.attach(channel, adapter) })
  }
  current(channel: string): Attachment | undefined { return this.attached.get(channel) }
  isCurrent(owner: Attachment) { return this.attached.get(owner.channel) === owner }
  /** Every attached integrator that claims this agent, asked synchronously; throwing counts as no claim. */
  claims(agent: Agent): ManagedClaim[] {
    const out: ManagedClaim[] = []
    for (const owner of this.attached.values()) {
      let address: unknown
      try { address = owner.adapter.resolveCaller(agent) } catch { address = undefined }
      if (typeof address === 'string' && address.length > 0) out.push({ channel: owner.channel, address, epoch: owner.epoch })
    }
    return out
  }
  supportsSessionMode(mode: string) { return this.modes.has(mode) }
  sessionMode(mode: string) { return this.modes.get(mode)?.handler }
  /** Invalidate every handle first; later attach calls are refused. */
  close() {
    this.closed = true
    for (const owner of [...this.attached.values()]) this.detach(owner)
  }
  private detach(owner: Attachment) {
    if (!this.isCurrent(owner)) return
    this.attached.delete(owner.channel)
    for (const [mode, entry] of this.modes) if (entry.owner === owner) this.modes.delete(mode)
  }
  private attach(channel: string, adapter: IntegratorAdapter): IntegrationHandle {
    if (this.closed) throw new CollabError('COLLAB_SERVICE_CLOSING')
    if (typeof channel !== 'string' || !this.channels.includes(channel)) throw new CollabError('COLLAB_BAD_CHANNEL')
    if (this.attached.has(channel)) throw new CollabError('COLLAB_CHANNEL_ATTACHED')
    if (!adapter || typeof adapter.resolveCaller !== 'function' || typeof adapter.holds !== 'function' || typeof adapter.claim !== 'function' || typeof adapter.presence !== 'function' || typeof adapter.deliver !== 'function') throw new CollabError('COLLAB_BAD_ARGUMENTS')
    const owner: Attachment = { channel, adapter, epoch: ++this.epoch }
    this.attached.set(channel, owner)
    return this.handle(owner)
  }
  private handle(owner: Attachment): IntegrationHandle {
    const relay = this.providers.find(p => p.channel === owner.channel)!
    const detached = { error: { code: 'COLLAB_CHANNEL_DETACHED' } }
    const ready = () => {
      const host = this.host?.()
      if (!host) throw new CollabError('COLLAB_SERVICE_NOT_READY')
      return host
    }
    /** Manager command: the guard checks the attach epoch and, for admit/rebind, that the new address is still held. */
    const managed = async (spaceId: string, cmdId: string, address: string | undefined, run: (service: CollabService, ctx: CommandContext) => Promise<CommandResult>): Promise<HandleResult<CommandResult>> => {
      if (!this.isCurrent(owner)) return detached
      let reason: 'detached' | 'unclaimed' | undefined
      const guard = () => {
        if (!this.isCurrent(owner)) { reason = 'detached'; return false }
        if (address !== undefined) {
          let held = false
          try { held = owner.adapter.holds(address) === true } catch { held = false }
          if (!held) { reason = 'unclaimed'; return false }
        }
        return true
      }
      try {
        const host = ready()
        const ctx: CommandContext = { principal: principals.manager(relay.id), spaceId, cmdId, guard }
        return await host.command(ctx, spaceId, cmdId, service => run(service, ctx))
      } catch (error) {
        if (!this.isCurrent(owner)) return detached
        if (error instanceof CollabError && error.code === 'COLLAB_CALLER_STALE') return { error: { code: reason === 'unclaimed' ? 'COLLAB_ADDRESS_UNCLAIMED' : 'COLLAB_CHANNEL_DETACHED' } }
        return { error: safeError(error) }
      }
    }
    /** Member call as the actual execution session; the handle must stay attached until the kernel boundary. */
    const asCaller = async <T>(exec: Exec, run: (host: CollabHost, caller: Caller) => Promise<T>): Promise<HandleResult<T>> => {
      if (!this.isCurrent(owner)) return detached
      try {
        const caller = this.access!.caller(exec ?? {})
        const scoped: Caller = { ...caller, guard: () => this.isCurrent(owner) && caller.guard() }
        return await run(ready(), scoped)
      } catch (error) {
        if (!this.isCurrent(owner)) return detached
        return { error: safeError(error) }
      }
    }
    const handle: IntegrationHandle = {
      admit: (spaceId, cmdId, input) => managed(spaceId, cmdId, input?.address, (s, c) => s.admitMember(c, { name: input.name, address: input.address })),
      rebind: (spaceId, cmdId, input) => managed(spaceId, cmdId, input?.address, (s, c) => s.rebindMember(c, { member: input.member, address: input.address })),
      retire: (spaceId, cmdId, input) => managed(spaceId, cmdId, undefined, (s, c) => s.retireMember(c, { member: input.member })),
      command: async (exec, spaceId, cmdId, op) => {
        if (!this.isCurrent(owner)) return detached
        const name = op && typeof op === 'object' ? op.op : undefined
        const run = typeof name === 'string' ? MEMBER_OPS[name] : undefined
        const input = op?.input
        if (!run || !input || typeof input !== 'object' || Array.isArray(input)) return { error: { code: 'COLLAB_BAD_ARGUMENTS' } }
        // A handle may only use its own channel's delivery modes.
        if (name === 'sendMessage' && input.mode !== undefined && (typeof input.mode !== 'string' || !input.mode.startsWith(`${owner.channel}:`))) return { error: { code: 'COLLAB_BAD_MODE' } }
        return asCaller(exec, (host, caller) => {
          const ctx = host.context(caller, spaceId, cmdId)
          return host.command(ctx, spaceId, cmdId, service => run(service, ctx, input))
        })
      },
      read: async (exec, spaceId, view, sinceSeq = 0) => {
        if (!this.isCurrent(owner)) return detached
        if (view !== 'overview' && view !== 'since') return { error: { code: 'COLLAB_BAD_ARGUMENTS' } }
        return asCaller(exec, async (host, caller) => {
          const ctx = host.context(caller, spaceId)
          const value = await host.read<unknown>(ctx, spaceId, service => view === 'overview' ? service.overview(ctx) : service.readSince(ctx, sinceSeq))
          if (!caller.guard()) throw new CollabError('COLLAB_CALLER_UNAVAILABLE')
          return JSON.parse(JSON.stringify(value))
        })
      },
      registerSessionMode: (mode, handler) => {
        if (!this.isCurrent(owner)) throw new CollabError('COLLAB_CHANNEL_DETACHED')
        if (typeof mode !== 'string' || !MODE.test(mode) || !mode.startsWith(`${owner.channel}:`) || typeof handler !== 'function') throw new CollabError('COLLAB_BAD_MODE')
        if (this.modes.has(mode)) throw new CollabError('COLLAB_MODE_TAKEN')
        this.modes.set(mode, { handler, owner })
      },
      dispose: () => this.detach(owner),
    }
    return Object.freeze(handle)
  }
}

/**
 * One relay provider per declared channel, registered at startup because the
 * kernel's provider list is fixed. Behavior follows the current attachment.
 */
export class RelayProvider implements ChannelProvider {
  readonly id: string
  readonly managed = true
  constructor(readonly channel: string, private readonly integrations: Integrations) { this.id = `dsh-collab:${channel}` }
  async claim(address: string, kind: MemberKind): Promise<Binding | null> {
    const owner = this.integrations.current(this.channel)
    if (!owner || kind !== 'agent' || typeof address !== 'string') return null
    let claimed = false
    try { claimed = (await owner.adapter.claim(address)) === true } catch { claimed = false }
    if (!claimed || !this.integrations.isCurrent(owner)) return null
    return { channel: this.channel, address, supports: { wake: true, confirm: false } }
  }
  async presence(member: Member): Promise<Presence> {
    const owner = this.integrations.current(this.channel)
    if (!owner) return 'unreachable'
    try {
      const value = await owner.adapter.presence({ name: member.name, address: member.binding.address })
      return PRESENCE.includes(value) ? value : 'unknown'
    } catch { return 'unknown' }
  }
  async deliver(member: Member, pointer: Pointer): Promise<void> {
    const owner = this.integrations.current(this.channel)
    if (!owner || member.binding.channel !== this.channel) throw new CollabError('COLLAB_CHANNEL_DETACHED')
    await owner.adapter.deliver({ name: member.name, address: member.binding.address }, safePointer(pointer))
  }
  supportsMode(mode: string): boolean {
    const owner = this.integrations.current(this.channel)
    return !!owner && typeof mode === 'string' && mode.startsWith(`${this.channel}:`) && Array.isArray(owner.adapter.modes) && owner.adapter.modes.includes(mode)
  }
}
