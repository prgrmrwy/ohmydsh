/**
 * Concrete Pet management routes.
 *
 * Each route has an exact path and a strict body allowlist. Together they
 * cover exactly the operations the Web client needs and nothing more.
 */

import { archiveTaskFromPet, type ArchiveSink } from './archive.js'
import type { CapabilityRegistry } from './capabilities.js'
import type { PetCoordinator } from './coordinator.js'
import { PetError } from './errors.js'
import {
  optionalString,
  petRoute,
  requireString,
  strictBody,
  type RouteRegistration,
} from './http.js'
import type { PetChangeFeed } from './changes.js'
import type { PetLifecycleMachine } from './lifecycle.js'
import type { PetPaths } from './paths.js'
import { detectProjectionDrift, rebuildProjection } from './projection.js'
import type { PetRepository } from './repository.js'
import {
  LocusManagementError,
  type LocusManagementPort,
} from './locus/management.js'
import { inspectBundle } from './skill-bundle.js'
import { currentAllowlist } from './skill-provider.js'
import { PET_ENV_PREFIX } from './shell-env.js'
import {
  ROUTES,
  PET_ENV_GLOBAL,
  type PetBindState,
  type PetChannelBlocker,
  type PetChannelPhase,
  type PetChannelView,
  type PetChatRoute,
  type PetUnifiedLocusReadiness,
  type PetSourceKind,
  type PetWorkspaceChoice,
  LOCUS_ROUTES,
  type PetLocusActionRequest,
  type PetLocusDiscoveryRequest,
  type PetLocusEndpointInput,
  type PetLocusEndpointView,
  type PetLocusManagementView,
  type PetLocusView,
} from '../wire.js'

/** Everything the routes read from the Host. */
export interface RouteDeps {
  readonly repository: PetRepository
  readonly capabilities: CapabilityRegistry
  readonly coordinator: PetCoordinator
  readonly lifecycle: PetLifecycleMachine
  readonly paths: PetPaths
  readonly packageVersion: string
  readonly changes: PetChangeFeed
  /** Archives the executor session when a terminal Task is archived from Pet. */
  readonly archiveSink: ArchiveSink
  /**
   * The model Pet currently follows, for display only. Returns `undefined`
   * when it cannot be resolved, so the panel degrades instead of failing.
   */
  readonly followedModel?: () => { providerId: string; modelId: string } | undefined
  /** Agent presets this Host offers, for the Settings picker. */
  readonly listPresets?: () => Promise<readonly { id: string; label: string }[]>
  /**
   * Workspaces this Host knows, for the environment tab's picker.
   *
   * Shown with title and path: a user configuring "the CR group for project
   * A" recognizes the project, not an opaque generated id.
   */
  readonly listWorkspaces?: () => Promise<readonly PetWorkspaceChoice[]>
  /** Inspects the Workspace files an executor session depends on. */
  readonly inspectWorkspace?: () => Promise<{ ok: boolean; problems: readonly string[] }>
  /** Restores those files, returning what could not be repaired. */
  readonly repairWorkspace?: () => Promise<{ ok: boolean; problems: readonly string[] }>
  /**
   * The Lark channel, when this Host composed one.
   *
   * Optional so a Pet without the channel keeps every other route working:
   * the settings tab reports it unavailable instead of the Host failing.
   */
  readonly channel?: ChannelControl
  /** Unified locus management capability; absent routes fail closed. */
  readonly locus?: LocusManagementPort
  /**
   * Owner-facing message -> generation -> child -> execution chains.
   *
   * Absent when this Host composed no unified locus, which is why the
   * diagnostics payload omits the field entirely rather than reporting an
   * empty list: "no unified entries" and "not available here" need different
   * answers. Implementations must not include message text or credentials.
   */
  readonly locusDiagnostics?: () => Promise<unknown> | unknown
  /** Host-authenticated operator identity; never read from request bodies. */
  readonly locusIdentity?: () => { readonly actorId?: string } | undefined
  /**
   * Session ids DSH has archived.
   *
   * Used to mark a route's session unreachable BEFORE the user clicks: the
   * shell silently lands on the home page when asked to open an archived
   * session, so a button that looks live is worse than one that explains
   * itself. Optional, so a Host without the registry simply offers the
   * button unqualified rather than losing the whole view.
   */
  readonly archivedSessionIds?: () => readonly string[]
}

/** What the channel routes drive. */
export interface ChannelControl {
  /** Live connection state for diagnostics. */
  status(): {
    phase: PetChannelPhase
    diagnostic?: string
    permission?: { code?: number; missingScopes: readonly string[]; consoleUrl?: string }
    identityDiagnostic?: string
    /** Fail-closed proof for the unified child-session execution path. */
    unifiedLocus?: PetUnifiedLocusReadiness
  }
  /** Whether a configured workspace still resolves in the Host registry. */
  workspaceAvailable?(workspaceId: string): boolean
  /** Apply an enabled/disabled decision, starting or stopping the consumer. */
  setEnabled(enabled: boolean): Promise<void>
  /** Revalidate readiness and restart a downed subscription. */
  reconnect(): Promise<void>
  /** Current ephemeral allowlist pairing projection. */
  pairingState(): PetChannelView['pairing']
  /** Generate a fresh pairing after verifying the bound bot identity. */
  startPairing(): Promise<void>
  /** Invalidate the current pairing, if any. */
  cancelPairing(): void
  /** Current binding-flow state, when one has run. */
  bindState(): PetBindState | undefined
  /** Begin creating a new Lark app; resolves when the flow settles. */
  beginCreate(): Promise<PetBindState>
  /** Bind an existing app; the secret is consumed, never stored. */
  connectExisting(appId: string, appSecret: string): Promise<PetBindState>
  /** Abort an in-flight binding flow. */
  cancelBind(): void
}

/**
 * Project the channel's stored state for the settings tab.
 *
 * Assembles ONLY identity facts and routing. There is no branch here that
 * could emit a credential, because the stored configuration has no field to
 * hold one.
 * @param repository - Pet repository.
 * @param channel - Channel control, when composed.
 * @param archivedSessionIds - Session ids DSH has archived, for marking a
 *   route's session unreachable before it is clicked.
 * @returns the view.
 */
