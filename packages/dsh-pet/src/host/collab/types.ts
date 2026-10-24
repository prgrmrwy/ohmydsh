/**
 * Structural view of the dsh-collab integrator surface Pet consumes
 * (`pet-locus-collab-integration` design D1–D5).
 *
 * Pet is published as an independent plugin, so it takes NO runtime or type
 * dependency on dsh-collab or collab-kernel. These types MUST stay
 * structurally aligned with dsh-collab's `IntegratorAdapter`,
 * `IntegrationHandle` and `DshCollabService`, and with collab-kernel's
 * record shapes; the contract is defined by the dsh-collab spec, not here.
 * Only the members Pet actually uses are declared.
 */

/** Opaque integrator data on items and messages (kernel `Ext`). */
export type CollabExt = Record<string, unknown>

/** Kernel item, narrowed to the fields Pet reads. */
export interface CollabItem {
  readonly id: string
  readonly author: string
  readonly kind: string
  readonly title: string
  readonly body: string
  readonly revision: number
  readonly ref?: number
  readonly ext?: CollabExt
  readonly assignee?: string
  readonly progress?: 'open' | 'accepted' | 'done' | 'rejected'
}

/** Kernel message, narrowed to the fields Pet reads. `id` is the commit seq as a string. */
export interface CollabMessage {
  readonly id: string
  readonly actor: string
  readonly to: string
  readonly body: string
  readonly needsReply: boolean
  readonly ref?: number
  readonly ext?: CollabExt
}

/** A business subject dsh-collab asks `visible` about. */
export type CollabSubject =
  | { readonly kind: 'item'; readonly item: CollabItem }
  | { readonly kind: 'message'; readonly message: CollabMessage }
  | { readonly kind: 'statusText'; readonly name: string }

/** A record addressable by its creation seq (item creation or message). */
export type CollabRecordAt =
  | { readonly kind: 'item'; readonly item: CollabItem }
  | { readonly kind: 'message'; readonly message: CollabMessage }

/** Synchronous lookup dsh-collab supplies from the same full replay (design AMD-1). */
export interface CollabLookup {
  recordAt(seq: number): CollabRecordAt | undefined
}

/** Kernel event, narrowed to the variants Pet folds; others pass through untyped. */
export type CollabEvent =
  | { readonly type: 'item/created' | 'item/revised' | 'item/acked'; readonly actor: string; readonly item: CollabItem }
  | { readonly type: 'message/sent'; readonly actor: string; readonly message: CollabMessage }
  | { readonly type: 'request/progressed'; readonly actor: string; readonly itemId: string; readonly progress: string }
  | { readonly type: 'space/created'; readonly actor: string; readonly leader: string }
  | { readonly type: 'manager/allowed' | 'manager/revoked'; readonly actor: string; readonly channel: string }
  | { readonly type: 'member/joined' | 'member/invited'; readonly actor: string; readonly member: { readonly name: string; readonly status: string; readonly managedBy?: string; readonly binding: { readonly address: string } } }
  | { readonly type: 'member/status'; readonly actor: string; readonly name: string; readonly status: string }
  | { readonly type: 'leader/changed'; readonly actor: string; readonly leader: string }
  | { readonly type: string; readonly actor: string; readonly [key: string]: unknown }

/** Kernel commit record, narrowed. */
export interface CollabCommitRecord {
  readonly seq: number
  readonly at?: number
  readonly events: readonly CollabEvent[]
}

/** Wake pointer handed to `deliver`. */
export interface CollabPointer {
  readonly spaceId: string
  readonly toSeq: number
  readonly from: string
}

export type CollabPresence = 'reachable' | 'unreachable' | 'unknown'
export interface CollabTarget { readonly name: string; readonly address: string }
export type CollabHandleResult<T> = T | { readonly error: { readonly code: string } }
export type CollabExec = { readonly agent?: unknown }

/** What Pet registers with `dshCollab.attach('pet-locus', adapter)`. */
export interface CollabIntegratorAdapter {
  claim(address: string): boolean | Promise<boolean>
  presence(target: CollabTarget): CollabPresence | Promise<CollabPresence>
  deliver(target: CollabTarget, pointer: CollabPointer): void | Promise<void>
  resolveCaller(agent: unknown): string | { readonly address: string; readonly stamp?: CollabExt } | undefined
  holds(address: string): boolean
  visible?(stamp: CollabExt, subject: CollabSubject, lookup: CollabLookup): boolean
  readonly recipients?: readonly string[]
}

/** The handle `attach` returns; only the members Pet calls. */
export interface CollabIntegrationHandle {
  admit(spaceId: string, cmdId: string, input: { name: string; address: string }): Promise<CollabHandleResult<unknown>>
  readManaged(spaceId: string): Promise<CollabHandleResult<CollabCommitRecord[]>>
  disposeRequest(spaceId: string, cmdId: string, input: { itemId: string; progress: 'open' | 'accepted' | 'done' | 'rejected' }): Promise<CollabHandleResult<unknown>>
  establish(exec: CollabExec, spaceId: string, cmdId: string, input: { name: string; purpose: string }): Promise<CollabHandleResult<{ spaceId: string }>>
  dispose(): void
}

/** The `dshCollab` cordis service. */
export interface CollabService {
  attach(channel: string, adapter: CollabIntegratorAdapter): CollabIntegrationHandle
}

export function isHandleError(value: unknown): value is { readonly error: { readonly code: string } } {
  return typeof value === 'object' && value !== null && 'error' in value
    && typeof (value as { error?: { code?: unknown } }).error?.code === 'string'
}
