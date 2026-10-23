/** `human` exists only in pre-change logs; new members are always `agent`. */
export type MemberKind = 'agent' | 'human'
export type MemberStatus = 'invited' | 'active' | 'declined' | 'gone'
export interface Address { channel: string; address: string }
/** `supports.confirm` stays in the shape so the previous kernel can read new logs; nothing reads it. */
export interface Binding extends Address { supports: { wake: boolean; confirm: boolean } }
/** `wakeCount` is still folded for log compatibility but gates nothing. */
/** `managedBy` marks a member admitted by an integrator channel; `previousBindings` keeps addresses retired by rebind (never reusable). */
export interface Member { name: string; kind: MemberKind; status: MemberStatus; joinSeq: number; binding: Binding; statusText: string; wakeCount: number; managedBy?: string; previousBindings?: Address[] }
/** `escalated` and `decided` exist only in pre-change logs and are read-only history. */
export type ItemStatus = 'draft' | 'agreed' | 'escalated' | 'decided'
export type Progress = 'open' | 'accepted' | 'done' | 'rejected'
export interface ItemFields { title: string; body: string; requiredAcks: string[] }
/** `deciders` and `agentEditCount` are inert fields carried by pre-change snapshots. */
/** Opaque integrator data: plain JSON object, set at creation, never interpreted by the kernel. */
export type Ext = Record<string, unknown>
interface ItemBase extends ItemFields { id: string; author: string; revision: number; status: ItemStatus; acks: Record<string, number>; ref?: number; ext?: Ext; deciders?: string[]; agentEditCount?: number }
export type Item = ItemBase & ({ kind: 'charter' | 'other' } | { kind: 'request'; assignee: string; progress: Progress })
export type CreateItemInput = ItemFields & { itemId: string; ref?: number; ext?: Ext } & ({ kind: 'charter' | 'other' } | { kind: 'request'; assignee: string })
export interface ReviseItemInput { itemId: string; expectedRevision: number; changes: Partial<ItemFields> }
/** Legacy decision request, replayed only as history. */
export interface DecisionRequest { id: string; itemId: string; revision: number; author: string; options: string[]; deciders: string[]; status: 'open' | 'superseded' | 'closed'; awaitingChannel: boolean }
/** Legacy human decision, replayed only as history. */
export interface Decision { requestId: string; itemId: string; actor: string; choice: string; providerId: string; actionId: string; deliveryId: string; messageRef: string }
/** `counts.decision` is always 0; kept so the forwarded pointer shape stays stable. */
export interface Pointer { spaceId: string; toSeq: number; counts: { message: number; item: number; decision: number; member: number }; from: string; invited?: true; thread?: number; mode?: string }
/** `confirm` deliveries exist only in pre-change logs. `thread` is the topic root of a message or completion wake. */
export interface Delivery { deliveryId: string; member: string; kind: 'wake' | 'confirm'; providerId: string; requestId?: string; pointer?: Pointer; outcome?: 'succeeded' | 'failed'; messageRef?: string; thread?: number; mode?: string }
export interface Message { id: string; actor: string; to: string; body: string; needsReply: boolean; ref?: number; ext?: Ext; mode?: string }
export interface ConventionInfo { version: string; sha256: string }
export interface SpaceState {
  spaceId: string; serviceId: string; status: 'open' | 'closed'; leader: string; convention: ConventionInfo; purpose?: string
  /** Integrator channels currently allowed to manage members (Leader grant). */
  managers: string[]
  members: Record<string, Member>; items: Record<string, Item>
  /** Creation seq of every item, written as own properties. */
  itemSeq: Record<string, number>
  /** Topic root of every message seq and item creation seq. */
  topicOf: Record<number, number>
  /** Counted waking messages per topic root. */
  topicWakes: Record<number, number>
  requests: Record<string, DecisionRequest>; decisions: Decision[]; messages: Message[]; deliveries: Record<string, Delivery>; lastSeq: number
}
type EventData =
 | { type: 'space/created'; spaceId: string; serviceId: string; leader: string; convention: ConventionInfo; purpose?: string }
 | { type: 'space/closed' }
 | { type: 'leader/changed'; leader: string }
 | { type: 'member/invited' | 'member/joined'; member: Member }
 | { type: 'member/status'; name: string; status: MemberStatus }
 | { type: 'member/statusText'; name: string; text: string }
 | { type: 'member/rebound'; name: string; binding: Binding }
 | { type: 'manager/allowed' | 'manager/revoked'; channel: string }
 | { type: 'item/created' | 'item/revised' | 'item/acked'; item: Item }
 | { type: 'request/progressed'; itemId: string; progress: Progress }
 | { type: 'message/sent'; message: Message }
 | { type: 'dispatch/intended'; delivery: Delivery }
 | { type: 'dispatch/completed'; deliveryId: string; outcome: 'succeeded' | 'failed'; messageRef?: string }
 // Legacy events: replayed as history, never written by this kernel.
 | { type: 'decision/requested'; request: DecisionRequest }
 | { type: 'decision/superseded'; requestId: string }
 | { type: 'decision/decided'; decision: Decision }
 | { type: 'breaker/reset'; member: string }
export type CollabEvent = EventData & { actor: string }
export type DispatchCompletedEvent = Extract<CollabEvent, { type: 'dispatch/completed' }>
/** `internal` scopes exist only in pre-change receipts; they still take part in replay matching. */
export type ReceiptScope = { kind: 'member'; name: string } | { kind: 'manager'; channel: string } | { kind: 'create'; channel: string; address: string } | { kind: 'internal'; purpose: string }
export interface CommandResult { seq: number; spaceId: string; itemId?: string; requestId?: string }
export interface Receipt { cmdId: string; scope: ReceiptScope; payloadHash: string; result: CommandResult }
export type CommitRecord = { kind: 'command'; seq: number; events: CollabEvent[]; receipt: Receipt } | { kind: 'completion'; seq: number; events: [DispatchCompletedEvent]; receipt?: never }
export type Presence = 'reachable' | 'unreachable' | 'unknown'
export interface Overview extends SpaceState { pendingDeliveries: Delivery[]; inFlightDeliveries: Delivery[]; presence: Record<string, Presence> }
/** Maximum counted waking messages per topic; there is no reset. */
export const TOPIC_LIMIT = 20
export class CollabError extends Error {
  constructor(public readonly code: string, public readonly details: { field?: string; currentRevision?: number; candidates?: string[]; lockPath?: string; lock?: { instanceId: string; pid: number } } = {}) { super(code) }
}
export function fail(code: string, details?: ConstructorParameters<typeof CollabError>[1]): never { throw new CollabError(code, details) }
