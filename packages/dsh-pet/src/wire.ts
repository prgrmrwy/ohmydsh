/**
 * Shared DSH Pet wire contract between the Host half and the Web client half.
 *
 * This module MUST stay free of runtime imports: it is compiled into the Node
 * Host bundle and into the browser client bundle alike, so it may only declare
 * types, constants and pure helpers.
 */

/** Stable plugin identity, used for the state directory and the client bundle id. */
export const PET_PLUGIN_ID = 'dsh-pet'

/** Display title of the Pet-owned Workspace registered in DSH. */
export const PET_WORKSPACE_TITLE = 'DSH Pet'

/** Exact Host routes. Every mutation is same-origin/loopback constrained by DSH Web transport. */
export const ROUTES = {
  status: '/dsh-pet/api/status',
  config: '/dsh-pet/api/config',
  configUpdate: '/dsh-pet/api/config-update',
  capabilities: '/dsh-pet/api/capabilities',
  presets: '/dsh-pet/api/presets',
  skills: '/dsh-pet/api/skills',
  skillInspect: '/dsh-pet/api/skill-inspect',
  skillImport: '/dsh-pet/api/skill-import',
  skillMutate: '/dsh-pet/api/skill-mutate',
  projectionRebuild: '/dsh-pet/api/projection-rebuild',
  workspaceRepair: '/dsh-pet/api/workspace-repair',
  tasks: '/dsh-pet/api/tasks',
  taskDetail: '/dsh-pet/api/task-detail',
  invocationCreate: '/dsh-pet/api/invocation-create',
  invocationAnswer: '/dsh-pet/api/invocation-answer',
  invocationCancel: '/dsh-pet/api/invocation-cancel',
  invocationRetry: '/dsh-pet/api/invocation-retry',
  taskArchive: '/dsh-pet/api/task-archive',
  diagnostics: '/dsh-pet/api/diagnostics',
} as const

/** Maximum accepted JSON request body for any Pet management route. */
export const MAX_REQUEST_BODY_BYTES = 256 * 1024

// ---------------------------------------------------------------------------
// Host lifecycle
// ---------------------------------------------------------------------------

/**
 * Contained Pet Host lifecycle. A Pet that cannot initialize becomes
 * `degraded` and MUST NOT prevent ordinary DSH services from loading.
 */
export type PetLifecycle = 'starting' | 'ready' | 'degraded' | 'stopping'

export interface PetLifecycleState {
  readonly phase: PetLifecycle
  /** Human-readable diagnostic present whenever `phase` is `degraded`. */
  readonly diagnostic?: string
  /** Monotonic counter so the client can detect a restart without polling. */
  readonly generation: number
}

// ---------------------------------------------------------------------------
// Source scope
// ---------------------------------------------------------------------------

/** The three supported Pet Task source kinds. */
export type PetSourceKind = 'session' | 'workspace' | 'none'

/** Declared context requirement of a Pet capability. */
export type PetContextRequirement = 'none' | 'optional' | 'workspace-required' | 'session-required'

/** Stable scope key that defines active-Task uniqueness. */
export type PetScopeKey = `session:${string}` | `workspace:${string}` | 'independent:web:default'

/** The phase-one independent scope key. */
export const INDEPENDENT_SCOPE_KEY: PetScopeKey = 'independent:web:default'

/**
 * Build the canonical scope key for a source selection.
 *
 * The scope key is the only active-uniqueness authority; titles and start
 * messages are visible projections and are never parsed back into routing.
 * @param kind - Selected source kind.
 * @param id - Source session or workspace id; ignored for `none`.
 * @returns the canonical scope key.
 */
export function scopeKeyOf(kind: PetSourceKind, id?: string): PetScopeKey {
  if (kind === 'none') return INDEPENDENT_SCOPE_KEY
  if (id === undefined || id === '') throw new Error(`Pet source kind ${kind} requires an id`)
  return kind === 'session' ? `session:${id}` : `workspace:${id}`
}

// ---------------------------------------------------------------------------
// Durable Pet entities
// ---------------------------------------------------------------------------

/** Execution state of a Pet Task, kept strictly separate from its archive state. */
export type PetTaskStatus =
  | 'creating-executor'
  | 'idle'
  | 'running'
  | 'waiting-user'
  | 'failed'
  | 'recovering'

