/**
 * Browser-side Pet management client.
 *
 * A thin, typed wrapper over the exact Pet Host routes. It holds no host,
 * filesystem or credential capability of its own: every operation is a
 * same-origin POST that the Host independently validates.
 */

import {
  LOCUS_ROUTES,
  ROUTES,
  type PetCapability,
  type PetChannelView,
  type PetEnvRecord,
  type PetLifecycleState,
  type PetWorkspaceChoice,
  type PetLocusActionRequest,
  type PetLocusActionResult,
  type PetLocusDefaultQaRequest,
  type PetLocusDefaultQaResult,
  type PetLocusDiscoveryRequest,
  type PetLocusDiscoveryView,
  type PetLocusManagementView,
} from '../wire.js'

/** Uniform envelope returned by every Pet route. */
type PetResponse<T> = { ok: true; data: T } | { ok: false; error: string; message: string }

/** A failed Pet call, carrying the Host's stable error code. */
export class PetApiError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PetApiError'
    this.code = code
  }
}

/**
 * Call one Pet route.
 * @param path - Exact route path.
 * @param body - Request body.
 * @returns the route's data payload.
 * @throws PetApiError when the Host rejects the call.
 */
async function call<T>(path: string, body: unknown = {}): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Same-origin only: the Host additionally enforces loopback and origin.
    credentials: 'same-origin',
    body: JSON.stringify(body),
  })
  // Read as text first. A Pet route that never registered answers 405 with an
  // empty body, and calling `response.json()` on that surfaces
  // "Unexpected end of JSON input" — a parse error that hides the real
  // problem. Anything that is not a Pet JSON envelope is reported as what it
  // actually is.
  const raw = await response.text()
  if (raw.trim() === '') {
    throw new PetApiError(
      'PET_UNAVAILABLE',
      response.status === 405 || response.status === 404
        ? 'Pet 的管理接口尚未注册，通常是 Host 未就绪或需要重启 DSH。'
        : `Pet 返回了空响应（HTTP ${response.status}）。`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new PetApiError(
      'PET_UNAVAILABLE',
      `Pet 返回了非预期的响应（HTTP ${response.status}）：${raw.slice(0, 120)}`,
    )
  }

  // Do not trust a truthy `ok` field or a structurally incomplete cast here.
  // A proxy/error page can return `{ ok: true }`, `null`, or an array; treating
  // any of those as a successful typed payload makes the UI fail later and can
  // hide a Host outage.  The Host envelope is deliberately validated before
  // the generic route type is applied.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new PetApiError(
      'PET_UNAVAILABLE',
      `Pet 返回了格式无效的响应（HTTP ${response.status}）。`,
    )
  }
  const candidate = parsed as Record<string, unknown>
  if (candidate.ok === true) {
    if (response.status < 200 || response.status >= 300) {
      throw new PetApiError(
        'PET_UNAVAILABLE',
        `Pet 返回了错误状态（HTTP ${response.status}）。`,
      )
    }
    if (!Object.prototype.hasOwnProperty.call(candidate, 'data')) {
      throw new PetApiError(
        'PET_UNAVAILABLE',
        `Pet 返回了缺少 data 的响应（HTTP ${response.status}）。`,
      )
    }
    return candidate.data as T
  }
  if (candidate.ok === false) {
    if (typeof candidate.error !== 'string' || candidate.error.trim() === '' ||
        typeof candidate.message !== 'string' || candidate.message.trim() === '') {
      throw new PetApiError(
        'PET_UNAVAILABLE',
        `Pet 返回了不完整的错误响应（HTTP ${response.status}）。`,
      )
    }
    throw new PetApiError(candidate.error, candidate.message)
  }
  throw new PetApiError(
    'PET_UNAVAILABLE',
    `Pet 返回了缺少 ok 标记的响应（HTTP ${response.status}）。`,
  )
}

/** Pet status projection. */
export interface PetStatus {
  readonly lifecycle: PetLifecycleState
  readonly version: string
  readonly skillSetGeneration: number
  /** Monotonic Host change generation; compared instead of polling data routes. */
  readonly generation: number
  /** Whether the generation the client sent is behind the Host. */
  readonly stale: boolean
}

/** Non-secret Pet configuration projection. */
export interface PetConfig {
  readonly providerId?: string
  readonly modelId?: string
  readonly agentPreset?: string
  readonly appearance?: {
    readonly accent?: string
    readonly glyph?: string
    readonly size?: string
    readonly ringStyle?: string
  }
  readonly defaultContextPolicy: 'current-session' | 'none'
  readonly workspaceId?: string
}

/** Fields accepted by the Host config-update route. */
export interface PetConfigPatch {
  readonly agentPreset?: string
  readonly defaultContextPolicy?: 'current-session' | 'none'
  readonly appearance?: {
    readonly accent?: string
    readonly glyph?: string
    readonly size?: string
    readonly ringStyle?: string
  }
}

