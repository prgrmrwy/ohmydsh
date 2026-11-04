/**
 * Standalone controller for the unified locus model.
 *
 * This module deliberately has no Cordis, DSH, lark-cli, or Pet repository
 * imports.  The runtime seams are injected below so a host that has not yet
 * shipped the locus repository can still exercise the control-plane rules in
 * isolation.  In particular, a successful external operation is never treated
 * as a durable locus: the repository commit is the publish point.
 *
 * The controller owns these ordering rules:
 *
 * - group locks are acquired before endpoint locks;
 * - a missing group is completed before a topic is created;
 * - an automatic group main is one-per-chat, never one-per-workspace;
 * - explicit topic parents win without changing the group main;
 * - new entries start read-only, publish a `not-created` generation (the child
 *   session is created lazily by the first deliverable message, never here) and
 *   a source is fixed at creation time;
 * - every entry hangs under a locus main session that Pet created for exactly
 *   one work session (the owner's ordinary session); the locus main and its
 *   collaboration space are established BEFORE anything is published;
 * - no partially provisioned external resource is published; and
 * - an automatic group may be replaced only while idle, with an explicit
 *   warning before the new generation can be used.
 *
 * The injected repository is expected to enforce the same invariants across
 * Host processes.  The in-memory locks here only close the common same-process
 * race; they are not a substitute for a conditional repository commit.
 */

import { randomUUID } from 'node:crypto'
import {
  endpointKeyOf,
  type LocusChildComposition,
} from './aggregate.js'
import { isUsableLocusMainSession } from './locus-main.js'
import { dispositionOf, isOwnerExit } from './serviceability.js'

/** A Feishu entry: a chat, optionally narrowed to one thread. */
export interface LocusEndpoint {
  readonly chatId: string
  readonly threadId?: string
}

/** A session which is eligible to be a locus main/parent session. */
export interface LocusParentSession {
  readonly id: string
  readonly workspaceId: string
  readonly title?: string
  /** Present for a child session; child sessions are never valid parents. */
  readonly parentSessionId?: string
  readonly state?: 'active' | 'archived' | 'missing'
  /**
   * The preset on this session's durable header, when the Host reported one.
   *
   * A locus child composes itself from its parent's composed preset, so an
   * explicitly bound main decides what the child can call. Absent means the
   * Host stated nothing — never assume it is safe.
   */
  readonly agentPreset?: string
}

/** A workspace returned by the host's current default-workspace resolver. */
export interface LocusWorkspace {
  readonly id: string
  readonly title?: string
}

/** Result of creating an external DSH session. */
export interface ProvisionedSession {
  readonly id: string
  readonly workspaceId?: string
  readonly parentSessionId?: string
  readonly title?: string
  /** Host-attested safe composition for a newly created locus child. */
  readonly childComposition?: LocusChildComposition
  /** Finish a pre-publication identity handoff after durable commit. */
  readonly commit?: () => Promise<void> | void
  /** Preferred cleanup hook for a failed provisioning transaction. */
  readonly rollback?: () => Promise<void> | void
}

/** Result of creating an external Feishu group. */
export interface ProvisionedChat {
  readonly chatId: string
  readonly chatName?: string
  /** Preferred cleanup hook for a failed provisioning transaction. */
  readonly rollback?: () => Promise<void> | void
}

/** Where the main session came from. */
export type LocusMainSource = 'auto' | 'explicit' | 'qa-created'

/** Where a locus came from. */
export type LocusSource = 'auto' | 'inherited' | 'explicit' | 'qa-created'

/** Durable lifecycle state of one locus generation. */
export type LocusState =
  | 'provisioning'
  /** Published without a child session; the first deliverable message creates it. */
  | 'not-created'
  | 'active'
  | 'switching'
  | 'invalid'
  | 'stopped'
  | 'retired'

/** The persisted group-level main-session structure. */
export interface LocusGroupRecord {
  readonly chatId: string
  readonly chatName?: string
  readonly workspaceId: string
  readonly mainSessionId: string
  readonly mainSessionTitle?: string
  readonly mainSource: LocusMainSource
  readonly state: LocusState
  readonly createdAt: number
  readonly updatedAt: number
}

/**
 * The 1:1 pairing of a work session (the owner's ordinary session) and the
 * locus main session Pet created for it. `loci.parentSessionId` points at
 * `locusMainSessionId`.
 */
export interface LocusMainRecord {
  readonly locusMainSessionId: string
  readonly workSessionId: string
  readonly generation: number
  readonly status: 'active' | 'retired'
  readonly spaceId: string
  readonly workspaceId: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly retiredAt?: number
  readonly retiredReason?: string
}

/** The persisted association for one endpoint and one generation. */
export interface LocusRecord {
  readonly locusId: string
  readonly generation: number
  readonly endpoint: LocusEndpoint
  readonly workspaceId: string
  /** The locus main session (NOT the work session). */
  readonly parentSessionId: string
  readonly parentSessionTitle?: string
  /** The work session this entry's locus main serves, when it has a pairing. */
  readonly workSessionId?: string
  /** Absent until the first deliverable message creates the child. */
  readonly childSessionId?: string
  /** The id the lazily created child will have; fixed when the generation is published. */
  readonly reservedChildSessionId?: string
  /** Missing on `not-created` and legacy rows. */
  readonly childComposition?: LocusChildComposition
  readonly toolTier?: { readonly desired: 'safe' | 'shell'; readonly effective: 'safe' | 'shell'; readonly verifiedAt?: number; readonly grantedBy?: string }
  /** Chat-level locus that structurally owns this topic, when applicable. */
  readonly parentLocusId?: string
  readonly source: LocusSource
  readonly state: LocusState
  /** Effective durable permission; every controller-created generation is read. */
  readonly permission: 'read' | 'write'
  readonly createdAt: number
  readonly retiredAt?: number
  readonly replacesLocusId?: string
}

/** A durable provisioning row, if the repository supports recovery records. */
export interface LocusProvisioningRecord {
  readonly provisioningId: string
  readonly kind: 'group' | 'topic' | 'qa' | 'replacement' | 'rebuild' | 'regenerate'
  readonly endpoint: LocusEndpoint
  /** The WORK session the entry is being established for. */
  readonly parentSessionId?: string
  readonly startedAt: number
}

/** An atomic publish request understood by the locus repository. */
export interface LocusProvisioningCommit {
  readonly provisioningId: string
  readonly group?: LocusGroupRecord
  readonly locus: LocusRecord
  /** The locus main created for this commit; omitted when an active one is reused. */
  readonly main?: LocusMainRecord
  /**
   * Set only for the first/default Q&A group. Names the LOCUS MAIN the default
   * pointer hangs from (the locus's own `parentSessionId`), because that is the
   * session its entries are indexed under.
   */
  readonly defaultQaForParentSessionId?: string
  /** Retire an active automatic generation and record its notice debt atomically. */
  readonly replace?: {
    readonly oldLocusId: string
    readonly noticeText: string
    /** Explicit owner bind after the old work session was proven archived. */
    readonly archivedWork?: true
  }
  /** Publish over an unavailable latest marker without silently reviving it. */
  readonly rebuild?: {
    readonly oldLocusId: string
    /**
     * Why a predecessor that is still CURRENT may be replaced.
     *
     * Absent keeps the ordinary rule: only a generation already out of service
     * may be published over. `archived-parent` is set by the session-level
     * replacement after IT re-proved that this predecessor's main session is
     * archived, and it also retires the predecessor — the set allows only one
     * current generation per endpoint.
     */
    readonly predecessorDisposition?: 'archived-parent'
  }
}

/** One entry's successor generation inside a regeneration. */
export interface LocusRegeneratedEntry {
  readonly oldLocusId: string
  /** Recorded as the predecessor's `invalidReason`. */
  readonly reason: string
  /** The predecessor is a previous-model row; the successor is established the auto way. */
  readonly previousModel?: boolean
  readonly locus: LocusRecord
}

/** Atomic publish of successor generations, optionally under a NEW locus main. */
export interface LocusRegenerationCommit {
  readonly provisioningId: string
  readonly entries: readonly LocusRegeneratedEntry[]
  readonly main?: LocusMainRecord
  readonly retireMain?: { readonly locusMainSessionId: string; readonly reason: string }
}

/**
 * Minimal repository port used by this standalone controller.
 *
 * `commitProvisioning` is the durable publish point and MUST be conditional:
 * it should reject an already-active endpoint rather than silently replacing
 * it. `begin/record/complete/failProvisioning` are required recovery hooks;
 * begin must reject before external creation when atomic persistence is absent.
 */
export interface LocusRepository {
  findGroup(chatId: string): Promise<LocusGroupRecord | undefined>
  findActive(endpoint: LocusEndpoint): Promise<LocusRecord | undefined>
  /**
   * Return the current default-Q&A locus, including an invalid/retired row.
   * A non-active result is intentionally not treated as missing: callers must
   * tell the owner to rebuild instead of silently opening another group.
   */
  findDefaultQa(parentSessionId: string): Promise<LocusRecord | undefined>
  /** The single active locus main of a work session, if any. */
  findActiveMain(workSessionId: string): Promise<LocusMainRecord | undefined>
  /** One pairing by its locus main session id, whatever its status. */
  findMain(locusMainSessionId: string): Promise<LocusMainRecord | undefined>
  /** The latest generation of every endpoint published under one locus main. */
  listEntriesOfMain(locusMainSessionId: string): Promise<readonly LocusRecord[]>
  /** Publish successor generations (and optionally a new locus main) atomically. */
  commitRegeneration(input: LocusRegenerationCommit): Promise<void>
  /** Whether no accepted/running work is attached to this locus generation. */
  isLocusIdle(locusId: string): Promise<boolean>
  /** Atomically publish a prepared group/locus generation. */
  commitProvisioning(input: LocusProvisioningCommit): Promise<void>
  beginProvisioning(record: LocusProvisioningRecord): Promise<void>
  recordProvisioningResource(
    provisioningId: string,
    resource: {
      readonly mainSessionId?: string
      readonly locusMainSessionId?: string
      readonly childSessionId?: string
      readonly chatId?: string
    },
  ): Promise<void>
  completeProvisioning(provisioningId: string): Promise<void>
  failProvisioning(provisioningId: string, reason: string): Promise<void>
  /** Return a still-owed source-switch notice for retry, if one exists. */
  findSwitchNotice(
    locusId: string,
    generation: number,
  ): Promise<{ readonly endpoint: LocusEndpoint; readonly text: string } | undefined>
  /** Clear a source-switch notice debt only after external delivery succeeded. */
  acknowledgeSwitchNotice(locusId: string, generation: number): Promise<void>
}

/** External DSH operations needed by the controller. */
export interface LocusDshPort {
  /** Pet-owned runtime workspace; the entry's workspace remains the work project. */
  readonly locusMainWorkspaceId?: string
  /** Resolve a persisted session; undefined means unavailable, not a fallback. */
  resolveSession(sessionId: string): Promise<LocusParentSession | undefined>
  /** Resolve the currently configured default workspace. */
  resolveDefaultWorkspace(): Promise<LocusWorkspace | undefined>
  /** Create a fresh automatic main in exactly the supplied workspace. */
  createMainSession(input: {
    workspaceId: string
    label: string
    chatId: string
  }): Promise<ProvisionedSession>
  /**
   * Create the locus main in the Pet workspace; input.workspaceId is the work
   * project. It mounts the neutral locus preset, is locked down (approval
   * `never`, sandbox `read-only`, no shell/write/edit/delegation tools) and is
   * verified before it is returned. It is NOT a child of anything: it is an
   * ordinary top-level session that only Pet and the work session talk to.
   */
  createLocusMainSession(input: {
    workSessionId: string
    workspaceId: string
    label: string
  }): Promise<ProvisionedSession>
  /** Fallback cleanup when a returned resource has no per-resource hook. */
  releaseSession?(sessionId: string): Promise<void>
}

/** Outcome of establishing the collaboration space for a work/locus-main pair. */
export type LocusSpaceEstablishment =
  | { readonly ok: true; readonly spaceId: string }
  | { readonly ok: false; readonly reason: string; readonly code?: string }

/** External Lark operations. No credentials or clients are imported here. */
export interface LocusLarkPort {
  /** Create the Q&A group with the human owner explicitly named. */
  createGroup(input: { name: string; ownerId: string }): Promise<ProvisionedChat>
  /** Deliver a mechanical source-switch warning to the current endpoint. */
  sendControlMessage(input: { endpoint: LocusEndpoint; text: string }): Promise<void>
  /** Fallback cleanup when a created chat has no per-resource hook. */
  deleteGroup?(chatId: string): Promise<void>
}

