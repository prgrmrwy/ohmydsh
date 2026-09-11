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
 * - new children start read-only and a source is fixed at creation time;
 * - no partially provisioned external resource is published; and
 * - an automatic group may be replaced only while idle, with an explicit
 *   warning before the new generation can be used.
 *
 * The injected repository is expected to enforce the same invariants across
 * Host processes.  The in-memory locks here only close the common same-process
 * race; they are not a substitute for a conditional repository commit.
 */

import { endpointKeyOf } from './aggregate.js'

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
  readonly state: 'provisioning' | 'active' | 'switching' | 'invalid' | 'stopped' | 'retired'
  readonly createdAt: number
  readonly updatedAt: number
}

/** The persisted association for one endpoint and one generation. */
export interface LocusRecord {
  readonly locusId: string
  readonly generation: number
  readonly endpoint: LocusEndpoint
  readonly workspaceId: string
  readonly parentSessionId: string
  readonly parentSessionTitle?: string
  readonly childSessionId: string
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
  readonly kind: 'group' | 'topic' | 'qa' | 'replacement' | 'rebuild'
  readonly endpoint: LocusEndpoint
  readonly parentSessionId?: string
  readonly startedAt: number
}

/** An atomic publish request understood by the locus repository. */
export interface LocusProvisioningCommit {
  readonly provisioningId: string
  readonly group?: LocusGroupRecord
  readonly locus: LocusRecord
  /** Set only for the first/default Q&A group for a parent session. */
  readonly defaultQaForParentSessionId?: string
  /** Retire an active automatic generation and record its notice debt atomically. */
  readonly replace?: {
    readonly oldLocusId: string
    readonly noticeText: string
  }
  /** Publish over an unavailable latest marker without silently reviving it. */
  readonly rebuild?: {
    readonly oldLocusId: string
  }
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
  /** Whether no accepted/running work is attached to this locus generation. */
  isLocusIdle(locusId: string): Promise<boolean>
  /** Atomically publish a prepared group/locus generation. */
  commitProvisioning(input: LocusProvisioningCommit): Promise<void>
  beginProvisioning(record: LocusProvisioningRecord): Promise<void>
  recordProvisioningResource(
    provisioningId: string,
    resource: { readonly mainSessionId?: string; readonly childSessionId?: string; readonly chatId?: string },
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
  /** Create a locus child directly under the selected main session. */
  createChildSession(input: {
    parentSessionId: string
    workspaceId: string
    /** Caller-reserved locus identity used by synchronous fresh composition. */
    locusId: string
    generation: number
    label: string
    endpoint: LocusEndpoint
    permission: 'read'
  }): Promise<ProvisionedSession>
  /** Fallback cleanup when a returned resource has no per-resource hook. */
  releaseSession?(sessionId: string): Promise<void>
}

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
}

export interface RebuildLocusResult {
  readonly group: LocusGroupRecord
  readonly locus: LocusRecord
  readonly previousLocus: LocusRecord
  readonly created: true
  readonly reused: false
}

