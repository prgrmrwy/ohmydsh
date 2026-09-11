/**
 * Optional Host seam for the owner-facing unified locus management routes.
 *
 * The repository/controller are intentionally injected rather than imported by
 * the route layer. A Host may therefore expose the additive routes before its
 * durable locus storage is composed. In that state the routes fail closed with
 * a capability diagnostic; they never read or mutate legacy Task, Invocation,
 * or channel-binding records as a fallback.
 */

import {
  endpointKeyOf,
  type LocusEndpoint,
  type LocusMutationFence,
  type LocusPermissionMode,
  type LocusRecord,
} from './aggregate.js'
import type { LocusPermissionMutationPort } from './permission-mutation.js'
import type {
  PetLocusActionRequest,
  PetLocusActionResult,
  PetLocusDefaultQaHostRequest,
  PetLocusDefaultQaResult,
  PetLocusDiscoveryRequest,
  PetLocusDiscoveryView,
  PetLocusEndpointView,
  PetLocusManagementView,
  PetLocusView,
} from '../../wire.js'

/** Stable error codes emitted by this management adapter. */
export type LocusManagementErrorCode =
  | 'CAPABILITY_UNAVAILABLE'
  | 'INVALID_REQUEST'
  | 'LOCUS_NOT_FOUND'
  | 'LOCUS_BUSY'
  | 'LOCUS_INVALID'
  | 'LOCUS_STOPPED'
  | 'REVISION_CONFLICT'
  | 'ACTION_UNAVAILABLE'
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

/** Minimal durable repository port used by the projection adapter. */
export interface LocusManagementRepository {
  /** All immutable generations; legacy Task/chat bindings are never consulted. */
  readonly listLoci: () => readonly LocusRecord[]
  /** Current endpoint lookup from the locus endpoint index, when available. */
  readonly getCurrentLocus?: (endpoint: LocusEndpoint) => LocusRecord | undefined
  /** Latest generation including stopped/invalid/retired markers. */
  readonly getLatestLocusByEndpoint?: (endpoint: LocusEndpoint) => LocusRecord | undefined
  /** Alias supported by the in-memory/reference repository. */
  readonly getCurrent?: (endpoint: LocusEndpoint) => LocusRecord | undefined
  /** Parent reverse index, if the durable adapter provides one. */
  readonly listLociByParent?: (parentSessionId: string) => readonly LocusRecord[]
  /** Alias supported by the in-memory/reference repository. */
  readonly listByParent?: (parentSessionId: string) => readonly LocusRecord[]
  /** Child reverse index, if the durable adapter provides one. */
  readonly getLocusByChild?: (childSessionId: string) => LocusRecord | undefined
  /** Alias supported by the in-memory/reference repository. */
  readonly getByChild?: (childSessionId: string) => LocusRecord | undefined
  /** Default-Q&A reverse index, including unavailable history. */
  readonly getDefaultQa?: (parentSessionId: string) => LocusRecord | undefined
  /** Accepted/queued/running Delivery fence, when the durable adapter can prove it. */
  readonly hasPendingDeliveries?: (locusId: string) => boolean
  /** Durable stopped/unbound transition. */
  readonly transitionLocus?: (
    locusId: string,
    state: LocusRecord['state'],
    now?: number,
    patch?: { readonly busy?: boolean },
    fence?: LocusMutationFence,
  ) => Promise<LocusRecord> | LocusRecord
  /** Reference/durable repository spelling for explicit stop. */
  readonly stopLocus?: (locusId: string, now?: number, fence?: LocusMutationFence) => Promise<LocusRecord> | LocusRecord
  /** Durable archive/retire transition. */
  readonly retireLocus?: (locusId: string, now?: number, fence?: LocusMutationFence) => Promise<LocusRecord> | LocusRecord
  /** Durable verified permission transition. */
  readonly setLocusMode?: (
    locusId: string,
    mode: LocusPermissionMode,
    grantedBy?: string,
    verifiedAt?: number,
    fence?: LocusMutationFence,
  ) => Promise<LocusRecord> | LocusRecord
  /** Owner-confirmed context facts; does not mutate permission. */
  readonly confirmContextAnchor?: (
    locusId: string,
    anchor: {
      readonly status: 'confirmed' | 'missing' | 'unknown'
      readonly existence?: 'exists' | 'missing' | 'unknown'
      readonly executionRoot?: string
      readonly projectResources?: readonly string[]
      readonly constraints?: readonly string[]
    },
    confirmedBy: string,
    now?: number,
    fence?: LocusMutationFence,
  ) => Promise<LocusRecord> | LocusRecord
}

/** Optional session/workspace metadata; management never guesses missing facts. */
export interface LocusManagementResolvers {
  readonly main?: (
    sessionId: string,
  ) =>
    | Promise<{ readonly title?: string; readonly availability?: 'available' | 'archived' | 'missing' } | undefined>
    | { readonly title?: string; readonly availability?: 'available' | 'archived' | 'missing' }
    | undefined
  readonly child?: (
    sessionId: string,
  ) =>
    | Promise<{ readonly title?: string; readonly availability?: 'available' | 'archived' | 'missing' } | undefined>
    | { readonly title?: string; readonly availability?: 'available' | 'archived' | 'missing' }
    | undefined
  readonly workspace?: (
    workspaceId: string,
  ) =>
    | Promise<{ readonly title?: string; readonly path?: string; readonly executionRoot?: string } | undefined>
    | { readonly title?: string; readonly path?: string; readonly executionRoot?: string }
    | undefined
}