function channelView(
  repository: PetRepository,
  channel: ChannelControl | undefined,
  archivedSessionIds: ReadonlySet<string> = new Set(),
): PetChannelView {
  const config = repository.getChannelConfig()
  const routes: PetChatRoute[] = repository.listChatBindings().map(binding => ({
    chatId: binding.chatId,
    chatType: binding.chatType,
    ...(binding.chatName !== undefined ? { chatName: binding.chatName } : {}),
    kind: binding.kind,
    ...(binding.workspaceId !== undefined ? { workspaceId: binding.workspaceId } : {}),
    ...(binding.activeTaskId !== undefined ? { activeTaskId: binding.activeTaskId } : {}),
    // Resolve the task to its executor session: the settings page offers
    // "open the session", and a task id is not something the shell can route
    // to. A task that no longer exists simply yields no id, so the button
    // does not appear rather than leading nowhere.
    ...(() => {
      if (binding.activeTaskId === undefined) return {}
      const task = repository.getTask(binding.activeTaskId)
      return task === undefined
        ? {}
        : { activeExecutorSessionId: task.executorSessionId }
    })(),
    // Whether the session "open the session" would navigate to is archived.
    // Computed against the SAME session the client picks for that control: a
    // qa route opens its parent, any other route opens its active executor.
    ...(() => {
      const target =
        binding.kind === 'qa'
          ? binding.qaParentSessionId
          : binding.activeTaskId === undefined
            ? undefined
            : repository.getTask(binding.activeTaskId)?.executorSessionId
      return target !== undefined && archivedSessionIds.has(target)
        ? { sessionArchived: true }
        : {}
    })(),
    ...(binding.qaChildSessionId !== undefined
      ? { qaChildSessionId: binding.qaChildSessionId }
      : {}),
    ...(binding.qaParentSessionId !== undefined
      ? { qaParentSessionId: binding.qaParentSessionId }
      : {}),
    ...(binding.kind === 'qa' ? { qaOrigin: binding.qaOrigin } : {}),
    ...(binding.qaInvalidatedAt !== undefined ? { qaInvalidatedAt: binding.qaInvalidatedAt } : {}),
    ...(binding.qaInvalidatedReason !== undefined
      ? { qaInvalidatedReason: binding.qaInvalidatedReason }
      : {}),
    boundBy: binding.boundBy,
    boundAt: binding.boundAt,
  }))

  // Work waiting behind current work, across every chat-sourced Task. Shown
  // so a backlog is visible rather than looking like the channel is stuck.
  let queueDepth = 0
  for (const task of repository.listTasks()) {
    if (task.sourceKind !== 'chat' || task.archivedAt !== undefined) continue
    queueDepth += repository
      .listInvocations(task.id)
      .filter(invocation => invocation.status === 'queued').length
  }

  const status = channel?.status() ?? { phase: 'stopped' as const }
  const unifiedLocus: PetUnifiedLocusReadiness = status.unifiedLocus ?? {
    childSession: 'unavailable',
    defaultPermission: 'read',
    readVerification: 'unavailable',
    diagnostic: '当前 Host 尚未核验统一子会话与默认只读策略。',
  }
  const binding = channel?.bindState()
  const pairing = channel?.pairingState()
  const blockers: PetChannelBlocker[] = []
  if (config.botAppId === undefined) {
    blockers.push({ code: 'bot-unbound', message: '请先绑定飞书 Bot。' })
  } else if (config.botOpenId === undefined) {
    blockers.push({ code: 'bot-identity-unresolved', message: '尚未确认 Bot 身份，请重新连接 Bot。' })
  }
  if (config.allowOpenIds.length === 0) {
    blockers.push({ code: 'allowlist-empty', message: '请先添加至少一位允许触发的成员。' })
  }
  if (config.defaultWorkspaceId === undefined) {
    blockers.push({ code: 'default-workspace-missing', message: '请选择自动主会话的默认工作区。' })
  } else if (channel?.workspaceAvailable?.(config.defaultWorkspaceId) === false) {
    blockers.push({ code: 'default-workspace-unavailable', message: '默认工作区已不可用，请重新选择。' })
  }
  if (unifiedLocus.childSession !== 'verified' || unifiedLocus.readVerification !== 'verified') {
    blockers.push({
      code: 'unified-locus-unavailable',
      message: unifiedLocus.diagnostic ?? '统一子会话或默认只读策略尚未通过 Host 核验。',
    })
  }
  if (status.identityDiagnostic !== undefined) {
    blockers.push({ code: 'profile-unavailable', message: status.identityDiagnostic })
  }
  if (status.permission !== undefined && config.botOpenId === undefined) {
    blockers.push({
      code: 'permission-missing',
      message: '飞书 Bot 缺少读取群成员所需的权限。',
      missingScopes: status.permission.missingScopes,
      ...(status.permission.consoleUrl !== undefined
        ? { consoleUrl: status.permission.consoleUrl }
        : {}),
    })
  }
  return {
    enabled: config.enabled,
    ...(config.botAppId !== undefined
      ? {
          bot: {
            appId: config.botAppId,
            ...(config.botName !== undefined ? { name: config.botName } : {}),
            ...(config.botOpenId !== undefined ? { openId: config.botOpenId } : {}),
          },
        }
      : {}),
    allowOpenIds: config.allowOpenIds,
    knownNames: config.knownNames ?? {},
    ...(pairing !== undefined ? { pairing } : {}),
    ...(config.defaultWorkspaceId !== undefined
      ? { defaultWorkspaceId: config.defaultWorkspaceId }
      : {}),
    routes,
    unifiedLocus,
    onboarding: {
      ready: blockers.length === 0,
      steps: [
        { id: 'bot', label: '绑定 Bot', complete: config.botAppId !== undefined },
        { id: 'identity', label: '确认 Bot 身份', complete: config.botOpenId !== undefined },
        { id: 'allowlist', label: '配置允许成员', complete: config.allowOpenIds.length > 0 },
        {
          id: 'workspace',
          label: '选择自动主会话的默认工作区',
          complete:
            config.defaultWorkspaceId !== undefined &&
            channel?.workspaceAvailable?.(config.defaultWorkspaceId) !== false,
        },
        {
          id: 'locus',
          label: '核验统一子会话与默认只读策略',
          complete:
            unifiedLocus.childSession === 'verified' &&
            unifiedLocus.readVerification === 'verified',
        },
        {
          id: 'subscription',
          label: '启用并连接',
          complete: config.enabled && status.phase === 'connected',
        },
      ],
      blockers,
    },
    connection: {
      phase: status.phase,
      ...(status.diagnostic !== undefined ? { diagnostic: status.diagnostic } : {}),
      queueDepth,
    },
    ...(binding !== undefined ? { binding } : {}),
  }
}

