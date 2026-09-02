/**
 * The `clean-worktree` bounded capability.
 *
 * Pet NEVER reimplements Worktree Session's safety gates. `wsClean` already
 * refuses to clean the caller's own worktree, a worktree used by an active
 * DSH session, a worktree bound to an active source session, an in-flight
 * operation, a dirty worktree, a branch that no longer descends from its
 * recorded base, or a branch not proven merged. This adapter's only job is to
 * resolve the target from TRUSTED context and hand the gates everything they
 * need to say no.
 *
 * The Worktree Session package is an OPTIONAL peer: when it is absent the
 * capability reports itself unavailable rather than breaking Pet.
 */

import { PetError } from './errors.js'
import type { PetRepository } from './repository.js'
import { resolveTrustedContext } from './capture.js'

/** The `wsClean` result shape Pet consumes. */
export interface CleanResultLike {
  readonly dryRun: boolean
  readonly operationId: string
  readonly worktreePath: string
  readonly taskBranch: string
  readonly actions: readonly string[]
  readonly cleaned: boolean
}

/** The `wsStatus` result shape Pet consumes. */
export interface StatusResultLike {
  readonly operationId: string
  readonly phase: string
  readonly repoRoot: string
  readonly taskBranch: string
  readonly worktreePath: string
  readonly dependencyMode: string
}

/** The narrow Worktree Session maintenance surface Pet depends on. */
export interface WorktreeMaintenance {
  wsStatus(target: { sessionId: string; repoPath: string }): Promise<StatusResultLike>
  wsClean(
    target: { sessionId: string; repoPath: string },
    options: {
      dryRun?: boolean
      activePaths?: readonly string[]
      activeBoundSessionIds?: readonly string[]
      requireActivePaths?: boolean
    },
  ): Promise<CleanResultLike>
}

/** Live Host facts the gates need in order to refuse correctly. */
export interface HostActivity {
  /** cwd of every live DSH session. */
  activePaths(): readonly string[]
  /** Source session ids with a live Worktree Session binding. */
  activeBoundSessionIds(): readonly string[]
}

/**
 * Try to load the installed Worktree Session maintenance module.
 *
 * Resolved dynamically so Pet loads and runs in a profile without the
 * Worktree Session plugin; the capability is simply unavailable there.
 * @returns the maintenance surface, or `undefined` when not installed.
 */
export async function loadWorktreeMaintenance(): Promise<WorktreeMaintenance | undefined> {
  try {
    const loaded = (await import('dsh-worktree-session/maintenance')) as unknown as {
      wsStatus?: unknown
      wsClean?: unknown
    }
    if (typeof loaded.wsStatus !== 'function' || typeof loaded.wsClean !== 'function') {
      return undefined
    }
    return loaded as unknown as WorktreeMaintenance
  } catch {
    return undefined
  }
}

/** Outcome returned to the Agent. */
export interface CleanWorktreeOutcome {
  readonly status: 'preview' | 'cleaned' | 'refused'
  readonly operationId?: string
  readonly worktreePath?: string
  readonly taskBranch?: string
  readonly actions?: readonly string[]
  /** The gate's own refusal text, surfaced verbatim and never reinterpreted. */
  readonly reason?: string
}

/**
 * Run `clean-worktree` for the calling executor session.
 *
 * The target is derived ONLY from the Invocation's immutable snapshot — the
 * model cannot pass a path, branch or session id — and a preview (`dryRun`)
 * must succeed before the destructive call is made.
 * @param options - Repository, maintenance surface, Host activity and caller.
 * @returns the bounded outcome.
 * @throws PetError when the caller is not a Pet executor with current work.
 */
export async function runCleanWorktree(options: {
  readonly repository: PetRepository
  readonly maintenance: WorktreeMaintenance | undefined
  readonly activity: HostActivity
  readonly executorSessionId: string
  /** When false, only a dry-run preview is produced. */
  readonly confirm: boolean
}): Promise<CleanWorktreeOutcome> {
  if (options.maintenance === undefined) {
    throw new PetError(
      'CAPABILITY_UNAVAILABLE',
      'Worktree Session is not installed in this DSH profile, so clean-worktree is unavailable.',
    )
  }

  // Caller-bound: resolution starts from the real executing session.
  const context = resolveTrustedContext(options.repository, options.executorSessionId)
  const snapshot = context.snapshot
  if (snapshot.sourceKind !== 'session' || snapshot.sourceSessionId === undefined) {
    throw new PetError(
      'CONTEXT_REQUIRED',
      'clean-worktree requires a DSH session source; this Invocation has none.',
    )
  }
  if (snapshot.cwd === undefined) {
    throw new PetError(
      'CONTEXT_REQUIRED',
      'The source session has no repository root recorded in its snapshot.',
    )
  }

  const target = { sessionId: snapshot.sourceSessionId, repoPath: snapshot.cwd }
  // Always supply live Host activity and require it: this is what lets the
  // gates refuse a worktree that is still in use.
  const gateOptions = {
    activePaths: options.activity.activePaths(),
    activeBoundSessionIds: options.activity.activeBoundSessionIds(),
    requireActivePaths: true,
  }

  try {
    const preview = await options.maintenance.wsClean(target, { ...gateOptions, dryRun: true })
    if (!options.confirm) {
      return {
        status: 'preview',
        operationId: preview.operationId,
        worktreePath: preview.worktreePath,
        taskBranch: preview.taskBranch,
        actions: preview.actions,
      }
    }
    const result = await options.maintenance.wsClean(target, { ...gateOptions, dryRun: false })
    return {
      status: result.cleaned ? 'cleaned' : 'refused',
      operationId: result.operationId,
      worktreePath: result.worktreePath,
      taskBranch: result.taskBranch,
      actions: result.actions,
    }
  } catch (error) {
    // A gate refusal is a legitimate, actionable answer — not a Pet failure.
    // The text is surfaced verbatim so the Agent cannot soften or bypass it.
    return { status: 'refused', reason: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Probe whether the capability can run in this profile.
 * @param maintenance - The loaded maintenance surface, if any.
 * @returns a diagnostic when unavailable, otherwise `undefined`.
 */
export function cleanWorktreeDiagnostic(
  maintenance: WorktreeMaintenance | undefined,
): string | undefined {
  return maintenance === undefined
    ? 'Worktree Session (dsh-worktree-session) is not installed in this DSH profile.'
    : undefined
}