/** Controller dependencies. */
export interface LocusControllerDeps {
  readonly repository: LocusRepository
  readonly dsh: LocusDshPort
  /**
   * Create the dsh-collab space of a work/locus-main pair and invite the work
   * session. Injected so this module stays free of collab imports; absent makes
   * every path that needs a new locus main fail closed.
   */
  /** Allocates the child session id reserved for a new `not-created` generation. */
  readonly reserveChildSessionId?: () => string
  readonly establishSpace?: (input: {
    readonly workSessionId: string
    readonly locusMainSessionId: string
  }) => Promise<LocusSpaceEstablishment>
  /** Required only by Q&A creation and automatic-source replacement. */
  readonly lark?: LocusLarkPort
  readonly now?: () => number
  readonly id?: () => string
  readonly log?: (message: string) => void
}

export interface EnsureGroupRequest {
  readonly chatId: string
  readonly chatName?: string
  /** Explicit main source. If absent, the configured default workspace is used. */
  readonly parentSessionId?: string
  /** Alias useful to callers that want to make precedence explicit in code. */
  readonly explicitParentSessionId?: string
}

export interface EnsureTopicRequest {
  readonly chatId: string
  readonly threadId: string
  readonly chatName?: string
  /** Explicit parent wins for this topic but never mutates the group main. */
  readonly parentSessionId?: string
  readonly explicitParentSessionId?: string
}

export interface EnsureGroupResult {
  readonly group: LocusGroupRecord
  readonly locus: LocusRecord
  readonly created: boolean
  readonly reused: boolean
  /** Present when an automatic group was explicitly replaced. */
  readonly warningText?: string
}

export interface EnsureTopicResult {
  readonly group: LocusGroupRecord
  readonly locus: LocusRecord
  readonly created: boolean
  readonly reused: boolean
  /** Whether the hierarchy step had to create the group structure. */
  readonly groupCreated: boolean
}

export interface DefaultQaRequest {
  readonly parentSessionId: string
  readonly ownerId: string
  readonly groupName?: string
}

export interface DefaultQaResult {
  readonly group: LocusGroupRecord
  readonly locus: LocusRecord
  readonly created: boolean
  readonly reused: boolean
}

export interface ReplaceAutomaticGroupRequest {
  readonly chatId: string
  readonly parentSessionId: string
}

export interface ReplaceAutomaticGroupResult {
  readonly group: LocusGroupRecord
  readonly locus: LocusRecord
  readonly previousLocus: LocusRecord
  readonly warningText: string
  readonly created: boolean
}

/** Explicit owner-only reconstruction of an unavailable endpoint marker. */
export interface RebuildLocusRequest {
  readonly endpoint: LocusEndpoint
  readonly previousLocusId: string
  readonly parentSessionId: string
  readonly asDefaultQa?: boolean
  /**
   * Replace an unusable recorded parent with a freshly created main session.
   *
   * The recorded parent is the only session that was ever this endpoint's main
   * session, and the management surface offers no way to pass a different one
   * (by design — see the "no bare-identifier binding" requirement). So when
   * that session is archived or missing, an explicit rebuild had no possible
   * parent and always failed, and an endpoint whose generation the Host itself
   * invalidated became permanently unreachable — the owner never exited
   * anything, yet the only way out was a rebuild that could never run.
   *
   * Recovery is opt-in per call: an owner-driven rebuild keeps refusing so the
   * management surface can explain which session to restore, while automatic
   * recovery of a Host-invalidated generation may establish a fresh main
   * session the same way first-time provisioning does.
   */
  readonly allowFreshParent?: boolean
  /**
   * Rebuild a generation that is NOT terminal, because its recorded main
   * session is archived.
   *
   * The generic rebuild refuses anything but a tombstone, and that guard is
   * what keeps a healthy generation from being replaced by mistake. An
   * archived main session is the exception the owner asked for: the endpoint
   * genuinely cannot serve (the archive fact outranks `active`), yet its row
   * is not a tombstone, so without this the session-level "use a new main
   * session" action would have no way to move its entries.
   *
   * Only the owner-facing session-level action sets this, and this method
   * re-proves the archived fact for THIS generation before accepting it — the
   * flag alone authorizes nothing.
   */
  readonly replaceArchivedParent?: boolean
}

export interface RebuildLocusResult {
  readonly group: LocusGroupRecord
  readonly locus: LocusRecord
  readonly previousLocus: LocusRecord
  readonly created: true
  readonly reused: false
}

/** Make an entry able to take its next message (see `LocusController.ensureEntry`). */
export interface EnsureEntryRequest {
  readonly chatId: string
  readonly threadId?: string
  readonly chatName?: string
}

/** What moving a work session's entries onto a new locus main did. */
export interface LocusMainMigration {
  readonly migrated: number
  readonly skipped: readonly { readonly locusId: string; readonly reason: string }[]
}

export interface EnsureEntryResult {
  readonly locus: LocusRecord
  readonly group?: LocusGroupRecord
  readonly created: boolean
  /** Owner-visible note to relay with the receipt, when something was retired or moved. */
  readonly notice?: string
  readonly migration?: LocusMainMigration
}

const LEGACY_RETIRED_REASON = '旧版协作模型入口已退休，由三层结构接替'
const MAIN_MIGRATED_REASON = 'locus 主会话不可用，入口已迁移到新的 locus 主会话'

/** Receipt line telling a previous-model entry its old association is retired. */
export const LEGACY_RETIRED_NOTICE =
  '这个入口来自旧版协作模型，旧的关联已退休（历史会话保留，但不会再被恢复）；已为它建立新的协作结构。'

function renderMigrationNotice(migration: LocusMainMigration): string {
  const head = `locus 主会话已更换，已迁移 ${String(migration.migrated)} 个入口。`
  if (migration.skipped.length === 0) return head
  return `${head}跳过：${migration.skipped.map(item => `${item.locusId}（${item.reason}）`).join('；')}`
}

export type LocusControllerErrorCode =
  | 'INVALID_ENDPOINT'
  | 'INVALID_REQUEST'
  | 'INVALID_PARENT'
  | 'PARENT_NOT_FOUND'
  | 'PARENT_NOT_ALLOWED'
  | 'DEFAULT_WORKSPACE_UNAVAILABLE'
  | 'GROUP_UNAVAILABLE'
  | 'TOPIC_UNAVAILABLE'
  | 'DEFAULT_QA_UNAVAILABLE'
  | 'EXPLICIT_PARENT_CONFLICT'
  | 'BUSY'
  | 'CAPABILITY_UNAVAILABLE'
  | 'PROVISIONING_FAILED'
  | 'LOCUS_MAIN_UNAVAILABLE'
  | 'SOURCE_ARCHIVED'
  | 'REPOSITORY_INCONSISTENT'
  | 'NOTIFICATION_FAILED'

/** Stable, safe-to-display controller error. */
export class LocusControllerError extends Error {
  readonly code: LocusControllerErrorCode
  readonly cause?: unknown

  constructor(code: LocusControllerErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'LocusControllerError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

/** Alias for integrations that use the shorter domain name. */
export const LocusError = LocusControllerError

/** Canonical key for endpoint locking and repository indexes. */
export function locusEndpointKey(endpoint: LocusEndpoint): string {
  return endpointKeyOf(endpoint)
}

/** The same six-character session identity shown by the Web session badge. */
export function shortLocusSessionId(sessionId: string): string {
  const withoutPrefix = sessionId.replace(/^(?:task|session)-/, '')
  return withoutPrefix.slice(0, 6)
}

/** A short label safe for a group-visible warning. */
export function shortLocusSessionLabel(sessionId: string, title?: string): string {
  const readable = title?.trim()
  return readable !== undefined && readable !== '' ? readable : shortLocusSessionId(sessionId)
}

/**
 * Render the explicit source-switch warning.  Keep this exported so the
 * channel integration can use exactly the same text if it elects to deliver
 * the returned warning itself.
 */
export function renderAutomaticReplacementWarning(input: {
  readonly fromSessionId: string
  readonly fromTitle?: string
  readonly toSessionId: string
  readonly toTitle?: string
}): string {
  const from = shortLocusSessionLabel(input.fromSessionId, input.fromTitle)
  const to = shortLocusSessionLabel(input.toSessionId, input.toTitle)
  return `当前入口已从「${from}」切换到「${to}」；上下文来源发生变化，旧对话历史未自动合并。后续消息将由新的子会话处理。`
}

const MAX_QA_GROUP_NAME = 32

function safeErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.slice(0, 300)
}

function endpointLabel(endpoint: LocusEndpoint): string {
  return endpoint.threadId === undefined
    ? endpoint.chatId
    : `${endpoint.chatId}#${endpoint.threadId}`
}

function requireNonEmpty(value: string | undefined, field: string): string {
  if (value === undefined || value.trim() === '') {
    throw new LocusControllerError('INVALID_ENDPOINT', `${field} 不能为空。`)
  }
  return value.trim()
}

function endpointOf(request: EnsureGroupRequest | EnsureTopicRequest): LocusEndpoint {
  const chatId = requireNonEmpty(request.chatId, 'chatId')
  if ('threadId' in request) {
    const threadId = requireNonEmpty(request.threadId, 'threadId')
    return { chatId, threadId }
  }
  return { chatId }
}

function requestedParent(
  request: Pick<EnsureGroupRequest, 'parentSessionId' | 'explicitParentSessionId'> | ReplaceAutomaticGroupRequest,
): string | undefined {
  const first = 'parentSessionId' in request ? request.parentSessionId : undefined
  const second = 'explicitParentSessionId' in request ? request.explicitParentSessionId : undefined
  if (first !== undefined && second !== undefined && first !== second) {
    throw new LocusControllerError('INVALID_PARENT', '显式 parentSessionId 参数不一致。')
  }
  const value = first ?? second
  return value === undefined ? undefined : requireNonEmpty(value, 'parentSessionId')
}

function qaGroupName(name: string | undefined): string {
  const trimmed = name?.trim() ?? ''
  if (trimmed === '') return '答疑 · DSH'
  return trimmed.length > MAX_QA_GROUP_NAME
    ? `${trimmed.slice(0, MAX_QA_GROUP_NAME - 1)}…`
    : trimmed
}

function assertSessionShape(
  session: ProvisionedSession,
  expectedParent: string | undefined,
  expectedWorkspace: string | undefined,
  operation: string,
): void {
  if (session.id.trim() === '') {
    throw new LocusControllerError('PROVISIONING_FAILED', `${operation} 未返回有效 session id。`)
  }
  if (expectedParent === undefined && session.parentSessionId !== undefined) {
    throw new LocusControllerError(
      'PROVISIONING_FAILED',
      `${operation} 返回了 child session，已拒绝把它当作一级会话发布。`,
    )
  }
  if (expectedParent !== undefined && session.parentSessionId !== expectedParent) {
    throw new LocusControllerError(
      'PROVISIONING_FAILED',
      `${operation} 未能证明返回的 child 属于指定 parent，已拒绝发布。`,
    )
  }
  if (expectedWorkspace !== undefined && session.workspaceId !== expectedWorkspace) {
    throw new LocusControllerError(
      'PROVISIONING_FAILED',
      `${operation} 未能证明返回的 session 属于指定 workspace，已拒绝发布。`,
    )
  }
}

/** External resources one provisioning attempt created, for rollback. */
interface ProvisionedResources {
  work?: ProvisionedSession
  locusMain?: ProvisionedSession
  chat?: ProvisionedChat
}

/** The work session an entry serves (its locus main's partner). */
function workOf(locus: Pick<LocusRecord, 'parentSessionId' | 'workSessionId'>): string {
  return locus.workSessionId ?? locus.parentSessionId
}

/** A published group/locus can take work: its child may still be uncreated. */
function isServingState(state: LocusState): boolean {
  return state === 'active' || state === 'not-created'
}

/** Build a unique id without making the repository responsible for identity. */
function generatedId(prefix: string, id: () => string): string {
  return `${prefix}-${id()}`
}

/**
 * Unified locus control-plane controller.
 *
 * It intentionally does not expose message routing or old channel APIs.  The
 * future channel adapter should call these methods after it has established a
 * trustworthy endpoint and sender.
 */
export class LocusController {
  private readonly deps: LocusControllerDeps
  private readonly locks = new Map<string, Promise<void>>()
  /** A pairing is shared across endpoints; hold its lease until durable publication or failure. */
  private readonly mainLeases = new Map<string, () => void>()
  private readonly now: () => number
  private readonly id: () => string

