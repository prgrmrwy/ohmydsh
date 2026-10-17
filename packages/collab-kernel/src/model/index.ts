export type MemberKind = 'agent' | 'human'
export type MemberStatus = 'invited' | 'active' | 'declined' | 'gone'
export interface Address { channel: string; address: string }
export interface Binding extends Address { supports: { wake: boolean; confirm: boolean } }
export interface Member { name: string; kind: MemberKind; status: MemberStatus; joinSeq: number; binding: Binding; statusText: string; wakeCount: number }
export type ItemStatus = 'draft' | 'agreed' | 'escalated' | 'decided'
export type Progress = 'open' | 'accepted' | 'done' | 'rejected'
export interface ItemFields { title: string; body: string; requiredAcks: string[]; deciders: string[] }
interface ItemBase extends ItemFields { id: string; author: string; revision: number; status: ItemStatus; acks: Record<string, number>; agentEditCount: number }
export type Item = ItemBase & ({ kind: 'charter' | 'other' } | { kind: 'request'; assignee: string; progress: Progress })
export type CreateItemInput = ItemFields & { itemId: string } & ({ kind: 'charter' | 'other' } | { kind: 'request'; assignee: string })
export interface ReviseItemInput { itemId: string; expectedRevision: number; changes: Partial<ItemFields> }
export interface DecisionRequest { id: string; itemId: string; revision: number; author: string; options: string[]; deciders: string[]; status: 'open' | 'superseded' | 'closed'; awaitingChannel: boolean }
export interface Decision { requestId: string; itemId: string; actor: string; choice: string; providerId: string; actionId: string; deliveryId: string; messageRef: string }
export interface Pointer { spaceId: string; toSeq: number; counts: { message: number; item: number; decision: number; member: number }; from: string; invited?: true }
export interface Delivery { deliveryId: string; member: string; kind: 'wake' | 'confirm'; providerId: string; requestId?: string; pointer?: Pointer; outcome?: 'succeeded' | 'failed'; messageRef?: string }
export interface Message { id: string; actor: string; to: string; body: string; needsReply: boolean }
export interface ConventionInfo { version: string; sha256: string }
export interface SpaceState { spaceId: string; serviceId: string; status: 'open' | 'closed'; leader: string; convention: ConventionInfo; members: Record<string, Member>; items: Record<string, Item>; requests: Record<string, DecisionRequest>; decisions: Decision[]; messages: Message[]; deliveries: Record<string, Delivery>; lastSeq: number }
type EventData =
 | { type: 'space/created'; spaceId: string; serviceId: string; leader: string; convention: ConventionInfo }
 | { type: 'space/closed' }
 | { type: 'leader/changed'; leader: string }
 | { type: 'member/invited' | 'member/joined'; member: Member }
 | { type: 'member/status'; name: string; status: MemberStatus }
 | { type: 'member/statusText'; name: string; text: string }
 | { type: 'item/created' | 'item/revised' | 'item/acked'; item: Item }
 | { type: 'request/progressed'; itemId: string; progress: Progress }
 | { type: 'message/sent'; message: Message }
 | { type: 'decision/requested'; request: DecisionRequest }
 | { type: 'decision/superseded'; requestId: string }
 | { type: 'decision/decided'; decision: Decision }
 | { type: 'dispatch/intended'; delivery: Delivery }
 | { type: 'dispatch/completed'; deliveryId: string; outcome: 'succeeded' | 'failed'; messageRef?: string }
 | { type: 'breaker/reset'; member: string }
export type CollabEvent = EventData & { actor: string }
export type DispatchCompletedEvent = Extract<CollabEvent, { type: 'dispatch/completed' }>
export type ReceiptScope = { kind: 'member'; name: string } | { kind: 'create'; channel: string; address: string } | { kind: 'internal'; purpose: string }
export interface CommandResult { seq: number; spaceId: string; itemId?: string; requestId?: string }
export interface Receipt { cmdId: string; scope: ReceiptScope; payloadHash: string; result: CommandResult }
export type CommitRecord = { kind: 'command'; seq: number; events: CollabEvent[]; receipt: Receipt } | { kind: 'completion'; seq: number; events: [DispatchCompletedEvent]; receipt?: never }
export type Presence = 'reachable' | 'unreachable' | 'unknown'
export interface Overview extends SpaceState { pendingDeliveries: Delivery[]; inFlightDeliveries: Delivery[]; presence: Record<string, Presence | 'paused'> }
export const ESCALATE_AFTER = 3
export const BREAKER_LIMIT = 6
export class CollabError extends Error {
  constructor(public readonly code: string, public readonly details: { field?: string; currentRevision?: number; candidates?: string[]; lockPath?: string; lock?: { instanceId: string; pid: number } } = {}) { super(code) }
}
export function fail(code: string, details?: ConstructorParameters<typeof CollabError>[1]): never { throw new CollabError(code, details) }
