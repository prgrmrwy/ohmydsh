import type { ChannelProvider, MemberKind, Binding, Member, Pointer, Presence } from '../../src/index.js'
/** A controllable Promise: tests suspend a provider call on `promise` and resume it with `open()`. */
export function gate() { let open!: () => void; const promise = new Promise<void>(resolve => { open = resolve }); return { promise, open } }
export class FakeProvider implements ChannelProvider {
  constructor(public id = 'P1', public channel = 'test-a', public prefix = 'a:') {}
  supports = { wake: true, confirm: false }
  managed?: boolean
  acceptKind: MemberKind | undefined
  claims: [string, MemberKind][] = []
  deliveries: { member: Member; pointer: Pointer }[] = []
  observedPresence: Presence = 'reachable'
  /** Per-address presence; falls back to `observedPresence`. */
  presenceBy: Record<string, Presence> = {}
  presenceCalls = 0
  /** Optional suspension points, awaited after the call is recorded. */
  holdClaim: (() => Promise<void>) | undefined
  holdPresence: (() => Promise<void>) | undefined
  modes = new Set<string>()
  async claim(address: string, kind: MemberKind): Promise<Binding | null> {
    this.claims.push([address, kind])
    await this.holdClaim?.()
    return address.startsWith(this.prefix) && (!this.acceptKind || kind === this.acceptKind) ? { channel: this.channel, address, supports: { ...this.supports } } : null
  }
  async deliver(member: Member, pointer: Pointer) { this.deliveries.push({ member, pointer }) }
  async presence(member: Member): Promise<Presence> {
    this.presenceCalls++
    await this.holdPresence?.()
    return this.presenceBy[member.binding.address] ?? this.observedPresence
  }
  supportsMode(mode: string): boolean { return this.modes.has(mode) }
}