  constructor(deps: LocusControllerDeps) {
    this.deps = deps
    this.now = deps.now ?? Date.now
    this.id = deps.id ?? (() => `runtime-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  }

  /** Ensure a group main and its group-level child locus. */
  async ensureGroup(request: EnsureGroupRequest): Promise<EnsureGroupResult> {
    const endpoint = endpointOf(request)
    const explicitParent = requestedParent(request)
    return this.withLock(`group:${endpoint.chatId}`, async () => {
      const existing = await this.deps.repository.findGroup(endpoint.chatId)
      if (existing !== undefined) {
        const previousModel = await this.previousModelRow(endpoint)
        if (previousModel !== undefined) {
          // The owner's bind over a previous-model entry: retire it and build the
          // three-tier structure on the session they named (or the auto way).
          const established = await this.establishFromPreviousModelLocked(
            endpoint,
            previousModel,
            request.chatName,
            explicitParent,
          )
          const group = await this.requireGroup(endpoint.chatId)
          return { group, locus: established.locus, created: true, reused: false }
        }
        if (!isServingState(existing.state)) {
          throw new LocusControllerError(
            'GROUP_UNAVAILABLE',
            `群 ${endpoint.chatId} 的群级结构处于 ${existing.state}，不会静默重建。`,
          )
        }
        if (explicitParent !== undefined && existing.mainSessionId !== explicitParent &&
            await this.isArchivedSession(existing.mainSessionId)) {
          const replacement = await this.replaceAutomaticGroupParentLocked({ chatId: endpoint.chatId, parentSessionId: explicitParent })
          return { group: replacement.group, locus: replacement.locus, created: replacement.created, reused: false, warningText: replacement.warningText }
        }
        const current = await this.requireActiveLocus(endpoint, '群级')
        if (explicitParent !== undefined && existing.mainSessionId !== explicitParent) {
          if (existing.mainSource === 'auto') {
            const replacement = await this.replaceAutomaticGroupParentLocked({
              chatId: endpoint.chatId,
              parentSessionId: explicitParent,
            })
            return {
              group: replacement.group,
              locus: replacement.locus,
              created: replacement.created,
              reused: false,
              ...(replacement.warningText === '' ? {} : { warningText: replacement.warningText }),
            }
          }
          throw new LocusControllerError(
            'EXPLICIT_PARENT_CONFLICT',
            `群 ${endpoint.chatId} 已显式绑定其它主会话，需先解除后再绑定。`,
          )
        }
        return { group: existing, locus: current, created: false, reused: true }
      }

      return this.provisionGroupLocked(endpoint, request.chatName, explicitParent)
    })
  }

  /**
   * Ensure a topic after ensuring its parent group.  The lock order is always
   * group then topic; this is important when two new topics arrive together.
   */
  async ensureTopic(request: EnsureTopicRequest): Promise<EnsureTopicResult> {
    const endpoint = endpointOf(request)
    if (endpoint.threadId === undefined) {
      throw new LocusControllerError('INVALID_ENDPOINT', '话题必须包含 threadId。')
    }
    const explicitParent = requestedParent(request)
    return this.withLock(`group:${endpoint.chatId}`, async () => {
      return this.withLock(`endpoint:${locusEndpointKey(endpoint)}`, async () => {
        const existing = await this.deps.repository.findActive(endpoint)
        if (existing !== undefined) {
          const previousModel = await this.previousModelRow(endpoint)
          if (previousModel !== undefined) {
            // A previous-model topic: retire it under the new structure.
            const established = await this.establishFromPreviousModelLocked(
              endpoint,
              previousModel,
              request.chatName,
              explicitParent,
            )
            return {
              group: await this.requireGroup(endpoint.chatId),
              locus: established.locus,
              created: true,
              reused: false,
              groupCreated: false,
            }
          }
          const group = await this.requireGroup(endpoint.chatId)
          if (explicitParent !== undefined && workOf(existing) === explicitParent) {
            // Same-source bind is idempotent, and is also the explicit retry
            // path for a generation whose switch notice is still owed.
            await this.flushPendingSwitchNotice(existing)
            const current = await this.deps.repository.findActive(endpoint)
            if (current === undefined || !isServingState(current.state)) {
              throw new LocusControllerError(
                'TOPIC_UNAVAILABLE',
                `话题 ${endpointLabel(endpoint)} 的切换通知已处理，但当前代际仍不可服务。`,
              )
            }
            return { group, locus: current, created: false, reused: true, groupCreated: false }
          }
          const archivedWork = explicitParent !== undefined && explicitParent !== workOf(existing) &&
            await this.isArchivedSession(workOf(existing))
          if (explicitParent !== undefined && existing.source === 'explicit' && !archivedWork) {
            throw new LocusControllerError(
              'EXPLICIT_PARENT_CONFLICT',
              `话题 ${endpointLabel(endpoint)} 已显式绑定其它主会话，需先解除后再绑定。`,
            )
          }
          if (!isServingState(existing.state)) {
            throw new LocusControllerError(
              'TOPIC_UNAVAILABLE',
              `话题 ${endpointLabel(endpoint)} 处于 ${existing.state}，不会静默改绑。`,
            )
          }
          if (explicitParent === undefined) {
            return { group, locus: existing, created: false, reused: true, groupCreated: false }
          }
          return this.replaceInheritedTopicParentLocked({
            endpoint: { chatId: endpoint.chatId, threadId: requireNonEmpty(endpoint.threadId, 'threadId') },
            group,
            previousLocus: existing,
            parentSessionId: explicitParent,
            ...(archivedWork ? { archivedWork: true } : {}),
            ...(request.chatName === undefined ? {} : { chatName: request.chatName }),
          })
        }

        // Validate an explicit source BEFORE creating an automatic group.  A
        // bad source must not leave a fresh automatic main as collateral.
        const explicit =
          explicitParent === undefined
            ? undefined
            : await this.resolveMainParent(explicitParent, '显式话题 parent')

        const groupResult = await this.ensureGroupLocked(
          { chatId: endpoint.chatId, ...(request.chatName !== undefined ? { chatName: request.chatName } : {}) },
          undefined,
        )
        const group = groupResult.group
        const inherited =
          explicit ?? (await this.resolveMainParent(group.mainSessionId, '群级主会话'))
        const source: LocusSource = explicit === undefined ? 'inherited' : 'explicit'
        const label = this.childLabel(endpoint, request.chatName, inherited.title)
        const locus = await this.provisionChildLocus(
          'topic',
          endpoint,
          inherited,
          source,
          label,
          groupResult.locus.locusId,
        )
        return {
          group,
          locus,
          created: true,
          reused: false,
          groupCreated: groupResult.created,
        }
      })
    })
  }

  /** Create or open the stable default Q&A group for one main session. */
  async createOrOpenDefaultQa(request: DefaultQaRequest): Promise<DefaultQaResult> {
    const parentSessionId = requireNonEmpty(request.parentSessionId, 'parentSessionId')
    const ownerId = requireNonEmpty(request.ownerId, 'ownerId')
    return this.withLock(`qa:${parentSessionId}`, async () => {
      const parent = await this.resolveMainParent(parentSessionId, 'Q&A parent')
      const existing = await this.deps.repository.findDefaultQa(parentSessionId)
      if (existing !== undefined) {
        if (!isServingState(existing.state)) {
          throw new LocusControllerError(
            'DEFAULT_QA_UNAVAILABLE',
            `主会话 ${shortLocusSessionLabel(parentSessionId, parent.title)} 的默认 Q&A 入口处于 ${existing.state}，请显式重建。`,
          )
        }
        const group = await this.requireGroup(existing.endpoint.chatId)
        return { group, locus: existing, created: false, reused: true }
      }

      const lark = this.requireLark('Q&A 创建')
      const endpointHint: LocusEndpoint = { chatId: `pending-${parentSessionId}` }
      const provisioningId = generatedId('provisioning', this.id)
      await this.beginProvisioning({
        provisioningId,
        kind: 'qa',
        endpoint: endpointHint,
        parentSessionId,
      })

      const resources: ProvisionedResources = {}
      let published = false
      try {
        // The opened session is the WORK session. Its locus main is reused when
        // it already has one (a second Q&A group, a bound group), created and
        // wired into a collaboration space otherwise.
        const { main, created } = await this.ensureLocusMain(parent, provisioningId, resources)

        const chat = await lark.createGroup({ name: qaGroupName(request.groupName), ownerId })
        resources.chat = chat
        const chatId = requireNonEmpty(chat.chatId, 'created chatId')
        await this.recordResource(provisioningId, { chatId })
        const endpoint: LocusEndpoint = { chatId }
        const locus = this.notCreatedLocus({ endpoint, work: parent, main, source: 'qa-created' })
        const group: LocusGroupRecord = {
          ...this.groupFor(endpoint, chat.chatName, parent, 'qa-created', locus),
        }
        await this.deps.repository.commitProvisioning({
          provisioningId,
          group,
          locus,
          defaultQaForParentSessionId: main.locusMainSessionId,
          ...(created ? { main } : {}),
        })
        published = true
        this.releaseMainLease(provisioningId)
        await resources.locusMain?.commit?.()
        await this.completeProvisioning(provisioningId)
        return { group, locus, created: true, reused: false }
      } catch (error) {
        if (published) {
          this.logPublishedFinalizeFailure(provisioningId, 'Q&A 默认入口', error)
          throw new LocusControllerError(
            'PROVISIONING_FAILED',
            'Q&A 默认入口已持久化发布，但会话 finalize 失败；已保留群、会话和 committed operation，等待恢复对账。',
            error,
          )
        }
        const chat = resources.chat
        const cleanup = await this.rollbackResources(resources)
        await this.failProvisioning(provisioningId, safeErrorMessage(error))
        if (error instanceof LocusControllerError && error.code === 'PROVISIONING_FAILED') {
          throw error
        }
        const residual = chat !== undefined && !cleanup.chat
          ? `飞书群「${chat.chatName ?? chat.chatId}」可能残留，请手动核对。`
          : ''
        throw new LocusControllerError(
          'PROVISIONING_FAILED',
          `Q&A 默认入口创建失败。${residual}`.trim(),
          error,
        )
      }
    })
  }

  /** Short alias for integrations that call the operation "ensure". */
  async ensureDefaultQa(request: DefaultQaRequest): Promise<DefaultQaResult> {
    return this.createOrOpenDefaultQa(request)
  }

  /**
   * Establish a fresh explicit locus for an endpoint protected only by an
   * opaque legacy marker. The caller must prove that marker; this method never
   * reads legacy identity/workspace/permission and refuses if any unified
   * generation already exists. A protected topic additionally requires an
   * already-active unified group.
   */
  async rebuildLegacyEndpoint(request: {
    readonly endpoint: LocusEndpoint
    readonly parentSessionId: string
    readonly chatName?: string
  }): Promise<EnsureGroupResult | EnsureTopicResult> {
    const endpoint = endpointOf(request.endpoint)
    const parentSessionId = requireNonEmpty(request.parentSessionId, 'parentSessionId')
    return this.withLock(`group:${endpoint.chatId}`, async () =>
      this.withLock(`endpoint:${locusEndpointKey(endpoint)}`, async () => {
        const existing = await this.deps.repository.findActive(endpoint)
        if (existing !== undefined) {
          throw new LocusControllerError('REPOSITORY_INCONSISTENT', '入口已存在统一模型代际，不能按 legacy marker 重建。')
        }
        if (endpoint.threadId === undefined) {
          const group = await this.deps.repository.findGroup(endpoint.chatId)
          if (group !== undefined) {
            throw new LocusControllerError('GROUP_UNAVAILABLE', '群级统一结构已存在，不能按 legacy marker 静默覆盖。')
          }
          return this.provisionGroupLocked(endpoint, request.chatName, parentSessionId)
        }

        const group = await this.requireGroup(endpoint.chatId)
        if (!isServingState(group.state)) {
          throw new LocusControllerError('GROUP_UNAVAILABLE', '话题所属群级结构不可用，不能重建旧入口。')
        }
        const parentGroupLocus = await this.requireActiveLocus({ chatId: endpoint.chatId }, '话题父级')
        const parent = await this.resolveMainParent(parentSessionId, 'legacy 入口显式重建 parent')
        const locus = await this.provisionChildLocus(
          'topic',
          endpoint,
          parent,
          'explicit',
          this.childLabel(endpoint, group.chatName, parent.title),
          parentGroupLocus.locusId,
        )
        return { group, locus, created: true, reused: false, groupCreated: false }
      }),
    )
  }

  /**
   * Explicitly rebuild an unavailable current marker as a fresh read generation.
   * Ordinary ensure deliberately refuses these markers; only owner-facing
   * management calls this method with the exact previous locus id.
   */
  async rebuildExplicit(request: RebuildLocusRequest): Promise<RebuildLocusResult> {
    const endpoint = endpointOf(
      request.endpoint.threadId === undefined
        ? { chatId: request.endpoint.chatId }
        : { chatId: request.endpoint.chatId, threadId: request.endpoint.threadId },
    )
    return this.withLock(`group:${endpoint.chatId}`, async () =>
      this.withLock(`endpoint:${locusEndpointKey(endpoint)}`, async () => {
        const previous = await this.deps.repository.findActive(endpoint)
        if (previous === undefined || previous.locusId !== request.previousLocusId) {
          throw new LocusControllerError('REPOSITORY_INCONSISTENT', '入口当前代际已变化，请刷新后重试。')
        }
        // A non-terminal generation may be replaced ONLY when this exact
        // generation's recorded main session is archived, re-proved here rather
        // than trusted from the caller's flag. Proved once, before the commit,
        // and carried into it so the persistence guard agrees with this gate
        // instead of re-deriving a rule it cannot check.
        const predecessorUnavailable =
          previous.state === 'stopped' || previous.state === 'invalid' || previous.state === 'retired'
        const archivedParent = !predecessorUnavailable &&
          request.replaceArchivedParent === true &&
          await this.isArchivedSession(previous.workSessionId ?? previous.parentSessionId)
        if (!predecessorUnavailable && !archivedParent) {
          throw new LocusControllerError('GROUP_UNAVAILABLE', '只有停止、失效或退役入口可以显式重建。')
        }
        if (!(await this.deps.repository.isLocusIdle(previous.locusId))) {
          throw new LocusControllerError('BUSY', '入口仍有执行中或排队消息，请空闲后再重建。')
        }
        if (request.asDefaultQa === true && endpoint.threadId !== undefined) {
          throw new LocusControllerError('INVALID_ENDPOINT', '默认 Q&A 只能重建群级入口。')
        }
        const parent = await this.resolveRebuildParent(request)
        const group = endpoint.threadId === undefined
          ? undefined
          : await this.requireGroup(endpoint.chatId)
        const parentLocusId = endpoint.threadId === undefined ? undefined : group!.chatId === endpoint.chatId
          ? (await this.requireActiveLocus({ chatId: endpoint.chatId }, '话题父级')).locusId
          : undefined
        if (endpoint.threadId !== undefined && parentLocusId === undefined) {
          throw new LocusControllerError('GROUP_UNAVAILABLE', '话题所属群级结构不可用，不能重建。')
        }
        const provisioningId = generatedId('provisioning', this.id)
        await this.beginProvisioning({
          provisioningId,
          kind: 'rebuild',
          endpoint,
          parentSessionId: parent.id,
        })
        const locusId = generatedId('locus', this.id)
        const generation = previous.generation + 1
        const resources: ProvisionedResources = {}
        let published = false
        try {
          const { main, created } = await this.ensureLocusMain(parent, provisioningId, resources)
          const source: LocusSource = request.asDefaultQa === true ? 'qa-created' : 'explicit'
          const locus = this.notCreatedLocus({
            locusId,
            generation,
            endpoint,
            work: parent,
            main,
            source,
            replacesLocusId: previous.locusId,
            ...(parentLocusId === undefined ? {} : { parentLocusId }),
          })
          const nextGroup: LocusGroupRecord | undefined = endpoint.threadId === undefined
            ? this.groupFor(
              endpoint,
              undefined,
              parent,
              request.asDefaultQa === true ? 'qa-created' : 'explicit',
              locus,
            )
            : undefined
          await this.deps.repository.commitProvisioning({
            provisioningId,
            ...(nextGroup === undefined ? {} : { group: nextGroup }),
            locus,
            ...(created ? { main } : {}),
            ...(request.asDefaultQa === true ? { defaultQaForParentSessionId: main.locusMainSessionId } : {}),
            rebuild: {
              oldLocusId: previous.locusId,
              // Stated, not assumed: reaching this commit means the archived
              // fact above was already re-proved for THIS predecessor, and the
              // persistence guard is the last place that has to agree.
              ...(archivedParent ? { predecessorDisposition: 'archived-parent' as const } : {}),
            },
          })
          published = true
          this.releaseMainLease(provisioningId)
        await resources.locusMain?.commit?.()
          await this.completeProvisioning(provisioningId)
          return {
            group: nextGroup ?? group!,
            locus,
            previousLocus: previous,
            created: true,
            reused: false,
          }
        } catch (error) {
          if (published) {
            this.logPublishedFinalizeFailure(provisioningId, '显式重建', error)
            throw new LocusControllerError(
              'PROVISIONING_FAILED',
              '重建已持久化发布，但会话 finalize 失败；保留 committed operation 等待恢复对账。',
              error,
            )
          }
          await this.rollbackResources(resources)
          await this.failProvisioning(provisioningId, safeErrorMessage(error))
          if (error instanceof LocusControllerError) throw error
          throw new LocusControllerError('PROVISIONING_FAILED', '显式重建失败，旧停止/失效标记保持不变。', error)
        }
      }),
    )
  }

  /**
   * Replace an automatic group main with an explicit parent.
   *
   * Existing topic generations are not touched.  The replacement creates a
   * sibling group child under the new parent and advances only the group
   * endpoint generation.
   */
  async replaceAutomaticGroupParent(
    request: ReplaceAutomaticGroupRequest,
  ): Promise<ReplaceAutomaticGroupResult> {
    const chatId = requireNonEmpty(request.chatId, 'chatId')
    const parentSessionId = requireNonEmpty(request.parentSessionId, 'parentSessionId')
    return this.withLock(`group:${chatId}`, async () =>
      this.replaceAutomaticGroupParentLocked({ chatId, parentSessionId }),
    )
  }

  /** Alias used by bind-oriented callers. */
  async bindExplicitGroup(
    request: ReplaceAutomaticGroupRequest,
  ): Promise<ReplaceAutomaticGroupResult> {
    return this.replaceAutomaticGroupParent(request)
  }

  private async ensureGroupLocked(
    request: EnsureGroupRequest,
    explicitParent: string | undefined,
  ): Promise<EnsureGroupResult> {
    const endpoint: LocusEndpoint = { chatId: requireNonEmpty(request.chatId, 'chatId') }
    const existing = await this.deps.repository.findGroup(endpoint.chatId)
    if (existing !== undefined) {
      const previousModel = await this.previousModelRow(endpoint)
      if (previousModel !== undefined) {
        const established = await this.establishFromPreviousModelLocked(
          endpoint,
          previousModel,
          request.chatName,
          explicitParent,
        )
        return { group: await this.requireGroup(endpoint.chatId), locus: established.locus, created: true, reused: false }
      }
      if (!isServingState(existing.state)) {
        throw new LocusControllerError(
          'GROUP_UNAVAILABLE',
          `群 ${endpoint.chatId} 的群级结构处于 ${existing.state}，不会静默重建。`,
        )
      }
      const current = await this.requireActiveLocus(endpoint, '群级')
      return { group: existing, locus: current, created: false, reused: true }
    }
    return this.provisionGroupLocked(endpoint, request.chatName, explicitParent)
  }

  private async provisionGroupLocked(
    endpoint: LocusEndpoint,
    chatName: string | undefined,
    explicitParent: string | undefined,
  ): Promise<EnsureGroupResult> {
    const parent =
      explicitParent === undefined
        ? undefined
        : await this.resolveMainParent(explicitParent, '显式群级 parent')
    const provisioningId = generatedId('provisioning', this.id)
    await this.beginProvisioning({
      provisioningId,
      kind: 'group',
      endpoint,
      ...(parent === undefined ? {} : { parentSessionId: parent.id }),
    })

    const resources: ProvisionedResources = {}
    let published = false
    try {
      let work: LocusParentSession
      let mainSource: LocusMainSource
      if (parent !== undefined) {
        work = parent
        mainSource = 'explicit'
      } else {
        const created = await this.createAutoWorkSession(provisioningId, endpoint, chatName, resources)
        work = created
        mainSource = 'auto'
      }

      const { main, created: mainCreated } = await this.ensureLocusMain(work, provisioningId, resources)
      const locus = this.notCreatedLocus({
        endpoint,
        work,
        main,
        source: mainSource === 'auto' ? 'auto' : 'explicit',
      })
      const group = this.groupFor(endpoint, chatName, work, mainSource, locus)
      await this.deps.repository.commitProvisioning({
        provisioningId,
        group,
        locus,
        ...(mainCreated ? { main } : {}),
      })
      published = true
      this.releaseMainLease(provisioningId)
      await resources.locusMain?.commit?.()
      await this.completeProvisioning(provisioningId)
      return { group, locus, created: true, reused: false }
    } catch (error) {
      if (published) {
        this.logPublishedFinalizeFailure(provisioningId, `群 ${endpoint.chatId}`, error)
        throw new LocusControllerError(
          'PROVISIONING_FAILED',
          `群 ${endpoint.chatId} 的 locus 已持久化发布，但会话 finalize 失败；已保留会话和 committed operation，等待恢复对账。`,
          error,
        )
      }
      await this.rollbackResources(resources)
      await this.failProvisioning(provisioningId, safeErrorMessage(error))
      if (error instanceof LocusControllerError) throw error
      throw new LocusControllerError(
        'PROVISIONING_FAILED',
        `群 ${endpoint.chatId} 的 locus 创建失败，未发布任何关联。`,
        error,
      )
    }
  }

  private async provisionChildLocus(
    kind: 'topic',
    endpoint: LocusEndpoint,
    parent: LocusParentSession,
    source: LocusSource,
    _label: string,
    parentLocusId: string,
  ): Promise<LocusRecord> {
    const provisioningId = generatedId('provisioning', this.id)
    await this.beginProvisioning({ provisioningId, kind, endpoint, parentSessionId: parent.id })
    const resources: ProvisionedResources = {}
    let published = false
    try {
      const { main, created } = await this.ensureLocusMain(parent, provisioningId, resources)
      const locus = this.notCreatedLocus({ endpoint, work: parent, main, source, parentLocusId })
      await this.deps.repository.commitProvisioning({ provisioningId, locus, ...(created ? { main } : {}) })
      published = true
      this.releaseMainLease(provisioningId)
      await resources.locusMain?.commit?.()
      await this.completeProvisioning(provisioningId)
      return locus
    } catch (error) {
      if (published) {
        this.logPublishedFinalizeFailure(provisioningId, `话题 ${endpointLabel(endpoint)}`, error)
        throw new LocusControllerError(
          'PROVISIONING_FAILED',
          `话题 ${endpointLabel(endpoint)} 的 locus 已持久化发布，但会话 finalize 失败；已保留会话和 committed operation，等待恢复对账。`,
          error,
        )
      }
      await this.rollbackResources(resources)
      await this.failProvisioning(provisioningId, safeErrorMessage(error))
      if (error instanceof LocusControllerError) throw error
      throw new LocusControllerError(
        'PROVISIONING_FAILED',
        `话题 ${endpointLabel(endpoint)} 的 locus 创建失败，未发布任何关联。`,
        error,
      )
    }
  }

  private async replaceInheritedTopicParentLocked(input: {
    readonly endpoint: LocusEndpoint & { readonly threadId: string }
    readonly group: LocusGroupRecord
    readonly previousLocus: LocusRecord
    readonly parentSessionId: string
    readonly archivedWork?: true
    readonly chatName?: string
  }): Promise<EnsureTopicResult> {
    const { endpoint, group, previousLocus } = input
    if (input.archivedWork !== true && previousLocus.source !== 'inherited' && previousLocus.source !== 'auto') {
      throw new LocusControllerError(
        'EXPLICIT_PARENT_CONFLICT',
        `话题 ${endpointLabel(endpoint)} 已显式绑定其它主会话，需先解除后再绑定。`,
      )
    }
    if (!(await this.deps.repository.isLocusIdle(previousLocus.locusId))) {
      throw new LocusControllerError(
        'BUSY',
        `话题 ${endpointLabel(endpoint)} 当前有执行中或排队消息，请空闲后再切换主会话。`,
      )
    }
    const parent = await this.resolveMainParent(input.parentSessionId, '显式话题 parent')
    if (parent.id === workOf(previousLocus)) {
      await this.flushPendingSwitchNotice(previousLocus)
      return { group, locus: previousLocus, created: false, reused: true, groupCreated: false }
    }

    const lark = this.requireLark('话题主会话替换通知')
    const provisioningId = generatedId('provisioning', this.id)
    await this.beginProvisioning({
      provisioningId,
      kind: 'replacement',
      endpoint,
      parentSessionId: parent.id,
    })
    const resources: ProvisionedResources = {}
    let published = false
    const locusId = generatedId('locus', this.id)
    const generation = previousLocus.generation + 1
    try {
      const { main, created } = await this.ensureLocusMain(parent, provisioningId, resources)
      const warningText = renderAutomaticReplacementWarning({
        fromSessionId: workOf(previousLocus),
        ...(previousLocus.parentSessionTitle === undefined ? {} : { fromTitle: previousLocus.parentSessionTitle }),
        toSessionId: parent.id,
        ...(parent.title === undefined ? {} : { toTitle: parent.title }),
      })
      const currentGroup = await this.deps.repository.findActive({ chatId: endpoint.chatId })
      const nextLocus = this.notCreatedLocus({
        locusId,
        generation,
        endpoint,
        work: parent,
        main,
        source: 'explicit',
        replacesLocusId: previousLocus.locusId,
        ...(currentGroup === undefined ? {} : { parentLocusId: currentGroup.locusId }),
      })
      // Topic replacement publishes only the endpoint generation. The group
      // record/current main is deliberately untouched, so other and future
      // inherited topics continue following the group default.
      await this.deps.repository.commitProvisioning({
        provisioningId,
        locus: nextLocus,
        ...(created ? { main } : {}),
        replace: { oldLocusId: previousLocus.locusId, noticeText: warningText, ...(input.archivedWork ? { archivedWork: true } : {}) },
      })
      published = true
      this.releaseMainLease(provisioningId)
      await resources.locusMain?.commit?.()
      await this.completeProvisioning(provisioningId)
      try {
        await lark.sendControlMessage({ endpoint, text: warningText })
        await this.deps.repository.acknowledgeSwitchNotice(nextLocus.locusId, nextLocus.generation)
      } catch (error) {
        throw new LocusControllerError(
          'NOTIFICATION_FAILED',
          '话题主会话切换已持久化，但通知尚未确认送达；新关联保持暂停并等待重试。',
          error,
        )
      }
      return { group, locus: nextLocus, created: true, reused: false, groupCreated: false }
    } catch (error) {
      if (published) {
        if (error instanceof LocusControllerError) throw error
        throw new LocusControllerError(
          'NOTIFICATION_FAILED',
          '话题主会话切换已持久化，但通知尚未确认送达；新关联保持暂停并等待重试。',
          error,
        )
      }
      await this.rollbackResources(resources)
      await this.failProvisioning(provisioningId, safeErrorMessage(error))
      if (error instanceof LocusControllerError) throw error
      throw new LocusControllerError(
        'PROVISIONING_FAILED',
        `话题 ${endpointLabel(endpoint)} 的显式主会话切换失败，旧关联保持不变。`,
        error,
      )
    }
  }

  private async replaceAutomaticGroupParentLocked(
    request: ReplaceAutomaticGroupRequest,
  ): Promise<ReplaceAutomaticGroupResult> {
    const endpoint: LocusEndpoint = { chatId: requireNonEmpty(request.chatId, 'chatId') }
    const group = await this.requireGroup(endpoint.chatId)
    if (!isServingState(group.state)) {
      throw new LocusControllerError(
        'GROUP_UNAVAILABLE',
        `群 ${endpoint.chatId} 的群级结构处于 ${group.state}，不会静默切换。`,
      )
    }
    const archivedWork = group.mainSessionId !== request.parentSessionId && await this.isArchivedSession(group.mainSessionId)
    const previousLocus = archivedWork
      ? await this.deps.repository.findActive(endpoint)
      : await this.requireActiveLocus(endpoint, '群级')
    if (previousLocus === undefined || !isServingState(previousLocus.state)) {
      throw new LocusControllerError('GROUP_UNAVAILABLE', '当前入口已停止或不可用，不能通过换绑复活。')
    }
    if (!archivedWork && (group.mainSource !== 'auto' || previousLocus.source !== 'auto')) {
      if (group.mainSessionId === request.parentSessionId) {
        const warningText = await this.flushPendingSwitchNotice(previousLocus)
        return {
          group,
          locus: previousLocus,
          previousLocus,
          warningText,
          created: false,
        }
      }
      throw new LocusControllerError(
        'EXPLICIT_PARENT_CONFLICT',
        `群 ${endpoint.chatId} 已有显式主会话，需先解除后再绑定。`,
      )
    }
    if (!(await this.deps.repository.isLocusIdle(previousLocus.locusId))) {
      throw new LocusControllerError(
        'BUSY',
        `群 ${endpoint.chatId} 当前有执行中或排队消息，请空闲后再切换主会话。`,
      )
    }
    const parent = await this.resolveMainParent(request.parentSessionId, '显式替换 parent')
    if (parent.id === group.mainSessionId) {
      const warningText = await this.flushPendingSwitchNotice(previousLocus)
      return {
        group,
        locus: previousLocus,
        previousLocus,
        warningText,
        created: false,
      }
    }

    const lark = this.requireLark('自动主会话替换通知')
    const provisioningId = generatedId('provisioning', this.id)
    await this.beginProvisioning({
      provisioningId,
      kind: 'replacement',
      endpoint,
      parentSessionId: parent.id,
    })
    const resources: ProvisionedResources = {}
    let published = false
    const locusId = generatedId('locus', this.id)
    const generation = previousLocus.generation + 1
    try {
      const { main, created } = await this.ensureLocusMain(parent, provisioningId, resources)
      const warningText = renderAutomaticReplacementWarning({
        fromSessionId: workOf(previousLocus),
        ...(previousLocus.parentSessionTitle === undefined && group.mainSessionTitle === undefined
          ? {}
          : { fromTitle: previousLocus.parentSessionTitle ?? group.mainSessionTitle }),
        toSessionId: parent.id,
        ...(parent.title !== undefined ? { toTitle: parent.title } : {}),
      })

      // The switch and its notice debt are published atomically below. The
      // external send happens only afterwards; while debt remains, ordinary
      // dispatch is gated by the durable notice store.
      const nextLocus = this.notCreatedLocus({
        // Must be the exact identity allocated here: the controller publishes
        // exactly this id, never a second allocation.
        locusId,
        generation,
        endpoint,
        work: parent,
        main,
        source: 'explicit',
        replacesLocusId: previousLocus.locusId,
      })
      const nextGroup: LocusGroupRecord = {
        ...group,
        workspaceId: parent.workspaceId,
        mainSessionId: parent.id,
        ...(parent.title !== undefined ? { mainSessionTitle: parent.title } : {}),
        mainSource: 'explicit',
        state: nextLocus.state,
        createdAt: nextLocus.createdAt,
        updatedAt: nextLocus.createdAt,
      }
      await this.deps.repository.commitProvisioning({
        provisioningId,
        group: nextGroup,
        locus: nextLocus,
        ...(created ? { main } : {}),
        replace: { oldLocusId: previousLocus.locusId, noticeText: warningText, ...(archivedWork ? { archivedWork: true } : {}) },
      })
      published = true
      this.releaseMainLease(provisioningId)
      await resources.locusMain?.commit?.()
      await this.completeProvisioning(provisioningId)
      try {
        await lark.sendControlMessage({ endpoint, text: warningText })
        await this.deps.repository.acknowledgeSwitchNotice(
          nextLocus.locusId,
          nextLocus.generation,
        )
      } catch (error) {
        throw new LocusControllerError(
          'NOTIFICATION_FAILED',
          '主会话切换已持久化，但通知尚未确认送达；新关联保持暂停并等待重试。',
          error,
        )
      }
      return {
        group: nextGroup,
        locus: nextLocus,
        previousLocus,
        warningText,
        created: true,
      }
    } catch (error) {
      if (published) {
        // The new generation and notice debt are already durable. Never release
        // its sessions or rewrite the committed operation as failed.
        if (error instanceof LocusControllerError) throw error
        throw new LocusControllerError(
          'NOTIFICATION_FAILED',
          '主会话切换已持久化，但通知尚未确认送达；新关联保持暂停并等待重试。',
          error,
        )
      }
      await this.rollbackResources(resources)
      await this.failProvisioning(provisioningId, safeErrorMessage(error))
      if (error instanceof LocusControllerError) throw error
      throw new LocusControllerError(
        'PROVISIONING_FAILED',
        `群 ${endpoint.chatId} 的显式主会话切换失败，旧关联保持不变。`,
        error,
      )
    }
  }

  /**
   * Resolve the parent for a rebuild, optionally falling back to a fresh one.
   *
   * With `allowFreshParent` unset this is exactly {@link resolveMainParent}:
   * an owner-driven rebuild still surfaces "the recorded session is archived /
   * gone", which is the actionable answer for someone looking at the panel.
   *
   * With it set — automatic recovery of a generation the HOST invalidated —
   * an unusable recorded parent is replaced by a newly created main session in
   * the default workspace, the same way first-time provisioning establishes
   * one. Refusing instead would strand the endpoint: the recorded parent is
   * the only one a rebuild is ever offered, so there is no second attempt to
   * make. This never revives or re-parents the invalid generation itself; that
   * child is left untouched as durable history and a brand-new one is created.
   * @param request - the rebuild request.
   * @returns the parent to build the replacement generation on.
   */
  private async resolveRebuildParent(request: RebuildLocusRequest): Promise<LocusParentSession> {
    try {
      return await this.resolveMainParent(request.parentSessionId, '显式重建 parent')
    } catch (error) {
      if (request.allowFreshParent !== true) throw error
      const workspace = await this.deps.dsh.resolveDefaultWorkspace()
      if (workspace === undefined || workspace.id.trim() === '') {
        throw new LocusControllerError(
          'DEFAULT_WORKSPACE_UNAVAILABLE',
          '原主会话不可用，且未配置 default workspace，无法自动建立新主会话。',
        )
      }
      const created = await this.deps.dsh.createMainSession({
        workspaceId: workspace.id,
        label: this.mainLabel(
          endpointOf(
            request.endpoint.threadId === undefined
              ? { chatId: request.endpoint.chatId }
              : { chatId: request.endpoint.chatId, threadId: request.endpoint.threadId },
          ),
          undefined,
        ),
        chatId: request.endpoint.chatId,
      })
      assertSessionShape(created, undefined, workspace.id, '恢复用主会话')
      return {
        id: created.id,
        workspaceId: workspace.id,
        ...(created.title === undefined ? {} : { title: created.title }),
        state: 'active',
      }
    }
  }

  /** Whether the exact recorded session is archived, proved from the Host. */
  private async isArchivedSession(sessionId: string): Promise<boolean> {
    if (sessionId.trim() === '') return false
    try {
      const session = await this.deps.dsh.resolveSession(sessionId)
      return session !== undefined && session.id === sessionId && session.state === 'archived'
    } catch {
      // Cannot prove it is archived, and treating "unknown" as archived would
      // let an unreadable registry replace a generation that is serving fine.
      return false
    }
  }

  /**
   * Move every entry of one archived main session onto ONE newly created main.
   *
   * This is a SESSION-level operation on purpose. The entries listed under an
   * archived session all went out of service for the same reason, and the
   * repair is a single decision — "stop using that session" — so it must
   * produce a single replacement session. Rebuilding each entry through the
   * per-entry path would create one new main session per entry, silently
   * splitting what used to be one shared session into as many as there are
   * groups.
   *
   * Entries are re-proved one by one: each must still be the current
   * generation of its endpoint and must still record the archived session as
   * its parent. A stale panel list therefore moves nothing it should not.
   * @param request - the archived session plus the entries the owner selected.
   * @returns the replacement session and one outcome per requested entry.
   */
  async replaceArchivedParent(request: {
    readonly parentSessionId: string
    readonly entries: readonly {
      readonly endpoint: LocusEndpoint
      readonly locusId: string
    }[]
  }): Promise<{
    readonly parentSessionId: string
    readonly replaced: readonly string[]
    readonly skipped: readonly { readonly locusId: string; readonly reason: string }[]
  }> {
    const recorded = requireNonEmpty(request.parentSessionId, 'parentSessionId')
    if (request.entries.length === 0) {
      throw new LocusControllerError('INVALID_REQUEST', '没有指定要迁移的入口。')
    }
    if (!(await this.isArchivedSession(recorded))) {
      // Refuse rather than no-op: the owner asked for a repair that only an
      // archived session needs, so a non-archived one means a stale panel —
      // and moving entries off a serving session would be destructive.
      throw new LocusControllerError(
        'PARENT_NOT_ALLOWED',
        '该主会话当前未被归档，无需接替；如要更换主会话请在单个入口上重建。',
      )
    }
    const session = await this.deps.dsh.resolveSession(recorded)
    const workspaceId = session?.workspaceId?.trim() ?? ''
    if (workspaceId === '') {
      throw new LocusControllerError('PARENT_NOT_FOUND', '原主会话的工作区无法确认，已停止操作。')
    }

    // Prove every entry is movable BEFORE creating the replacement session.
    // Discovering it afterwards is what left a freshly created main session
    // with nothing on it — a session the owner never asked for, which then has
    // to be cleaned up (and a cleanup that only detaches reappears in their
    // ungrouped bucket). Refusing here has no side effect at all.
    const refusals: { readonly locusId: string; readonly reason: string }[] = []
    for (const entry of request.entries) {
      const current = await this.deps.repository.findActive(entry.endpoint)
      if (current === undefined || current.locusId !== entry.locusId) {
        refusals.push({ locusId: entry.locusId, reason: '入口当前代际已变化，请刷新后重试。' })
        continue
      }
      if (workOf(current) !== recorded) {
        refusals.push({ locusId: entry.locusId, reason: '入口已不属于该主会话，请刷新后重试。' })
        continue
      }
      if (isOwnerExit(current.state)) {
        refusals.push({ locusId: entry.locusId, reason: '入口由所有者停止/退役，不迁移。' })
        continue
      }
      if (!(await this.deps.repository.isLocusIdle(current.locusId))) {
        refusals.push({ locusId: entry.locusId, reason: '入口仍有在途工作，请空闲后再迁移。' })
      }
    }
    if (refusals.length === request.entries.length) {
      throw new LocusControllerError(
        'GROUP_UNAVAILABLE',
        `没有任何入口可以迁移：${refusals[0]!.reason}`,
      )
    }

    // One replacement for the whole session, created in the ARCHIVED
    // session's own workspace: relocating the owner's entries into the
    // configured default workspace would move their work somewhere they never
    // put it.
    const anchor = request.entries[0]!
    // The replacement CONTINUES the archived session's job, so it inherits that
    // session's own title. Passing the old title in as a chat NAME stacked
    // another 「Locus 主会话 ·」 prefix onto it and produced
    // 「Locus 主会话 · Locus 主会话 · oc_…」, which reads as a stray session
    // rather than as the successor of the one the owner just retired.
    const inherited = session?.title?.trim() ?? ''
    const created = await this.deps.dsh.createMainSession({
      workspaceId,
      label: inherited !== ''
        ? inherited
        : this.mainLabel(endpointOf(
          anchor.endpoint.threadId === undefined
            ? { chatId: anchor.endpoint.chatId }
            : { chatId: anchor.endpoint.chatId, threadId: anchor.endpoint.threadId },
        ), undefined),
      chatId: anchor.endpoint.chatId,
    })
    assertSessionShape(created, undefined, workspaceId, '接替用主会话')

    const replaced: string[] = []
    const skipped: { readonly locusId: string; readonly reason: string }[] = [...refusals]
    const refused = new Set(refusals.map(item => item.locusId))
    for (const entry of request.entries) {
      // Already refused above, with the reason the owner needs; retrying it
      // would only produce a second, less specific entry for the same id.
      if (refused.has(entry.locusId)) continue
      try {
        await this.rebuildExplicit({
          endpoint: entry.endpoint,
          previousLocusId: entry.locusId,
          parentSessionId: created.id,
          // Re-proves the archived parent for THIS generation inside the
          // rebuild, which is what authorizes replacing a non-terminal row.
          replaceArchivedParent: true,
        })
        replaced.push(entry.locusId)
      } catch (error: unknown) {
        skipped.push({
          locusId: entry.locusId,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
    if (replaced.length === 0) {
      // Nothing moved, so the freshly created session has no owner. It MUST be
      // rolled back: an orphan main session looks like the owner's work, shows
      // up in their session list, and nothing will ever use it.
      //
      // Via the creator's own `rollback` hook, not `releaseSession`: the
      // production adapter deliberately does NOT publish a generic session
      // release ("only a creator-held rollback closure may tear down a session
      // created by this adapter"), so the generic call is a silent no-op and
      // the orphan survives exactly the failure it was meant to clean up.
      await this.rollbackSession(created)
      throw new LocusControllerError(
        'GROUP_UNAVAILABLE',
        skipped[0] === undefined
          ? '没有任何入口被迁移。'
          : `没有任何入口被迁移：${skipped[0].reason}`,
      )
    }
    return { parentSessionId: created.id, replaced, skipped }
  }

  // -- three-tier establishment --------------------------------------------

  /**
   * Make sure one entry can take its next message, establishing or repairing
   * whatever it needs, and say what was done.
   *
   * This is the single entry point for the delivery path. It never creates a
   * child session: the most it does is publish a `not-created` generation
   * (under a possibly new locus main). What it repairs, and why each case is a
   * different repair:
   *
   * - no row at all: first establishment (auto);
   * - a previous-model row: retired and re-established the auto way, in a
   *   brand-new work session — never on the user's session it used to borrow;
   * - the locus main is unavailable: a new locus main for the SAME work
   *   session, with every entry the owner did not exit moved onto it;
   * - only this entry's child is unusable: a new generation under the SAME
   *   locus main, leaving its siblings alone;
   * - the work session is archived, or the owner exited the entry: refused —
   *   those are owner decisions and are never undone from here.
   *
   * A child lost to the runtime's capacity limit is deliberately not in this
   * list: that is a retry, not a repair, and never reaches this method.
   */
  async ensureEntry(request: EnsureEntryRequest): Promise<EnsureEntryResult> {
    const endpoint = endpointOf(
      request.threadId === undefined
        ? { chatId: request.chatId }
        : { chatId: request.chatId, threadId: request.threadId },
    )
    const named = request.chatName === undefined ? {} : { chatName: request.chatName }
    const latest = await this.deps.repository.findActive(endpoint)
    if (latest === undefined) {
      const ensured = endpoint.threadId === undefined
        ? await this.ensureGroup({ chatId: endpoint.chatId, ...named })
        : await this.ensureTopic({ chatId: endpoint.chatId, threadId: endpoint.threadId, ...named })
      return { locus: ensured.locus, group: ensured.group, created: ensured.created }
    }
    return this.withLock(`group:${endpoint.chatId}`, async () =>
      this.withLock(`endpoint:${locusEndpointKey(endpoint)}`, async () => {
        const current = await this.deps.repository.findActive(endpoint)
        if (current === undefined) {
          throw new LocusControllerError('REPOSITORY_INCONSISTENT', `入口 ${endpointLabel(endpoint)} 的当前代际已消失。`)
        }
        return this.repairEntryLocked(endpoint, current, request.chatName)
      }),
    )
  }

  private async repairEntryLocked(
    endpoint: LocusEndpoint,
    current: LocusRecord,
    chatName: string | undefined,
  ): Promise<EnsureEntryResult> {
    const { disposition, main, workArchived } = await this.classify(current)
    const group = endpoint.threadId === undefined ? undefined : await this.deps.repository.findGroup(endpoint.chatId)
    switch (disposition.kind) {
      case 'serve':
      case 'create':
        return { locus: current, ...(group === undefined ? {} : { group }), created: false }
      case 'terminal':
        throw new LocusControllerError(
          workArchived ? 'SOURCE_ARCHIVED' : endpoint.threadId === undefined ? 'GROUP_UNAVAILABLE' : 'TOPIC_UNAVAILABLE',
          workArchived
            ? '来源会话已归档，普通 @ 不会自动恢复或换来源。请恢复该会话，或用 /bind 绑定到新的干活主会话。'
            : `入口 ${endpointLabel(endpoint)} ${disposition.reason}，不会静默重建。`,
        )
      case 'replace': {
        if (disposition.why === 'previous-model') {
          return this.establishFromPreviousModelLocked(endpoint, current, chatName)
        }
        if (disposition.why === 'locus-main-unavailable' && main !== undefined) {
          return this.migrateLocusMainLocked(main, endpoint, current)
        }
        return this.regenerateUnderSameMainLocked(endpoint, current, main, disposition.reason)
      }
    }
  }

  /**
   * The endpoint's latest row when it belongs to the previous model and the
   * owner did not exit it; undefined otherwise. An owner's stop is never read as
   * "old", so an old but stopped entry stays stopped.
   */
  private async previousModelRow(endpoint: LocusEndpoint): Promise<LocusRecord | undefined> {
    const latest = await this.deps.repository.findActive(endpoint)
    if (latest === undefined || isOwnerExit(latest.state)) return undefined
    return (await this.deps.repository.findMain(latest.parentSessionId)) === undefined ? latest : undefined
  }

  /**
   * Publish a successor generation for an entry whose child cannot serve, under
   * the locus main it already has. Siblings are untouched.
   */
  private async regenerateUnderSameMainLocked(
    endpoint: LocusEndpoint,
    current: LocusRecord,
    main: LocusMainRecord | undefined,
    reason: string,
  ): Promise<EnsureEntryResult> {
    if (main === undefined || main.status !== 'active') {
      throw new LocusControllerError('LOCUS_MAIN_UNAVAILABLE', `入口 ${endpointLabel(endpoint)} 的 locus 主会话不可用。`)
    }
    if (!(await this.deps.repository.isLocusIdle(current.locusId))) {
      throw new LocusControllerError('BUSY', `入口 ${endpointLabel(endpoint)} 仍有执行中或排队消息，请空闲后再重建。`)
    }
    const work = await this.resolveMainParent(main.workSessionId, '入口重建的干活主会话')
    const provisioningId = generatedId('provisioning', this.id)
    await this.beginProvisioning({ provisioningId, kind: 'regenerate', endpoint, parentSessionId: work.id })
    try {
      const successor = this.notCreatedLocus({
        endpoint,
        work,
        main,
        source: current.source,
        generation: current.generation + 1,
        replacesLocusId: current.locusId,
        ...(current.parentLocusId === undefined ? {} : { parentLocusId: current.parentLocusId }),
      })
      await this.deps.repository.commitRegeneration({
        provisioningId,
        entries: [{ oldLocusId: current.locusId, reason, locus: successor }],
      })
      await this.completeProvisioning(provisioningId)
      return { locus: successor, created: true }
    } catch (error) {
      await this.failProvisioning(provisioningId, safeErrorMessage(error))
      if (error instanceof LocusControllerError) throw error
      throw new LocusControllerError('PROVISIONING_FAILED', `入口 ${endpointLabel(endpoint)} 的新一代发布失败，旧代际保持不变。`, error)
    }
  }

  /**
   * Retire a previous-model entry and establish the three-tier structure the
   * auto way: a NEW work session in the default workspace and a locus main for
   * it. The old row is not rewritten here — the commit marks it `invalid` as
   * the successor is published, and its child is never adopted or resumed.
   */
  private async establishFromPreviousModelLocked(
    endpoint: LocusEndpoint,
    previous: LocusRecord,
    chatName: string | undefined,
    /** An owner's `/bind` target; absent means the auto way. */
    explicitWork?: string,
  ): Promise<EnsureEntryResult> {
    if (!(await this.deps.repository.isLocusIdle(previous.locusId))) {
      throw new LocusControllerError('BUSY', `入口 ${endpointLabel(endpoint)} 仍有执行中或排队消息，请空闲后再建立。`)
    }
    const isTopic = endpoint.threadId !== undefined
    // A topic is established under its group, which is established first.
    let groupLocus: LocusRecord | undefined
    let groupResult: EnsureEntryResult | undefined
    if (isTopic) {
      const groupEndpoint: LocusEndpoint = { chatId: endpoint.chatId }
      const latestGroup = await this.deps.repository.findActive(groupEndpoint)
      if (latestGroup === undefined) {
        throw new LocusControllerError('GROUP_UNAVAILABLE', `话题 ${endpointLabel(endpoint)} 缺少群级结构。`)
      }
      groupResult = await this.repairEntryLocked(groupEndpoint, latestGroup, chatName)
      groupLocus = groupResult.locus
    }

    const provisioningId = generatedId('provisioning', this.id)
    await this.beginProvisioning({ provisioningId, kind: 'regenerate', endpoint })
    const resources: ProvisionedResources = {}
    let published = false
    try {
      let work: LocusParentSession
      if (explicitWork !== undefined) {
        work = await this.resolveMainParent(explicitWork, '显式绑定的干活主会话')
      } else if (isTopic) {
        const groupMain = await this.deps.repository.findMain((groupLocus as LocusRecord).parentSessionId)
        if (groupMain === undefined) {
          throw new LocusControllerError('GROUP_UNAVAILABLE', '群级入口尚未建立三层结构。')
        }
        work = await this.resolveMainParent(groupMain.workSessionId, '话题继承的干活主会话')
      } else {
        work = await this.createAutoWorkSession(provisioningId, endpoint, chatName, resources)
      }
      const { main, created: mainCreated } = await this.ensureLocusMain(work, provisioningId, resources)
      const successor = this.notCreatedLocus({
        endpoint,
        work,
        main,
        source: explicitWork !== undefined ? 'explicit' : isTopic ? 'inherited' : 'auto',
        generation: previous.generation + 1,
        replacesLocusId: previous.locusId,
        ...(groupLocus === undefined ? {} : { parentLocusId: groupLocus.locusId }),
      })
      await this.deps.repository.commitRegeneration({
        provisioningId,
        entries: [{ oldLocusId: previous.locusId, reason: LEGACY_RETIRED_REASON, previousModel: true, locus: successor }],
        ...(mainCreated ? { main } : {}),
      })
      published = true
      this.releaseMainLease(provisioningId)
      await resources.locusMain?.commit?.()
      await this.completeProvisioning(provisioningId)
      return {
        locus: successor,
        ...(groupResult?.group === undefined ? {} : { group: groupResult.group }),
        created: true,
        notice: LEGACY_RETIRED_NOTICE,
      }
    } catch (error) {
      if (published) {
        this.logPublishedFinalizeFailure(provisioningId, `旧入口 ${endpointLabel(endpoint)}`, error)
        throw new LocusControllerError('PROVISIONING_FAILED', '旧入口的新结构已发布，但会话 finalize 失败；等待恢复对账。', error)
      }
      await this.rollbackResources(resources)
      await this.failProvisioning(provisioningId, safeErrorMessage(error))
      if (error instanceof LocusControllerError) throw error
      throw new LocusControllerError('PROVISIONING_FAILED', `旧入口 ${endpointLabel(endpoint)} 的新结构建立失败，旧标记保持不变。`, error)
    }
  }

  /**
   * The locus main of a work session cannot serve: pair the SAME work session
   * with a new locus main and move onto it every entry the owner did not exit.
   * The old locus main and its children are never resumed.
   */
  private async migrateLocusMainLocked(
    old: LocusMainRecord,
    trigger: LocusEndpoint,
    triggerLocus: LocusRecord,
  ): Promise<EnsureEntryResult> {
    const work = await this.resolveMainParent(old.workSessionId, '迁移 locus 主会话的干活主会话')
    const entries = await this.deps.repository.listEntriesOfMain(old.locusMainSessionId)
    const skipped: { readonly locusId: string; readonly reason: string }[] = []
    const movable: LocusRecord[] = []
    for (const entry of entries) {
      if (isOwnerExit(entry.state)) {
        skipped.push({ locusId: entry.locusId, reason: '入口由所有者停止/退役，不迁移。' })
      } else if (!(await this.deps.repository.isLocusIdle(entry.locusId))) {
        skipped.push({ locusId: entry.locusId, reason: '入口仍有在途工作，请空闲后再迁移。' })
      } else {
        movable.push(entry)
      }
    }
    // A topic can only follow a chat-level entry that is itself serving or moving.
    const movingIds = new Set(movable.map(entry => entry.locusId))
    const movableFinal = movable.filter(entry => {
      if (entry.parentLocusId === undefined || movingIds.has(entry.parentLocusId)) return true
      const parent = entries.find(candidate => candidate.locusId === entry.parentLocusId)
      if (parent !== undefined && isServingState(parent.state)) return true
      skipped.push({ locusId: entry.locusId, reason: '所属群级入口未迁移，话题无法单独迁移。' })
      return false
    })
    if (!movableFinal.some(entry => entry.locusId === triggerLocus.locusId)) {
      throw new LocusControllerError(
        'LOCUS_MAIN_UNAVAILABLE',
        `入口 ${endpointLabel(trigger)} 暂时无法迁移到新的 locus 主会话：${skipped.find(item => item.locusId === triggerLocus.locusId)?.reason ?? '未知原因'}`,
      )
    }

    const provisioningId = generatedId('provisioning', this.id)
    await this.beginProvisioning({
      provisioningId,
      kind: 'regenerate',
      endpoint: { chatId: `locus-main-migration:${work.id}` },
      parentSessionId: work.id,
    })
    const resources: ProvisionedResources = {}
    let published = false
    try {
      const { main, created } = await this.ensureLocusMain(work, provisioningId, resources, { retiring: old })
      // Chat-level entries first, so a topic's successor can name its new parent.
      const ordered = [...movableFinal].sort(
        (left, right) => Number(left.endpoint.threadId !== undefined) - Number(right.endpoint.threadId !== undefined),
      )
      const successorByOld = new Map<string, LocusRecord>()
      const regenerated: LocusRegeneratedEntry[] = []
      for (const entry of ordered) {
        const remappedParent = entry.parentLocusId === undefined
          ? undefined
          : successorByOld.get(entry.parentLocusId)?.locusId ?? entry.parentLocusId
        const successor = this.notCreatedLocus({
          endpoint: entry.endpoint,
          work,
          main,
          source: entry.source,
          generation: entry.generation + 1,
          replacesLocusId: entry.locusId,
          ...(remappedParent === undefined ? {} : { parentLocusId: remappedParent }),
        })
        successorByOld.set(entry.locusId, successor)
        regenerated.push({ oldLocusId: entry.locusId, reason: MAIN_MIGRATED_REASON, locus: successor })
      }
      await this.deps.repository.commitRegeneration({
        provisioningId,
        entries: regenerated,
        ...(created ? { main } : {}),
        retireMain: { locusMainSessionId: old.locusMainSessionId, reason: 'locus 主会话不可用，已为干活主会话新建' },
      })
      published = true
      this.releaseMainLease(provisioningId)
      await resources.locusMain?.commit?.()
      await this.completeProvisioning(provisioningId)
      const successor = successorByOld.get(triggerLocus.locusId) as LocusRecord
      const migration: LocusMainMigration = { migrated: regenerated.length, skipped }
      return { locus: successor, created: true, migration, notice: renderMigrationNotice(migration) }
    } catch (error) {
      if (published) {
        this.logPublishedFinalizeFailure(provisioningId, `locus 主会话迁移 ${old.locusMainSessionId}`, error)
        throw new LocusControllerError('PROVISIONING_FAILED', 'locus 主会话迁移已发布，但会话 finalize 失败；等待恢复对账。', error)
      }
      await this.rollbackResources(resources)
      await this.failProvisioning(provisioningId, safeErrorMessage(error))
      if (error instanceof LocusControllerError) throw error
      throw new LocusControllerError('PROVISIONING_FAILED', 'locus 主会话迁移失败，旧关联保持不变。', error)
    }
  }

  /** Auto path: a brand-new work session in the default workspace. */
  private async createAutoWorkSession(
    provisioningId: string,
    endpoint: LocusEndpoint,
    chatName: string | undefined,
    resources: ProvisionedResources,
  ): Promise<LocusParentSession> {
    const workspace = await this.deps.dsh.resolveDefaultWorkspace()
    if (workspace === undefined || workspace.id.trim() === '') {
      throw new LocusControllerError(
        'DEFAULT_WORKSPACE_UNAVAILABLE',
        '未配置或无法解析 default workspace，已停止自动创建干活主会话。',
      )
    }
    const work = await this.deps.dsh.createMainSession({
      workspaceId: workspace.id,
      label: this.mainLabel(endpoint, chatName),
      chatId: endpoint.chatId,
    })
    resources.work = work
    assertSessionShape(work, undefined, workspace.id, '自动干活主会话')
    await this.recordResource(provisioningId, { mainSessionId: work.id })
    return {
      id: work.id,
      workspaceId: workspace.id,
      ...(work.title !== undefined ? { title: work.title } : {}),
      state: 'active',
    }
  }

  /**
   * The active locus main of a work session: reused when it can still serve,
   * created (and wired into its collaboration space) otherwise.
   *
   * Nothing is published here. A locus main whose space could not be set up is
   * rolled back by the caller, so a half-built pairing is never addressable.
   */
  private async ensureLocusMain(
    work: LocusParentSession,
    provisioningId: string,
    resources: ProvisionedResources,
    options: { readonly retiring?: LocusMainRecord } = {},
  ): Promise<{ readonly main: LocusMainRecord; readonly created: boolean }> {
    const key = `main:${work.id}`
    const previous = this.locks.get(key) ?? Promise.resolve()
    let release!: () => void
    const lease = new Promise<void>(resolve => { release = resolve })
    const tail = previous.catch(() => {}).then(() => lease)
    this.locks.set(key, tail)
    await previous.catch(() => {})
    this.mainLeases.set(provisioningId, () => {
      release()
      if (this.locks.get(key) === tail) this.locks.delete(key)
    })
    if (options.retiring === undefined) {
      const existing = await this.deps.repository.findActiveMain(work.id)
      if (existing !== undefined) {
        if (await this.isMainUsable(existing)) return { main: existing, created: false }
        throw new LocusControllerError(
          'LOCUS_MAIN_UNAVAILABLE',
          `干活主会话 ${shortLocusSessionLabel(work.id, work.title)} 的 locus 主会话不可用；下一条授权 @ 会为它新建并迁移入口。`,
        )
      }
    }
    const establishSpace = this.deps.establishSpace
    if (establishSpace === undefined) {
      throw new LocusControllerError('CAPABILITY_UNAVAILABLE', '建立 locus 主会话需要已注入的协作空间端口，未执行任何外部操作。')
    }
    const created = await this.deps.dsh.createLocusMainSession({
      workSessionId: work.id,
      workspaceId: work.workspaceId,
      label: this.locusMainLabel(work),
    })
    resources.locusMain = created
    assertSessionShape(created, undefined, this.deps.dsh.locusMainWorkspaceId, 'locus 主会话')
    const mainWorkspaceId = requireNonEmpty(created.workspaceId, 'locusMainWorkspaceId')
    await this.recordResource(provisioningId, { locusMainSessionId: created.id })
    let space: LocusSpaceEstablishment
    try {
      space = await establishSpace({ workSessionId: work.id, locusMainSessionId: created.id })
    } catch (error) {
      throw new LocusControllerError('PROVISIONING_FAILED', '协作空间建立失败，已停止建立入口。', error)
    }
    if (!space.ok) {
      throw new LocusControllerError(
        'PROVISIONING_FAILED',
        space.reason === 'work-not-invitable'
          ? '干活主会话当前不能被邀请进协作空间，未建立入口。'
          : `协作空间建立失败（${space.reason}${'code' in space && space.code ? `/${space.code}` : ''}），未建立入口。`,
      )
    }
    const now = this.now()
    return {
      created: true,
      main: {
        locusMainSessionId: created.id,
        workSessionId: work.id,
        generation: (options.retiring?.generation ?? 0) + 1,
        status: 'active',
        spaceId: space.spaceId,
        workspaceId: mainWorkspaceId,
        createdAt: now,
        updatedAt: now,
      },
    }
  }

  /** A fresh `not-created` generation: nothing external exists for its child yet. */
  private notCreatedLocus(input: {
    readonly endpoint: LocusEndpoint
    readonly work: LocusParentSession
    readonly main: LocusMainRecord
    readonly source: LocusSource
    readonly parentLocusId?: string
    readonly generation?: number
    readonly replacesLocusId?: string
    readonly locusId?: string
  }): LocusRecord {
    return {
      locusId: input.locusId ?? generatedId('locus', this.id),
      generation: input.generation ?? 1,
      endpoint: input.endpoint,
      workspaceId: input.work.workspaceId,
      parentSessionId: input.main.locusMainSessionId,
      ...(input.work.title !== undefined ? { parentSessionTitle: input.work.title } : {}),
      workSessionId: input.work.id,
      reservedChildSessionId: (this.deps.reserveChildSessionId ?? (() => `session-${randomUUID()}`))(),
      ...(input.parentLocusId === undefined ? {} : { parentLocusId: input.parentLocusId }),
      source: input.source,
      state: 'not-created',
      permission: 'read',
      createdAt: this.now(),
      ...(input.replacesLocusId === undefined ? {} : { replacesLocusId: input.replacesLocusId }),
    }
  }

  /** The chat-level structure that mirrors one chat-level locus. */
  private groupFor(
    endpoint: LocusEndpoint,
    chatName: string | undefined,
    work: LocusParentSession,
    mainSource: LocusMainSource,
    locus: LocusRecord,
  ): LocusGroupRecord {
    return {
      chatId: endpoint.chatId,
      ...(chatName !== undefined ? { chatName } : {}),
      workspaceId: locus.workspaceId,
      mainSessionId: work.id,
      ...(work.title !== undefined ? { mainSessionTitle: work.title } : {}),
      mainSource,
      state: locus.state,
      createdAt: locus.createdAt,
      updatedAt: locus.createdAt,
    }
  }

  private async resolveMainParent(
    sessionId: string,
    operation: string,
  ): Promise<LocusParentSession> {
    const normalized = requireNonEmpty(sessionId, 'parentSessionId')
    let session: LocusParentSession | undefined
    try {
      session = await this.deps.dsh.resolveSession(normalized)
    } catch (error) {
      throw new LocusControllerError(
        'PARENT_NOT_FOUND',
        `${operation} ${shortLocusSessionLabel(normalized)} 当前不可用，已停止操作。`,
        error,
      )
    }
    if (session?.state === 'archived') {
      // Archived is reversible, unlike missing — the session's bytes and
      // history are still on disk, only its workspace-registry membership is
      // hidden. Saying only "unavailable, stopped" here used to strand an
      // owner: rebuild's parentSessionId comes from the STOPPED locus record
      // (the only session that was ever this endpoint's main session), so
      // there was no path back into this method with a different id, and
      // ordinary `@bot` refuses a stopped/invalid endpoint with "rebuild it"
      // — a rebuild whose only possible parent is the one this branch always
      // refused. Naming the reversible cause tells the owner the one action
      // that actually unblocks it, instead of a dead end wearing the same
      // wording as a truly gone session.
      throw new LocusControllerError(
        'PARENT_NOT_FOUND',
        `${operation} ${shortLocusSessionLabel(normalized, session.title)} 已被归档，已停止操作。` +
        '两个可用的修法：在「会话归档管理」中恢复该会话后重试；' +
        '或改用「用新的主会话重建」，让本入口改挂到一个新建的主会话上。',
      )
    }
    if (session === undefined || session.state === 'missing') {
      throw new LocusControllerError(
        'PARENT_NOT_FOUND',
        `${operation} ${shortLocusSessionLabel(normalized)} 当前不可用，已停止操作。`,
      )
    }
    if (session.id !== normalized || session.parentSessionId !== undefined) {
      throw new LocusControllerError(
        'PARENT_NOT_ALLOWED',
        `${operation} 必须指定可用的主会话，不能使用子会话作为绑定源。`,
      )
    }
    // A locus main is Pet's own plumbing, not the owner's work: binding one as
    // a work session would make an entry serve its own coordinator.
    if ((await this.deps.repository.findMain(session.id)) !== undefined) {
      throw new LocusControllerError(
        'PARENT_NOT_ALLOWED',
        `${operation} 不能使用 Pet 自己创建的 locus 主会话作为干活主会话。`,
      )
    }
    if (session.workspaceId.trim() === '') {
      throw new LocusControllerError(
        'PARENT_NOT_FOUND',
        `${operation} 的 workspace 无法确认，已停止操作。`,
      )
    }
    // No preset condition: the locus child composes from Pet's own
    // LOCUS_CHILD_PRESET, not from this session, so any unarchived main
    // session is a valid bind target (spec: `/bind` matches 未归档主会话).
    return session
  }

  private async requireGroup(chatId: string): Promise<LocusGroupRecord> {
    const group = await this.deps.repository.findGroup(chatId)
    if (group === undefined) {
      throw new LocusControllerError(
        'REPOSITORY_INCONSISTENT',
        `群 ${chatId} 缺少群级结构，无法安全继续。`,
      )
    }
    return group
  }

  private async requireActiveLocus(endpoint: LocusEndpoint, label: string): Promise<LocusRecord> {
    const locus = await this.deps.repository.findActive(endpoint)
    if (locus === undefined) {
      throw new LocusControllerError(
        'REPOSITORY_INCONSISTENT',
        `${label} ${endpointLabel(endpoint)} 缺少 active locus，已停止操作。`,
      )
    }
    // Classified by the shared policy, not by a local reading of `state`:
    // every layer that decides "may this proceed / may this be replaced" must
    // agree, and hand-written copies are what let three rounds of fixes each
    // move the refusal one layer deeper instead of removing it.
    const { disposition } = await this.classify(locus)
    if (disposition.kind !== 'serve' && disposition.kind !== 'create') {
      throw new LocusControllerError(
        label === '群级' ? 'GROUP_UNAVAILABLE' : 'TOPIC_UNAVAILABLE',
        disposition.kind === 'replace'
          // Reachable only when the provisioning seam did not take the
          // replacement path — a wiring gap worth naming precisely, because
          // the policy says this generation IS replaceable.
          ? `${label} ${endpointLabel(endpoint)} 需要被替换（${disposition.reason}），但本次调用未走替换路径。`
          : `${label} ${endpointLabel(endpoint)} ${disposition.reason}，不会静默重建。`,
      )
    }
    return locus
  }

  /**
   * The shared serviceability policy applied to one stored row, with the facts
   * only this layer can read: whether the row has a locus-main pairing (no
   * pairing = previous model), whether that main can still serve, and whether
   * the work session behind it is archived.
   */
  private async classify(locus: LocusRecord): Promise<{
    readonly disposition: ReturnType<typeof dispositionOf>
    readonly main: LocusMainRecord | undefined
    readonly workArchived: boolean
  }> {
    const main = await this.deps.repository.findMain(locus.parentSessionId)
    const legacy = main === undefined
    const workArchived = !legacy && await this.isArchivedSession(main.workSessionId)
    const mainUnavailable = !legacy && !workArchived && !isOwnerExit(locus.state) &&
      !(main.status === 'active' && await this.isMainUsable(main))
    return {
      main,
      workArchived,
      disposition: dispositionOf({
        ...locus,
        parentArchived: workArchived,
        legacy,
        mainUnavailable,
      }),
    }
  }

  /**
   * Whether a locus main can still serve: it resolves, is not archived, is a
   * top-level session, and still runs the neutral locus preset. A preset that
   * is not provably the reviewed one is a locus main that is not proven safe,
   * and "not proven" is not usable.
   */
  private async isMainUsable(main: LocusMainRecord): Promise<boolean> {
    let session: LocusParentSession | undefined
    try {
      session = await this.deps.dsh.resolveSession(main.locusMainSessionId)
    } catch {
      return false
    }
    return isUsableLocusMainSession(session, main.locusMainSessionId, this.deps.dsh.locusMainWorkspaceId)
  }

  private async flushPendingSwitchNotice(locus: LocusRecord): Promise<string> {
    const notice = await this.deps.repository.findSwitchNotice(
      locus.locusId,
      locus.generation,
    )
    if (notice === undefined) return ''
    const lark = this.requireLark('主会话切换通知重试')
    try {
      await lark.sendControlMessage({ endpoint: notice.endpoint, text: notice.text })
      await this.deps.repository.acknowledgeSwitchNotice(
        locus.locusId,
        locus.generation,
      )
      return notice.text
    } catch (error) {
      throw new LocusControllerError(
        'NOTIFICATION_FAILED',
        '主会话切换已持久化，但通知仍未确认送达；新关联保持暂停并等待重试。',
        error,
      )
    }
  }

  private requireLark(operation: string): LocusLarkPort {
    if (this.deps.lark === undefined) {
      throw new LocusControllerError(
        'CAPABILITY_UNAVAILABLE',
        `${operation} 需要已注入的 Lark 操作端口，未执行任何外部操作。`,
      )
    }
    return this.deps.lark
  }

  private mainLabel(endpoint: LocusEndpoint, chatName: string | undefined): string {
    return `协作工作会话 · ${chatName?.trim() || endpoint.chatId}`
  }

  private locusMainLabel(work: LocusParentSession): string {
    return `[locus] ${work.title?.trim() || shortLocusSessionId(work.id)}`
  }

  private childLabel(
    endpoint: LocusEndpoint,
    chatName: string | undefined,
    parentTitle: string | undefined,
  ): string {
    const name = chatName?.trim() || endpoint.chatId
    const suffix = parentTitle?.trim() === undefined ? '' : ` · ${parentTitle.trim()}`
    return `Locus 子会话 · ${name}${suffix}`
  }

  private async beginProvisioning(
    record: Omit<LocusProvisioningRecord, 'startedAt'>,
  ): Promise<void> {
    try {
      await this.deps.repository.beginProvisioning({ ...record, startedAt: this.now() })
    } catch (error) {
      throw new LocusControllerError(
        'PROVISIONING_FAILED',
        `无法登记 ${record.kind} provisioning，已停止外部创建。`,
        error,
      )
    }
  }

  private async recordResource(
    provisioningId: string,
    resource: {
      readonly mainSessionId?: string
      readonly locusMainSessionId?: string
      readonly childSessionId?: string
      readonly chatId?: string
    },
  ): Promise<void> {
    try {
      await this.deps.repository.recordProvisioningResource(provisioningId, resource)
    } catch (error) {
      throw new LocusControllerError(
        'PROVISIONING_FAILED',
        `无法记录 ${provisioningId} 的外部资源，已停止发布。`,
        error,
      )
    }
  }

  private logPublishedFinalizeFailure(
    provisioningId: string,
    resourceLabel: string,
    error: unknown,
  ): void {
    // commitProvisioning is the durable publication boundary. A later runtime
    // finalize error is recovery debt, not a failed provisioning transaction:
    // deleting external resources or rewriting the operation to failed would
    // leave committed indexes pointing at resources this catch block removed.
    this.deps.log?.(
      `locus provisioning ${provisioningId} published ${resourceLabel} but child finalize failed; recovery required: ${safeErrorMessage(error)}`,
    )
  }

  private async completeProvisioning(provisioningId: string): Promise<void> {
    try {
      await this.deps.repository.completeProvisioning(provisioningId)
    } catch (error) {
      // The active commit is already durable.  Do not roll back a published
      // locus because a best-effort recovery marker failed; leave a diagnostic
      // for restart reconciliation instead.
      this.deps.log?.(`locus provisioning ${provisioningId} completion marker failed: ${safeErrorMessage(error)}`)
    }
  }

  private releaseMainLease(provisioningId: string): void {
    this.mainLeases.get(provisioningId)?.()
    this.mainLeases.delete(provisioningId)
  }

  private async failProvisioning(provisioningId: string, reason: string): Promise<void> {
    this.releaseMainLease(provisioningId)
    try {
      await this.deps.repository.failProvisioning(provisioningId, reason.slice(0, 500))
    } catch (error) {
      this.deps.log?.(`locus provisioning ${provisioningId} failure marker failed: ${safeErrorMessage(error)}`)
    }
  }

  private async rollbackResources(resources: ProvisionedResources): Promise<{
    readonly work: boolean
    readonly locusMain: boolean
    readonly chat: boolean
  }> {
    // Locus main first: it was created for the work session and may need that
    // session to remain around long enough for its cleanup hook to execute.
    const locusMain = await this.rollbackSession(resources.locusMain)
    const work = await this.rollbackSession(resources.work)
    const chat = await this.rollbackChat(resources.chat)
    return { work, locusMain, chat }
  }

  private async rollbackSession(resource: ProvisionedSession | undefined): Promise<boolean> {
    if (resource === undefined) return true
    try {
      if (resource.rollback !== undefined) {
        await resource.rollback()
      } else if (this.deps.dsh.releaseSession !== undefined) {
        await this.deps.dsh.releaseSession(resource.id)
      } else {
        this.deps.log?.(`locus rollback has no DSH release hook for ${resource.id}`)
        return false
      }
      return true
    } catch (error) {
      this.deps.log?.(`locus rollback could not release session ${resource.id}: ${safeErrorMessage(error)}`)
      return false
    }
  }

  private async rollbackChat(resource: ProvisionedChat | undefined): Promise<boolean> {
    if (resource === undefined) return true
    try {
      if (resource.rollback !== undefined) {
        await resource.rollback()
      } else if (this.deps.lark?.deleteGroup !== undefined) {
        await this.deps.lark.deleteGroup(resource.chatId)
      } else {
        this.deps.log?.(`locus rollback has no Lark delete hook for ${resource.chatId}`)
        return false
      }
      return true
    } catch (error) {
      this.deps.log?.(`locus rollback could not delete chat ${resource.chatId}: ${safeErrorMessage(error)}`)
      return false
    }
  }

  /** FIFO lock for one key; all controller locks are process-local. */
  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(resolve => {
      release = resolve
    })
    const queued = previous.then(() => current)
    this.locks.set(key, queued)
    await previous
    try {
      return await fn()
    } finally {
      release()
      if (this.locks.get(key) === queued) this.locks.delete(key)
    }
  }
}

/** Factory form for callers that prefer a function over `new`. */
export function createLocusController(deps: LocusControllerDeps): LocusController {
  return new LocusController(deps)
}

/** Stateless convenience form; long-lived integrations should retain the controller. */
export async function ensureGroup(
  deps: LocusControllerDeps,
  request: EnsureGroupRequest,
): Promise<EnsureGroupResult> {
  return createLocusController(deps).ensureGroup(request)
}

/** Stateless convenience form for topic hierarchy creation. */
export async function ensureTopic(
  deps: LocusControllerDeps,
  request: EnsureTopicRequest,
): Promise<EnsureTopicResult> {
  return createLocusController(deps).ensureTopic(request)
}

/** Stateless convenience form for Q&A create-or-open. */
export async function createOrOpenDefaultQa(
  deps: LocusControllerDeps,
  request: DefaultQaRequest,
): Promise<DefaultQaResult> {
  return createLocusController(deps).createOrOpenDefaultQa(request)
}