/** Terminal Task statuses that permit archival without an explicit cancellation. */
export const TERMINAL_TASK_STATUSES: readonly PetTaskStatus[] = ['idle', 'failed']

/** Execution state of one Pet Invocation. */
export type PetInvocationStatus =
  | 'queued'
  | 'dispatching'
  | 'running'
  | 'waiting-user'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'recovering'

/** Invocation statuses that no longer occupy the Task's single current slot. */
export const TERMINAL_INVOCATION_STATUSES: readonly PetInvocationStatus[] = [
  'succeeded',
  'failed',
  'cancelled',
]

/**
 * Whether an Invocation still occupies the per-Task serial slot.
 * @param status - Invocation status to classify.
 * @returns whether the Invocation is the current, non-settled one.
 */
export function occupiesCurrentSlot(status: PetInvocationStatus): boolean {
  return !TERMINAL_INVOCATION_STATUSES.includes(status)
}

/** Availability of the source behind a Task, projected for display only. */
export type PetSourceAvailability = 'available' | 'archived' | 'missing'

export interface PetTaskRecord {
  readonly id: string
  readonly scopeKey: PetScopeKey
  readonly epoch: number
  readonly sourceKind: PetSourceKind
  readonly sourceId?: string
  /** Human-readable source title captured when the Task was created. */
  readonly sourceTitle?: string
  readonly sourceAvailability: PetSourceAvailability
  readonly executorSessionId: string
  readonly status: PetTaskStatus
  readonly diagnostic?: string
  readonly archivedAt?: number
  readonly createdAt: number
  readonly updatedAt: number
  /** Optimistic-concurrency fence for every mutation and archive transition. */
  readonly revision: number
}

export interface PetInvocationRecord {
  readonly id: string
  readonly taskId: string
  readonly capabilityId: string
  /** Skill name resolved at acceptance time. */
  readonly skillName: string
  /** Immutable store digest fixed for this Invocation; upgrades never rewrite it. */
  /** Registered directory at acceptance time, recorded for diagnostics. */
  readonly skillSourcePath: string
  /** Pet skill-set generation active when the Invocation was accepted. */
  readonly skillSetGeneration: number
  readonly snapshotId: string
  /** Free-text user request, rendered into the visible envelope. */
  readonly request?: string
  readonly status: PetInvocationStatus
  /** Durable FIFO ordering within the owning Task. */
  readonly queuePosition: number
  readonly resultSummary?: string
  readonly errorSummary?: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly revision: number
}

/** Immutable source facts fixed at Invocation acceptance time. */
export interface PetSourceSnapshot {
  readonly id: string
  readonly invocationId: string
  readonly sourceKind: PetSourceKind
  readonly sourceSessionId?: string
  readonly sourceWorkspaceId?: string
  readonly sessionTitle?: string
  readonly workspaceTitle?: string
  /** Repository root reported by the source session header. */
  readonly cwd?: string
  /** Durable session event position proving where the snapshot was taken. */
  readonly asOfSeq?: number
  /** Optional Worktree Session facts, absent when that plugin is not installed. */
  readonly worktree?: PetWorktreeFacts
  /** Optional side-effect-free SCM facts. */
  readonly scm?: PetScmFacts
  readonly capturedAt: number
}

export interface PetWorktreeFacts {
  /** Managed execution root, which differs from the session header cwd by design. */
  readonly executionRoot: string
  readonly branch?: string
  readonly dependencyMode?: string
  readonly lifecycle?: string
}

export interface PetScmFacts {
  readonly branch?: string
  readonly head?: string
  readonly remote?: string
}

