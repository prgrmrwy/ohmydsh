/**
 * Owner-facing locus management adapter (v20, pet-locus-isomorphic-entries D10).
 *
 * One row per entry, grouped by the work session W the chat serves; topic rows
 * nest under their group row by `chatId`. Three mutations only — stop, access,
 * rebind — each fenced by `{expectedLocusId, expectedRevision}` and delegated
 * to Host actions; this layer resolves the target, checks the fence, and
 * projects the chat as it is afterwards. Nothing here reads legacy Task,
 * Invocation or channel-binding records, and nothing is guessed: a fact the
 * Host cannot prove is omitted, or for W reported as `unknown`.
 */

import type { PetLocusMainRecord } from '../spec.js'
import type { LocusAccessModeV20, LocusGroupRowV20, LocusRowFenceV20, LocusRowV20 } from './contract-v20.js'
import { LOCUS_WRITE_ENABLED } from './policy-verification.js'
import type {
  PetLocusActionResultV20,
  PetLocusChatViewV20,
  PetLocusDefaultQaHostRequest,
  PetLocusDefaultQaResultV20,
  PetLocusEndpointInput,
  PetLocusEndpointView,
  PetLocusEntryViewV20,
  PetLocusManagementViewV20,
  PetLocusMainViewV20,
  PetLocusWorkGroupViewV20,
  PetLocusWorkspaceView,
  PetLocusWorkViewV20,
} from '../../wire.js'

/** Stable error codes emitted by this management adapter. */
export type LocusManagementErrorCode =
  | 'CAPABILITY_UNAVAILABLE'
  | 'ACTION_UNAVAILABLE'
  | 'INVALID_REQUEST'
  | 'LOCUS_NOT_FOUND'
  | 'LOCUS_BUSY'
  | 'REVISION_CONFLICT'
  | 'INTEGRATION_FAILED'

/** Error with a stable route-facing code and safe diagnostic. */
export class LocusManagementError extends Error {
  readonly code: LocusManagementErrorCode
  readonly cause?: unknown