/** The typed Pet management API. */
export const petApi = {
  status: (seenGeneration?: number): Promise<PetStatus> =>
    call(ROUTES.status, seenGeneration === undefined ? {} : { seenGeneration }),
  config: (): Promise<PetConfig> => call(ROUTES.config),
  updateConfig: (patch: PetConfigPatch): Promise<PetConfig> =>
    call(ROUTES.configUpdate, patch),
  capabilities: (): Promise<{ capabilities: PetCapability[] }> => call(ROUTES.capabilities),
  presets: (): Promise<{ presets: readonly { id: string; label: string }[] }> =>
    call(ROUTES.presets),
  repairWorkspace: (): Promise<{ ok: boolean; problems: readonly string[] }> =>
    call(ROUTES.workspaceRepair),
  skills: (): Promise<Record<string, unknown>> => call(ROUTES.skills),
  inspectSkill: (path: string): Promise<Record<string, unknown>> =>
    call(ROUTES.skillInspect, { path }),
  importSkill: (path: string, args?: string): Promise<Record<string, unknown>> =>
    call(ROUTES.skillImport, args === undefined ? { path } : { path, arguments: args }),
  mutateSkill: (input: {
    skillName: string
    action: 'enable' | 'disable' | 'shortcut' | 'remove' | 'arguments'
    arguments?: string
    showAsShortcut?: boolean
  }): Promise<Record<string, unknown>> => call(ROUTES.skillMutate, input),
  rebuildProjection: (): Promise<Record<string, unknown>> => call(ROUTES.projectionRebuild),
  petEnv: (): Promise<{
    entries: PetEnvRecord[]
    workspaces: PetWorkspaceChoice[]
    globalScope: string
    prefix: string
  }> => call(ROUTES.petEnv),
  mutatePetEnv: (input: {
    scope: string
    key: string
    action: 'set' | 'remove'
    value?: string
  }): Promise<{ entries: PetEnvRecord[] }> => call(ROUTES.petEnvMutate, input),
  channel: (): Promise<PetChannelView> => call(ROUTES.channel),
  mutateChannel: (input: {
    action:
      | 'set-enabled'
      | 'set-allowlist'
      | 'set-default-workspace'
      | 'reconnect'
      | 'pair-start'
      | 'pair-cancel'
    enabled?: boolean
    allowOpenIds?: readonly string[]
    defaultWorkspaceId?: string
  }): Promise<PetChannelView> => call(ROUTES.channelMutate, input),
  bindBot: (input: {
    action: 'create' | 'connect' | 'cancel'
    appId?: string
    /** Sent once, never stored client-side and never echoed back. */
    appSecret?: string
  }): Promise<PetChannelView> => call(ROUTES.channelBind, input),
  tasks: (): Promise<Record<string, unknown>> => call(ROUTES.tasks),
  taskDetail: (taskId: string): Promise<Record<string, unknown>> =>
    call(ROUTES.taskDetail, { taskId }),
  createInvocation: (capture: Record<string, unknown>): Promise<Record<string, unknown>> =>
    call(ROUTES.invocationCreate, capture),
  answer: (taskId: string, answer: string): Promise<unknown> =>
    call(ROUTES.invocationAnswer, { taskId, answer }),
  cancel: (taskId: string): Promise<unknown> => call(ROUTES.invocationCancel, { taskId }),
  retry: (invocationId: string): Promise<unknown> =>
    call(ROUTES.invocationRetry, { invocationId }),
  archive: (taskId: string, revision?: number): Promise<unknown> =>
    call(ROUTES.taskArchive, revision === undefined ? { taskId } : { taskId, revision }),
  diagnostics: (): Promise<Record<string, unknown>> => call(ROUTES.diagnostics),
  /** Owner-facing unified locus snapshot; this does not read legacy Tasks. */
  locus: (): Promise<PetLocusManagementView> => call(LOCUS_ROUTES.view),
  locusDiscovery: (input: PetLocusDiscoveryRequest): Promise<PetLocusDiscoveryView> =>
    call(LOCUS_ROUTES.discovery, input),
  locusAction: (input: PetLocusActionRequest): Promise<PetLocusActionResult> =>
    call(LOCUS_ROUTES.action, input),
  locusDefaultQa: (input: PetLocusDefaultQaRequest): Promise<PetLocusDefaultQaResult> =>
    call(LOCUS_ROUTES.defaultQa, input),
  locusBind: (input: Extract<PetLocusActionRequest, { action: 'bind' }>): Promise<PetLocusActionResult> =>
    call(LOCUS_ROUTES.bind, input),
  locusUnbind: (input: Extract<PetLocusActionRequest, { action: 'unbind' }>): Promise<PetLocusActionResult> =>
    call(LOCUS_ROUTES.unbind, input),
  locusArchive: (input: Extract<PetLocusActionRequest, { action: 'archive' }>): Promise<PetLocusActionResult> =>
    call(LOCUS_ROUTES.archive, input),
  locusStop: (input: Extract<PetLocusActionRequest, { action: 'stop' }>): Promise<PetLocusActionResult> =>
    call(LOCUS_ROUTES.stop, input),
  locusScope: (input: Extract<PetLocusActionRequest, { action: 'scope' }>): Promise<PetLocusActionResult> =>
    call(LOCUS_ROUTES.scope, input),
  locusConfirmAnchor: (input: Extract<PetLocusActionRequest, { action: 'confirm-anchor' }>): Promise<PetLocusActionResult> =>
    call(LOCUS_ROUTES.action, input),
  locusRebuild: (input: Extract<PetLocusActionRequest, { action: 'rebuild' }>): Promise<PetLocusActionResult> =>
    call(LOCUS_ROUTES.rebuild, input),
}
