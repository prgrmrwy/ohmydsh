import type { Binding, Member, MemberKind, Pointer, Presence } from '../model/index.js'
export interface ChannelProvider {
  id: string
  channel: string
  claim(address: string, kind: MemberKind): Promise<Binding | null>
  deliver(member: Member, pointer: Pointer): Promise<void>
  presence(member: Member): Promise<Presence>
  /** An integrator provider: its channel's members are admitted by the integrator, never by invite. */
  managed?: boolean
  /** Synchronous, in-memory: whether this provider can deliver a wake with the given mode. */
  supportsMode?(mode: string): boolean
}
