/**
 * Structural view of the dsh-collab integrator surface Pet consumes
 * (`locus-three-tier-structure` design D8).
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
  readonly status?: string
  readonly progress?: 'open' | 'accepted' | 'done' | 'rejected'
}

/** Kernel event, narrowed to the variants Pet folds; others pass through untyped. */
export type CollabEvent =
  | { readonly type: 'item/created' | 'item/revised' | 'item/acked'; readonly actor: string; readonly item: CollabItem }
  | { readonly type: 'request/progressed'; readonly actor: string; readonly itemId: string; readonly progress: string }
  | { readonly type: 'space/created'; readonly actor: string; readonly leader: string }
  | { readonly type: 'manager/allowed' | 'manager/revoked'; readonly actor: string; readonly channel: string }
  | { readonly type: 'member/joined' | 'member/invited'; readonly actor: string; readonly member: { readonly name: string; readonly status: string; readonly binding: { readonly channel?: string; readonly address: string } } }
  | { readonly type: 'leader/changed'; readonly actor: string; readonly leader: string }
  | { readonly type: string; readonly actor: string; readonly [key: string]: unknown }

/** Kernel commit record, narrowed. */
export interface CollabCommitRecord {
  readonly seq: number
  readonly at?: number
  readonly events: readonly CollabEvent[]
}

/** Wake pointer handed to `deliver`; Pet has no managed member, so it never receives one. */
export interface CollabPointer {
  readonly spaceId: string
  readonly toSeq: number
  readonly from: string
}

export type CollabPresence = 'reachable' | 'unreachable' | 'unknown'
export interface CollabTarget { readonly name: string; readonly address: string }
export type CollabHandleResult<T> = T | { readonly error: { readonly code: string } }

/**
 * What Pet registers with `dshCollab.attach('pet-locus', adapter)`.
 *
 * Pet has no managed member any more: `claim`/`holds` always answer no and
 * `resolveCaller` never resolves a caller. The one meaningful member is
 * `owns`, which makes the locus main sessions Pet created addressable by
 * `actAs` and lets the manager dispose their requests.
 */
export interface CollabIntegratorAdapter {
  claim(address: string): boolean | Promise<boolean>
  presence(target: CollabTarget): CollabPresence | Promise<CollabPresence>
  deliver(target: CollabTarget, pointer: CollabPointer): void | Promise<void>
  resolveCaller(agent: unknown): undefined
  holds(address: string): boolean
  owns(sessionId: string): boolean
}

/** Closed operation set `actAs` accepts (dsh-collab spec "接入方以其拥有的普通会话身份执行封闭命令"). */
export type CollabActAsOp =
  | { readonly op: 'createSpace'; readonly input: { readonly name: string; readonly purpose?: string } }
  | { readonly op: 'allowManager'; readonly input: { readonly channel: string } }
  | { readonly op: 'invite'; readonly input: { readonly name: string; readonly address: string } }
  | { readonly op: 'createItem'; readonly input: Record<string, unknown> }
  | { readonly op: 'sendMessage'; readonly input: Record<string, unknown> }
  | { readonly op: 'read'; readonly input: { readonly view: 'overview' | 'since'; readonly sinceSeq?: number } }

/** The handle `attach` returns; only the members Pet calls. */
export interface CollabIntegrationHandle {
  actAs(sessionId: string, spaceId: string, cmdId: string, op: CollabActAsOp): Promise<CollabHandleResult<any>>
  readManaged(spaceId: string): Promise<CollabHandleResult<CollabCommitRecord[]>>
  disposeRequest(spaceId: string, cmdId: string, input: { itemId: string; progress: 'open' | 'accepted' | 'done' | 'rejected' }): Promise<CollabHandleResult<unknown>>
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
