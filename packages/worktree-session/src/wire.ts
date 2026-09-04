/** Shared Worktree Session wire contract. This module has no runtime imports. */

export const ROUTES = {
  repoStatus: '/worktree-session/api/repo-status',
  start: '/worktree-session/api/start',
  operationStatus: '/worktree-session/api/operation-status',
  promote: '/worktree-session/api/promote',
  clean: '/worktree-session/api/clean',
  bindSource: '/worktree-session/api/bind-source',
  sessionStatus: '/worktree-session/api/session-status',
  status: '/worktree-session/api/status',
} as const

export type OperationPhase =
  | 'allocated'
  | 'branch-created'
  | 'worktree-created'
  | 'dependencies-ready'
  | 'environment-ready'
  | 'prepared'
  | 'cleaned'

/** Supported dependency project types, resolved from the repo-root lockfile. */
export type PackageManager = 'npm' | 'pnpm'

export type ActiveOperationPhase = Exclude<OperationPhase, 'prepared' | 'cleaned'>
export type DependencyMode = 'lean' | 'mutable'
export type RefKind = 'local' | 'remote'

export interface RefEntry {
  name: string
  fullName: string
  kind: RefKind
  commit: string
}

export interface WorktreeEntry {
  path: string
  head: string
  branch?: string
  bare: boolean
  detached: boolean
  prunable: boolean
}

export type PublicBindingLifecycle = 'bound' | 'submit-claimed' | 'admitted' | 'uncertain' | 'cleaned'
export type SourceBindingState = PublicBindingLifecycle | 'cleaned-archived' | 'released'

/**
 * Marks tombstones written by the archive-aware schema-v2 implementation.
 * Its absence on a cleaned binding identifies a pre-change tombstone for the
 * one-time compatibility reconciliation; schemaVersion deliberately remains 2.
 */
export interface ArchiveLifecycleMetadata {
  version: 1
}

export interface SourceSessionBinding {
  mode: 'source-session'
  sourceSessionId: string
  state: SourceBindingState
  updatedAt: string
  archiveLifecycle?: ArchiveLifecycleMetadata
}

export type SessionBinding = SourceSessionBinding

/** Released audit history is deliberately not a current Session binding. */
export function isCurrentBinding(binding: SessionBinding | undefined): binding is SourceSessionBinding {
  return binding?.mode === 'source-session' && binding.state !== 'released'
}

/** Map internal archive states onto the stable public lifecycle vocabulary. */
export function publicBindingLifecycle(binding: SourceSessionBinding): PublicBindingLifecycle {
  return binding.state === 'cleaned-archived' || binding.state === 'released' ? 'cleaned' : binding.state
}

export interface OperationRecord {
  schemaVersion: 2
  operationId: string
  repoRoot: string
  gitCommonDir: string
  baseRef: string
  baseCommit: string
  taskBranch: string
  worktreePath: string
  taskHash: string
  dependencyMode: DependencyMode
  /** Dependency project type; absent on legacy operations (treated as npm). */
  packageManager?: PackageManager
  lockFingerprint?: string
  cacheNodeModules?: string
  dshHome: string
  phase: OperationPhase
  createdAt: string
  updatedAt: string
  diagnostics?: readonly string[]
  binding?: SessionBinding
}

/** The persisted binding of a schema-v2 operation, if established. */
export function bindingOf(operation: OperationRecord): SessionBinding | undefined {
  return operation.binding
}

export interface RepoStatusRequest {
  repoPath: string
}

export interface RepoStatusResult {
  repo: true
  repoRoot: string
  gitCommonDir: string
  currentBranch?: string
  currentCommit: string
  refs: readonly RefEntry[]
  worktrees: readonly WorktreeEntry[]
}

export interface StartOperationRequest {
  operationId: string
  repoPath: string
  baseRef: string
  taskText: string
  dependencyMode: 'lean'
}

export interface PreparedOperationResult {
  operationId: string
  phase: 'prepared'
  worktreePath: string
  taskBranch: string
  baseCommit: string
  dependencyMode: DependencyMode
  packageManager: PackageManager
  lockFingerprint: string
  dshHome: string
}

export interface OperationStatusRequest {
  operationId: string
  repoPath: string
}

export interface MaintenanceRequest {
  path: string
}

export interface BindSourceRequest {
  operationId: string
  repoPath: string
  sourceSessionId: string
}

export interface SourceBindingRequest extends BindSourceRequest {
  action: 'bind-source' | 'claim-submit' | 'admitted' | 'uncertain' | 'cleaned'
}

export interface BindSourceResult {
  sourceSessionId: string
  state: 'bound' | 'submit-claimed' | 'admitted' | 'uncertain' | 'cleaned'
  submitAllowed: boolean
}

export interface SessionStatusRequest {
  sessionId: string
  repoPath: string
}

export interface SessionStatusResult {
  bound: boolean
  operationId?: string
  phase?: OperationPhase
  taskBranch?: string
  worktreePath?: string
  dependencyMode?: DependencyMode
  packageManager?: PackageManager
  lifecycle?: PublicBindingLifecycle
  cleaned?: boolean
}

