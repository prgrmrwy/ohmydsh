/**
 * Standalone controller for the isomorphic (v20) locus model.
 *
 * No Cordis, DSH, lark-cli or Pet repository imports: the runtime seams are
 * injected so the control-plane rules can be exercised in isolation. A
 * successful external operation is never a durable locus; the repository
 * commit is the publish point.
 *
 * Ordering rules (design D4-D7):
 *
 * - lock order is `group:<chat>` -> `endpoint:<key>` -> `main:<W>` lease; the
 *   lease is taken by `ensureLocusMain` and held until the durable commit or
 *   the end of failure compensation;
 * - a chat is created from nothing by ONE path (`provisionChatLocked`): the
 *   group row and the optional first topic row are published by one
 *   `commitProvisioning`, so a topic never exists without its group and both
 *   always sit under one M;
 * - an explicit W that differs from the group row's W is refused with
 *   `EXPLICIT_PARENT_CONFLICT` after the group lock and before any Host call;
 * - a W that left service is replaced only through `rebindChat` (archived W)
 *   or `migrateWholeW` (M unavailable, W healthy); both go through the
 *   repository's single-transaction `resetChat`;
 * - nothing partially provisioned is published, and compensation reclaims only
 *   what the failing operation itself created.
 */

import { randomUUID } from 'node:crypto'
import type { PetLocusMainRecord } from '../spec.js'
import { endpointKeyOf } from './aggregate.js'
import type {
  LocusControllerDepsV20,
  LocusGroupRowV20,
  LocusProvisioningKindV20,
  LocusRowV20,
  LocusTopicRowV20,
} from './contract-v20.js'
import { isUsableLocusMainSession } from './locus-main.js'
import { dispositionOf } from './serviceability.js'

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
  /** The preset on this session's durable header, when the Host reported one. */
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

/** External DSH operations needed by the controller. */
export interface LocusDshPort {
  /** Pet-owned runtime workspace; the entry's workspace remains the work project. */
  readonly locusMainWorkspaceId?: string
  /** Resolve a persisted session; undefined means unavailable, not a fallback. */
  resolveSession(sessionId: string): Promise<LocusParentSession | undefined>
  /** Resolve the currently configured default workspace. */
  resolveDefaultWorkspace(): Promise<LocusWorkspace | undefined>
  /** Create a fresh automatic work session in exactly the supplied workspace. */
  createMainSession(input: {
    workspaceId: string
    label: string
    chatId: string
  }): Promise<ProvisionedSession>
  /**
   * Create the locus main in the Pet workspace; `input.workspaceId` is the work
   * project. Locked down and verified before it is returned; an ordinary
   * top-level session that only Pet and the work session talk to.
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
  /** Deliver a mechanical control message to an endpoint. */
  sendControlMessage(input: { endpoint: LocusEndpoint; text: string }): Promise<void>
  /** Fallback cleanup when a created chat has no per-resource hook. */
  deleteGroup?(chatId: string): Promise<void>
}

/** Controller dependencies: the frozen v20 shape plus space compensation. */
export interface LocusControllerDeps extends LocusControllerDepsV20 {
  /**
   * Best-effort close of the collaboration space of an M this operation
   * created. Compensation never blocks on it: the space id derives from the
   * never-reused M id, so a leaked space is inert.
   */
  readonly releaseSpace?: (input: {
    readonly workSessionId: string
    readonly locusMainSessionId: string
  }) => Promise<void>
}

export interface EnsureGroupRequest {
  readonly chatId: string
  readonly chatName?: string
  /** Explicit work session (W). If absent, a new auto W is created. */
  readonly parentSessionId?: string
  /** Alias useful to callers that want to make precedence explicit in code. */
  readonly explicitParentSessionId?: string
}

export interface EnsureTopicRequest {
  readonly chatId: string
  readonly threadId: string
  readonly chatName?: string
  readonly parentSessionId?: string
  readonly explicitParentSessionId?: string
}

/** A whole-W migration that was committed: the new M and how many chats moved with it. */
export interface LocusMigrationNote {
  readonly newMain: string
  readonly chats: number
}

export interface EnsureGroupResult {
  readonly group: LocusGroupRowV20
  readonly locus: LocusGroupRowV20
  readonly created: boolean
  readonly reused: boolean
  /** A stopped row was re-enabled in place by a same-W `/bind` (D7). */
  readonly reenabled?: true
  /** `/bind` found the W's M unavailable and migrated the whole W first (D6). */
  readonly migration?: LocusMigrationNote
}

export interface EnsureTopicResult {
  readonly group: LocusGroupRowV20
  readonly locus: LocusTopicRowV20
  readonly created: boolean
  readonly reused: boolean
  /** Whether this call also created the group row (and its M). */
  readonly groupCreated: boolean
  readonly reenabled?: true
  /** `/bind` found the W's M unavailable and migrated the whole W first (D6). */
  readonly migration?: LocusMigrationNote
}

export interface DefaultQaRequest {
  readonly parentSessionId: string
  readonly ownerId: string
  readonly groupName?: string
}

export interface DefaultQaResult {
  readonly group: LocusGroupRowV20
  readonly locus: LocusGroupRowV20
  readonly created: boolean
  readonly reused: boolean
}

/** Make an entry able to take its next message (see `LocusController.ensureEntry`). */
export interface EnsureEntryRequest {
  readonly chatId: string
  readonly threadId?: string
  readonly chatName?: string
}

export interface EnsureEntryResult {
  readonly locus: LocusRowV20
  readonly group?: LocusGroupRowV20
  readonly created: boolean
  /** The whole-W migration that served this call, when one ran. */
  readonly migration?: LocusMigrationNote
}

/** `rebindChat` request: the fence is the GROUP row's (D6). */
export interface RebindChatRequest {
  readonly chatId: string
  readonly workSessionId: string
  readonly expectedLocusId: string
  readonly expectedRevision: number
}

export interface RebindChatResult {
  readonly group: LocusGroupRowV20
  readonly rows: readonly LocusRowV20[]
  readonly retargetedDeliveryIds: readonly string[]
}