/** Desired projection derived from the current allowlist. */
function desiredProjection(
  repository: PetRepository,
): readonly { skillName: string; sourcePath: string }[] {
  return currentAllowlist(repository).map(entry => ({
    skillName: entry.skillName,
    sourcePath: entry.sourcePath,
  }))
}

/** Longest free-text argument string accepted for one Skill. */
const MAX_ARGUMENTS_CHARS = 500

/** Assert Pet is ready before accepting work. */
function requireReady(lifecycle: PetLifecycleMachine): void {
  if (!lifecycle.isReady) {
    throw new PetError(
      'PET_DEGRADED',
      lifecycle.state.diagnostic ?? 'Pet is not ready. See Pet Settings → Diagnostics.',
    )
  }
}

const LOCUS_FENCE_FIELDS = ['expectedGeneration', 'expectedLocusId', 'expectedUpdatedAt'] as const
const LOCUS_ACTION_FIELDS: Readonly<Record<PetLocusActionRequest['action'], readonly string[]>> = {
  bind: ['action', 'endpoint', 'parentSessionId', 'workspaceId', 'parentLocusId', ...LOCUS_FENCE_FIELDS],
  unbind: ['action', 'endpoint', 'locusId', ...LOCUS_FENCE_FIELDS],
  scope: ['action', 'locusId', 'mode', ...LOCUS_FENCE_FIELDS],
  'confirm-anchor': [
    'action', 'endpoint', 'locusId', 'executionRoot', 'projectResources', 'constraints', 'existence',
    ...LOCUS_FENCE_FIELDS,
  ],
  rebuild: ['action', 'endpoint', 'parentSessionId', 'workspaceId', 'parentLocusId', 'asDefaultQa', ...LOCUS_FENCE_FIELDS],
  archive: ['action', 'endpoint', 'locusId', ...LOCUS_FENCE_FIELDS],
  stop: ['action', 'endpoint', 'locusId', ...LOCUS_FENCE_FIELDS],
}

function optionalFiniteInteger(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new PetError('INVALID_REQUEST', `${key} must be a non-negative safe integer`)
  }
  return value
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new PetError('INVALID_REQUEST', `${key} must be a boolean`)
  return value
}

function optionalStringArray(record: Record<string, unknown>, key: string): readonly string[] | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim() === '')) {
    throw new PetError('INVALID_REQUEST', `${key} must be an array of non-empty strings`)
  }
  return value.map(item => String(item).trim())
}

function locusEndpointInput(value: unknown): PetLocusEndpointInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PetError('INVALID_REQUEST', 'endpoint must be an object')
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (key !== 'chatId' && key !== 'threadId') {
      throw new PetError('INVALID_REQUEST', `Unknown endpoint field '${key}'`)
    }
  }
  const threadId = optionalString(record, 'threadId')
  const chatId = requireString(record, 'chatId').trim()
  const normalizedThreadId = threadId?.trim()
  if (chatId.includes('\u0000') || normalizedThreadId?.includes('\u0000') === true) {
    throw new PetError('INVALID_REQUEST', 'endpoint identifiers may not contain NUL')
  }
  return {
    chatId,
    ...(normalizedThreadId === undefined ? {} : { threadId: normalizedThreadId }),
  }
}

function parseLocusAction(body: unknown, expectedAction?: PetLocusActionRequest['action']): PetLocusActionRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new PetError('INVALID_REQUEST', 'Request body must be a JSON object')
  }
  const action = requireString(body as Record<string, unknown>, 'action')
  if (action !== 'bind' && action !== 'unbind' && action !== 'scope' && action !== 'confirm-anchor' && action !== 'rebuild' && action !== 'archive' && action !== 'stop') {
    throw new PetError('INVALID_REQUEST', `Unknown locus action '${action}'`)
  }
  if (expectedAction !== undefined && action !== expectedAction) {
    throw new PetError('INVALID_REQUEST', `Expected locus action '${expectedAction}'`)
  }
  const record = strictBody(body, LOCUS_ACTION_FIELDS[action])
  const expectedGeneration = optionalFiniteInteger(record, 'expectedGeneration')
  const expectedUpdatedAt = optionalFiniteInteger(record, 'expectedUpdatedAt')
  const expectedLocusId = optionalString(record, 'expectedLocusId')
  const fence = {
    ...(expectedGeneration === undefined ? {} : { expectedGeneration }),
    ...(expectedLocusId === undefined ? {} : { expectedLocusId: expectedLocusId.trim() }),
    ...(expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt }),
  }
  switch (action) {
    case 'bind':
      return {
        action,
        endpoint: locusEndpointInput(record['endpoint']),
        parentSessionId: requireString(record, 'parentSessionId').trim(),
        ...(optionalString(record, 'workspaceId') === undefined ? {} : { workspaceId: optionalString(record, 'workspaceId')!.trim() }),
        ...(optionalString(record, 'parentLocusId') === undefined ? {} : { parentLocusId: optionalString(record, 'parentLocusId')!.trim() }),
        ...fence,
      }
    case 'rebuild': {
      const asDefaultQa = optionalBoolean(record, 'asDefaultQa')
      return {
        action,
        endpoint: locusEndpointInput(record['endpoint']),
        parentSessionId: requireString(record, 'parentSessionId').trim(),
        ...(optionalString(record, 'workspaceId') === undefined ? {} : { workspaceId: optionalString(record, 'workspaceId')!.trim() }),
        ...(optionalString(record, 'parentLocusId') === undefined ? {} : { parentLocusId: optionalString(record, 'parentLocusId')!.trim() }),
        ...(asDefaultQa === undefined ? {} : { asDefaultQa }),
        ...fence,
      }
    }
    case 'unbind':
      return {
        action,
        locusId: requireString(record, 'locusId').trim(),
        endpoint: locusEndpointInput(record['endpoint']),
        ...fence,
      }
    case 'scope': {
      const mode = requireString(record, 'mode')
      if (mode !== 'read' && mode !== 'write') throw new PetError('INVALID_REQUEST', 'mode must be read or write')
      return { action, locusId: requireString(record, 'locusId').trim(), mode, ...fence }
    }
    case 'confirm-anchor': {
      const existence = optionalString(record, 'existence')
      if (existence !== undefined && existence !== 'exists' && existence !== 'missing' && existence !== 'unknown') {
        throw new PetError('INVALID_REQUEST', 'existence must be exists, missing, or unknown')
      }
      const executionRoot = optionalString(record, 'executionRoot')?.trim()
      return {
        action,
        locusId: requireString(record, 'locusId').trim(),
        endpoint: locusEndpointInput(record['endpoint']),
        ...(executionRoot === undefined ? {} : { executionRoot }),
        ...(optionalStringArray(record, 'projectResources') === undefined
          ? {}
          : { projectResources: optionalStringArray(record, 'projectResources')! }),
        ...(optionalStringArray(record, 'constraints') === undefined
          ? {}
          : { constraints: optionalStringArray(record, 'constraints')! }),
        ...(existence === undefined ? {} : { existence }),
        ...fence,
      }
    }
    case 'archive':
    case 'stop':
      return {
        action,
        locusId: requireString(record, 'locusId').trim(),
        endpoint: locusEndpointInput(record['endpoint']),
        ...fence,
      }
  }
}

