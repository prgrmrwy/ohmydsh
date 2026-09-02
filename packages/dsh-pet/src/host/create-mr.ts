/**
 * The `create-mr` bounded capability.
 *
 * Backed by the installed `bytedcli codebase mr create` contract:
 *
 *   --repo, --head, --base, --title (required), --body, --reviewer-ids, --push
 *
 * The repository and source branch come from the Invocation's TRUSTED
 * snapshot — never from model text — so a model cannot retarget the MR at a
 * different repository or branch. Title, body and reviewers are model- or
 * user-supplied content, passed as separate argv entries so they stay data.
 */

import { PetError } from './errors.js'
import { resolveTrustedContext } from './capture.js'
import {
  isCommandAvailable,
  requireSuccess,
  runBoundedCommand,
  type CommandRunner,
} from './bounded-command.js'
import type { PetRepository } from './repository.js'

/** Executable providing the Codebase surface. */
export const CREATE_MR_COMMAND = 'bytedcli'

/** Maximum accepted title/body lengths, bounding what reaches the CLI. */
export const MR_LIMITS = { maxTitle: 300, maxBody: 20_000, maxReviewers: 20 } as const

/** Model/user-supplied MR content. The target is NOT part of this. */
export interface CreateMrRequest {
  readonly title: string
  readonly body?: string
  /** Target branch; omitted uses the repository default. */
  readonly base?: string
  readonly reviewers?: readonly string[]
  /** Push the source branch before creating the MR. */
  readonly push?: boolean
}

/** Outcome returned to the Agent. */
export interface CreateMrOutcome {
  readonly status: 'created' | 'refused'
  readonly repositoryRoot?: string
  readonly head?: string
  readonly base?: string
  readonly url?: string
  readonly reason?: string
}

/**
 * Extract an MR URL from CLI output without assuming a strict format.
 * @param output - Raw stdout.
 * @returns the first URL found, or `undefined`.
 */
export function extractMrUrl(output: string): string | undefined {
  const match = /https?:\/\/\S+/.exec(output)
  return match?.[0]
}

/**
 * Probe whether the capability can run in this profile.
 * @param runner - Command runner.
 * @returns a diagnostic when unavailable, otherwise `undefined`.
 */
export async function createMrDiagnostic(
  runner: CommandRunner = runBoundedCommand,
): Promise<string | undefined> {
  return (await isCommandAvailable(CREATE_MR_COMMAND, runner))
    ? undefined
    : `\`${CREATE_MR_COMMAND}\` is not installed on this machine, so create-mr is unavailable.`
}

/**
 * Create a merge request for the calling executor's trusted source.
 *
 * Resolution is caller-bound: the repository and branch come from the
 * Invocation snapshot, so the model cannot substitute a different target.
 * @param options - Repository, runner and caller identity plus MR content.
 * @returns the bounded outcome.
 * @throws PetError when the caller or context is invalid.
 */
export async function runCreateMr(options: {
  readonly repository: PetRepository
  readonly executorSessionId: string
  readonly request: CreateMrRequest
  readonly runner?: CommandRunner
}): Promise<CreateMrOutcome> {
  const runner = options.runner ?? runBoundedCommand
  const diagnostic = await createMrDiagnostic(runner)
  if (diagnostic !== undefined) throw new PetError('CAPABILITY_UNAVAILABLE', diagnostic)

  const context = resolveTrustedContext(options.repository, options.executorSessionId)
  const snapshot = context.snapshot
  if (snapshot.sourceKind !== 'session') {
    throw new PetError('CONTEXT_REQUIRED', 'create-mr requires a DSH session source.')
  }

  // The managed worktree is the execution root when present; otherwise the
  // repository root. Never a path the model supplied.
  const cwd = snapshot.worktree?.executionRoot ?? snapshot.cwd
  if (cwd === undefined) {
    throw new PetError(
      'CONTEXT_REQUIRED',
      'The source session has no repository root recorded in its snapshot.',
    )
  }

  const title = options.request.title.trim()
  if (title === '') {
    throw new PetError('INVALID_REQUEST', 'A merge request requires a non-empty title.')
  }
  if (title.length > MR_LIMITS.maxTitle) {
    throw new PetError('INVALID_REQUEST', `Title exceeds ${MR_LIMITS.maxTitle} characters.`)
  }
  const body = options.request.body ?? ''
  if (body.length > MR_LIMITS.maxBody) {
    throw new PetError('INVALID_REQUEST', `Body exceeds ${MR_LIMITS.maxBody} characters.`)
  }
  const reviewers = options.request.reviewers ?? []
  if (reviewers.length > MR_LIMITS.maxReviewers) {
    throw new PetError('INVALID_REQUEST', `At most ${MR_LIMITS.maxReviewers} reviewers.`)
  }

  // The branch comes from the worktree binding when Pet has one, so a managed
  // Worktree Session MR targets its own task branch rather than whatever is
  // checked out elsewhere.
  const head = snapshot.worktree?.branch

  const args = [
    'codebase',
    'mr',
    'create',
    '--json',
    '--title',
    title,
    ...(body === '' ? [] : ['--body', body]),
    ...(head !== undefined ? ['--head', head] : []),
    ...(options.request.base !== undefined ? ['--base', options.request.base] : []),
    ...(reviewers.length > 0 ? ['--reviewer-ids', reviewers.join(',')] : []),
    ...(options.request.push === true ? ['--push'] : []),
  ]

  const result = await runner(CREATE_MR_COMMAND, args, { cwd })
  if (result.code !== 0) {
    // A CLI refusal (protected branch, no commits, auth) is an actionable
    // answer, surfaced verbatim rather than retried differently.
    return {
      status: 'refused',
      repositoryRoot: cwd,
      ...(head !== undefined ? { head } : {}),
      ...(options.request.base !== undefined ? { base: options.request.base } : {}),
      reason: (result.stderr.trim() || result.stdout.trim()).slice(0, 600),
    }
  }

  const stdout = requireSuccess('bytedcli codebase mr create', result)
  return {
    status: 'created',
    repositoryRoot: cwd,
    ...(head !== undefined ? { head } : {}),
    ...(options.request.base !== undefined ? { base: options.request.base } : {}),
    ...(extractMrUrl(stdout) !== undefined ? { url: extractMrUrl(stdout)! } : {}),
  }
}
