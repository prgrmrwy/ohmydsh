/**
 * Browser-side Pet management client.
 *
 * A thin, typed wrapper over the exact Pet Host routes. It holds no host,
 * filesystem or credential capability of its own: every operation is a
 * same-origin POST that the Host independently validates.
 */

import {
  ROUTES,
  type PetCapability,
  type PetEnvRecord,
  type PetLifecycleState,
  type PetWorkspaceChoice,
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

  let payload: PetResponse<T>
  try {
    payload = JSON.parse(raw) as PetResponse<T>
  } catch {
    throw new PetApiError(
      'PET_UNAVAILABLE',
      `Pet 返回了非预期的响应（HTTP ${response.status}）：${raw.slice(0, 120)}`,
    )
  }
  if (!payload.ok) throw new PetApiError(payload.error, payload.message)
  return payload.data
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

/** Non-secret Pet configuration. */
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

/** The typed Pet management API. */
export const petApi = {
  status: (seenGeneration?: number): Promise<PetStatus> =>
    call(ROUTES.status, seenGeneration === undefined ? {} : { seenGeneration }),
  config: (): Promise<PetConfig> => call(ROUTES.config),
  updateConfig: (patch: Partial<PetConfig>): Promise<PetConfig> =>
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
}