/**
 * Build every Pet management route.
 * @param deps - Host dependencies.
 * @returns the exact route registrations.
 */
export function createPetRoutes(deps: RouteDeps): readonly RouteRegistration[] {
  const { repository, capabilities, coordinator, lifecycle, paths } = deps

  const locusUnavailable = (): never => {
    throw new PetError('LOCUS_UNAVAILABLE', 'Unified locus management is unavailable in this Host.')
  }
  const requireLocusActor = (): string => {
    const actorId = deps.locusIdentity?.()?.actorId?.trim()
    if (actorId === undefined || actorId === '') {
      throw new PetError('LOCUS_UNAVAILABLE', 'Host owner identity is unavailable.')
    }
    return actorId
  }
  const invokeLocus = async <T>(operation: string, run: () => T | Promise<T>): Promise<T> => {
    try {
      return await run()
    } catch (error) {
      if (error instanceof LocusManagementError) {
        const code = error.code === 'CAPABILITY_UNAVAILABLE' || error.code === 'ACTION_UNAVAILABLE'
          ? 'LOCUS_UNAVAILABLE'
          : error.code === 'LOCUS_NOT_FOUND'
            ? 'LOCUS_NOT_FOUND'
            : error.code === 'LOCUS_BUSY'
              ? 'LOCUS_BUSY'
              : error.code === 'LOCUS_INVALID'
                ? 'LOCUS_INVALID'
                : error.code === 'WRITE_UNSUPPORTED'
                  ? 'WRITE_UNSUPPORTED'
                  : error.code === 'LOCUS_STOPPED'
                  ? 'LOCUS_STOPPED'
                  : error.code === 'REVISION_CONFLICT'
                  ? 'LOCUS_CONFLICT'
                  : error.code === 'INVALID_REQUEST'
                    ? 'INVALID_REQUEST'
                    : 'INTERNAL'
        throw new PetError(code, `${operation}：${error.message}`)
      }
      throw error
    }
  }
  const requireLocus = (): LocusManagementPort => deps.locus ?? locusUnavailable()
  // Read fresh on every request rather than captured once: a session archived
  // while the settings page is open must be reflected on the next refresh, and
  // this view is re-fetched by the change feed anyway.
  const archivedSet = (): ReadonlySet<string> =>
    new Set(deps.archivedSessionIds?.() ?? [])

  return [
    petRoute(LOCUS_ROUTES.view, async () => {
      requireReady(lifecycle)
      requireLocusActor()
      return invokeLocus('读取 locus', () => requireLocus().view())
    }),
    petRoute(LOCUS_ROUTES.discovery, async ({ body }) => {
      const record = strictBody(body, ['endpoint', 'parentSessionId', 'childSessionId'])
      const endpoint = record['endpoint']
      const parentSessionId = record['parentSessionId']
      const childSessionId = record['childSessionId']
      const selectorCount = [endpoint, parentSessionId, childSessionId].filter(value => value !== undefined).length
      if (selectorCount !== 1) {
        throw new PetError('INVALID_REQUEST', 'Exactly one locus discovery selector is required')
      }
      requireReady(lifecycle)
      requireLocusActor()
      if (endpoint !== undefined) {
        if (typeof endpoint !== 'object' || endpoint === null || Array.isArray(endpoint)) {
          throw new PetError('INVALID_REQUEST', 'endpoint must be an object')
        }
        const candidate = endpoint as Record<string, unknown>
        for (const key of Object.keys(candidate)) {
          if (key !== 'chatId' && key !== 'threadId') {
            throw new PetError('INVALID_REQUEST', `Unknown endpoint field '${key}'`)
          }
        }
        const threadId = optionalString(candidate, 'threadId')
        const chatId = requireString(candidate, 'chatId')
        if (chatId.includes('\u0000') || threadId?.includes('\u0000') === true) {
          throw new PetError('INVALID_REQUEST', 'endpoint identifiers may not contain NUL')
        }
        return invokeLocus('查询 locus endpoint', () => requireLocus().discovery({ endpoint: {
          chatId,
          ...(threadId === undefined ? {} : { threadId }),
        } }))
      }
      if (typeof parentSessionId === 'string' && parentSessionId.trim() !== '') {
        return invokeLocus('查询 locus parent', () => requireLocus().discovery({ parentSessionId: parentSessionId.trim() }))
      }
      if (typeof childSessionId === 'string' && childSessionId.trim() !== '') {
        return invokeLocus('查询 locus child', () => requireLocus().discovery({ childSessionId: childSessionId.trim() }))
      }
      throw new PetError('INVALID_REQUEST', 'Discovery selector must be a non-empty string')
    }),
    petRoute(LOCUS_ROUTES.defaultQa, async ({ body }) => {
      const record = strictBody(body, ['parentSessionId', 'groupName'])
      requireReady(lifecycle)
      const handler = requireLocus().defaultQa
      if (handler === undefined) return locusUnavailable()
      const actorId = requireLocusActor()
      return invokeLocus('创建或打开默认 Q&A', () => handler({
        parentSessionId: requireString(record, 'parentSessionId'),
        actorId,
        ...(typeof record['groupName'] === 'string' ? { groupName: record['groupName'] } : {}),
      }, { actorId }))
    }),
    petRoute(LOCUS_ROUTES.action, async ({ body }) => {
      const request = parseLocusAction(body)
      requireReady(lifecycle)
      const handler = requireLocus().action
      if (handler === undefined) return locusUnavailable()
      return invokeLocus(`执行 locus ${request.action}`, () => handler(request, {
        actorId: requireLocusActor(),
      }))
    }),
    petRoute(LOCUS_ROUTES.bind, async ({ body }) => {
      const request = parseLocusAction(body, 'bind')
      requireReady(lifecycle)
      const handler = requireLocus().bind
      if (handler === undefined) return locusUnavailable()
      return invokeLocus('绑定 locus', () => handler(
        request as Extract<PetLocusActionRequest, { action: 'bind' }>,
        { actorId: requireLocusActor() },
      ))
    }),
    petRoute(LOCUS_ROUTES.unbind, async ({ body }) => {
      const request = parseLocusAction(body, 'unbind')
      requireReady(lifecycle)
      const handler = requireLocus().unbind
      if (handler === undefined) return locusUnavailable()
      return invokeLocus('解除 locus', () => handler(
        request as Extract<PetLocusActionRequest, { action: 'unbind' }>,
        { actorId: requireLocusActor() },
      ))
    }),
    petRoute(LOCUS_ROUTES.scope, async ({ body }) => {
      const request = parseLocusAction(body, 'scope')
      requireReady(lifecycle)
      const handler = requireLocus().scope
      if (handler === undefined) return locusUnavailable()
      return invokeLocus('修改 locus 权限', () => handler(
        request as Extract<PetLocusActionRequest, { action: 'scope' }>,
        { actorId: requireLocusActor() },
      ))
    }),
    petRoute(LOCUS_ROUTES.rebuild, async ({ body }) => {
      const request = parseLocusAction(body, 'rebuild')
      requireReady(lifecycle)
      const handler = requireLocus().rebuild
      if (handler === undefined) return locusUnavailable()
      return invokeLocus('重建 locus', () => handler(
        request as Extract<PetLocusActionRequest, { action: 'rebuild' }>,
        { actorId: requireLocusActor() },
      ))
    }),
    petRoute(LOCUS_ROUTES.archive, async ({ body }) => {
      const request = parseLocusAction(body, 'archive')
      requireReady(lifecycle)
      const port = requireLocus()
      const handler = port.archive ?? port.action
      if (handler === undefined) return locusUnavailable()
      return invokeLocus('归档 locus', () => handler(request as never, { actorId: requireLocusActor() }))
    }),
    petRoute(LOCUS_ROUTES.stop, async ({ body }) => {
      const request = parseLocusAction(body, 'stop')
      requireReady(lifecycle)
      const port = requireLocus()
      const handler = port.stop ?? port.action
      if (handler === undefined) return locusUnavailable()
      return invokeLocus('停止 locus', () => handler(request as never, { actorId: requireLocusActor() }))
    }),

    petRoute(ROUTES.status, async ({ body }) => {
      const record = strictBody(body, ['seenGeneration'])
      const seen = record['seenGeneration']
      return {
        lifecycle: lifecycle.state,
        version: deps.packageVersion,
        skillSetGeneration: repository.global.skillSetGeneration,
        // Generation-aware refresh: the client compares this instead of
        // polling, and reloads a complete snapshot when it is stale.
        generation: deps.changes.generation,
        stale: typeof seen === 'number' ? deps.changes.isStale(seen) : true,
      }
    }),

    petRoute(ROUTES.config, async () => {
      const global = repository.global
      // Report the model Pet WOULD use, which is the Host's default selection,
      // not a Pet-owned copy. Reading it through the same resolver the
      // coordinator uses keeps the panel honest even when the Host default
      // changes underneath. A resolver failure is not fatal to reading config.
      const followed = deps.followedModel?.()
      // Deliberately projects only non-secret routing selections.
      return {
        // Always the Host's default selection: Pet follows DSH rather than
        // keeping its own copy. The write route no longer accepts these, so
        // reading a stored value back would only report a stale ghost.
        providerId: followed?.providerId,
        modelId: followed?.modelId,
        agentPreset: global.agentPreset,
        defaultContextPolicy: global.defaultContextPolicy,
        appearance: global.appearance,
        workspaceId: global.workspaceId,
      }
    }),

    petRoute(ROUTES.configUpdate, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, [
        'agentPreset',
        'defaultContextPolicy',
        'appearance',
      ])

      // Appearance is display state, but it must round-trip exactly: accept
      // only the known fields and coerce nothing else.
      const rawAppearance = record['appearance']
      let appearance: Record<string, string> | undefined
      if (rawAppearance !== undefined) {
        if (typeof rawAppearance !== 'object' || rawAppearance === null) {
          throw new PetError('INVALID_REQUEST', 'appearance must be an object')
        }
        const source = rawAppearance as Record<string, unknown>
        appearance = {}
        for (const key of ['accent', 'glyph', 'size', 'ringStyle'] as const) {
          if (typeof source[key] === 'string') appearance[key] = source[key]
        }
      }
      const policy = optionalString(record, 'defaultContextPolicy')
      if (policy !== undefined && policy !== 'current-session' && policy !== 'none') {
        throw new PetError('INVALID_REQUEST', 'defaultContextPolicy must be current-session or none', {
          defaultContextPolicy: 'invalid',
        })
      }
      // Normalize blank to undefined: storing `''` is indistinguishable from
      // "unset" to a reader using `??`, and DSH rejects it as a preset name.
      const rawPreset = optionalString(record, 'agentPreset')
      const agentPreset = rawPreset?.trim() === '' ? undefined : rawPreset
      await repository.updateGlobal(current => ({
        ...current,
        ...(agentPreset !== undefined ? { agentPreset } : {}),
        ...(policy !== undefined ? { defaultContextPolicy: policy } : {}),
        // Merge, so setting one field does not clear the others.
        ...(appearance !== undefined
          ? { appearance: { ...(current.appearance ?? {}), ...appearance } }
          : {}),
      }))
      // Re-read the durable projection instead of echoing the request: a
      // rejected or normalized field must never be reported as stored.
      const updated = repository.global
      const followed = deps.followedModel?.()
      return {
        providerId: followed?.providerId,
        modelId: followed?.modelId,
        agentPreset: updated.agentPreset,
        appearance: updated.appearance,
        defaultContextPolicy: updated.defaultContextPolicy,
        workspaceId: updated.workspaceId,
      }
    }),

    petRoute(ROUTES.workspaceRepair, async () => {
      // Explicit, user-applied repair. Sessions also self-heal on creation,
      // but a visible action lets the user fix a reported problem directly.
      const health = (await deps.repairWorkspace?.()) ?? { ok: true, problems: [] }
      deps.changes.publish()
      return { ok: health.ok, problems: health.problems }
    }),

    petRoute(ROUTES.presets, async () => ({
      presets: (await deps.listPresets?.()) ?? [],
    })),

    petRoute(ROUTES.capabilities, async () => ({
      capabilities: capabilities.project(repository),
    })),

    petRoute(ROUTES.skills, async () => ({
      revisions: repository.listSkillRevisions(),
      selections: repository.listSkillSelections(),
      projection: await detectProjectionDrift(paths, desiredProjection(repository)),
    })),

    petRoute(ROUTES.skillInspect, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, ['path'])
      // The ONLY route accepting a filesystem path, and it is read-only.
      const inspection = await inspectBundle(requireString(record, 'path'))
      return {
        skillName: inspection.skillName,
        description: inspection.description,
        whenToUse: inspection.whenToUse,
        fileCount: inspection.fileCount,
        totalBytes: inspection.totalBytes,
        files: inspection.files,
        canonicalSourcePath: inspection.canonicalSourcePath,
        alreadyInstalled: repository.getSkillRevision(inspection.skillName) !== undefined,
      }
    }),

    petRoute(ROUTES.skillImport, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, ['path', 'arguments'])
      // Registration links the user's own directory; nothing is copied, so a
      // later edit to that directory takes effect immediately.
      const inspection = await inspectBundle(requireString(record, 'path'))

      // Free-text arguments, appended after the skill token on dispatch. Pet
      // stores them verbatim and never parses them.
      const rawArguments = record['arguments']
      if (rawArguments !== undefined && typeof rawArguments !== 'string') {
        throw new PetError('INVALID_REQUEST', 'arguments must be a string')
      }
      const skillArguments = (rawArguments ?? '').trim().slice(0, MAX_ARGUMENTS_CHARS)

      const revision = await repository.putSkillRevision({
        skillName: inspection.skillName,
        sourcePath: inspection.canonicalSourcePath,
        description: inspection.description,
        ...(skillArguments === '' ? {} : { arguments: skillArguments }),
        provenance: {
          kind: 'local-link',
          sourcePath: inspection.canonicalSourcePath,
          installedAt: Date.now(),
        },
        fileCount: inspection.fileCount,
        totalBytes: inspection.totalBytes,
      })
      deps.changes.publish()
      return { revision }
    }),

    petRoute(ROUTES.skillMutate, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, ['skillName', 'action', 'showAsShortcut', 'arguments'])
      const skillName = requireString(record, 'skillName')
      const action = requireString(record, 'action')
      const selection = repository.getSkillSelection(skillName)

      switch (action) {
        case 'enable': {
          if (repository.getSkillRevision(skillName) === undefined) {
            throw new PetError('SKILL_NOT_FOUND', `Skill ${skillName} is not registered`)
          }
          await repository.putSkillSelection({
            skillName,
            enabled: true,
            showAsShortcut: selection?.showAsShortcut ?? true,
          })
          break
        }
        case 'disable': {
          await repository.putSkillSelection({
            skillName,
            showAsShortcut: selection?.showAsShortcut ?? true,
          })
          break
        }
        case 'shortcut': {
          const visible = record['showAsShortcut']
          if (typeof visible !== 'boolean') {
            throw new PetError('INVALID_REQUEST', 'showAsShortcut must be a boolean')
          }
          await repository.putSkillSelection({
            skillName,
            ...(selection?.enabled === true ? { enabled: true } : {}),
            showAsShortcut: visible,
          })
          break
        }
        case 'arguments': {
          // Editable after install: the right arguments are usually only
          // discovered by running the Skill once.
          const raw = record['arguments']
          if (raw !== undefined && typeof raw !== 'string') {
            throw new PetError('INVALID_REQUEST', 'arguments must be a string')
          }
          const revision = repository.getSkillRevision(skillName)
          if (revision === undefined) {
            throw new PetError('SKILL_NOT_FOUND', `Skill ${skillName} is not registered`)
          }
          const next = (raw ?? '').trim().slice(0, MAX_ARGUMENTS_CHARS)
          // Rebuild without the key when cleared: `exactOptionalPropertyTypes`
          // distinguishes an absent field from an explicit `undefined`.
          const { arguments: _dropped, ...rest } = revision
          await repository.putSkillRevision(
            next === '' ? rest : { ...rest, arguments: next },
          )
          break
        }
        case 'remove': {
          // Drop the registration and its selection. The user's own directory
          // is never touched — Pet only ever held a link to it.
          await repository.putSkillSelection({ skillName, showAsShortcut: false })
          await repository.deleteSkillRevision(skillName)
          break
        }
        default:
          throw new PetError('INVALID_REQUEST', `Unknown skill action '${action}'`)
      }

      // Republish so the projection matches the new allowlist immediately.
      const projection = await rebuildProjection(paths, desiredProjection(repository))
      deps.changes.publish()
      return {
        selections: repository.listSkillSelections(),
        projection,
        skillSetGeneration: repository.global.skillSetGeneration,
      }
    }),

    petRoute(ROUTES.projectionRebuild, async () => {
      requireReady(lifecycle)
      return { projection: await rebuildProjection(paths, desiredProjection(repository)) }
    }),

    petRoute(ROUTES.tasks, async () => ({
      tasks: repository.listTasks().map(task => ({
        ...task,
        invocations: repository.listInvocations(task.id),
      })),
    })),

    petRoute(ROUTES.taskDetail, async ({ body }) => {
      const record = strictBody(body, ['taskId'])
      const taskId = requireString(record, 'taskId')
      const task = repository.getTask(taskId)
      if (task === undefined) {
        throw new PetError('TASK_NOT_FOUND', `Pet Task ${taskId} does not exist`)
      }
      const invocations = repository.listInvocations(taskId)
      return {
        task,
        invocations,
        snapshots: invocations.flatMap(invocation => {
          const snapshot = repository.getSnapshot(invocation.snapshotId)
          return snapshot === undefined ? [] : [snapshot]
        }),
        runs: invocations.flatMap(invocation => repository.listRuns(invocation.id)),
      }
    }),

    petRoute(ROUTES.invocationCreate, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, [
        'clientInvocationId',
        'capabilityId',
        'sourceKind',
        'sourceSessionId',
        'sourceWorkspaceId',
        'sessionTitle',
        'workspaceTitle',
        'request',
      ])
      const sourceKind = requireString(record, 'sourceKind')
      if (sourceKind !== 'session' && sourceKind !== 'workspace' && sourceKind !== 'none') {
        throw new PetError('INVALID_REQUEST', 'sourceKind must be session, workspace or none')
      }
      const sourceSessionId = optionalString(record, 'sourceSessionId')
      const sourceWorkspaceId = optionalString(record, 'sourceWorkspaceId')
      const userRequest = optionalString(record, 'request')
      const accepted = await coordinator.accept({
        clientInvocationId: requireString(record, 'clientInvocationId'),
        capabilityId: requireString(record, 'capabilityId'),
        sourceKind: sourceKind as PetSourceKind,
        ...(sourceSessionId !== undefined ? { sourceSessionId } : {}),
        ...(sourceWorkspaceId !== undefined ? { sourceWorkspaceId } : {}),
        ...(userRequest !== undefined ? { request: userRequest } : {}),
      })
      deps.changes.publish()
      return accepted
    }),

    petRoute(ROUTES.invocationAnswer, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, ['taskId', 'answer'])
      await coordinator.answer(requireString(record, 'taskId'), requireString(record, 'answer'))
      deps.changes.publish()
      return { ok: true }
    }),

    petRoute(ROUTES.invocationCancel, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, ['taskId'])
      await coordinator.cancel(requireString(record, 'taskId'))
      deps.changes.publish()
      return { ok: true }
    }),

    petRoute(ROUTES.invocationRetry, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, ['invocationId'])
      const invocation = await coordinator.retry(requireString(record, 'invocationId'))
      deps.changes.publish()
      return { invocation }
    }),

    petRoute(ROUTES.taskArchive, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, ['taskId', 'revision'])
      const revision = record['revision']
      if (revision !== undefined && typeof revision !== 'number') {
        throw new PetError('INVALID_REQUEST', 'revision must be a number')
      }
      // Archiving from Pet must SYNC the executor session; calling the
      // repository directly would leave the executor live and the two sides
      // diverged.
      const task = await archiveTaskFromPet(
        repository,
        deps.archiveSink,
        requireString(record, 'taskId'),
        revision as number | undefined,
      )
      deps.changes.publish()
      return { task }
    }),


    petRoute(ROUTES.petEnv, async () => ({
      // Both scopes in one response so the UI can mark which workspace entries
      // shadow a global one without a second round trip.
      entries: repository.listEnvEntries(),
      workspaces: (await deps.listWorkspaces?.()) ?? [],
      globalScope: PET_ENV_GLOBAL,
      prefix: PET_ENV_PREFIX,
    })),

    petRoute(ROUTES.petEnvMutate, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, ['scope', 'key', 'value', 'action'])
      const action = requireString(record, 'action')
      const scope = requireString(record, 'scope')
      const key = requireString(record, 'key')

      // `global` is a reserved scope name, so it must not arrive as a
      // workspace id: that would silently write the global set while the user
      // believed they were configuring one workspace.
      const rawScope = record['scope']
      if (typeof rawScope !== 'string' || rawScope.trim() === '') {
        throw new PetError('BINDING_INVALID', 'scope must be "global" or a workspace id')
      }

      switch (action) {
        case 'set': {
          const value = record['value']
          if (typeof value !== 'string') {
            throw new PetError('BINDING_INVALID', 'value must be a string')
          }
          // The repository validates key shape and non-empty value, so the
          // rule lives in exactly one place.
          await repository.putEnvEntry({ scope, key, value: value.trim(), updatedAt: Date.now() })
          break
        }
        case 'remove': {
          await repository.deleteEnvEntry(scope, key)
          break
        }
        default:
          throw new PetError('BINDING_INVALID', `Unknown env action '${action}'`)
      }

      deps.changes.publish()
      return { entries: repository.listEnvEntries() }
    }),

    petRoute(ROUTES.channel, async () => channelView(repository, deps.channel, archivedSet())),

    petRoute(ROUTES.channelMutate, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, [
        'action',
        'enabled',
        'allowOpenIds',
        'defaultWorkspaceId',
        'chatId',
        'workspaceId',
      ])
      const action = requireString(record, 'action')
      const config = repository.getChannelConfig()
      const actionBody = (...fields: string[]): Record<string, unknown> =>
        strictBody(record, ['action', ...fields])

      switch (action) {
        case 'set-enabled': {
          actionBody('enabled')
          const enabled = record['enabled']
          if (typeof enabled !== 'boolean') {
            throw new PetError('BINDING_INVALID', 'enabled must be a boolean')
          }
          // Refuse to arm a channel that has no identity to check mentions
          // against or no one permitted to use it: an "enabled" channel that
          // silently admits nobody is worse than an honest refusal.
          if (enabled && config.botAppId === undefined) {
            throw new PetError('BINDING_INVALID', 'Bind a Lark bot before enabling the channel.')
          }
          if (enabled && config.botOpenId === undefined) {
            throw new PetError('BINDING_INVALID', 'Confirm the Lark bot identity before enabling.')
          }
          if (enabled && config.allowOpenIds.length === 0) {
            throw new PetError(
              'BINDING_INVALID',
              'Add at least one permitted sender before enabling the channel.',
            )
          }
          if (enabled && config.defaultWorkspaceId === undefined) {
            throw new PetError('BINDING_INVALID', 'Choose a default workspace before enabling.')
          }
          const defaultWorkspaceId = config.defaultWorkspaceId
          if (
            enabled &&
            defaultWorkspaceId !== undefined &&
            deps.channel?.workspaceAvailable?.(defaultWorkspaceId) === false
          ) {
            throw new PetError('BINDING_INVALID', 'The default workspace is unavailable.')
          }
          if (enabled) {
            const unifiedLocus = deps.channel?.status().unifiedLocus
            if (
              unifiedLocus?.childSession !== 'verified' ||
              unifiedLocus.readVerification !== 'verified'
            ) {
              throw new PetError(
                'BINDING_INVALID',
                unifiedLocus?.diagnostic ??
                  'Verify unified child-session creation and the effective read policy before enabling.',
              )
            }
          }
          await repository.updateChannelConfig(current => ({
            ...current,
            enabled,
            updatedAt: Date.now(),
          }))
          try {
            await deps.channel?.setEnabled(enabled)
          } catch (error) {
            if (enabled) {
              await repository.updateChannelConfig(current => ({
                ...current,
                enabled: false,
                updatedAt: Date.now(),
              }))
            }
            throw error
          }
          break
        }
        case 'set-allowlist': {
          actionBody('allowOpenIds')
          const raw = record['allowOpenIds']
          if (!Array.isArray(raw) || raw.some(entry => typeof entry !== 'string')) {
            throw new PetError('BINDING_INVALID', 'allowOpenIds must be an array of open ids')
          }
          // The repository rejects anything that is not a resolved open id, so
          // an unusable allowlist cannot be stored looking configured.
          await repository.updateChannelConfig(current => {
            if (current.enabled && raw.length === 0) {
              throw new PetError(
                'BINDING_INVALID',
                'Disable the channel before clearing its allowlist.',
              )
            }
            return { ...current, allowOpenIds: raw as string[], updatedAt: Date.now() }
          })
          break
        }
        case 'set-default-workspace': {
          actionBody('defaultWorkspaceId')
          const workspaceId = optionalString(record, 'defaultWorkspaceId')
          await repository.updateChannelConfig(current => {
            if (
              current.enabled &&
              (workspaceId === undefined ||
                deps.channel?.workspaceAvailable?.(workspaceId) === false)
            ) {
              throw new PetError(
                'BINDING_INVALID',
                'Disable the channel before removing or invalidating its default workspace.',
              )
            }
            const { defaultWorkspaceId: _previous, ...withoutDefault } = current
            return {
              ...withoutDefault,
              ...(workspaceId === undefined ? {} : { defaultWorkspaceId: workspaceId }),
              updatedAt: Date.now(),
            }
          })
          break
        }
        case 'rebind-chat': {
          actionBody('chatId', 'workspaceId')
          const chatId = requireString(record, 'chatId')
          const workspaceId = requireString(record, 'workspaceId')
          const existing = repository.getChatBinding(chatId)
          if (existing === undefined) {
            throw new PetError('BINDING_INVALID', `Chat ${chatId} has no route to rebind.`)
          }
          // A qa binding routes to a fork child, not a workspace; letting it
          // be re-pointed at a workspace would silently discard the child and
          // turn the QA group into an ordinary chat.
          if (existing.kind === 'qa') {
            throw new PetError('BINDING_INVALID', `Chat ${chatId} is a QA group binding and cannot be re-bound to a workspace.`)
          }
          // Marked `user` so a later default-routed message never silently
          // overwrites a deliberate choice.
          await repository.putChatBinding({
            ...existing,
            workspaceId,
            boundBy: 'user',
            boundAt: Date.now(),
          })
          break
        }
        case 'remove-chat': {
          actionBody('chatId')
          await repository.deleteChatBinding(requireString(record, 'chatId'))
          break
        }
        case 'reconnect': {
          actionBody()
          await deps.channel?.reconnect()
          break
        }
        case 'pair-start': {
          actionBody()
          if (deps.channel === undefined) {
            throw new PetError('BINDING_INVALID', 'This Pet Host has no Lark channel.')
          }
          await deps.channel.startPairing()
          break
        }
        case 'pair-cancel': {
          actionBody()
          if (deps.channel === undefined) {
            throw new PetError('BINDING_INVALID', 'This Pet Host has no Lark channel.')
          }
          deps.channel.cancelPairing()
          break
        }
        default:
          throw new PetError('BINDING_INVALID', `Unknown channel action '${action}'`)
      }

      deps.changes.publish()
      return channelView(repository, deps.channel, archivedSet())
    }),

    petRoute(ROUTES.channelBind, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, ['action', 'appId', 'appSecret'])
      const action = requireString(record, 'action')
      const channel = deps.channel
      if (channel === undefined) {
        throw new PetError('BINDING_INVALID', 'This Pet Host has no Lark channel.')
      }

      switch (action) {
        case 'create': {
          // Deliberately not awaited: creating blocks until the user finishes
          // authorizing in a browser, and the client needs the verification
          // link long before that. Progress is polled through `channel`.
          void channel.beginCreate().catch(() => {
            // Binding diagnostics are projected through bindState; never let a
            // background authorization failure reject into the Host process.
          })
          break
        }
        case 'connect': {
          const appId = requireString(record, 'appId')
          const appSecret = record['appSecret']
          if (typeof appSecret !== 'string' || appSecret.trim() === '') {
            throw new PetError('BINDING_INVALID', 'appSecret is required')
          }
          // Awaited: connecting is a fast local call. The secret goes straight
          // through to lark-cli and is never echoed back in the response.
          await channel.connectExisting(appId, appSecret)
          break
        }
        case 'cancel': {
          channel.cancelBind()
          break
        }
        default:
          throw new PetError('BINDING_INVALID', `Unknown bind action '${action}'`)
      }

      deps.changes.publish()
      return channelView(repository, channel, archivedSet())
    }),

    petRoute(ROUTES.diagnostics, async () => ({
      lifecycle: lifecycle.state,
      workspace: (await deps.inspectWorkspace?.()) ?? { ok: true, problems: [] },
      paths: {
        stateRoot: paths.stateRoot,
        databaseFile: paths.databaseFile,
        workspaceRoot: paths.workspaceRoot,
        projectionRoot: paths.projectionRoot,
        storeRoot: paths.storeRoot,
      },
      allowlist: currentAllowlist(repository),
      drift: await detectProjectionDrift(paths, desiredProjection(repository)),
      skillSetGeneration: repository.global.skillSetGeneration,
      // QA groups, listed apart from chat routes: their health is not the
      // channel's — a perfectly connected subscription still cannot serve a
      // group whose source session is gone — and a backlog here means
      // questions are waiting on a child rather than on Pet's own queue.
      qaGroups: repository
        .listChatBindings()
        .filter(binding => binding.kind === 'qa')
        .map(binding => ({
          chatId: binding.chatId,
          ...(binding.chatName !== undefined ? { chatName: binding.chatName } : {}),
          ...(binding.qaChildSessionId !== undefined
            ? { childSessionId: binding.qaChildSessionId }
            : {}),
          ...(binding.qaParentSessionId !== undefined
            ? { sourceSessionId: binding.qaParentSessionId }
            : {}),
          ...(binding.qaInvalidatedAt !== undefined
            ? {
                invalidatedAt: binding.qaInvalidatedAt,
                ...(binding.qaInvalidatedReason !== undefined
                  ? { invalidatedReason: binding.qaInvalidatedReason }
                  : {}),
              }
            : {}),
          pendingQuestions: repository.countPendingChannelForChat(binding.chatId),
        })),
      // Unified locus chains: message -> generation -> child -> execution.
      // Absent when this Host composed no locus diagnostics, so the field
      // distinguishes "no unified entries" from "not available here".
      ...(deps.locusDiagnostics === undefined
        ? {}
        : { locus: await deps.locusDiagnostics() }),
    })),
  ]
}