/** Result of a whole-W migration attempt (D7). */
export type MigrateWholeWResult =
  | { readonly migrated: true; readonly newMain: PetLocusMainRecord; readonly chats: number }
  /** The W's M is usable (another trigger migrated first, or it never broke). */
  | { readonly migrated: false; readonly reason: 'main-usable'; readonly main: PetLocusMainRecord }
  /** A chat of the W has a current Delivery; the message stays in backlog. */
  | { readonly migrated: false; readonly reason: 'current-delivery'; readonly chatId: string }

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
  | 'CAPABILITY_UNAVAILABLE'
  | 'PROVISIONING_FAILED'
  | 'LOCUS_MAIN_UNAVAILABLE'
  | 'SOURCE_ARCHIVED'
  | 'REPOSITORY_INCONSISTENT'
  | 'LOCUS_NOT_FOUND'
  | 'LOCUS_CONFLICT'
  | 'LOCUS_BUSY'

/**
 * Runtime table of every {@link LocusControllerErrorCode}. A `Record` over the
 * union makes the compiler reject a code added to the type but not here, so
 * diagnostics can tell a DEFINED reason code from an arbitrary `code` string.
 */
const LOCUS_CONTROLLER_ERROR_CODES: Readonly<Record<LocusControllerErrorCode, true>> = {
  INVALID_ENDPOINT: true,
  INVALID_REQUEST: true,
  INVALID_PARENT: true,
  PARENT_NOT_FOUND: true,
  PARENT_NOT_ALLOWED: true,
  DEFAULT_WORKSPACE_UNAVAILABLE: true,
  GROUP_UNAVAILABLE: true,
  TOPIC_UNAVAILABLE: true,
  DEFAULT_QA_UNAVAILABLE: true,
  EXPLICIT_PARENT_CONFLICT: true,
  CAPABILITY_UNAVAILABLE: true,
  PROVISIONING_FAILED: true,
  LOCUS_MAIN_UNAVAILABLE: true,
  SOURCE_ARCHIVED: true,
  REPOSITORY_INCONSISTENT: true,
  LOCUS_NOT_FOUND: true,
  LOCUS_CONFLICT: true,
  LOCUS_BUSY: true,
}

/** Whether `code` is one of the reason codes `LocusControllerError` defines. */
export function isLocusControllerErrorCode(code: unknown): code is LocusControllerErrorCode {
  return typeof code === 'string' && Object.hasOwn(LOCUS_CONTROLLER_ERROR_CODES, code)
}

/** Stable, safe-to-display controller error. */
export class LocusControllerError extends Error {
  readonly code: LocusControllerErrorCode
  readonly cause?: unknown
  /**
   * Set when an authorized message may still be accepted into the durable
   * backlog of this existing entry (a whole-W migration is deferred, D7).
   */
  readonly deferred?: { readonly locusId: string; readonly sessionId: string }
  /**
   * Set (by `/bind`) when a whole-W migration was already committed before this
   * failure: the migration is a durable fact, so the receipt must say so (D6).
   */
  migrationCommitted?: LocusMigrationNote

  constructor(code: LocusControllerErrorCode, message: string, cause?: unknown, deferred?: { readonly locusId: string; readonly sessionId: string }) {
    super(message)
    if (deferred !== undefined) this.deferred = deferred
    this.name = 'LocusControllerError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

/** Alias for integrations that use the shorter domain name. */
export const LocusError = LocusControllerError

const REPOSITORY_REFUSAL_CODES: ReadonlySet<string> = new Set([
  'INVALID_REQUEST',
  'LOCUS_NOT_FOUND',
  'LOCUS_CONFLICT',
  'LOCUS_BUSY',
  'EXPLICIT_PARENT_CONFLICT',
])

/** A refusal that already carries a v20 code (controller or repository): never re-wrapped. */
function isRefusal(error: unknown): error is Error & { readonly code: string } {
  if (error instanceof LocusControllerError) return true
  const code = (error as { code?: unknown } | undefined)?.code
  return error instanceof Error && typeof code === 'string' && REPOSITORY_REFUSAL_CODES.has(code)
}

/** Canonical key for endpoint locking and repository indexes. */
export function locusEndpointKey(endpoint: LocusEndpoint): string {
  return endpointKeyOf(endpoint)
}

/** The same six-character session identity shown by the Web session badge. */
export function shortLocusSessionId(sessionId: string): string {
  return sessionId.replace(/^(?:task|session)-/, '').slice(0, 6)
}

/** A short label safe for a group-visible message. */
export function shortLocusSessionLabel(sessionId: string, title?: string): string {
  const readable = title?.trim()
  return readable !== undefined && readable !== '' ? readable : shortLocusSessionId(sessionId)
}

const MAX_QA_GROUP_NAME = 32

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300)
}

function endpointLabel(endpoint: LocusEndpoint): string {
  return endpoint.threadId === undefined ? endpoint.chatId : `${endpoint.chatId}#${endpoint.threadId}`
}

function requireNonEmpty(value: string | undefined, field: string): string {
  if (value === undefined || value.trim() === '') {
    throw new LocusControllerError('INVALID_ENDPOINT', `${field} 不能为空。`)
  }
  return value.trim()
}

function requestedParent(request: {
  readonly parentSessionId?: string
  readonly explicitParentSessionId?: string
}): string | undefined {
  const { parentSessionId: first, explicitParentSessionId: second } = request
  if (first !== undefined && second !== undefined && first !== second) {
    throw new LocusControllerError('INVALID_PARENT', '显式 parentSessionId 参数不一致。')
  }
  const value = first ?? second
  return value === undefined ? undefined : requireNonEmpty(value, 'parentSessionId')
}

function qaGroupName(name: string | undefined): string {
  const trimmed = name?.trim() ?? ''
  if (trimmed === '') return '答疑 · DSH'
  return trimmed.length > MAX_QA_GROUP_NAME ? `${trimmed.slice(0, MAX_QA_GROUP_NAME - 1)}…` : trimmed
}

