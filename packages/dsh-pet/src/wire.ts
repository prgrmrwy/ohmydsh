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
/**
 * Preset composing a Pet executor WITHOUT local-root Skill discovery.
 *
 * Shared because both halves need it: the Host defaults new executors to it,
 * and Settings shows it as the current selection when none is stored.
 * `standard` would load `skill-filesystem` and make every globally installed
 * Skill visible to the executor — see ADR-0001.
 */
export const PET_EXECUTOR_PRESET = 'dsh-pet-executor'

/**
 * DSH's ordinary full coding-agent preset.
 *
 * Named explicitly for workspace-resident executors rather than left unset:
 * an omitted preset is not recorded on the session header at all, so the UI
 * has nothing to show and the session appears to have no mode. Saying
 * `standard` states the intent and keeps it visible.
 */
export const STANDARD_PRESET = 'standard'

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
  petEnv: '/dsh-pet/api/env',
  petEnvMutate: '/dsh-pet/api/env-mutate',
  channel: '/dsh-pet/api/channel',
  channelMutate: '/dsh-pet/api/channel-mutate',
  channelBind: '/dsh-pet/api/channel-bind',
  qaGroupCreate: '/dsh-pet/api/qa-group-create',
} as const

/**
 * Wheel id of the built-in Q&A action.
 *
 * A `builtin` capability id, deliberately not a Skill name: nothing may
 * resolve a Skill from it.
 */
export const QA_GROUP_ACTION_ID = 'qa-group'

/** What the Q&A action returns once its group exists. */
export interface PetQaGroupResult {
  readonly chatId: string
  readonly chatName: string
  readonly childSessionId: string
  readonly taskId: string
  /**
   * Whether an existing group was returned instead of a new one created.
   *
   * One source session owns at most one live QA group, so a second click is
   * "show me my group". The client must be able to say which happened: two
   * identical-looking outcomes are how several identically named groups came
   * to exist before reuse was implemented.
   */
  readonly reused?: boolean
}

/**
 * Reserved scope naming the global environment set.
 *
 * Shared by both halves: the client sends it verbatim as `scope`, and the Host
 * stores it in the same column workspace ids use. A DSH workspace id is
 * generated and never this literal, so the two cannot be confused.
 */
export const PET_ENV_GLOBAL = 'global'

/** One configured environment entry, as the management routes exchange it. */
export interface PetEnvRecord {
  /** `global`, or a workspace id. */
  readonly scope: string
  /** Upper-snake-case name, stored WITHOUT the `DSH_PET_` prefix. */
  readonly key: string
  readonly value: string
  readonly updatedAt: number
}

/** A workspace the environment tab can target, for the picker. */
export interface PetWorkspaceChoice {
  readonly id: string
  readonly title?: string
  readonly path?: string
}

// ---------------------------------------------------------------------------
// Lark channel
// ---------------------------------------------------------------------------

/**
 * Bound bot identity, as the management routes expose it.
 *
 * Identity facts only. There is deliberately no field for an app secret: the
 * secret lives in lark-cli, and a shape that could carry one would eventually
 * be filled in.
 */
export interface PetBotIdentity {
  readonly appId: string
  readonly name?: string
  /** Absent until proven from a chat member list. */
  readonly openId?: string
}

/** Progress of a bot-binding flow. */
export type PetBindPhase = 'idle' | 'awaiting-authorization' | 'bound' | 'failed'

/** Bot-binding flow state, safe to show in the UI. */
export interface PetBindState {
  readonly phase: PetBindPhase
  /** One-time onboarding link; not a credential. */
  readonly verificationUrl?: string
  readonly appId?: string
  readonly diagnostic?: string
}

/** Live connection state of the inbound subscription. */
export type PetChannelPhase = 'stopped' | 'starting' | 'connected' | 'reconnecting' | 'down'

/** One chat route, as the management routes exchange it. */
export interface PetChatRoute {
  readonly chatId: string
  readonly chatType: 'p2p' | 'group'
  readonly chatName?: string
  /** Binding kind; `workspace` routes to a workspace, `qa` to a fork child. */
  readonly kind: 'workspace' | 'qa'
  /** Present on `workspace` bindings only. */
  readonly workspaceId?: string
  readonly activeTaskId?: string
  /** Present on `qa` bindings: the fork child serving the group. */
  readonly qaChildSessionId?: string
  /** Present on `qa` bindings: the source session the child was forked from. */
  readonly qaParentSessionId?: string
  /**
   * How a `qa` binding came to exist: Pet created the group, or an existing
   * group was attached with `/bind`. Presentational only — it exists so the
   * UI can avoid implying Pet can manage a group it merely joined.
   */
  readonly qaOrigin?: 'created' | 'bound'
  /** Present when a qa binding has been invalidated (no longer raises work). */
  readonly qaInvalidatedAt?: number
  readonly qaInvalidatedReason?: string
  readonly boundBy: 'auto' | 'user'
  readonly boundAt: number
}