export type LocusControllerErrorCode =
  | 'INVALID_ENDPOINT'
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
      `${operation} 返回了 child session，已拒绝把它当作主会话发布。`,
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
        if (existing.state !== 'active') {
          throw new LocusControllerError(
            'GROUP_UNAVAILABLE',
            `群 ${endpoint.chatId} 的群级结构处于 ${existing.state}，不会静默重建。`,
          )
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
          const group = await this.requireGroup(endpoint.chatId)
          if (explicitParent !== undefined && existing.parentSessionId === explicitParent) {
            // Same-source bind is idempotent, and is also the explicit retry
            // path for a generation whose switch notice is still owed.
            await this.flushPendingSwitchNotice(existing)
            const current = await this.deps.repository.findActive(endpoint)
            if (current === undefined || current.state !== 'active') {
              throw new LocusControllerError(
                'TOPIC_UNAVAILABLE',
                `话题 ${endpointLabel(endpoint)} 的切换通知已处理，但当前代际仍不可服务。`,
              )
            }
            return { group, locus: current, created: false, reused: true, groupCreated: false }
          }
          if (explicitParent !== undefined && existing.source === 'explicit') {
            throw new LocusControllerError(
              'EXPLICIT_PARENT_CONFLICT',
              `话题 ${endpointLabel(endpoint)} 已显式绑定其它主会话，需先解除后再绑定。`,
            )
          }
          if (existing.state !== 'active') {
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
        if (existing.state !== 'active') {
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

      let child: ProvisionedSession | undefined
      let chat: ProvisionedChat | undefined
      let published = false
      const locusId = generatedId('locus', this.id)
      const generation = 1
      try {
        child = await this.deps.dsh.createChildSession({
          parentSessionId,
          workspaceId: parent.workspaceId,
          locusId,
          generation,
          label: qaGroupName(request.groupName),
          endpoint: endpointHint,
          permission: 'read',
        })
        assertSessionShape(child, parentSessionId, parent.workspaceId, 'Q&A 子会话')
        await this.recordResource(provisioningId, { childSessionId: child.id })

        chat = await lark.createGroup({ name: qaGroupName(request.groupName), ownerId })
        const chatId = requireNonEmpty(chat.chatId, 'created chatId')
        await this.recordResource(provisioningId, { chatId })
        const endpoint: LocusEndpoint = { chatId }
        const now = this.now()
        const group: LocusGroupRecord = {
          chatId,
          ...(chat.chatName !== undefined ? { chatName: chat.chatName } : {}),
          workspaceId: parent.workspaceId,
          mainSessionId: parent.id,
          ...(parent.title !== undefined ? { mainSessionTitle: parent.title } : {}),
          mainSource: 'qa-created',
          state: 'active',
          createdAt: now,
          updatedAt: now,
        }
        const locus: LocusRecord = {
          locusId,
          generation,
          endpoint,
          workspaceId: parent.workspaceId,
          parentSessionId: parent.id,
          ...(parent.title !== undefined ? { parentSessionTitle: parent.title } : {}),
          childSessionId: child.id,
          source: 'qa-created',
          state: 'active',
          permission: 'read',
          createdAt: now,
        }
        await this.deps.repository.commitProvisioning({
          provisioningId,
          group,
          locus,
          defaultQaForParentSessionId: parent.id,
        })
        published = true
        await child.commit?.()
        await this.completeProvisioning(provisioningId)
        return { group, locus, created: true, reused: false }
      } catch (error) {
        if (published) {
          this.logPublishedFinalizeFailure(provisioningId, 'Q&A 默认入口', error)
          throw new LocusControllerError(
            'PROVISIONING_FAILED',
            'Q&A 默认入口已持久化发布，但子会话 finalize 失败；已保留群、会话和 committed operation，等待恢复对账。',
            error,
          )
        }
        const cleanup = await this.rollbackResources(
          child === undefined && chat === undefined ? {} : { ...(child === undefined ? {} : { child }), ...(chat === undefined ? {} : { chat }) },
        )
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
        if (group.state !== 'active') {
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
        if (previous.state !== 'stopped' && previous.state !== 'invalid' && previous.state !== 'retired') {
          throw new LocusControllerError('GROUP_UNAVAILABLE', '只有停止、失效或退役入口可以显式重建。')
        }
        if (!(await this.deps.repository.isLocusIdle(previous.locusId))) {
          throw new LocusControllerError('BUSY', '入口仍有执行中或排队消息，请空闲后再重建。')
        }
        if (request.asDefaultQa === true && endpoint.threadId !== undefined) {
          throw new LocusControllerError('INVALID_ENDPOINT', '默认 Q&A 只能重建群级入口。')
        }
        const parent = await this.resolveMainParent(request.parentSessionId, '显式重建 parent')
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
        let child: ProvisionedSession | undefined
        let published = false
        try {
          child = await this.deps.dsh.createChildSession({
            parentSessionId: parent.id,
            workspaceId: parent.workspaceId,
            locusId,
            generation,
            label: this.childLabel(endpoint, group?.chatName, parent.title),
            endpoint,
            permission: 'read',
          })
          assertSessionShape(child, parent.id, parent.workspaceId, '重建后的子会话')
          await this.recordResource(provisioningId, { childSessionId: child.id })
          const now = this.now()
          const source: LocusSource = request.asDefaultQa === true ? 'qa-created' : 'explicit'
          const locus: LocusRecord = {
            locusId,
            generation,
            endpoint,
            workspaceId: parent.workspaceId,
            parentSessionId: parent.id,
            ...(parent.title === undefined ? {} : { parentSessionTitle: parent.title }),
            childSessionId: child.id,
            ...(parentLocusId === undefined ? {} : { parentLocusId }),
            source,
            state: 'active',
            permission: 'read',
            createdAt: now,
            replacesLocusId: previous.locusId,
          }
          const nextGroup: LocusGroupRecord | undefined = endpoint.threadId === undefined
            ? {
              chatId: endpoint.chatId,
              workspaceId: parent.workspaceId,
              mainSessionId: parent.id,
              ...(parent.title === undefined ? {} : { mainSessionTitle: parent.title }),
              mainSource: request.asDefaultQa === true ? 'qa-created' : 'explicit',
              state: 'active',
              createdAt: now,
              updatedAt: now,
            }
            : undefined
          await this.deps.repository.commitProvisioning({
            provisioningId,
            ...(nextGroup === undefined ? {} : { group: nextGroup }),
            locus,
            ...(request.asDefaultQa === true ? { defaultQaForParentSessionId: parent.id } : {}),
            rebuild: { oldLocusId: previous.locusId },
          })
          published = true
          await child.commit?.()
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
              '重建已持久化发布，但子会话 finalize 失败；保留 committed operation 等待恢复对账。',
              error,
            )
          }
          await this.rollbackResources(child === undefined ? {} : { child })
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
      if (existing.state !== 'active') {
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

    let main: ProvisionedSession | undefined
    let child: ProvisionedSession | undefined
    let published = false
    try {
      let selected: LocusParentSession
      let mainSource: LocusMainSource
      if (parent !== undefined) {
        selected = parent
        mainSource = 'explicit'
      } else {
        const workspace = await this.deps.dsh.resolveDefaultWorkspace()
        if (workspace === undefined || workspace.id.trim() === '') {
          throw new LocusControllerError(
            'DEFAULT_WORKSPACE_UNAVAILABLE',
            '未配置或无法解析 default workspace，已停止自动创建群级主会话。',
          )
        }
        main = await this.deps.dsh.createMainSession({
          workspaceId: workspace.id,
          label: this.mainLabel(endpoint, chatName),
          chatId: endpoint.chatId,
        })
        assertSessionShape(main, undefined, workspace.id, '自动群级主会话')
        await this.recordResource(provisioningId, { mainSessionId: main.id })
        selected = {
          id: main.id,
          workspaceId: workspace.id,
          ...(main.title !== undefined ? { title: main.title } : {}),
          state: 'active',
        }
        mainSource = 'auto'
      }

      const locusId = generatedId('locus', this.id)
      const generation = 1
      child = await this.deps.dsh.createChildSession({
        parentSessionId: selected.id,
        workspaceId: selected.workspaceId,
        locusId,
        generation,
        label: this.childLabel(endpoint, chatName, selected.title),
        endpoint,
        permission: 'read',
      })
      assertSessionShape(child, selected.id, selected.workspaceId, '群级子会话')
      await this.recordResource(provisioningId, { childSessionId: child.id })

      const now = this.now()
      const group: LocusGroupRecord = {
        chatId: endpoint.chatId,
        ...(chatName !== undefined ? { chatName } : {}),
        workspaceId: selected.workspaceId,
        mainSessionId: selected.id,
        ...(selected.title !== undefined ? { mainSessionTitle: selected.title } : {}),
        mainSource,
        state: 'active',
        createdAt: now,
        updatedAt: now,
      }
      const locus: LocusRecord = {
        locusId,
        generation,
        endpoint,
        workspaceId: selected.workspaceId,
        parentSessionId: selected.id,
        ...(selected.title !== undefined ? { parentSessionTitle: selected.title } : {}),
        childSessionId: child.id,
        source: mainSource === 'auto' ? 'auto' : 'explicit',
        state: 'active',
        permission: 'read',
        createdAt: now,
      }
      await this.deps.repository.commitProvisioning({ provisioningId, group, locus })
      published = true
      await child.commit?.()
      await this.completeProvisioning(provisioningId)
      return { group, locus, created: true, reused: false }
    } catch (error) {
      if (published) {
        this.logPublishedFinalizeFailure(provisioningId, `群 ${endpoint.chatId}`, error)
        throw new LocusControllerError(
          'PROVISIONING_FAILED',
          `群 ${endpoint.chatId} 的 locus 已持久化发布，但子会话 finalize 失败；已保留主/子会话和 committed operation，等待恢复对账。`,
          error,
        )
      }
      await this.rollbackResources(
        child === undefined && main === undefined ? {} : { ...(child === undefined ? {} : { child }), ...(main === undefined ? {} : { main }) },
      )
      await this.failProvisioning(provisioningId, safeErrorMessage(error))
      if (error instanceof LocusControllerError) throw error
      throw new LocusControllerError(
        'PROVISIONING_FAILED',
        `群 ${endpoint.chatId} 的 locus 创建失败，未发布 active 关联。`,
        error,
      )
    }
  }

  private async provisionChildLocus(
    kind: 'topic',
    endpoint: LocusEndpoint,
    parent: LocusParentSession,
    source: LocusSource,
    label: string,
    parentLocusId: string,
  ): Promise<LocusRecord> {
    const provisioningId = generatedId('provisioning', this.id)
    await this.beginProvisioning({ provisioningId, kind, endpoint, parentSessionId: parent.id })
    let child: ProvisionedSession | undefined
    let published = false
    const locusId = generatedId('locus', this.id)
    const generation = 1
    try {
      child = await this.deps.dsh.createChildSession({
        parentSessionId: parent.id,
        workspaceId: parent.workspaceId,
        locusId,
        generation,
        label,
        endpoint,
        permission: 'read',
      })
      assertSessionShape(child, parent.id, parent.workspaceId, '话题子会话')
      await this.recordResource(provisioningId, { childSessionId: child.id })
      const now = this.now()
      const locus: LocusRecord = {
        locusId,
        generation,
        endpoint,
        workspaceId: parent.workspaceId,
        parentSessionId: parent.id,
        ...(parent.title !== undefined ? { parentSessionTitle: parent.title } : {}),
        childSessionId: child.id,
        parentLocusId,
        source,
        state: 'active',
        permission: 'read',
        createdAt: now,
      }
      await this.deps.repository.commitProvisioning({ provisioningId, locus })
      published = true
      await child.commit?.()
      await this.completeProvisioning(provisioningId)
      return locus
    } catch (error) {
      if (published) {
        this.logPublishedFinalizeFailure(provisioningId, `话题 ${endpointLabel(endpoint)}`, error)
        throw new LocusControllerError(
          'PROVISIONING_FAILED',
          `话题 ${endpointLabel(endpoint)} 的 locus 已持久化发布，但子会话 finalize 失败；已保留子会话和 committed operation，等待恢复对账。`,
          error,
        )
      }
      await this.rollbackResources(child === undefined ? {} : { child })
      await this.failProvisioning(provisioningId, safeErrorMessage(error))
      if (error instanceof LocusControllerError) throw error
      throw new LocusControllerError(
        'PROVISIONING_FAILED',
        `话题 ${endpointLabel(endpoint)} 的 locus 创建失败，未发布 active 关联。`,
        error,
      )
    }
  }

  private async replaceInheritedTopicParentLocked(input: {
    readonly endpoint: LocusEndpoint & { readonly threadId: string }
    readonly group: LocusGroupRecord
    readonly previousLocus: LocusRecord
    readonly parentSessionId: string
    readonly chatName?: string
  }): Promise<EnsureTopicResult> {
    const { endpoint, group, previousLocus } = input
    if (previousLocus.source !== 'inherited' && previousLocus.source !== 'auto') {
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
    if (parent.id === previousLocus.parentSessionId) {
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
    let child: ProvisionedSession | undefined
    let published = false
    const locusId = generatedId('locus', this.id)
    const generation = previousLocus.generation + 1
    try {
      child = await this.deps.dsh.createChildSession({
        parentSessionId: parent.id,
        workspaceId: parent.workspaceId,
        locusId,
        generation,
        label: this.childLabel(endpoint, input.chatName ?? group.chatName, parent.title),
        endpoint,
        permission: 'read',
      })
      assertSessionShape(child, parent.id, parent.workspaceId, '替换后的话题子会话')
      await this.recordResource(provisioningId, { childSessionId: child.id })
      const warningText = renderAutomaticReplacementWarning({
        fromSessionId: previousLocus.parentSessionId,
        ...(previousLocus.parentSessionTitle === undefined ? {} : { fromTitle: previousLocus.parentSessionTitle }),
        toSessionId: parent.id,
        ...(parent.title === undefined ? {} : { toTitle: parent.title }),
      })
      const now = this.now()
      const nextLocus: LocusRecord = {
        locusId,
        generation,
        endpoint,
        workspaceId: parent.workspaceId,
        parentSessionId: parent.id,
        ...(parent.title === undefined ? {} : { parentSessionTitle: parent.title }),
        childSessionId: child.id,
        ...(previousLocus.parentLocusId === undefined ? {} : { parentLocusId: previousLocus.parentLocusId }),
        source: 'explicit',
        state: 'active',
        permission: 'read',
        createdAt: now,
        replacesLocusId: previousLocus.locusId,
      }
      // Topic replacement publishes only the endpoint generation. The group
      // record/current main is deliberately untouched, so other and future
      // inherited topics continue following the group default.
      await this.deps.repository.commitProvisioning({
        provisioningId,
        locus: nextLocus,
        replace: { oldLocusId: previousLocus.locusId, noticeText: warningText },
      })
      published = true
      await child.commit?.()
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
      await this.rollbackResources(child === undefined ? {} : { child })
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
    if (group.state !== 'active') {
      throw new LocusControllerError(
        'GROUP_UNAVAILABLE',
        `群 ${endpoint.chatId} 的群级结构处于 ${group.state}，不会静默切换。`,
      )
    }
    const previousLocus = await this.requireActiveLocus(endpoint, '群级')
    if (group.mainSource !== 'auto' || previousLocus.source !== 'auto') {
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
    let child: ProvisionedSession | undefined
    let published = false
    const locusId = generatedId('locus', this.id)
    const generation = previousLocus.generation + 1
    try {
      child = await this.deps.dsh.createChildSession({
        parentSessionId: parent.id,
        workspaceId: parent.workspaceId,
        locusId,
        generation,
        label: this.childLabel(endpoint, group.chatName, parent.title),
        endpoint,
        permission: 'read',
      })
      assertSessionShape(child, parent.id, parent.workspaceId, '替换后的群级子会话')
      await this.recordResource(provisioningId, { childSessionId: child.id })
      const warningText = renderAutomaticReplacementWarning({
        fromSessionId: previousLocus.parentSessionId,
        ...(previousLocus.parentSessionTitle === undefined && group.mainSessionTitle === undefined
          ? {}
          : { fromTitle: previousLocus.parentSessionTitle ?? group.mainSessionTitle }),
        toSessionId: parent.id,
        ...(parent.title !== undefined ? { toTitle: parent.title } : {}),
      })

      // The switch and its notice debt are published atomically below. The
      // external send happens only afterwards; while debt remains, ordinary
      // dispatch is gated by the durable notice store.
      const now = this.now()
      const nextGroup: LocusGroupRecord = {
        ...group,
        workspaceId: parent.workspaceId,
        mainSessionId: parent.id,
        ...(parent.title !== undefined ? { mainSessionTitle: parent.title } : {}),
        mainSource: 'explicit',
        createdAt: now,
        updatedAt: now,
      }
      const nextLocus: LocusRecord = {
        // Must be the exact identity staged before child publication. A second
        // allocation here composes the child as one locus and durably publishes
        // another, making every later caller-bound check fail closed.
        locusId,
        generation,
        endpoint,
        workspaceId: parent.workspaceId,
        parentSessionId: parent.id,
        ...(parent.title !== undefined ? { parentSessionTitle: parent.title } : {}),
        childSessionId: child.id,
        source: 'explicit',
        state: 'active',
        permission: 'read',
        createdAt: now,
        replacesLocusId: previousLocus.locusId,
      }
      await this.deps.repository.commitProvisioning({
        provisioningId,
        group: nextGroup,
        locus: nextLocus,
        replace: { oldLocusId: previousLocus.locusId, noticeText: warningText },
      })
      published = true
      await child.commit?.()
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
        // its child or rewrite the committed operation as failed.
        if (error instanceof LocusControllerError) throw error
        throw new LocusControllerError(
          'NOTIFICATION_FAILED',
          '主会话切换已持久化，但通知尚未确认送达；新关联保持暂停并等待重试。',
          error,
        )
      }
      await this.rollbackResources(child === undefined ? {} : { child })
      await this.failProvisioning(provisioningId, safeErrorMessage(error))
      if (error instanceof LocusControllerError) throw error
      throw new LocusControllerError(
        'PROVISIONING_FAILED',
        `群 ${endpoint.chatId} 的显式主会话切换失败，旧关联保持不变。`,
        error,
      )
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
    if (session === undefined || session.state === 'missing' || session.state === 'archived') {
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
    if (session.workspaceId.trim() === '') {
      throw new LocusControllerError(
        'PARENT_NOT_FOUND',
        `${operation} 的 workspace 无法确认，已停止操作。`,
      )
    }
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
    if (locus.state !== 'active') {
      throw new LocusControllerError(
        label === '群级' ? 'GROUP_UNAVAILABLE' : 'TOPIC_UNAVAILABLE',
        `${label} ${endpointLabel(endpoint)} 处于 ${locus.state}，不会静默重建。`,
      )
    }
    return locus
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
    return `Locus 主会话 · ${chatName?.trim() || endpoint.chatId}`
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
    resource: { readonly mainSessionId?: string; readonly childSessionId?: string; readonly chatId?: string },
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

  private async failProvisioning(provisioningId: string, reason: string): Promise<void> {
    try {
      await this.deps.repository.failProvisioning(provisioningId, reason.slice(0, 500))
    } catch (error) {
      this.deps.log?.(`locus provisioning ${provisioningId} failure marker failed: ${safeErrorMessage(error)}`)
    }
  }

  private async rollbackResources(resources: {
    readonly main?: ProvisionedSession
    readonly child?: ProvisionedSession
    readonly chat?: ProvisionedChat
  }): Promise<{ readonly main: boolean; readonly child: boolean; readonly chat: boolean }> {
    // Child first: it may depend on the main session remaining around long
    // enough for its cleanup hook to execute.
    const child = await this.rollbackSession(resources.child)
    const main = await this.rollbackSession(resources.main)
    const chat = await this.rollbackChat(resources.chat)
    return { child, main, chat }
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