function assertSessionShape(
  session: ProvisionedSession,
  expectedWorkspace: string | undefined,
  operation: string,
): void {
  if (session.id.trim() === '') {
    throw new LocusControllerError('PROVISIONING_FAILED', `${operation} 未返回有效 session id。`)
  }
  if (session.parentSessionId !== undefined) {
    throw new LocusControllerError(
      'PROVISIONING_FAILED',
      `${operation} 返回了 child session，已拒绝把它当作一级会话发布。`,
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
  /** The M whose collaboration space this operation may have created. */
  space?: { readonly workSessionId: string; readonly locusMainSessionId: string }
  chat?: ProvisionedChat
}

/** A group-row-less view of the facts a row needs from its group. */
function isServing(row: Pick<LocusRowV20, 'state'>): boolean {
  return row.state === 'active' || row.state === 'not-created'
}

function isGroupRow(row: LocusRowV20): row is LocusGroupRowV20 {
  return !('threadId' in row.endpoint)
}

/**
 * Unified locus control-plane controller. It does not expose message routing;
 * the channel adapter calls it after establishing a trustworthy endpoint and
 * sender.
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

  private get repo(): LocusControllerDeps['repository'] {
    return this.deps.repository
  }

  private reserve(): string {
    return (this.deps.reserveChildSessionId ?? (() => `session-${randomUUID()}`))()
  }

  // -- /bind and first contact ----------------------------------------------

  /** Ensure a group row (D4/D5/D7). */
  async ensureGroup(request: EnsureGroupRequest): Promise<EnsureGroupResult> {
    const chatId = requireNonEmpty(request.chatId, 'chatId')
    const explicit = requestedParent(request)
    return this.withLock(`group:${chatId}`, async () => {
      const group = this.repo.getRow({ chatId })
      if (group !== undefined && isGroupRow(group)) {
        const reenabled = await this.checkExplicitBindLocked(group, group, explicit)
        const current = reenabled ?? group
        if (reenabled === undefined && !isServing(current)) {
          throw new LocusControllerError('GROUP_UNAVAILABLE', `群 ${chatId} 的入口处于 ${current.state}，不会静默重建。`)
        }
        return {
          group: current as LocusGroupRowV20,
          locus: current as LocusGroupRowV20,
          created: false,
          reused: reenabled === undefined,
          ...(reenabled === undefined ? {} : { reenabled: true as const }),
        }
      }
      const { rows, migration } = await this.provisionChatLocked({
        chatId,
        explicit,
        ...(request.chatName === undefined ? {} : { chatName: request.chatName }),
      })
      const created = rows[0] as LocusGroupRowV20
      return { group: created, locus: created, created: true, reused: false, ...(migration === undefined ? {} : { migration }) }
    })
  }

  /**
   * Ensure a topic row. A missing group is created in the SAME commit with the
   * explicit W carried through (D4); an existing group appends a row under its
   * M with no external call.
   */
  async ensureTopic(request: EnsureTopicRequest): Promise<EnsureTopicResult> {
    const chatId = requireNonEmpty(request.chatId, 'chatId')
    const threadId = requireNonEmpty(request.threadId, 'threadId')
    const explicit = requestedParent(request)
    return this.withLock(`group:${chatId}`, async () =>
      this.withLock(`endpoint:${locusEndpointKey({ chatId, threadId })}`, async () => {
        const group = this.repo.getRow({ chatId })
        if (group === undefined || !isGroupRow(group)) {
          const { rows, migration } = await this.provisionChatLocked({
            chatId,
            threadId,
            explicit,
            ...(request.chatName === undefined ? {} : { chatName: request.chatName }),
          })
          return {
            group: rows[0] as LocusGroupRowV20,
            locus: rows[1] as LocusTopicRowV20,
            created: true,
            reused: false,
            groupCreated: true,
            ...(migration === undefined ? {} : { migration }),
          }
        }
        const existing = this.repo.getRow({ chatId, threadId })
        const reenabled = await this.checkExplicitBindLocked(group, existing, explicit)
        if (existing !== undefined) {
          const current = (reenabled ?? existing) as LocusTopicRowV20
          if (reenabled === undefined && !isServing(current)) {
            throw new LocusControllerError('TOPIC_UNAVAILABLE', `话题 ${endpointLabel({ chatId, threadId })} 处于 ${current.state}，不会静默重建。`)
          }
          return {
            group,
            locus: current,
            created: false,
            reused: reenabled === undefined,
            groupCreated: false,
            ...(reenabled === undefined ? {} : { reenabled: true as const }),
          }
        }
        const topic = await this.addTopicRowLocked(group, threadId)
        return { group, locus: topic, created: true, reused: false, groupCreated: false }
      }),
    )
  }

  /**
   * D5/D7 for an explicit `/bind` against an existing group. Runs after the
   * group lock and BEFORE any Host call. A different W is refused; the same W
   * re-enables a `stopped` target in place and is otherwise idempotent.
   * @returns the re-enabled row, or undefined when nothing changed.
   */
  private async checkExplicitBindLocked(
    group: LocusGroupRowV20,
    target: LocusRowV20 | undefined,
    explicit: string | undefined,
  ): Promise<LocusRowV20 | undefined> {
    if (explicit === undefined) return undefined
    const main = this.repo.findMain(group.locusMainSessionId)
    if (main === undefined) {
      throw new LocusControllerError('REPOSITORY_INCONSISTENT', `群 ${group.endpoint.chatId} 的 M 没有 locus_mains 配对。`)
    }
    if (main.workSessionId !== explicit) {
      throw new LocusControllerError(
        'EXPLICIT_PARENT_CONFLICT',
        `该群已由 ${shortLocusSessionLabel(main.workSessionId)} 跟进，不能在这里改绑；原会话归档后可在管理面「改绑到其他会话」。`,
      )
    }
    if (target === undefined || target.state !== 'stopped') return undefined
    return this.repo.reenableRow(
      { expectedLocusId: target.locusId, expectedRevision: target.revision },
      this.now(),
      () => this.reserve(),
    )
  }

  /** Create or open the stable default Q&A group for one work session. */
  async createOrOpenDefaultQa(request: DefaultQaRequest): Promise<DefaultQaResult> {
    const workSessionId = requireNonEmpty(request.parentSessionId, 'parentSessionId')
    const ownerId = requireNonEmpty(request.ownerId, 'ownerId')
    return this.withLock(`qa:${workSessionId}`, async () => {
      const work = await this.resolveWorkSession(workSessionId, 'Q&A parent')
      const existing = this.repo.findDefaultQa(workSessionId)
      if (existing !== undefined) {
        if (!isServing(existing)) {
          throw new LocusControllerError(
            'DEFAULT_QA_UNAVAILABLE',
            `会话 ${shortLocusSessionLabel(workSessionId, work.title)} 的默认 Q&A 入口处于 ${existing.state}。`,
          )
        }
        return { group: existing, locus: existing, created: false, reused: true }
      }
      const lark = this.requireLark('Q&A 创建')
      const provisioningId = `provisioning-${this.id()}`
      await this.beginProvisioning({ provisioningId, kind: 'chat', chatId: `pending-${workSessionId}`, workSessionId })
      const resources: ProvisionedResources = {}
      let published = false
      try {
        const { main, created } = await this.ensureLocusMain(work, provisioningId, resources)
        const chat = await lark.createGroup({ name: qaGroupName(request.groupName), ownerId })
        resources.chat = chat
        const chatId = requireNonEmpty(chat.chatId, 'created chatId')
        await this.recordResource(provisioningId, { chatId })
        const group = this.newGroupRow(chatId, work, main, { defaultQa: true })
        await this.repo.commitProvisioning({ provisioningId, rows: [group], ...(created ? { main } : {}) })
        published = true
        await this.finalizeLocked(provisioningId, resources)
        return { group, locus: group, created: true, reused: false }
      } catch (error) {
        throw await this.failOperation(error, published, provisioningId, resources, 'Q&A 默认入口')
      }
    })
  }

  /** Short alias for integrations that call the operation "ensure". */
  async ensureDefaultQa(request: DefaultQaRequest): Promise<DefaultQaResult> {
    return this.createOrOpenDefaultQa(request)
  }

  /**
   * D4: the one from-zero creation path. Runs inside the caller's group lock.
   * The explicit W is resolved BEFORE any external creation; the group row and
   * the optional topic row are published by a single `commitProvisioning`.
   *
   * D6: when the explicit W's active M can no longer serve, the whole W is
   * migrated first (same mechanism, same lock order as `ensureEntry`'s replace
   * branch: group lock, then the `main:<W>` lease) and the entry is then built
   * on the new M, which `ensureLocusMain` reuses. The migration is its own
   * committed transaction; a later failure marks the error instead of undoing it.
   */
  private async provisionChatLocked(input: {
    readonly chatId: string
    readonly chatName?: string
    readonly threadId?: string
    readonly explicit: string | undefined
  }): Promise<{ readonly rows: readonly LocusRowV20[]; readonly migration?: LocusMigrationNote }> {
    const { chatId, threadId, explicit } = input
    const explicitWork = explicit === undefined ? undefined : await this.resolveWorkSession(explicit, '显式 parent')
    const migration = explicitWork === undefined ? undefined : await this.migrateUnavailableMainLocked(explicitWork.id, chatId, threadId)
    try {
      const rows = await this.buildChatLocked(input, explicitWork)
      return { rows, ...(migration === undefined ? {} : { migration }) }
    } catch (error) {
      if (migration !== undefined && typeof error === 'object' && error !== null) {
        (error as { migrationCommitted?: LocusMigrationNote }).migrationCommitted = migration
      }
      throw error
    }
  }

  /**
   * D6 pre-step of an explicit `/bind`: migrate the W when its active M is not
   * usable. A current Delivery anywhere in the W defers the migration, and then
   * nothing at all is created or written.
   * @returns the committed migration, or undefined when none was needed or
   * another trigger already did it.
   */
  private async migrateUnavailableMainLocked(
    workSessionId: string,
    chatId: string,
    threadId: string | undefined,
  ): Promise<LocusMigrationNote | undefined> {
    const active = this.repo.findActiveMain(workSessionId)
    if (active === undefined || await this.isMainUsable(active)) return undefined
    const migrated = await this.migrateWholeW(workSessionId, chatId, threadId)
    if (migrated.migrated) return { newMain: migrated.newMain.locusMainSessionId, chats: migrated.chats }
    if (migrated.reason === 'current-delivery') {
      throw new LocusControllerError('LOCUS_BUSY', '该来源会话的另一个群有处理中的投递，暂不迁移；请稍后再绑定。')
    }
    return undefined
  }

  private async buildChatLocked(
    input: {
      readonly chatId: string
      readonly chatName?: string
      readonly threadId?: string
    },
    explicitWork: LocusParentSession | undefined,
  ): Promise<readonly LocusRowV20[]> {
    const { chatId, threadId } = input
    const provisioningId = `provisioning-${this.id()}`
    await this.beginProvisioning({
      provisioningId,
      kind: 'chat',
      chatId,
      ...(threadId === undefined ? {} : { threadId }),
      ...(explicitWork === undefined ? {} : { workSessionId: explicitWork.id }),
    })
    const resources: ProvisionedResources = {}
    let published = false
    try {
      const work = explicitWork ?? await this.createAutoWorkSession(provisioningId, chatId, input.chatName, resources)
      const { main, created } = await this.ensureLocusMain(work, provisioningId, resources)
      const group = this.newGroupRow(chatId, work, main)
      const rows: LocusRowV20[] = threadId === undefined ? [group] : [group, this.newTopicRow(chatId, threadId)]
      await this.repo.commitProvisioning({
        provisioningId,
        rows: rows as unknown as Parameters<LocusControllerDeps['repository']['commitProvisioning']>[0]['rows'],
        ...(created ? { main } : {}),
      })
      published = true
      await this.finalizeLocked(provisioningId, resources)
      return rows
    } catch (error) {
      throw await this.failOperation(error, published, provisioningId, resources, `入口 ${chatId}`)
    }
  }

  /** D4 "群已存在": append a topic under the group row's M. Nothing external. */
  private async addTopicRowLocked(group: LocusGroupRowV20, threadId: string): Promise<LocusTopicRowV20> {
    return this.repo.addTopicRow(this.newTopicRow(group.endpoint.chatId, threadId))
  }

  // -- rebind (D6) -------------------------------------------------------------

  /**
   * Rebind a chat whose W was archived onto another work session. Checks run in
   * order and the first failure refuses: group row, fence, current W archived,
   * target eligibility, no current Delivery in the chat.
   */
  async rebindChat(request: RebindChatRequest): Promise<RebindChatResult> {
    const chatId = requireNonEmpty(request.chatId, 'chatId')
    const targetId = requireNonEmpty(request.workSessionId, 'workSessionId')
    return this.withLock(`group:${chatId}`, async () => {
      const group = this.repo.getRow({ chatId })
      if (group === undefined || !isGroupRow(group)) {
        throw new LocusControllerError('LOCUS_NOT_FOUND', '该群没有入口行。')
      }
      if (group.locusId !== request.expectedLocusId || group.revision !== request.expectedRevision) {
        throw new LocusControllerError('LOCUS_CONFLICT', '入口已变化，请刷新后重试。')
      }
      const oldMain = this.repo.findMain(group.locusMainSessionId)
      if (oldMain === undefined) {
        throw new LocusControllerError('REPOSITORY_INCONSISTENT', `群 ${chatId} 的 M 没有 locus_mains 配对。`)
      }
      if (!(await this.isArchivedSession(oldMain.workSessionId))) {
        throw new LocusControllerError('INVALID_REQUEST', '原来源会话未归档（或无法证明已归档），不能改绑。')
      }
      const target = await this.resolveWorkSession(targetId, '改绑目标', 'INVALID_REQUEST')
      if (this.repo.hasCurrentDeliveryInChat(chatId)) {
        throw new LocusControllerError('LOCUS_BUSY', '该群有处理中的投递，请空闲后再改绑。')
      }
      // The target W's active M is dead: no @ will ever come on the management
      // path, so migrate the whole W first (retire it, activate a fresh M1).
      const targetMain = this.repo.findActiveMain(target.id)
      if (targetMain !== undefined && !(await this.isMainUsable(targetMain))) {
        const migrated = await this.migrateWholeW(target.id, chatId)
        if (!migrated.migrated && migrated.reason === 'current-delivery') {
          throw new LocusControllerError('LOCUS_BUSY', '目标会话的另一个群有处理中的投递，请稍后再改绑。')
        }
      }
      const provisioningId = `provisioning-${this.id()}`
      await this.beginProvisioning({ provisioningId, kind: 'rebind', chatId, workSessionId: target.id })
      const resources: ProvisionedResources = {}
      let published = false
      try {
        const { main, created } = await this.ensureLocusMain(target, provisioningId, resources)
        const result = await this.repo.rebindChat({
          provisioningId,
          chatId,
          expectedLocusId: request.expectedLocusId,
          expectedRevision: request.expectedRevision,
          toM: main.locusMainSessionId,
          ...(created ? { main } : {}),
          workspaceId: target.workspaceId,
          reboundFrom: oldMain.workSessionId,
          now: this.now(),
          reserveChildSessionId: () => this.reserve(),
        })
        published = true
        await this.finalizeLocked(provisioningId, resources)
        return {
          group: result.rows[0] as LocusGroupRowV20,
          rows: result.rows,
          retargetedDeliveryIds: result.retargetedDeliveryIds,
        }
      } catch (error) {
        throw await this.failOperation(error, published, provisioningId, resources, `群 ${chatId} 改绑`)
      }
    })
  }

  // -- stop (D7) -----------------------------------------------------------

  /** Idle-only stop of one row; a group row's stop never touches its topic rows. */
  async stopEntry(fence: { readonly expectedLocusId: string; readonly expectedRevision: number }): Promise<LocusRowV20> {
    return this.repo.stopRow(fence, this.now())
  }

  // -- delivery path ---------------------------------------------------------

  /**
   * Make one entry able to take its next message and say what was done.
   * Never creates a child session; the most it does is publish a fresh
   * reservation. What it repairs, and why each case differs:
   *
   * - no row: first establishment (auto W);
   * - child lost (`invalid`): in-place rebuild of that ONE row (D7);
   * - M unavailable, W healthy: whole-W migration (D7);
   * - W archived or the owner stopped the entry: refused, never undone here.
   */
  async ensureEntry(request: EnsureEntryRequest): Promise<EnsureEntryResult> {
    const chatId = requireNonEmpty(request.chatId, 'chatId')
    const threadId = request.threadId === undefined ? undefined : requireNonEmpty(request.threadId, 'threadId')
    const endpoint: LocusEndpoint = threadId === undefined ? { chatId } : { chatId, threadId }
    const named = request.chatName === undefined ? {} : { chatName: request.chatName }
    if (this.repo.getRow(endpoint) === undefined) {
      const ensured = threadId === undefined
        ? await this.ensureGroup({ chatId, ...named })
        : await this.ensureTopic({ chatId, threadId, ...named })
      return { locus: ensured.locus, group: ensured.group, created: ensured.created }
    }
    return this.withLock(`group:${chatId}`, async () =>
      this.withLock(`endpoint:${locusEndpointKey(endpoint)}`, async () => {
        const row = this.repo.getRow(endpoint)
        if (row === undefined) {
          throw new LocusControllerError('REPOSITORY_INCONSISTENT', `入口 ${endpointLabel(endpoint)} 已消失。`)
        }
        return this.repairEntryLocked(endpoint, row)
      }),
    )
  }

  private async repairEntryLocked(endpoint: LocusEndpoint, row: LocusRowV20): Promise<EnsureEntryResult> {
    const { disposition, workSessionId } = await this.classify(row)
    const group = this.groupOf(row)
    switch (disposition.kind) {
      case 'serve':
      case 'create':
        return { locus: row, ...(group === undefined ? {} : { group }), created: false }
      case 'terminal':
        throw new LocusControllerError(
          disposition.workArchived ? 'SOURCE_ARCHIVED' : endpoint.threadId === undefined ? 'GROUP_UNAVAILABLE' : 'TOPIC_UNAVAILABLE',
          disposition.workArchived
            ? '来源会话已归档，请在管理面改绑。'
            : `入口 ${endpointLabel(endpoint)} ${disposition.reason}，不会静默重建。`,
        )
      case 'replace': {
        if (disposition.why === 'locus-main-unavailable') {
          const migrated = await this.migrateWholeW(workSessionId, endpoint.chatId, endpoint.threadId)
          if (!migrated.migrated && migrated.reason === 'current-delivery') {
            throw new LocusControllerError('LOCUS_BUSY', '同一来源会话下有处理中的投递，暂不迁移；消息保留在队列。', undefined, { locusId: row.locusId, sessionId: row.sessionId })
          }
          const next = this.repo.getRow(endpoint)
          if (next === undefined) {
            throw new LocusControllerError('REPOSITORY_INCONSISTENT', `迁移后入口 ${endpointLabel(endpoint)} 已消失。`)
          }
          const nextGroup = this.groupOf(next)
          return {
            locus: next,
            ...(nextGroup === undefined ? {} : { group: nextGroup }),
            created: migrated.migrated,
            ...(migrated.migrated ? { migration: { newMain: migrated.newMain.locusMainSessionId, chats: migrated.chats } } : {}),
          }
        }
        const rebuilt = await this.repo.rebuildRowInPlace(
          { expectedLocusId: row.locusId, expectedRevision: row.revision },
          this.now(),
          () => this.reserve(),
        )
        return { locus: rebuilt, ...(group === undefined ? {} : { group }), created: true }
      }
    }
  }

  // -- whole-W migration (D7) ---------------------------------------------------

  /**
   * M of a work session is unavailable while the W is healthy: pair the W with
   * a NEW M and reset every chat of every pairing of the W in one transaction.
   * Serialised by the `main:<W>` lease, so a second concurrent trigger sees the
   * usable M1 and does nothing. Any chat with a current Delivery defers the
   * whole migration (backlog does not).
   */
  async migrateWholeW(
    workSessionId: string,
    triggerChatId: string,
    triggerThreadId?: string,
  ): Promise<MigrateWholeWResult> {
    const work = await this.resolveWorkSession(workSessionId, '迁移的来源会话', 'SOURCE_ARCHIVED')
    const provisioningId = `provisioning-${this.id()}`
    const resources: ProvisionedResources = {}
    // The lease serialises concurrent triggers; re-check under it.
    await this.acquireMainLease(work.id, provisioningId)
    let published = false
    let begun = false
    let committed: LocusMigrationNote | undefined
    try {
      const active = this.repo.findActiveMain(work.id)
      if (active !== undefined && (await this.isMainUsable(active))) {
        this.releaseMainLease(provisioningId)
        return { migrated: false, reason: 'main-usable', main: active }
      }
      const pairings = this.repo.listPairingsOfWork(work.id)
      const chatIds = new Set<string>()
      for (const pairing of pairings) {
        for (const group of this.repo.listGroupRowsOfMain(pairing.locusMainSessionId)) chatIds.add(group.endpoint.chatId)
      }
      for (const chatId of chatIds) {
        if (this.repo.hasCurrentDeliveryInChat(chatId)) {
          this.releaseMainLease(provisioningId)
          return { migrated: false, reason: 'current-delivery', chatId }
        }
      }
      // Capture each chat's revisions AND owning M now, before any external
      // await: a management rebind can move a chat while M-new is being made.
      const chats = [...chatIds].map(chatId => {
        const group = this.repo.getRow({ chatId })
        return {
          chatId,
          ...(group !== undefined && isGroupRow(group) ? { expectedMain: group.locusMainSessionId } : {}),
          expectedRevisions: Object.fromEntries(
            this.repo.listRowsOfChat(chatId).map(row => [locusEndpointKey(row.endpoint), row.revision]),
          ),
        }
      })
      await this.beginProvisioning({
        provisioningId,
        kind: 'migrate',
        chatId: triggerChatId,
        ...(triggerThreadId === undefined ? {} : { threadId: triggerThreadId }),
        workSessionId: work.id,
      })
      begun = true
      const generation = pairings.reduce((max, pairing) => Math.max(max, pairing.generation), 0) + 1
      const { main } = await this.ensureLocusMain(work, provisioningId, resources, { forceNew: true, generation })
      // An archived W is not migrated: rebind owns it.
      if (await this.isArchivedSession(work.id)) {
        throw new LocusControllerError('SOURCE_ARCHIVED', `来源会话 ${work.id} 已归档，不再整体迁移；请改绑。`)
      }
      await this.repo.commitWholeWMigration({
        provisioningId,
        workSessionId: work.id,
        newMain: main,
        ...(active === undefined ? {} : { retireMain: { locusMainSessionId: active.locusMainSessionId, reason: 'locus 主会话不可用，已为来源会话新建' } }),
        chats,
        now: this.now(),
        reserveChildSessionId: () => this.reserve(),
      })
      published = true
      committed = { newMain: main.locusMainSessionId, chats: chats.length }
      await this.finalizeLocked(provisioningId, resources)
      return { migrated: true, newMain: main, chats: chats.length }
    } catch (error) {
      if (!begun) {
        this.releaseMainLease(provisioningId)
        throw error
      }
      const failure = await this.failOperation(error, published, provisioningId, resources, `来源会话 ${work.id} 的整体迁移`)
      // The commit is durable even though finalize failed: say so (D6), never undo it.
      if (committed !== undefined && failure instanceof Error) (failure as { migrationCommitted?: LocusMigrationNote }).migrationCommitted = committed
      throw failure
    }
  }

  // -- construction helpers ------------------------------------------------------

  private newGroupRow(
    chatId: string,
    work: LocusParentSession,
    main: PetLocusMainRecord,
    extra: { readonly defaultQa?: true } = {},
  ): LocusGroupRowV20 {
    const now = this.now()
    return {
      endpoint: { chatId },
      locusId: `locus-${this.id()}`,
      sessionId: this.reserve(),
      state: 'not-created',
      accessMode: 'read-only',
      revision: 0,
      createdAt: now,
      updatedAt: now,
      locusMainSessionId: main.locusMainSessionId,
      workspaceId: work.workspaceId,
      ...(extra.defaultQa === true ? { defaultQa: true as const } : {}),
    }
  }

  private newTopicRow(chatId: string, threadId: string): LocusTopicRowV20 {
    const now = this.now()
    return {
      endpoint: { chatId, threadId },
      locusId: `locus-${this.id()}`,
      sessionId: this.reserve(),
      state: 'not-created',
      accessMode: 'read-only',
      revision: 0,
      createdAt: now,
      updatedAt: now,
    }
  }

  private groupOf(row: LocusRowV20): LocusGroupRowV20 | undefined {
    if (isGroupRow(row)) return row
    const group = this.repo.getRow({ chatId: row.endpoint.chatId })
    return group !== undefined && isGroupRow(group) ? group : undefined
  }

  /** Auto path: a brand-new work session in the default workspace. */
  private async createAutoWorkSession(
    provisioningId: string,
    chatId: string,
    chatName: string | undefined,
    resources: ProvisionedResources,
  ): Promise<LocusParentSession> {
    const workspace = await this.deps.dsh.resolveDefaultWorkspace()
    if (workspace === undefined || workspace.id.trim() === '') {
      throw new LocusControllerError('DEFAULT_WORKSPACE_UNAVAILABLE', '未配置或无法解析 default workspace，已停止自动创建来源会话。')
    }
    const work = await this.deps.dsh.createMainSession({
      workspaceId: workspace.id,
      label: `协作工作会话 · ${chatName?.trim() || chatId}`,
      chatId,
    })
    resources.work = work
    assertSessionShape(work, workspace.id, '自动来源会话')
    await this.recordResource(provisioningId, { mainSessionId: work.id })
    return { id: work.id, workspaceId: workspace.id, ...(work.title === undefined ? {} : { title: work.title }), state: 'active' }
  }

  /**
   * The active M of a work session: reused when it can still serve, created
   * (and wired into its collaboration space) otherwise. Takes the `main:<W>`
   * lease and keeps it until commit or compensation ends.
   */
  private async ensureLocusMain(
    work: LocusParentSession,
    provisioningId: string,
    resources: ProvisionedResources,
    options: { readonly forceNew?: boolean; readonly generation?: number } = {},
  ): Promise<{ readonly main: PetLocusMainRecord; readonly created: boolean }> {
    if (!this.mainLeases.has(provisioningId)) await this.acquireMainLease(work.id, provisioningId)
    if (options.forceNew !== true) {
      const existing = this.repo.findActiveMain(work.id)
      if (existing !== undefined) {
        if (await this.isMainUsable(existing)) return { main: existing, created: false }
        throw new LocusControllerError(
          'LOCUS_MAIN_UNAVAILABLE',
          `来源会话 ${shortLocusSessionLabel(work.id, work.title)} 的 locus 主会话不可用，未建立入口。`,
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
      label: `[locus] ${work.title?.trim() || shortLocusSessionId(work.id)}`,
    })
    resources.locusMain = created
    assertSessionShape(created, this.deps.dsh.locusMainWorkspaceId, 'locus 主会话')
    const mainWorkspaceId = requireNonEmpty(created.workspaceId, 'locusMainWorkspaceId')
    await this.recordResource(provisioningId, { locusMainSessionId: created.id })
    // From here the space may exist even if establishSpace fails half-way.
    resources.space = { workSessionId: work.id, locusMainSessionId: created.id }
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
          ? '来源会话当前不能被邀请进协作空间，未建立入口。'
          : `协作空间建立失败（${space.reason}${space.code ? `/${space.code}` : ''}），未建立入口。`,
      )
    }
    const now = this.now()
    return {
      created: true,
      main: {
        locusMainSessionId: created.id,
        workSessionId: work.id,
        generation: options.generation ?? 1,
        status: 'active',
        spaceId: space.spaceId,
        workspaceId: mainWorkspaceId,
        createdAt: now,
        updatedAt: now,
      },
    }
  }

  // -- classification -------------------------------------------------------------

  /** Whether the exact recorded session is archived, proved from the Host. */
  private async isArchivedSession(sessionId: string): Promise<boolean> {
    if (sessionId.trim() === '') return false
    try {
      const session = await this.deps.dsh.resolveSession(sessionId)
      return session !== undefined && session.id === sessionId && session.state === 'archived'
    } catch {
      // Unknown is not archived: an unreadable registry must not release a serving entry.
      return false
    }
  }

  /** Whether an M can still serve: resolves, unarchived, top level, neutral preset, Pet workspace. */
  private async isMainUsable(main: PetLocusMainRecord): Promise<boolean> {
    if (main.status !== 'active') return false
    let session: LocusParentSession | undefined
    try {
      session = await this.deps.dsh.resolveSession(main.locusMainSessionId)
    } catch {
      return false
    }
    return isUsableLocusMainSession(session, main.locusMainSessionId, this.deps.dsh.locusMainWorkspaceId)
  }

  /** The shared serviceability policy applied to one row, with the facts only this layer can read. */
  private async classify(row: LocusRowV20): Promise<{
    readonly disposition: ReturnType<typeof dispositionOf>
    readonly workSessionId: string
  }> {
    const group = this.groupOf(row)
    if (group === undefined) {
      throw new LocusControllerError('REPOSITORY_INCONSISTENT', `入口 ${endpointLabel(row.endpoint)} 缺少群行。`)
    }
    const main = this.repo.findMain(group.locusMainSessionId)
    if (main === undefined) {
      throw new LocusControllerError('REPOSITORY_INCONSISTENT', `M ${group.locusMainSessionId} 没有 locus_mains 配对。`)
    }
    const workArchived = await this.isArchivedSession(main.workSessionId)
    const mainUnavailable = !workArchived && row.state !== 'stopped' && !(await this.isMainUsable(main))
    return {
      workSessionId: main.workSessionId,
      disposition: dispositionOf({
        state: row.state,
        ...(row.invalidReason === undefined ? {} : { invalidReason: row.invalidReason }),
        workArchived,
        mainUnavailable,
      }),
    }
  }

  /** A W is a valid work session: unarchived, top level, not any locus main. */
  private async resolveWorkSession(
    sessionId: string,
    operation: string,
    code: 'PARENT_NOT_FOUND' | 'INVALID_REQUEST' | 'SOURCE_ARCHIVED' = 'PARENT_NOT_FOUND',
  ): Promise<LocusParentSession> {
    const normalized = requireNonEmpty(sessionId, 'parentSessionId')
    const refuse = (message: string, cause?: unknown): never => {
      throw new LocusControllerError(code === 'INVALID_REQUEST' ? 'INVALID_REQUEST' : code, message, cause)
    }
    let session: LocusParentSession | undefined
    try {
      session = await this.deps.dsh.resolveSession(normalized)
    } catch (error) {
      return refuse(`${operation} ${shortLocusSessionLabel(normalized)} 当前不可用，已停止操作。`, error)
    }
    if (session?.state === 'archived') {
      return refuse(`${operation} ${shortLocusSessionLabel(normalized, session.title)} 已被归档，已停止操作。`)
    }
    if (session === undefined || session.state === 'missing') {
      return refuse(`${operation} ${shortLocusSessionLabel(normalized)} 当前不可用，已停止操作。`)
    }
    if (session.id !== normalized || session.parentSessionId !== undefined) {
      throw new LocusControllerError(
        code === 'INVALID_REQUEST' ? 'INVALID_REQUEST' : 'PARENT_NOT_ALLOWED',
        `${operation} 必须指定可用的一级会话，不能使用子会话。`,
      )
    }
    if (this.repo.findMain(session.id) !== undefined) {
      throw new LocusControllerError(
        code === 'INVALID_REQUEST' ? 'INVALID_REQUEST' : 'PARENT_NOT_ALLOWED',
        `${operation} 不能使用 Pet 自己创建的 locus 主会话。`,
      )
    }
    if (session.workspaceId.trim() === '') {
      return refuse(`${operation} 的 workspace 无法确认，已停止操作。`)
    }
    return session
  }

  private requireLark(operation: string): LocusLarkPort {
    if (this.deps.lark === undefined) {
      throw new LocusControllerError('CAPABILITY_UNAVAILABLE', `${operation} 需要已注入的 Lark 操作端口，未执行任何外部操作。`)
    }
    return this.deps.lark
  }

  // -- provisioning bookkeeping ----------------------------------------------------

  private async beginProvisioning(input: {
    readonly provisioningId: string
    readonly kind: LocusProvisioningKindV20
    readonly chatId: string
    readonly threadId?: string
    readonly workSessionId?: string
  }): Promise<void> {
    try {
      await this.repo.beginProvisioning({ ...input, startedAt: this.now() })
    } catch (error) {
      // A repository refusal keeps its code: the owner needs the truthful reason.
      const code = (error as { code?: unknown } | null)?.code
      const message = error instanceof Error ? error.message : ''
      if (code === 'LOCUS_CONFLICT' || code === 'LOCUS_BUSY') {
        const text = message.includes('failed recently') ? '该群上一次操作刚失败，约 10 分钟后可重试。'
          : message.includes('compensation failed') ? '该群上一次失败操作的清理未完成，下一次请求会重试。'
          : message.includes('is still') ? '该群有另一个操作正在进行，请稍后再试。'
          : message
        throw new LocusControllerError(code, text, error)
      }
      throw new LocusControllerError('PROVISIONING_FAILED', `无法登记 ${input.kind} provisioning，已停止外部创建。`, error)
    }
  }

  private async recordResource(
    provisioningId: string,
    resource: { readonly mainSessionId?: string; readonly locusMainSessionId?: string; readonly chatId?: string },
  ): Promise<void> {
    try {
      await this.repo.recordProvisioningResource(provisioningId, resource)
    } catch (error) {
      throw new LocusControllerError('PROVISIONING_FAILED', `无法记录 ${provisioningId} 的外部资源，已停止发布。`, error)
    }
  }

  /** After the durable commit: free the lease, hand off the M session, mark complete. */
  private async finalizeLocked(provisioningId: string, resources: ProvisionedResources): Promise<void> {
    this.releaseMainLease(provisioningId)
    await resources.locusMain?.commit?.()
    try {
      await this.repo.completeProvisioning(provisioningId)
    } catch (error) {
      // The commit is durable; a failed completion marker is left to restart reconciliation.
      this.deps.log?.(`locus provisioning ${provisioningId} completion marker failed: ${safeErrorMessage(error)}`)
    }
  }

  /**
   * Shared failure tail. After the commit nothing is released and the committed
   * operation is kept for recovery; before it, only what THIS operation created
   * is reclaimed (a reused M and its space are never touched, because they are
   * never recorded in `resources`).
   */
  private async failOperation(
    error: unknown,
    published: boolean,
    provisioningId: string,
    resources: ProvisionedResources,
    label: string,
  ): Promise<Error> {
    if (published) {
      this.deps.log?.(`locus provisioning ${provisioningId} published ${label} but finalize failed; recovery required: ${safeErrorMessage(error)}`)
      return new LocusControllerError(
        'PROVISIONING_FAILED',
        `${label} 已持久化发布，但会话 finalize 失败；已保留会话和 committed operation，等待恢复对账。`,
        error,
      )
    }
    const cleanup = await this.rollbackResources(resources)
    this.releaseMainLease(provisioningId)
    try {
      // Fully reclaimed by this rollback: nothing is left to compensate, so the endpoint is not blocked.
      await this.repo.failProvisioning(
        provisioningId,
        safeErrorMessage(error).slice(0, 500),
        cleanup.complete ? { reclaimed: true } : undefined,
      )
    } catch (failure) {
      this.deps.log?.(`locus provisioning ${provisioningId} failure marker failed: ${safeErrorMessage(failure)}`)
    }
    if (isRefusal(error)) return error
    const residual = resources.chat !== undefined && !cleanup.chat
      ? `飞书群「${resources.chat.chatName ?? resources.chat.chatId}」可能残留，请手动核对。`
      : ''
    return new LocusControllerError('PROVISIONING_FAILED', `${label} 创建失败，未发布任何关联。${residual}`.trim(), error)
  }

  private async rollbackResources(resources: ProvisionedResources): Promise<{
    readonly work: boolean
    readonly locusMain: boolean
    readonly chat: boolean
    /** Every resource this operation created was released. */
    readonly complete: boolean
  }> {
    // Space first (it hangs off the M id), then M, then the W Pet itself created, then the chat.
    const space = await this.releaseSpace(resources.space)
    const locusMain = await this.rollbackSession(resources.locusMain)
    const work = await this.rollbackSession(resources.work)
    const chat = await this.rollbackChat(resources.chat)
    return { work, locusMain, chat, complete: space && locusMain && work && chat }
  }

  private async releaseSpace(space: ProvisionedResources['space']): Promise<boolean> {
    if (space === undefined) return true
    if (this.deps.releaseSpace === undefined) return false
    try {
      await this.deps.releaseSpace(space)
      return true
    } catch (error) {
      this.deps.log?.(`locus rollback could not release space of ${space.locusMainSessionId}: ${safeErrorMessage(error)}`)
      return false
    }
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

  // -- locks -------------------------------------------------------------------

  /** Take the `main:<W>` lease for one operation; released by commit or compensation. */
  private async acquireMainLease(workSessionId: string, provisioningId: string): Promise<void> {
    const key = `main:${workSessionId}`
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
  }

  private releaseMainLease(provisioningId: string): void {
    this.mainLeases.get(provisioningId)?.()
    this.mainLeases.delete(provisioningId)
  }

  /** FIFO lock for one key; all controller locks are process-local. */
  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(resolve => { release = resolve })
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
export async function ensureGroup(deps: LocusControllerDeps, request: EnsureGroupRequest): Promise<EnsureGroupResult> {
  return createLocusController(deps).ensureGroup(request)
}

/** Stateless convenience form for topic creation. */
export async function ensureTopic(deps: LocusControllerDeps, request: EnsureTopicRequest): Promise<EnsureTopicResult> {
  return createLocusController(deps).ensureTopic(request)
}

/** Stateless convenience form for Q&A create-or-open. */
export async function createOrOpenDefaultQa(deps: LocusControllerDeps, request: DefaultQaRequest): Promise<DefaultQaResult> {
  return createLocusController(deps).createOrOpenDefaultQa(request)
}