export interface CleanRequest extends MaintenanceRequest {
  dryRun: boolean
  activePaths?: readonly string[]
}

export interface StatusResult {
  operationId: string
  phase: OperationPhase
  repoRoot: string
  baseRef: string
  baseCommit: string
  taskBranch: string
  worktreePath: string
  dependencyMode: DependencyMode
  packageManager: PackageManager
  lockFingerprint?: string
  dshHome: string
}

export interface PromoteResult extends StatusResult {
  dependencyMode: 'mutable'
}

/**
 * How the task branch was proven to be merged.
 *
 * `ancestor` is ordinary Git ancestry — the strongest proof, and the only one
 * a plain merge workflow ever needs. `patch-equivalent` means ancestry did NOT
 * hold, yet every commit on the branch already exists upstream under a
 * different hash (`git cherry` patch-id equality), which is exactly what a
 * rebase produces. The weaker proof is reported rather than hidden: a clean is
 * irreversible, so the basis for "already merged" must stay reviewable.
 */
export type MergeProof = 'ancestor' | 'patch-equivalent'

export interface CleanResult {
  dryRun: boolean
  operationId: string
  worktreePath: string
  taskBranch: string
  actions: readonly string[]
  cleaned: boolean
  /** Which proof established that the task branch is merged. */
  mergeProof: MergeProof
  /**
   * Present only when this candidate's source Session was archived as part of
   * THIS call, after the user confirmed finishing it. Absent for an
   * already-archived candidate, keeping the two paths distinguishable.
   */
  archivedBeforeClean?: true
}

/**
 * The decidable facts a user needs to judge one archive-then-clean offer. The
 * candidate is identified exactly (never summarized), and `merged`/`clean`
 * report the gates already proven at offer time — the clean itself re-verifies
 * them under the repository lock.
 */
export interface RepoCleanArchiveOffer {
  operationId: string
  sourceSessionId: string
  taskBranch: string
  worktreePath: string
  /** The task branch is provably merged into its base ref. */
  merged: boolean
  /** The worktree has no uncommitted changes. */
  clean: boolean
}

/**
 * Why one repository-clean candidate was not cleaned. `not-archived` is this
 * flow's own precondition (the user was asked and declined);
 * `confirmation-unavailable` marks a candidate that passed every safety gate
 * but whose question could not reach a human at all, which is a different fact
 * from a refusal and must not be reported as one; `archive-failed` marks a
 * confirmed offer whose archive call failed, leaving every resource intact;
 * `refused` carries an existing single-operation safety-gate rejection;
 * `unreadable` marks metadata that could not be parsed (including retired
 * schema versions), which is reported and never mutated.
 */
export type RepoCleanRefusalKind = 'not-archived' | 'confirmation-unavailable' | 'archive-failed' | 'refused' | 'unreadable'

/** A candidate this run deliberately left untouched, with a stable reason. */
export interface RepoCleanRefusal {
  operationId: string
  kind: RepoCleanRefusalKind
  reason: string
  code?: WsErrorCode
  sourceSessionId?: string
  worktreePath?: string
  taskBranch?: string
}

/** Completed history (cleaned/released tombstones) skipped without mutation. */
export interface RepoCleanIgnored {
  operationId: string
  lifecycle: 'cleaned' | 'released'
  worktreePath?: string
  taskBranch?: string
}

/**
 * One repository-wide `ws clean` pass. Candidates are independent: `cleaned`
 * lists the operations this run removed, while every other operation appears
 * exactly once under `refused` or `ignored` with its resources intact.
 */
export interface RepoCleanResult {
  dryRun: boolean
  repoRoot: string
  scanned: number
  cleaned: readonly CleanResult[]
  refused: readonly RepoCleanRefusal[]
  ignored: readonly RepoCleanIgnored[]
  /**
   * How many candidates a real run would offer to archive-and-finish. Present
   * only on a preview that could make such an offer, and only when non-zero.
   *
   * A preview reports those candidates as refusals, so `cleaned: []` reads as
   * "nothing to do here" even when a real run would put a real decision to the
   * user. This states the actionable outcome outright instead of leaving it to
   * be inferred from refusal prose.
   */
  wouldOfferToFinish?: number
}

export type WsErrorCode =
  | 'INVALID_REQUEST'
  | 'UNTRUSTED_REQUEST'
  | 'METHOD_NOT_ALLOWED'
  | 'BODY_TOO_LARGE'
  | 'NOT_A_REPOSITORY'
  | 'OUTSIDE_REPOSITORY'
  | 'GIT_FAILED'
  | 'GIT_TIMEOUT'
  | 'OPERATION_CONFLICT'
  | 'OPERATION_NOT_FOUND'
  | 'OPERATION_INVALID'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'UNSUPPORTED_PROJECT'
  | 'DEPENDENCY_FAILED'
  | 'ENVIRONMENT_FAILED'
  | 'PROMOTE_REFUSED'
  | 'CLEAN_REFUSED'
  | 'INTERNAL_ERROR'

export interface WsWireError {
  code: WsErrorCode
  message: string
  phase?: OperationPhase
  retryable: boolean
  details?: Record<string, string | number | boolean>
}

export type WireEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: WsWireError }