  constructor(code: LocusManagementErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'LocusManagementError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

/** The owner-facing text of a stale fence (spec 围栏过期时拒绝而不乐观改写). */
export const LOCUS_FENCE_STALE_MESSAGE = '入口已变化，请刷新后重试'

/** The access receipt; it never claims the mode was applied (design D8). */
export const LOCUS_ACCESS_RECEIPT = '已更新，下次唤醒时应用并核验；核验失败将拒绝服务'

/**
 * The read surface the view needs. Index.ts adapts the v20 repository
 * (`LocusRepositoryPortV20`) onto it.
 */
export interface LocusManagementRepository {
  /** Every v20 `loci` row. */
  readonly listRows: () => readonly LocusRowV20[]
  /** The W ↔ M pairing of one locus main session. */
  readonly findMain: (locusMainSessionId: string) => PetLocusMainRecord | undefined
  /** Any non-terminal Delivery exists for the entry: 「投递中」, greys stop / access. */
  readonly hasNonTerminalDelivery: (locusId: string) => boolean
  /** A `current` Delivery (queued / running / finishing included) exists for the entry: greys rebind. */
  readonly hasCurrentDelivery: (locusId: string) => boolean
}

type MaybePromise<T> = T | Promise<T>

/** Optional session/workspace/endpoint metadata; management never guesses missing facts. */
export interface LocusManagementResolvers {
  /** Cold-read description of any session (W, M or child). */
  readonly session?: (sessionId: string) => MaybePromise<LocusSessionDescription | undefined>
  readonly workspace?: (
    workspaceId: string,
  ) => MaybePromise<{ readonly title?: string; readonly path?: string } | undefined>
  /** Display-only facts (doc title/url, comment quote). Failing leaves them out. */
  readonly endpoint?: (
    endpoint: PetLocusEndpointInput,
  ) => MaybePromise<Pick<PetLocusEndpointView, 'chatName' | 'quote' | 'docUrl'> | undefined>
}

/** One session's owner-facing metadata, as resolved from durable evidence. */
export interface LocusSessionDescription {
  readonly title?: string
  readonly availability?: 'available' | 'archived' | 'missing'
  /**
   * The session's immutable working directory, i.e. its `workspace-write`
   * boundary in DSH's own contract (`sandboxPolicy.resolve()` reports this as
   * `workspaceRoot`). Offered as the CONFIRM CANDIDATE for a locus execution
   * root; it is never an authorization by itself.
   */
  readonly executionRoot?: string
}

/**
 * Cheap cold facts about one session: existence and `cwd` from the persisted
 * log HEADER, and the title from DSH's persisted projection cache — the same
 * sources DSH's own session list uses, neither of which decompresses the body.
 */
export type LocusSessionPeek =
  | { readonly exists: false }
  | {
    readonly exists: true
    readonly cwd?: unknown
    /** Whether the cache answered the title question at all (null counts). */
    readonly titleKnown: boolean
    readonly title?: string
  }

/** Narrow Host capabilities needed to describe a session without loading it. */
export interface LocusSessionDescriberDeps {
  /**
   * Optional fast path. Resolves `undefined` when it cannot answer (service
   * absent, session live in memory), in which case `inspect` is used. A full
   * `inspect` decompresses and replays the whole log; for long sessions that is
   * tens of MB per call, and the management view calls it for every parent and
   * child on every refresh.
   */
  readonly peek?: ((sessionId: string) => Promise<LocusSessionPeek | undefined>) | undefined

  /**
   * Cold-readable session inspection. Resolves for a session whose durable log
   * exists — loaded or not — and rejects when it cannot be read.
   */
  readonly inspect: ((sessionId: string) => Promise<{
    readonly events?: readonly unknown[]
    /** Immutable session header; `cwd` is the working-boundary fact. */
    readonly meta?: { readonly cwd?: unknown }
  }>) | undefined
  /** Durable archive account, the only evidence that outranks readability. */
  readonly archivedSessionIds: () => readonly string[]
  /** Fold the durable title out of a session's events. */
  readonly foldTitle: (events: readonly unknown[]) => string | undefined
}

/**
 * Describe one session for the owner-facing management view.
 *
 * Existence is proven by COLD inspection, never by the live registry.
 * "Is this session loaded in memory right now" is a different question from
 * "does this session exist": after a Host restart nobody has opened a locus
 * main yet, so a healthy session whose log sits on disk would be reported
 * `missing` and the owner would be told their active locus is unavailable.
 * That answer also flips as sessions load and unload, so it cannot serve as
 * acceptance evidence. This mirrors the rule `dsh-port.ts` already states for
 * provisioning: existence comes from cold inspection, never from the live
 * registries.
 *
 * @param deps - narrow Host capabilities.
 * @returns a resolver suitable for {@link LocusManagementResolvers}.
 */
export function createLocusSessionDescriber(
  deps: LocusSessionDescriberDeps,
): (sessionId: string) => Promise<LocusSessionDescription | undefined> {
  /** The cold read itself: availability from the log, plus title and root. */
  const read = async (sessionId: string): Promise<LocusSessionDescription | undefined> => {
    if (deps.peek !== undefined) {
      let peeked: LocusSessionPeek | undefined
      try {
        peeked = await deps.peek(sessionId)
      } catch {
        // The header itself is unreadable: the same "cannot open this" answer
        // a failed full inspection gives.
        return { availability: 'missing' }
      }
      if (peeked !== undefined) {
        if (!peeked.exists) return { availability: 'missing' }
        // Existence is already proven by the persisted header; only fall back to
        // a full read when the cache cannot answer the title question.
        if (peeked.titleKnown) {
          const executionRoot = executionRootOf(peeked.cwd)
          return {
            availability: 'available',
            ...(peeked.title === undefined || peeked.title.trim() === '' ? {} : { title: peeked.title }),
            ...(executionRoot === undefined ? {} : { executionRoot }),
          }
        }
      }
    }
    // No cold-read capability: report nothing rather than guess. An omitted
    // availability reads as unknown, which is honest; claiming `missing` would
    // invent a fact out of a Host limitation.
    if (deps.inspect === undefined) return undefined

    let inspection: {
      readonly events?: readonly unknown[]
      readonly meta?: { readonly cwd?: unknown }
    } | undefined
    try {
      inspection = await deps.inspect(sessionId)
    } catch {
      // Missing, corrupt and temporarily unreadable are all "cannot open this"
      // to an owner deciding whether to click through.
      return { availability: 'missing' }
    }
    if (inspection === undefined) return { availability: 'missing' }

    // Titles are log-only `session/title` events, never header fields: reading
    // the header yields undefined for EVERY session, the exact failure that
    // once made every bound group display one fallback name.
    const title = deps.foldTitle(inspection.events ?? [])
    // The header's `cwd` IS the session's workspace-write boundary (DSH's
    // `sandboxPolicy.resolve` reports it as `workspaceRoot`), so it is the only
    // honest candidate for an owner-confirmed locus execution root. A missing
    // or unusable value stays absent: guessing one here is what the whole
    // derivation exists to prevent.
    const executionRoot = executionRootOf(inspection.meta?.cwd)
    return {
      availability: 'available',
      ...(title === undefined ? {} : { title }),
      ...(executionRoot === undefined ? {} : { executionRoot }),
    }
  }

  return async sessionId => {
    // Archived outranks readability: an archived session's log still inspects
    // fine, so the read below only contributes its TITLE (an archived W must
    // still be recognisable on the panel). Whatever the read says about
    // availability, the answer stays `archived`.
    if (deps.archivedSessionIds().some(id => id === sessionId)) {
      const found = await read(sessionId)
      return {
        availability: 'archived',
        ...(found?.title === undefined ? {} : { title: found.title }),
      }
    }
    return read(sessionId)
  }
}

function executionRootOf(cwd: unknown): string | undefined {
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd.trim() : undefined
}

/** Host-authenticated context supplied to every management action. */
export interface LocusManagementActionContext {
  /** Trusted Host actor; never taken from the browser request body. */
  readonly actorId: string
}

/**
 * The Host actions the three mutations delegate to (index.ts wires them):
 * - `stop`    → controller `stopEntry(fence)`;
 * - `access`  → access-mutation `set({locusId, mode, actorId})`;
 * - `rebind`  → controller `rebindChat({chatId, workSessionId, expectedLocusId, expectedRevision})`;
 * - `defaultQa` → controller `createOrOpenDefaultQa`, answering the chat id.
 * Refusals reject with an Error whose `code` is a v20 code
 * (`INVALID_REQUEST` / `LOCUS_NOT_FOUND` / `LOCUS_CONFLICT` / `LOCUS_BUSY` /
 * `EXPLICIT_PARENT_CONFLICT`) and a deterministic message.
 */
export interface LocusManagementActions {
  readonly stop?: (fence: LocusRowFenceV20) => Promise<unknown>
  readonly access?: (request: {
    readonly locusId: string
    readonly mode: LocusAccessModeV20
    readonly actorId: string
    /** The client's fence; re-checked inside the repository write queue. */
    readonly expectedRevision: number
  }) => Promise<{ readonly receipt?: string } | unknown>
  readonly rebind?: (request: {
    readonly chatId: string
    readonly workSessionId: string
    readonly expectedLocusId: string
    readonly expectedRevision: number
  }) => Promise<unknown>
  readonly defaultQa?: (
    request: PetLocusDefaultQaHostRequest,
  ) => Promise<{ readonly chatId: string; readonly created?: boolean; readonly reused?: boolean }>
}

export interface LocusStopRequest extends LocusRowFenceV20 {
  readonly endpoint: PetLocusEndpointInput
}
export interface LocusAccessRequest extends LocusRowFenceV20 {
  readonly endpoint: PetLocusEndpointInput
  readonly accessMode: LocusAccessModeV20
}
export interface LocusRebindRequest extends LocusRowFenceV20 {
  readonly chatId: string
  readonly workSessionId: string
}

/** The owner-facing management seam the routes call. */
export interface LocusManagementPort {
  readonly view: () => Promise<PetLocusManagementViewV20>
  readonly stop: (request: LocusStopRequest, context: LocusManagementActionContext) => Promise<PetLocusActionResultV20>
  readonly access: (request: LocusAccessRequest, context: LocusManagementActionContext) => Promise<PetLocusActionResultV20>
  readonly rebind: (request: LocusRebindRequest, context: LocusManagementActionContext) => Promise<PetLocusActionResultV20>
  readonly defaultQa?: (request: PetLocusDefaultQaHostRequest) => Promise<PetLocusDefaultQaResultV20>
}

export interface CreateLocusManagementPortOptions {
  readonly repository: LocusManagementRepository
  readonly resolvers?: LocusManagementResolvers
  readonly actions?: LocusManagementActions
  /** Host change generation, when one exists; otherwise the adapter's own counter. */
  readonly generation?: () => number
  /** Defaults to `LOCUS_WRITE_ENABLED`; injectable for tests. */
  readonly writeEnabled?: boolean
}

function endpointKeyOf(endpoint: { readonly chatId: string; readonly threadId?: string }): string {
  return endpoint.threadId === undefined ? `chat:${endpoint.chatId}` : `chat:${endpoint.chatId}:thread:${endpoint.threadId}`
}

function endpointInput(endpoint: { readonly chatId: string; readonly threadId?: string }): PetLocusEndpointInput {
  return endpoint.threadId === undefined ? { chatId: endpoint.chatId } : { chatId: endpoint.chatId, threadId: endpoint.threadId }
}

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

/** Map a Host refusal (v20 code) onto this adapter's stable vocabulary. */
function managementError(error: unknown): LocusManagementError {
  if (error instanceof LocusManagementError) return error
  const code = (error as { code?: unknown } | undefined)?.code
  const message = safeMessage(error)
  if (code === 'LOCUS_CONFLICT') return new LocusManagementError('REVISION_CONFLICT', message, error)
  if (code === 'LOCUS_NOT_FOUND' || code === 'LOCUS_BUSY' || code === 'INVALID_REQUEST') {
    return new LocusManagementError(code, message, error)
  }
  if (code === 'EXPLICIT_PARENT_CONFLICT') return new LocusManagementError('INVALID_REQUEST', message, error)
  return new LocusManagementError('INTEGRATION_FAILED', message, error)
}

const AVAILABILITY_RANK: Record<PetLocusWorkViewV20['availability'], number> = {
  available: 0, archived: 1, missing: 2, unknown: 3,
}

/** Create the v20 management adapter over the durable rows. */
export function createLocusManagementPort(options: CreateLocusManagementPortOptions): LocusManagementPort {
  const { repository, resolvers, actions } = options
  const writeEnabled = options.writeEnabled ?? LOCUS_WRITE_ENABLED
  let revision = 0

  /** One snapshot describes each session once: a description is a cold read. */
  const describer = (): ((id: string) => Promise<LocusSessionDescription | undefined>) => {
    const seen = new Map<string, Promise<LocusSessionDescription | undefined>>()
    return id => {
      let found = seen.get(id)
      if (found === undefined) {
        found = (async () => resolvers?.session?.(id))().catch(() => ({ availability: 'missing' as const }))
        seen.set(id, found)
      }
      return found
    }
  }

  const entryView = async (
    row: LocusRowV20,
    describe: (id: string) => Promise<LocusSessionDescription | undefined>,
  ): Promise<PetLocusEntryViewV20> => {
    const display = await (async () => resolvers?.endpoint?.(endpointInput(row.endpoint)))().catch(() => undefined)
    // A not-created row's sessionId is only a reservation: never cold-read it.
    const session = row.state === 'not-created' ? undefined : await describe(row.sessionId)
    return {
      locusId: row.locusId,
      revision: row.revision,
      endpoint: {
        ...endpointInput(row.endpoint),
        ...(display?.chatName === undefined ? {} : { chatName: display.chatName }),
        ...(display?.quote === undefined ? {} : { quote: display.quote }),
        ...(display?.docUrl === undefined ? {} : { docUrl: display.docUrl }),
      },
      sessionId: row.sessionId,
      ...(row.state === 'not-created' ? {} : {
        session: {
          ...(session?.title === undefined ? {} : { title: session.title }),
          availability: session?.availability ?? 'unknown',
        },
      }),
      state: row.state,
      ...(row.invalidReason === undefined ? {} : { invalidReason: row.invalidReason }),
      accessMode: row.accessMode,
      ...(row.grantedBy === undefined ? {} : { grantedBy: row.grantedBy }),
      ...(row.verifiedAt === undefined ? {} : { verifiedAt: row.verifiedAt }),
      inFlight: repository.hasNonTerminalDelivery(row.locusId),
      hasCurrentDelivery: repository.hasCurrentDelivery(row.locusId),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(row.stoppedAt === undefined ? {} : { stoppedAt: row.stoppedAt }),
    }
  }

  const sessionView = async (
    sessionId: string,
    describe: (id: string) => Promise<LocusSessionDescription | undefined>,
  ): Promise<PetLocusMainViewV20> => {
    const found = await describe(sessionId)
    return {
      sessionId,
      ...(found?.title === undefined ? {} : { title: found.title }),
      ...(found?.availability === undefined ? {} : { availability: found.availability }),
    }
  }

  /** Every chat with its W, from one consistent read of the rows. */
  const project = async (): Promise<readonly { readonly work: PetLocusWorkViewV20; readonly chat: PetLocusChatViewV20 }[]> => {
    const rows = repository.listRows()
    const describe = describer()
    const topicsByChat = new Map<string, LocusRowV20[]>()
    for (const row of rows) {
      if (!('threadId' in row.endpoint)) continue
      const list = topicsByChat.get(row.endpoint.chatId) ?? []
      list.push(row)
      topicsByChat.set(row.endpoint.chatId, list)
    }
    const groups = rows.filter((row): row is LocusGroupRowV20 => !('threadId' in row.endpoint))
    return Promise.all(groups.map(async group => {
      const main = repository.findMain(group.locusMainSessionId)
      if (main === undefined) {
        throw new LocusManagementError('INTEGRATION_FAILED', `群行 ${group.endpoint.chatId} 的 locus 主会话没有配对记录。`)
      }
      const [workFacts, locusMain, workspace, groupEntry, topics, rebound] = await Promise.all([
        describe(main.workSessionId),
        sessionView(group.locusMainSessionId, describe),
        (async () => resolvers?.workspace?.(group.workspaceId))().catch(() => undefined),
        entryView(group, describe),
        Promise.all((topicsByChat.get(group.endpoint.chatId) ?? [])
          .sort((left, right) => endpointKeyOf(left.endpoint).localeCompare(endpointKeyOf(right.endpoint)))
          .map(row => entryView(row, describe))),
        group.reboundFrom === undefined ? undefined : describe(group.reboundFrom),
      ])
      const work: PetLocusWorkViewV20 = {
        sessionId: main.workSessionId,
        ...(workFacts?.title === undefined ? {} : { title: workFacts.title }),
        availability: workFacts?.availability ?? 'unknown',
      }
      const workspaceView: PetLocusWorkspaceView = {
        workspaceId: group.workspaceId,
        ...(workspace?.title === undefined ? {} : { title: workspace.title }),
        ...(workspace?.path === undefined ? {} : { path: workspace.path }),
      }
      const chat: PetLocusChatViewV20 = {
        group: groupEntry,
        topics,
        locusMain,
        workspace: workspaceView,
        ...(group.reboundFrom === undefined ? {} : {
          reboundFrom: {
            sessionId: group.reboundFrom,
            ...(rebound?.title === undefined ? {} : { title: rebound.title }),
          },
        }),
        ...(group.defaultQa === true ? { defaultQa: true } : {}),
      }
      return { work, chat }
    }))
  }

  const view = async (): Promise<PetLocusManagementViewV20> => {
    const chats = await project()
    const byWork = new Map<string, { work: PetLocusWorkViewV20; chats: PetLocusChatViewV20[] }>()
    for (const { work, chat } of chats) {
      const found = byWork.get(work.sessionId)
      if (found === undefined) byWork.set(work.sessionId, { work, chats: [chat] })
      else found.chats.push(chat)
    }
    const works: PetLocusWorkGroupViewV20[] = [...byWork.values()]
      .map(group => ({
        work: group.work,
        chats: [...group.chats].sort((left, right) => left.group.endpoint.chatId.localeCompare(right.group.endpoint.chatId)),
      }))
      .sort((left, right) =>
        AVAILABILITY_RANK[left.work.availability] - AVAILABILITY_RANK[right.work.availability] ||
        (left.work.title ?? '').localeCompare(right.work.title ?? '') ||
        left.work.sessionId.localeCompare(right.work.sessionId))
    return { generation: options.generation?.() ?? revision, works, writeEnabled }
  }

  const chatViewOf = async (chatId: string): Promise<PetLocusChatViewV20> => {
    const found = (await project()).find(item => item.chat.group.endpoint.chatId === chatId)
    if (found === undefined) throw new LocusManagementError('LOCUS_NOT_FOUND', `入口 ${chatId} 不存在。`)
    return found.chat
  }

  /** The row this fence names, proven to be the same entry at the same revision. */
  const requireFenced = (fence: LocusRowFenceV20, endpoint: PetLocusEndpointInput): LocusRowV20 => {
    const row = repository.listRows().find(item => endpointKeyOf(item.endpoint) === endpointKeyOf(endpoint))
    if (row === undefined) throw new LocusManagementError('LOCUS_NOT_FOUND', '入口不存在。')
    if (row.locusId !== fence.expectedLocusId || row.revision !== fence.expectedRevision) {
      throw new LocusManagementError('REVISION_CONFLICT', LOCUS_FENCE_STALE_MESSAGE)
    }
    return row
  }

  const unavailable = (action: string): LocusManagementError =>
    new LocusManagementError('ACTION_UNAVAILABLE', `${action} 需要已注入的 Host 动作。`)

  const requireActor = (context: LocusManagementActionContext | undefined): string => {
    const actor = context?.actorId?.trim()
    if (actor === undefined || actor === '') {
      throw new LocusManagementError('CAPABILITY_UNAVAILABLE', '缺少 Host 可信操作者身份，不能修改 locus。')
    }
    return actor
  }

  const stop: LocusManagementPort['stop'] = async (request, context) => {
    requireActor(context)
    if (actions?.stop === undefined) throw unavailable('stop')
    const row = requireFenced(request, request.endpoint)
    if (repository.hasNonTerminalDelivery(row.locusId)) {
      throw new LocusManagementError('LOCUS_BUSY', '该入口正在投递，待其结束后再停止。')
    }
    try {
      await actions.stop({ expectedLocusId: request.expectedLocusId, expectedRevision: request.expectedRevision })
    } catch (error) {
      throw managementError(error)
    }
    revision += 1
    return { action: 'stop', chat: await chatViewOf(row.endpoint.chatId) }
  }

  const access: LocusManagementPort['access'] = async (request, context) => {
    const actorId = requireActor(context)
    if (actions?.access === undefined) throw unavailable('access')
    if (request.accessMode === 'danger-full-access' && !writeEnabled) {
      throw new LocusManagementError('INVALID_REQUEST', '写档已全局停用：全局写开关已关闭，不能设为完全访问。')
    }
    const row = requireFenced(request, request.endpoint)
    if (row.state !== 'not-created' && row.state !== 'active') {
      throw new LocusManagementError('INVALID_REQUEST', '只有未创建或活跃的入口可以修改访问模式。')
    }
    if (repository.hasNonTerminalDelivery(row.locusId)) {
      throw new LocusManagementError('LOCUS_BUSY', '该入口正在投递，待其结束后再修改访问模式。')
    }
    let receipt: string | undefined
    try {
      const result = await actions.access({ locusId: row.locusId, mode: request.accessMode, actorId, expectedRevision: request.expectedRevision })
      const text = (result as { receipt?: unknown } | undefined)?.receipt
      receipt = typeof text === 'string' && text.trim() !== '' ? text : undefined
    } catch (error) {
      throw managementError(error)
    }
    revision += 1
    return { action: 'access', chat: await chatViewOf(row.endpoint.chatId), receipt: receipt ?? LOCUS_ACCESS_RECEIPT }
  }

  const rebind: LocusManagementPort['rebind'] = async (request, context) => {
    requireActor(context)
    if (actions?.rebind === undefined) throw unavailable('rebind')
    const workSessionId = request.workSessionId.trim()
    if (workSessionId === '') throw new LocusManagementError('INVALID_REQUEST', '请输入目标工作会话的完整 sessionId。')
    requireFenced(request, { chatId: request.chatId })
    try {
      await actions.rebind({
        chatId: request.chatId,
        workSessionId,
        expectedLocusId: request.expectedLocusId,
        expectedRevision: request.expectedRevision,
      })
    } catch (error) {
      throw managementError(error)
    }
    revision += 1
    const moved = (await project()).find(item => item.chat.group.endpoint.chatId === request.chatId)
    if (moved === undefined) throw new LocusManagementError('LOCUS_NOT_FOUND', `入口 ${request.chatId} 不存在。`)
    const target = moved.work.title === undefined ? moved.work.sessionId : `${moved.work.title}（${moved.work.sessionId}）`
    return {
      action: 'rebind',
      chat: moved.chat,
      receipt: `已改绑到 ${target}；各入口将在新会话下按首条消息重新创建子会话，不保留上下文。`,
    }
  }

  const defaultQa = actions?.defaultQa === undefined ? undefined : async (
    request: PetLocusDefaultQaHostRequest,
  ): Promise<PetLocusDefaultQaResultV20> => {
    let opened: Awaited<ReturnType<NonNullable<LocusManagementActions['defaultQa']>>>
    try {
      opened = await actions.defaultQa!(request)
    } catch (error) {
      throw managementError(error)
    }
    revision += 1
    return {
      action: 'default-qa',
      chat: await chatViewOf(opened.chatId),
      ...(opened.created === undefined ? {} : { created: opened.created }),
      ...(opened.reused === undefined ? {} : { reused: opened.reused }),
    }
  }

  return { view, stop, access, rebind, ...(defaultQa === undefined ? {} : { defaultQa }) }
}