/** Host-authenticated context supplied to an external management action. */
export interface LocusManagementActionContext {
  /** Trusted Host actor; never taken from the browser request body. */
  readonly actorId: string
  /** Authoritative target snapshot, when this action addresses an existing locus. */
  readonly target?: LocusRecord
}

/** Actions supplied by a composed controller/external-resource adapter. */
export interface LocusManagementActions {
  readonly bind?: (
    request: Extract<PetLocusActionRequest, { action: 'bind' }>,
    context: LocusManagementActionContext,
  ) => Promise<PetLocusActionResult> | PetLocusActionResult
  readonly defaultQa?: (
    request: PetLocusDefaultQaHostRequest,
    context: LocusManagementActionContext,
  ) => Promise<PetLocusDefaultQaResult> | PetLocusDefaultQaResult
  readonly rebuild?: (
    request: Extract<PetLocusActionRequest, { action: 'rebuild' }>,
    context: LocusManagementActionContext,
  ) => Promise<PetLocusActionResult> | PetLocusActionResult
  readonly archive?: (
    request: Extract<PetLocusActionRequest, { action: 'archive' }>,
    context: LocusManagementActionContext,
  ) => Promise<PetLocusActionResult> | PetLocusActionResult
  readonly stop?: (
    request: Extract<PetLocusActionRequest, { action: 'stop' }>,
    context: LocusManagementActionContext,
  ) => Promise<PetLocusActionResult> | PetLocusActionResult
}

/** Optional Host seam for the owner-facing unified locus management routes. */
export interface LocusManagementPort {
  /** Complete owner-facing view, including reverse-index projections. */
  readonly view: () => Promise<PetLocusManagementView> | PetLocusManagementView
  /** Query one or more authoritative endpoint/parent/child indexes. */
  readonly discovery: (
    request: PetLocusDiscoveryRequest,
  ) => Promise<PetLocusDiscoveryView> | PetLocusDiscoveryView
  /** Create/open a stable default Q&A locus for one main session. */
  readonly defaultQa?: (
    request: PetLocusDefaultQaHostRequest,
    context: LocusManagementActionContext,
  ) => Promise<PetLocusDefaultQaResult> | PetLocusDefaultQaResult
  /** Optional generic transactional action dispatcher. */
  readonly action?: (
    request: PetLocusActionRequest,
    context: LocusManagementActionContext,
  ) => Promise<PetLocusActionResult> | PetLocusActionResult
  readonly bind?: (
    request: Extract<PetLocusActionRequest, { action: 'bind' }>,
    context: LocusManagementActionContext,
  ) => Promise<PetLocusActionResult> | PetLocusActionResult
  readonly unbind?: (
    request: Extract<PetLocusActionRequest, { action: 'unbind' }>,
    context: LocusManagementActionContext,
  ) => Promise<PetLocusActionResult> | PetLocusActionResult
  readonly scope?: (
    request: Extract<PetLocusActionRequest, { action: 'scope' }>,
    context: LocusManagementActionContext,
  ) => Promise<PetLocusActionResult> | PetLocusActionResult
  readonly rebuild?: (
    request: Extract<PetLocusActionRequest, { action: 'rebuild' }>,
    context: LocusManagementActionContext,
  ) => Promise<PetLocusActionResult> | PetLocusActionResult
  /** Explicit archive/retire; absent means the action is unavailable. */
  readonly archive?: (
    request: Extract<PetLocusActionRequest, { action: 'archive' }>,
    context: LocusManagementActionContext,
  ) => Promise<PetLocusActionResult> | PetLocusActionResult
  /** Explicit stop; absent means the action is unavailable. */
  readonly stop?: (
    request: Extract<PetLocusActionRequest, { action: 'stop' }>,
    context: LocusManagementActionContext,
  ) => Promise<PetLocusActionResult> | PetLocusActionResult
}

/** Host-authoritative owner identity and lifecycle diagnostics. */
export interface LocusManagementIdentity {
  /** Authenticated Host actor; never read from a browser action body. */
  readonly actorId?: string
  /** Safe display label for diagnostics; no credentials or raw auth payload. */
  readonly actorLabel?: string
}

export interface LocusManagementDiagnostics {
  readonly capability: 'available' | 'unavailable'
  readonly diagnostic?: string
  readonly owner?: LocusManagementIdentity
}

