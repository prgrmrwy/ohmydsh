/**
 * Browser-side Pet management client.
 *
 * A thin, typed wrapper over the exact Pet Host routes. It holds no host,
 * filesystem or credential capability of its own: every operation is a
 * same-origin POST that the Host independently validates.
 */

import { ROUTES, type PetCapability, type PetLifecycleState } from '../wire.js'

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
  const payload = (await response.json()) as PetResponse<T>
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
  skills: (): Promise<Record<string, unknown>> => call(ROUTES.skills),
  inspectSkill: (path: string): Promise<Record<string, unknown>> =>
    call(ROUTES.skillInspect, { path }),
  importSkill: (path: string, expectedDigest: string): Promise<Record<string, unknown>> =>
    call(ROUTES.skillImport, { path, expectedDigest }),
  mutateSkill: (input: {
    skillName: string
    action: 'enable' | 'disable' | 'upgrade' | 'shortcut' | 'uninstall'
    digest?: string
    showAsShortcut?: boolean
  }): Promise<Record<string, unknown>> => call(ROUTES.skillMutate, input),
  rebuildProjection: (): Promise<Record<string, unknown>> => call(ROUTES.projectionRebuild),
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
  bindings: (): Promise<Record<string, unknown>> => call(ROUTES.bindings),
  updateBinding: (binding: Record<string, unknown>): Promise<unknown> =>
    call(ROUTES.bindingsUpdate, binding),
  diagnostics: (): Promise<Record<string, unknown>> => call(ROUTES.diagnostics),
}