/** One execution attempt of an Invocation. Retries reuse the Invocation snapshot. */
export interface PetRunRecord {
  readonly id: string
  readonly invocationId: string
  readonly attempt: number
  readonly status: PetInvocationStatus
  readonly errorSummary?: string
  readonly startedAt: number
  readonly settledAt?: number
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export interface PetCapability {
  readonly id: string
  readonly label: string
  readonly icon?: string
  readonly description: string
  readonly skillName: string
  readonly contextRequirement: PetContextRequirement
  readonly requiresConfirmation: boolean
  /** Computed: a missing organization-specific dependency disables rather than breaks Pet. */
  readonly available: boolean
  readonly diagnostic?: string
  /**
   * Whether the capability appears in the radial shortcut menu. A hidden
   * capability stays installed, enabled and invocable elsewhere — this
   * controls menu clutter only, never authorization.
   */
  readonly showAsShortcut: boolean
}

// ---------------------------------------------------------------------------
// Skill store
// ---------------------------------------------------------------------------

/** Every Skill is added by the user; Pet ships no privileged built-ins. */
export type PetSkillProvenanceKind = 'local-link'

export interface PetSkillProvenance {
  readonly kind: PetSkillProvenanceKind
  /** Directory the user registered, echoed for diagnostics. */
  readonly sourcePath?: string
  readonly installedAt: number
}

export interface PetSkillRevision {
  readonly skillName: string
  /** Canonical directory on the Host that the projection links to. */
  readonly sourcePath: string
  readonly description: string
  /**
   * Pet presentation and context requirement declared by the Skill itself.
   *
   * This is what makes a capability an INSTALL rather than a code change:
   * Pet reads these from the bundle's frontmatter and ships no per-capability
   * adapter. Persisted with the immutable revision, so queued work keeps the
   * declarations it was accepted with.
   */
  readonly pet?: {
    readonly label?: string
    readonly icon?: string
    readonly context?: PetContextRequirement
    readonly confirm?: boolean
  }
  /**
   * Free-text arguments appended after the skill token on every dispatch.
   *
   * Pet does not parse them: the Skill's instructions decide what they mean.
   */
  readonly arguments?: string
  readonly provenance: PetSkillProvenance
  readonly fileCount: number
  readonly totalBytes: number
}

/** Per-skill selection state: installed, enabled and shortcut visibility are separate facts. */
export interface PetSkillSelection {
  readonly skillName: string
  /** Whether the Skill is enabled; a Skill has no versions to choose between. */
  readonly enabled?: boolean
  readonly showAsShortcut: boolean
  /** Newer trusted built-in revision available but never silently applied. */
}

export type PetProjectionStatus = 'ok' | 'missing' | 'drifted' | 'not-a-symlink' | 'out-of-store'

export interface PetProjectionEntry {
  readonly skillName: string
  readonly status: PetProjectionStatus
  /** Canonical source directory this entry is expected to link to. */
  readonly expectedSourcePath?: string
  readonly resolvedTarget?: string
  readonly diagnostic?: string
}

// ---------------------------------------------------------------------------
// Invocation capture contract (Web -> Host)
// ---------------------------------------------------------------------------

/**
 * The immutable capture the browser sends when the user confirms an Invocation.
 * The Host never consults the browser's live `current` selection again for this
 * Invocation.
 */
export interface PetInvocationCapture {
  /** Stable client-generated id making the create call idempotent. */
  readonly clientInvocationId: string
  readonly capabilityId: string
  readonly sourceKind: PetSourceKind
  readonly sourceSessionId?: string
  readonly sourceWorkspaceId?: string
  /** Browser-visible titles, revalidated Host-side and never trusted as authority. */
  readonly sessionTitle?: string
  readonly workspaceTitle?: string
  readonly request?: string
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Stable Pet error codes returned by every management route. */
export type PetErrorCode =
  | 'PET_DEGRADED'
  | 'INVALID_REQUEST'
  | 'UNKNOWN_CAPABILITY'
  | 'CAPABILITY_UNAVAILABLE'
  | 'CONTEXT_REQUIRED'
  | 'SOURCE_NOT_FOUND'
  | 'TASK_NOT_FOUND'
  | 'TASK_ARCHIVED'
  | 'INVOCATION_NOT_FOUND'
  | 'NO_CURRENT_INVOCATION'
  | 'AMBIGUOUS_CURRENT_INVOCATION'
  | 'NOT_A_PET_SESSION'
  | 'REVISION_CONFLICT'
  | 'SKILL_NOT_FOUND'
  | 'SKILL_DISABLED'
  | 'SKILL_DIGEST_MISMATCH'
  | 'SKILL_IMPORT_REJECTED'
  | 'PROJECTION_DRIFT'
  /** Workspace files an executor depends on are missing and could not be repaired. */
  | 'WORKSPACE_UNHEALTHY'
  | 'MODEL_UNAVAILABLE'
  | 'BINDING_INVALID'
  | 'ARCHIVE_BLOCKED'
  | 'INTERNAL'

/** Uniform error body returned by Pet management routes. */
export interface PetErrorBody {
  readonly error: PetErrorCode
  readonly message: string
  /** Optional field-level details for validation failures; never contains secrets. */
  readonly fields?: Readonly<Record<string, string>>
}
