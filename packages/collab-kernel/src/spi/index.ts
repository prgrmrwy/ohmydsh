import type { Binding, DecisionRequest, Member, MemberKind, Pointer, Presence } from '../model/index.js'
export interface ChannelProvider {
  id: string
  channel: string
  claim(address: string, kind: MemberKind): Promise<Binding | null>
  deliver(member: Member, pointer: Pointer): Promise<void>
  presence(member: Member): Promise<Presence>
  requestConfirmation(member: Member, request: DecisionRequest, deliveryId: string): Promise<{ messageRef?: string }>
}