export interface CreateLocusManagementPortOptions {
  readonly repository: LocusManagementRepository
  readonly resolvers?: LocusManagementResolvers
  readonly actions?: LocusManagementActions
  /** Host change generation, when one exists; otherwise the adapter revision is used. */
  readonly generation?: () => number
  /** Current time for safe transition records and deterministic tests. */
  readonly now?: () => number
  /** Host-derived owner identity for audit/display only; never browser supplied. */
  readonly identity?: () => LocusManagementIdentity | undefined
  /** Stable capability diagnostic exposed to the owner-facing diagnostics route. */
  readonly capabilityDiagnostic?: string
  /**
   * Preferred Host-verified permission mutation. It applies and reads back the
   * exact child sandbox before persisting permission/audit state.
   */
  readonly permissionMutation?: LocusPermissionMutationPort
  /** @deprecated Compatibility-only test seam; production must use permissionMutation. */
  readonly verifyWrite?: (input: {
    readonly locus: LocusRecord
  }) => Promise<{ readonly verifiedAt: number }> | { readonly verifiedAt: number }
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

function managementError(error: unknown, operation: string): LocusManagementError {
  if (error instanceof LocusManagementError) return error
  const code = (error as { code?: unknown } | undefined)?.code
  if (code === 'LOCUS_NOT_FOUND') return new LocusManagementError('LOCUS_NOT_FOUND', safeErrorMessage(error), error)
  if (code === 'LOCUS_BUSY') return new LocusManagementError('LOCUS_BUSY', safeErrorMessage(error), error)
  if (code === 'LOCUS_STOPPED') return new LocusManagementError('LOCUS_STOPPED', safeErrorMessage(error), error)
  if (code === 'LOCUS_INVALID' || code === 'LOCUS_NOT_CURRENT' || code === 'INVALID_STATE' || code === 'INVALID_PERMISSION' || code === 'WRITE_UNSUPPORTED' || code === 'POLICY_APPLY_FAILED' || code === 'POLICY_VERIFY_FAILED') {
    return new LocusManagementError('LOCUS_INVALID', safeErrorMessage(error), error)
  }
  return new LocusManagementError('INTEGRATION_FAILED', `${operation} 失败：${safeErrorMessage(error)}`, error)
}

function endpointOfView(endpoint: PetLocusEndpointView): LocusEndpoint {
  if (endpoint === null || typeof endpoint !== 'object') {
    throw new LocusManagementError('INVALID_REQUEST', 'endpoint 必须是对象。')
  }
  if (typeof endpoint.chatId !== 'string' || endpoint.chatId.trim() === '') {
    throw new LocusManagementError('INVALID_REQUEST', 'endpoint.chatId 必须是非空字符串。')
  }
  if (endpoint.threadId !== undefined && (typeof endpoint.threadId !== 'string' || endpoint.threadId.trim() === '')) {
    throw new LocusManagementError('INVALID_REQUEST', 'endpoint.threadId 必须是非空字符串。')
  }
  return {
    chatId: endpoint.chatId.trim(),
    ...(endpoint.threadId === undefined ? {} : { threadId: endpoint.threadId.trim() }),
  }
}

function endpointView(endpoint: LocusEndpoint): PetLocusEndpointView {
  return endpoint.threadId === undefined
    ? { chatId: endpoint.chatId }
    : { chatId: endpoint.chatId, threadId: endpoint.threadId }
}

function sourceMain(source: LocusRecord['source']): LocusRecord['source'] {
  return source
}

function stateView(record: LocusRecord): PetLocusView['state'] {
  return {
    state: record.state,
    busy: record.busy,
    ...(record.invalidReason === undefined ? {} : { invalidReason: record.invalidReason }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.stoppedAt === undefined ? {} : { stoppedAt: record.stoppedAt }),
    ...(record.retiredAt === undefined ? {} : { retiredAt: record.retiredAt }),
  }
}

/**
 * Adapt one domain record to the owner-facing wire projection. Metadata is
 * resolved only when the Host explicitly supplies a resolver; missing facts are
 * omitted rather than inferred from ids or cwd.
 */
async function projectRecord(
  record: LocusRecord,
  isDefaultQa: boolean,
  resolvers: LocusManagementResolvers | undefined,
): Promise<PetLocusView> {
  const [main, child, workspace] = await Promise.all([
    resolvers?.main?.(record.parentSessionId),
    record.childSessionId === undefined ? undefined : resolvers?.child?.(record.childSessionId),
    resolvers?.workspace?.(record.workspaceId),
  ])
  return {
    locusId: record.id,
    generation: record.generation,
    endpoint: endpointView(record.endpoint),
    main: {
      sessionId: record.parentSessionId,
      source: sourceMain(record.source),
      ...(main?.title === undefined ? {} : { title: main.title }),
      ...(main?.availability === undefined ? {} : { availability: main.availability }),
    },
    child: {
      ...(record.childSessionId === undefined ? {} : { sessionId: record.childSessionId }),
      ...(child?.title === undefined ? {} : { title: child.title }),
      ...(child?.availability === undefined ? {} : { availability: child.availability }),
    },
    workspace: {
      workspaceId: record.workspaceId,
      ...(workspace?.title === undefined ? {} : { title: workspace.title }),
      ...(workspace?.path === undefined ? {} : { path: workspace.path }),
      ...(workspace?.executionRoot === undefined ? {} : { executionRoot: workspace.executionRoot }),
    },
    ...(record.contextAnchor === undefined ? {} : {
      contextAnchor: {
        status: record.contextAnchor.status,
        ...(record.contextAnchor.existence === undefined ? {} : { existence: record.contextAnchor.existence }),
        ...(record.contextAnchor.authorization === undefined ? {} : { authorization: record.contextAnchor.authorization }),
        ...(record.contextAnchor.executionRoot === undefined ? {} : { executionRoot: record.contextAnchor.executionRoot }),
        ...(record.contextAnchor.projectResources === undefined ? {} : { projectResources: [...record.contextAnchor.projectResources] }),
        ...(record.contextAnchor.constraints === undefined ? {} : { constraints: [...record.contextAnchor.constraints] }),
        ...(record.contextAnchor.provenance === undefined ? {} : { provenance: record.contextAnchor.provenance }),
        ...(record.contextAnchor.confirmedAt === undefined ? {} : { confirmedAt: record.contextAnchor.confirmedAt }),
      },
    }),
    permission: {
      desired: record.permission.desired,
      effective: record.permission.effective,
      ...(record.permission.verifiedAt === undefined ? {} : { verifiedAt: record.permission.verifiedAt }),
      ...(record.permission.grantedBy === undefined ? {} : { grantedBy: record.permission.grantedBy }),
    },
    state: stateView(record),
    source: record.source,
    ...(record.parentLocusId === undefined ? {} : { parentLocusId: record.parentLocusId }),
    isDefaultQa,
    defaultQa: isDefaultQa,
  }
}

function sortRecords(records: readonly LocusRecord[]): readonly LocusRecord[] {
  return [...records].sort((left, right) => {
    if (left.generation !== right.generation) return left.generation - right.generation
    if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt
    return left.id.localeCompare(right.id)
  })
}

function requireSelector(request: PetLocusDiscoveryRequest): void {
  if (request.endpoint === undefined && request.parentSessionId === undefined && request.childSessionId === undefined) {
    throw new LocusManagementError('INVALID_REQUEST', '至少提供 endpoint、parentSessionId 或 childSessionId 之一。')
  }
}

function requireRecord(repository: LocusManagementRepository, locusId: string): LocusRecord {
  const record = repository.listLoci().find(item => item.id === locusId)
  if (record === undefined) throw new LocusManagementError('LOCUS_NOT_FOUND', `Locus ${locusId} 不存在。`)
  return record
}

function assertExpected(
  record: LocusRecord,
  expectedGeneration: number | undefined,
  expectedLocusId: string | undefined,
  expectedUpdatedAt: number | undefined,
): void {
  if (expectedGeneration !== undefined && record.generation !== expectedGeneration) {
    throw new LocusManagementError('REVISION_CONFLICT', 'locus generation 已变化，请刷新后重试。')
  }
  if (expectedLocusId !== undefined && record.id !== expectedLocusId) {
    throw new LocusManagementError('REVISION_CONFLICT', 'locus 当前代际已变化，请刷新后重试。')
  }
  if (expectedUpdatedAt !== undefined && record.updatedAt !== expectedUpdatedAt) {
    throw new LocusManagementError('REVISION_CONFLICT', 'locus 管理视图已变化，请刷新后重试。')
  }
}

/**
 * Prove that a lifecycle mutation still targets the endpoint's exact current
 * generation.  A historical locus id is not authority to stop/archive the
 * endpoint that replaced it, and omitting the endpoint would make that race
 * impossible to distinguish.
 */
function requireExactCurrent(
  repository: LocusManagementRepository,
  target: LocusRecord,
  endpointInput: PetLocusEndpointView | undefined,
): LocusEndpoint {
  if (endpointInput === undefined) {
    throw new LocusManagementError('INVALID_REQUEST', '当前入口操作必须提供 endpoint。')
  }
  const endpoint = endpointOfView(endpointInput)
  if (endpointKeyOf(endpoint) !== endpointKeyOf(target.endpoint)) {
    throw new LocusManagementError('INVALID_REQUEST', 'endpoint 与 locusId 不匹配。')
  }
  const lookup = repository.getCurrentLocus ?? repository.getCurrent
  if (lookup === undefined) {
    throw new LocusManagementError('CAPABILITY_UNAVAILABLE', '仓储未提供当前入口索引，不能安全修改 locus。')
  }
  const current = lookup.call(repository, endpoint)
  if (current === undefined || current.id !== target.id || current.generation !== target.generation) {
    throw new LocusManagementError('REVISION_CONFLICT', 'locus 已不是该入口的当前代际，请刷新后重试。')
  }
  return endpoint
}

/** A rebuild may target a retired marker whose current index was intentionally cleared. */
function requireIdle(
  repository: LocusManagementRepository,
  target: LocusRecord,
): void {
  if (repository.hasPendingDeliveries === undefined) {
    throw new LocusManagementError('CAPABILITY_UNAVAILABLE', '仓储不能证明 locus 无在途 Delivery，已拒绝生命周期修改。')
  }
  if (target.busy || repository.hasPendingDeliveries(target.id)) {
    throw new LocusManagementError('LOCUS_BUSY', 'locus 仍有已接受、排队或运行中的 Delivery，请稍后重试。')
  }
}

function requireLatestEndpointMarker(
  repository: LocusManagementRepository,
  target: LocusRecord,
  endpointInput: PetLocusEndpointView,
): LocusEndpoint {
  const endpoint = endpointOfView(endpointInput)
  const key = endpointKeyOf(endpoint)
  if (key !== endpointKeyOf(target.endpoint)) {
    throw new LocusManagementError('INVALID_REQUEST', 'endpoint 与停止标记不匹配。')
  }
  const latest = repository.listLoci()
    .filter(record => endpointKeyOf(record.endpoint) === key)
    .sort((left, right) => right.generation - left.generation || right.updatedAt - left.updatedAt)[0]
  if (latest?.id !== target.id) {
    throw new LocusManagementError('REVISION_CONFLICT', 'locus 已不是该入口的最新停止标记，请刷新后重试。')
  }
  const current = (repository.getCurrentLocus ?? repository.getCurrent)?.call(repository, endpoint)
  if (current !== undefined && current.id !== target.id) {
    throw new LocusManagementError('REVISION_CONFLICT', '入口已经有更新的当前代际，请刷新后重试。')
  }
  return endpoint
}

/**
 * Create a concrete management adapter over the durable locus repository.
 * Bind/default-Q&A/rebuild require external session/chat provisioning and are
 * delegated only when explicitly injected. Unbind and scope use durable
 * transitions when the repository exposes the corresponding method.
 */
export function createLocusManagementPort(
  options: CreateLocusManagementPortOptions,
): LocusManagementPort {
  const { repository, resolvers, actions, now = Date.now } = options
  const identity = options.identity
  let revision = 0

  const records = (): readonly LocusRecord[] => sortRecords(repository.listLoci())
  const defaultFor = (parentSessionId: string): LocusRecord | undefined =>
    repository.getDefaultQa?.(parentSessionId)
  const currentFor = (endpoint: LocusEndpoint, history: readonly LocusRecord[]): LocusRecord | undefined => {
    const key = endpointKeyOf(endpoint)
    const indexed = repository.getCurrentLocus?.(endpoint) ?? repository.getCurrent?.(endpoint)
    if (indexed !== undefined) {
      if (endpointKeyOf(indexed.endpoint) !== key || !history.some(record => record.id === indexed.id)) {
        throw new LocusManagementError('INTEGRATION_FAILED', 'endpoint current index points outside its endpoint history')
      }
      // An unavailable marker is still the authoritative current generation;
      // project it for diagnostics, but never fall back to an older routable
      // row and accidentally revive the endpoint.
      return indexed
    }
    // A repository without an index must not synthesize a current row from
    // history: missing index state is not proof of routability.
    return undefined
  }
  const project = async (record: LocusRecord, isDefaultQa = false): Promise<PetLocusView> =>
    projectRecord(record, isDefaultQa, resolvers)
  const actionResult = async (
    action: PetLocusActionRequest['action'],
    record: LocusRecord,
    previous?: LocusRecord,
    flags: { readonly created?: boolean; readonly reused?: boolean; readonly warningText?: string } = {},
  ): Promise<PetLocusActionResult> => ({
    action,
    locus: await project(record, defaultFor(record.parentSessionId)?.id === record.id),
    ...(previous === undefined
      ? {}
      : { previousLocus: await project(previous, defaultFor(previous.parentSessionId)?.id === previous.id) }),
    ...(flags.created === undefined ? {} : { created: flags.created }),
    ...(flags.reused === undefined ? {} : { reused: flags.reused }),
    ...(flags.warningText === undefined ? {} : { warningText: flags.warningText }),
  })

  const view = async (): Promise<PetLocusManagementView> => {
    const all = records()
    const defaultQaRecords = new Map<string, LocusRecord>()
    const parentIds = new Set<string>()
    for (const record of all) parentIds.add(record.parentSessionId)
    for (const parentId of parentIds) {
      const defaultQa = defaultFor(parentId)
      if (defaultQa !== undefined) defaultQaRecords.set(parentId, defaultQa)
    }
    const projected = new Map<string, PetLocusView>()
    for (const record of all) {
      projected.set(record.id, await project(record, defaultQaRecords.get(record.parentSessionId)?.id === record.id))
    }
    const requireProjected = (record: LocusRecord): PetLocusView => {
      const value = projected.get(record.id)
      if (value === undefined) throw new LocusManagementError('INTEGRATION_FAILED', `locus ${record.id} projection is missing`)
      return value
    }
    const byEndpoint = new Map<string, LocusRecord[]>()
    for (const record of all) {
      const key = endpointKeyOf(record.endpoint)
      const list = byEndpoint.get(key) ?? []
      list.push(record)
      byEndpoint.set(key, list)
    }
    const discovery: PetLocusDiscoveryView = {
      byEndpoint: [...byEndpoint.values()].map(history => {
        const sorted = sortRecords(history)
        const first = sorted[0]
        if (first === undefined) throw new LocusManagementError('INTEGRATION_FAILED', '空 endpoint 历史。')
        const current = currentFor(first.endpoint, sorted)
        return {
          endpoint: endpointView(first.endpoint),
          ...(current === undefined ? {} : { current: requireProjected(current) }),
          history: sorted.map(requireProjected),
        }
      }),
      byParent: [...parentIds].sort().map(parentSessionId => {
        const parentRecords = repository.listLociByParent?.(parentSessionId) ?? repository.listByParent?.(parentSessionId) ?? all.filter(record => record.parentSessionId === parentSessionId)
        const defaultQa = defaultQaRecords.get(parentSessionId)
        return {
          parentSessionId,
          ...(defaultQa === undefined ? {} : { defaultQa: requireProjected(defaultQa) }),
          loci: sortRecords(parentRecords).map(requireProjected),
        }
      }),
      byChild: [...new Set(all.flatMap(record => record.childSessionId === undefined ? [] : [record.childSessionId]))].sort().map(childSessionId => {
        const childRecord = repository.getLocusByChild?.(childSessionId) ?? repository.getByChild?.(childSessionId) ?? all.find(record => record.childSessionId === childSessionId)
        const history = all.filter(record => record.childSessionId === childSessionId)
        return {
          childSessionId,
          ...(childRecord === undefined ? {} : { locus: requireProjected(childRecord) }),
          ...(history.length === 0 ? {} : { history: sortRecords(history).map(requireProjected) }),
        }
      }),
    }
    return {
      generation: options.generation?.() ?? revision,
      loci: all.map(requireProjected),
      defaultQa: [...defaultQaRecords.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([parentSessionId, record]) => ({ parentSessionId, locus: requireProjected(record) })),
      discovery,
    }
  }

  const discovery = async (request: PetLocusDiscoveryRequest): Promise<PetLocusDiscoveryView> => {
    requireSelector(request)
    const snapshot = await view()
    const endpoint = request.endpoint === undefined ? undefined : endpointOfView(request.endpoint)
    return {
      byEndpoint: endpoint === undefined
        ? []
        : snapshot.discovery.byEndpoint.filter(item => endpointKeyOf(item.endpoint) === endpointKeyOf(endpoint)),
      byParent: request.parentSessionId === undefined
        ? []
        : snapshot.discovery.byParent.filter(item => item.parentSessionId === request.parentSessionId),
      byChild: request.childSessionId === undefined
        ? []
        : snapshot.discovery.byChild.filter(item => item.childSessionId === request.childSessionId),
    }
  }

  const requireActor = (): string => {
    const actor = identity?.()?.actorId?.trim()
    if (actor === undefined || actor === '') {
      throw new LocusManagementError('CAPABILITY_UNAVAILABLE', '缺少 Host 可信操作者身份，不能修改 locus。')
    }
    return actor
  }
  const actionContext = (target?: LocusRecord): LocusManagementActionContext => ({
    actorId: requireActor(),
    ...(target === undefined ? {} : { target }),
  })
  const assertActionContext = (
    context: LocusManagementActionContext | undefined,
    target?: LocusRecord,
  ): LocusManagementActionContext => {
    if (context === undefined || typeof context.actorId !== 'string' || context.actorId.trim() === '') {
      throw new LocusManagementError('CAPABILITY_UNAVAILABLE', '缺少 Host 可信操作者身份，不能修改 locus。')
    }
    const actorId = requireActor()
    if (context.actorId !== actorId) {
      throw new LocusManagementError('CAPABILITY_UNAVAILABLE', 'locus 操作者身份与当前 Host 身份不一致。')
    }
    if (target !== undefined && context.target !== undefined && context.target.id !== target.id) {
      throw new LocusManagementError('REVISION_CONFLICT', 'locus 目标已变化，请刷新后重试。')
    }
    return target === undefined ? context : { ...context, target }
  }
  const unavailable = (action: string): LocusManagementError =>
    new LocusManagementError('ACTION_UNAVAILABLE', `${action} 需要已注入的 locus controller/storage action seam；未回退旧 Task/Invocation。`)

  const unbind = async (
    request: Extract<PetLocusActionRequest, { action: 'unbind' }>,
    context: LocusManagementActionContext,
  ): Promise<PetLocusActionResult> => {
    if (repository.stopLocus === undefined && repository.transitionLocus === undefined) throw unavailable('unbind')
    const previous = requireRecord(repository, request.locusId)
    assertExpected(previous, request.expectedGeneration, request.expectedLocusId, request.expectedUpdatedAt)
    requireExactCurrent(repository, previous, request.endpoint)
    const trusted = assertActionContext(context, previous)
    const fence: LocusMutationFence = {
      ...(request.expectedGeneration === undefined ? {} : { expectedGeneration: request.expectedGeneration }),
      ...(request.expectedLocusId === undefined ? {} : { expectedLocusId: request.expectedLocusId }),
      ...(request.expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: request.expectedUpdatedAt }),
    }
    requireIdle(repository, previous)
    void trusted
    if (previous.state === 'stopped') {
      return actionResult('unbind', previous, previous, { created: false, reused: true })
    }
    try {
      const next = repository.stopLocus !== undefined
        ? await repository.stopLocus(previous.id, now(), fence)
        : await repository.transitionLocus!(previous.id, 'stopped', now(), undefined, fence)
      revision += 1
      return actionResult('unbind', next, previous, { created: false })
    } catch (error) {
      throw managementError(error, 'unbind')
    }
  }

