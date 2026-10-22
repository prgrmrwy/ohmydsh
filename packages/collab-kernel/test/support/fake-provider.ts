import type { ChannelProvider, MemberKind, Binding, Member, Pointer, Presence } from '../../src/index.js'
export class FakeProvider implements ChannelProvider {
  constructor(public id = 'P1', public channel = 'test-a', public prefix = 'a:') {}
  supports = { wake: true, confirm: false }
  acceptKind: MemberKind | undefined
  claims: [string, MemberKind][] = []
  deliveries: { member: Member; pointer: Pointer }[] = []
  observedPresence: Presence = 'reachable'
  async claim(address: string, kind: MemberKind): Promise<Binding | null> {
    this.claims.push([address, kind])
    return address.startsWith(this.prefix) && (!this.acceptKind || kind === this.acceptKind) ? { channel: this.channel, address, supports: { ...this.supports } } : null
  }
  async deliver(member: Member, pointer: Pointer) { this.deliveries.push({ member, pointer }) }
  async presence(_member: Member): Promise<Presence> { return this.observedPresence }
}