/** Everything the Channel settings tab renders. */
export interface PetChannelView {
  readonly enabled: boolean
  /** Absent until a bot is bound. */
  readonly bot?: PetBotIdentity
  readonly allowOpenIds: readonly string[]
  /**
   * Display names for known open_ids, for presentation only.
   *
   * Admission compares ids; this exists so the list is readable.
   */
  readonly knownNames: Readonly<Record<string, string>>
  readonly defaultWorkspaceId?: string
  readonly routes: readonly PetChatRoute[]
  readonly connection: {
    readonly phase: PetChannelPhase
    readonly diagnostic?: string
    /** Invocations waiting behind current work, across all chats. */
    readonly queueDepth: number
  }
  /** Present while a binding flow is running or has just failed. */
  readonly binding?: PetBindState
}

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

/**
 * The supported Pet Task source kinds.
 *
 * `chat` is an external channel conversation (a Lark chat). It is a source
 * kind of its own rather than a flavour of `workspace`: two chats routed to
 * the same workspace MUST keep independent Tasks, which only holds when the
 * chat id — not the route target — is what forms the scope key.
 *
 * `qa-chat` is a QA group, whose Task represents a fork child of a user
 * session rather than an executor Pet created. Distinct from `chat` because
 * the healing paths differ: a `chat` Task recovers from a stale pointer by
 * creating a new executor, which a QA Task must never do — a fresh session
 * would drop the inherited context the group exists for.
 */
export type PetSourceKind = 'session' | 'workspace' | 'none' | 'chat' | 'qa-chat'

/**
 * Stable scope key that defines active-Task uniqueness.
 *
 * `qa:` is keyed on the SOURCE SESSION rather than on the chat, because a QA
 * group's chat id does not exist until that group has been created — a
 * chat-keyed scope could never match an earlier group, so every click would
 * build another one. Namespaced apart from `session:` so one source session
 * can hold an overlay Task and a QA group at the same time.
 */
export type PetScopeKey =
  | `session:${string}`
  | `workspace:${string}`
  | `chat:${string}`
  | `qa:${string}`
  | 'independent:web:default'

/** The phase-one independent scope key. */
export const INDEPENDENT_SCOPE_KEY: PetScopeKey = 'independent:web:default'

/**
 * Build the canonical scope key for a source selection.
 *
 * The scope key is the only active-uniqueness authority; titles and start
 * messages are visible projections and are never parsed back into routing.
 * @param kind - Selected source kind.
 * @param id - Source session, workspace or chat id; ignored for `none`.
 * @returns the canonical scope key.
 */
export function scopeKeyOf(kind: PetSourceKind, id?: string): PetScopeKey {
  if (kind === 'none') return INDEPENDENT_SCOPE_KEY
  if (id === undefined || id === '') throw new Error(`Pet source kind ${kind} requires an id`)
  if (kind === 'session') return `session:${id}`
  if (kind === 'chat') return `chat:${id}`
  return `workspace:${id}`
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
  /**
   * Workspace the executor session lives IN, for workspace-resident Tasks.
   *
   * Absent on every ordinary Task, whose executor runs in the dedicated
   * `DSH Pet` workspace and reaches its source through the trusted snapshot.
   * Present only when a channel route placed the executor directly inside a
   * target workspace — a form in which Pet does NOT promise its Skill
   * allowlist projection or standing instructions.
   */
  readonly residentWorkspaceId?: string
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
  /**
   * Skill name resolved at acceptance time.
   *
   * ABSENT for a conversational Invocation — one raised by an inbound channel
   * message rather than by clicking a capability. Such an Invocation carries a
   * question, not a Skill to run, so there is no name to pin, no `/<name>`
   * token to lead the envelope with, and nothing for the pre-dispatch Skill
   * check to verify.
   */
  readonly skillName?: string
  /** Registered directory at acceptance time, recorded for diagnostics. */
  readonly skillSourcePath?: string
  /** Pet skill-set generation active when the Invocation was accepted. */
  readonly skillSetGeneration?: number
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
  /** Always the Skill name: Pet reads no Pet-specific label from a Skill. */
  readonly label: string
  readonly description: string
  readonly skillName: string
  /**
   * Where this wheel entry comes from.
   *
   * `skill` is the ordinary case: a Skill the user imported and enabled, run
   * through the Invocation path. `builtin` is a Host action (Q&A) that is NOT
   * a Skill at all — it never enters the allowlist model, emits no
   * `/<skill-name>` envelope, and its availability is probed by the Host. The
   * two share the wheel because the wheel is a shortcut surface, not a Skill
   * listing.
   */
  readonly kind: 'skill' | 'builtin'
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