  const scope = async (
    request: Extract<PetLocusActionRequest, { action: 'scope' }>,
    context: LocusManagementActionContext,
  ): Promise<PetLocusActionResult> => {
    if (options.permissionMutation === undefined && repository.setLocusMode === undefined) {
      throw unavailable('scope')
    }
    const previous = requireRecord(repository, request.locusId)
    assertExpected(previous, request.expectedGeneration, request.expectedLocusId, request.expectedUpdatedAt)
    const trusted = assertActionContext(context, previous)
    const fence: LocusMutationFence = {
      ...(request.expectedGeneration === undefined ? {} : { expectedGeneration: request.expectedGeneration }),
      ...(request.expectedLocusId === undefined ? {} : { expectedLocusId: request.expectedLocusId }),
      ...(request.expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: request.expectedUpdatedAt }),
    }
    if (options.permissionMutation !== undefined) {
      try {
        const next = await options.permissionMutation.mutate({
          locusId: previous.id,
          actorId: trusted.actorId,
          mode: request.mode,
          fence,
        })
        revision += 1
        return actionResult('scope', next, previous, { created: false })
      } catch (error) {
        throw managementError(error, 'scope policy mutation')
      }
    }
    const setLocusMode = repository.setLocusMode
    if (setLocusMode === undefined) throw unavailable('scope')
    if (previous.busy || repository.hasPendingDeliveries?.(previous.id) === true) {
      throw new LocusManagementError('LOCUS_BUSY', 'locus 仍有已接受或运行中的 Delivery，请稍后重试。')
    }
    let verifiedAt = now()
    if (request.mode === 'write') {
      if (options.verifyWrite === undefined) throw unavailable('scope write')
      try {
        verifiedAt = (await options.verifyWrite({ locus: previous })).verifiedAt
      } catch (error) {
        throw managementError(error, 'scope write verification')
      }
    }
    try {
      const next = await setLocusMode.call(
        repository,
        previous.id,
        request.mode,
        trusted.actorId,
        verifiedAt,
        fence,
      )
      revision += 1
      return actionResult('scope', next, previous, { created: false })
    } catch (error) {
      throw managementError(error, 'scope')
    }
  }

  const confirmAnchor = async (
    request: Extract<PetLocusActionRequest, { action: 'confirm-anchor' }>,
    context: LocusManagementActionContext,
  ): Promise<PetLocusActionResult> => {
    if (repository.confirmContextAnchor === undefined) throw unavailable('confirm-anchor')
    const previous = requireRecord(repository, request.locusId)
    assertExpected(previous, request.expectedGeneration, request.expectedLocusId, request.expectedUpdatedAt)
    requireExactCurrent(repository, previous, request.endpoint)
    const trusted = assertActionContext(context, previous)
    requireIdle(repository, previous)
    const hasFacts = request.executionRoot !== undefined ||
      request.projectResources !== undefined || request.constraints !== undefined
    const status = hasFacts ? 'confirmed' as const : request.existence === 'missing' ? 'missing' as const : 'unknown' as const
    try {
      const next = await repository.confirmContextAnchor(
        previous.id,
        {
          status,
          ...(request.existence === undefined ? {} : { existence: request.existence }),
          ...(request.executionRoot === undefined ? {} : { executionRoot: request.executionRoot }),
          ...(request.projectResources === undefined ? {} : { projectResources: request.projectResources }),
          ...(request.constraints === undefined ? {} : { constraints: request.constraints }),
        },
        trusted.actorId,
        now(),
        mutationFence(request),
      )
      revision += 1
      return actionResult('confirm-anchor', next, previous, { created: false })
    } catch (error) {
      throw managementError(error, 'confirm-anchor')
    }
  }

  const bind = async (
    request: Extract<PetLocusActionRequest, { action: 'bind' }>,
    context: LocusManagementActionContext,
  ): Promise<PetLocusActionResult> => {
    if (actions?.bind === undefined) throw unavailable('bind')
    const marker = repository.getLatestLocusByEndpoint?.(request.endpoint)
      ?? repository.getCurrentLocus?.(request.endpoint)
      ?? repository.getCurrent?.(request.endpoint)
    if (marker === undefined) {
      if (
        request.expectedLocusId !== undefined ||
        request.expectedGeneration !== undefined ||
        request.expectedUpdatedAt !== undefined
      ) {
        throw new LocusManagementError('REVISION_CONFLICT', '入口当前代际已变化，请刷新后重试。')
      }
      return actions.bind(request, assertActionContext(context))
    }
    assertExpected(marker, request.expectedGeneration, request.expectedLocusId, request.expectedUpdatedAt)
    requireLatestEndpointMarker(repository, marker, request.endpoint)
    requireIdle(repository, marker)
    return actions.bind(request, assertActionContext(context, marker))
  }
  const rebuild = async (
    request: Extract<PetLocusActionRequest, { action: 'rebuild' }>,
    context: LocusManagementActionContext,
  ): Promise<PetLocusActionResult> => {
    if (request.expectedLocusId === undefined) {
      throw new LocusManagementError('INVALID_REQUEST', '显式重建必须指定当前停止标记。')
    }
    const target = requireRecord(repository, request.expectedLocusId)
    assertExpected(target, request.expectedGeneration, request.expectedLocusId, request.expectedUpdatedAt)
    requireLatestEndpointMarker(repository, target, request.endpoint)
    if (target.state !== 'stopped' && target.state !== 'invalid' && target.state !== 'retired') {
      throw new LocusManagementError('LOCUS_INVALID', '只有停止、失效或退役入口可以显式重建。')
    }
    requireIdle(repository, target)
    const trusted = assertActionContext(context, target)
    if (actions?.rebuild === undefined) throw unavailable('rebuild')
    return actions.rebuild(request, trusted)
  }
  const mutationFence = (request: { readonly expectedGeneration?: number; readonly expectedLocusId?: string; readonly expectedUpdatedAt?: number }): LocusMutationFence => ({
    ...(request.expectedGeneration === undefined ? {} : { expectedGeneration: request.expectedGeneration }),
    ...(request.expectedLocusId === undefined ? {} : { expectedLocusId: request.expectedLocusId }),
    ...(request.expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: request.expectedUpdatedAt }),
  })
  const archive = async (
    request: Extract<PetLocusActionRequest, { action: 'archive' }>,
    context: LocusManagementActionContext,
  ): Promise<PetLocusActionResult> => {
    const target = requireRecord(repository, request.locusId)
    assertExpected(target, request.expectedGeneration, request.expectedLocusId, request.expectedUpdatedAt)
    requireExactCurrent(repository, target, request.endpoint)
    const trusted = assertActionContext(context, target)
    requireIdle(repository, target)
    const fence = mutationFence(request)
    // Panel archive is another explicit exit for the current entry.  Preserve
    // the same stopped tombstone as /unbind so a later ordinary @bot or a new
    // topic cannot treat the endpoint as never-created.  Historical sessions
    // and older locus generations remain untouched.
    if (repository.stopLocus !== undefined || repository.transitionLocus !== undefined) {
      try {
        const next = repository.stopLocus !== undefined
          ? await repository.stopLocus(target.id, now(), fence)
          : await repository.transitionLocus!(target.id, 'stopped', now(), undefined, fence)
        revision += 1
        return actionResult('archive', next, target, { created: false })
      } catch (error) {
        throw managementError(error, 'archive')
      }
    }
    if (actions?.archive === undefined) throw unavailable('archive')
    return actions.archive(request, trusted)
  }
  const stop = async (
    request: Extract<PetLocusActionRequest, { action: 'stop' }>,
    context: LocusManagementActionContext,
  ): Promise<PetLocusActionResult> => {
    const target = requireRecord(repository, request.locusId)
    assertExpected(target, request.expectedGeneration, request.expectedLocusId, request.expectedUpdatedAt)
    requireExactCurrent(repository, target, request.endpoint)
    const trusted = assertActionContext(context, target)
    requireIdle(repository, target)
    const fence = mutationFence(request)
    if (repository.stopLocus !== undefined) {
      try {
        const next = await repository.stopLocus(target.id, now(), fence)
        revision += 1
        return actionResult('stop', next, target, { created: false })
      } catch (error) {
        throw managementError(error, 'stop')
      }
    }
    if (actions?.stop === undefined) throw unavailable('stop')
    return actions.stop(request, trusted)
  }

  const defaultQa = actions?.defaultQa === undefined
    ? undefined
    : async (request: PetLocusDefaultQaHostRequest, context: LocusManagementActionContext) =>
        actions.defaultQa!(request, assertActionContext(context))

  const adapter: LocusManagementPort = {
    view,
    discovery,
    ...(defaultQa === undefined ? {} : { defaultQa }),
    ...(bind === undefined ? {} : { bind }),
    ...(rebuild === undefined ? {} : { rebuild }),
    ...(archive === undefined ? {} : { archive }),
    ...(stop === undefined ? {} : { stop }),
    unbind,
    scope,
    action: async (request, context) => {
      switch (request.action) {
        case 'bind':
          return bind(request, context)
        case 'rebuild':
          return rebuild(request, context)
        case 'unbind':
          return unbind(request, context)
        case 'scope':
          return scope(request, context)
        case 'confirm-anchor':
          return confirmAnchor(request, context)
        case 'archive':
          return archive(request, context)
        case 'stop':
          return stop(request, context)
        default: {
          const exhaustive: never = request
          throw new LocusManagementError('INVALID_REQUEST', `未知 locus action：${String(exhaustive)}`)
        }
      }
    },
  }
  return adapter
}
