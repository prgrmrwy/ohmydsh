/**
 * The `pet_context` tool: a zero-argument, executor-bound trusted context read.
 *
 * The schema accepts NO arguments by design. Resolution starts from the real
 * `exec.agent.session.id` set by the agent loop, so the model cannot name a
 * different Task, session or workspace. Prompt text is never an authorization
 * boundary; this tool is.
 */

import { PetError } from './errors.js'
import { resolveTrustedContext } from './capture.js'
import { isSafeLocusReplyTarget } from './locus/context.js'
import type {
  LocusContextRecord,
  LocusContextRepository,
  LocusCurrentDelivery,
} from './locus/context-repository.js'
import type { PetRepository } from './repository.js'
import { isForkChildTaskForm } from '../wire.js'

/** Tool name registered in the Pet executor composition. */
export const PET_CONTEXT_TOOL = 'pet_context'

/** The ordinary Pet Task/Invocation payload returned by a successful lookup. */
export interface PetInvocationContextResult {
  readonly scope: 'invocation'
  readonly taskId: string
  readonly invocationId: string
  readonly capabilityId: string
  readonly source: {
    readonly kind: string
    readonly sessionId?: string
    readonly workspaceId?: string
    readonly sessionTitle?: string
    readonly workspaceTitle?: string
    /**
     * The SOURCE session's repository root. This executor does not run there:
     * its own cwd is the Pet workspace, which is not a Git checkout.
     */
    readonly repositoryRoot?: string
    /**
     * The SOURCE session's managed execution root, present only when that
     * session has a worktree binding. It is never this executor's working
     * directory — reading it as such has in practice led an agent to refuse
     * work on the belief that it was standing inside that worktree.
     */
    readonly executionRoot?: string
    readonly branch?: string
    readonly dependencyMode?: string
    readonly capturedAt: string
    readonly asOfSeq?: number
  }
}

/** Caller-bound context returned for a valid unified-locus child. */
export interface PetLocusContextResult {
  readonly scope: 'locus'
  readonly endpoint: LocusContextRecord['endpoint']
  readonly locus: LocusContextRecord['locus']
  readonly main: LocusContextRecord['main']
  readonly child: LocusContextRecord['child']
  readonly workspace: LocusContextRecord['workspace']
  readonly permission: LocusContextRecord['permission']
  readonly contextAnchor: LocusContextRecord['contextAnchor']
  /** Omitted when this turn has no accepted Feishu Delivery (for example GUI). */
  readonly currentDelivery?: LocusCurrentDelivery
}

/** Model-facing payload for either ordinary Pet or unified-locus callers. */
export type PetContextResult = PetInvocationContextResult | PetLocusContextResult

/** Optional integration seam for the not-yet-durable locus repository. */
export interface PetContextDependencies {
  readonly locusRepository?: LocusContextRepository
}

/** Minimal execution view Pet reads; mirrors `ToolExecution`. */
export interface ToolExecutionLike {
  readonly agent?: { readonly session: { readonly id: string } }
}

/**
 * Execute a `pet_context` lookup for one tool call.
 * @param repository - Pet repository.
 * @param exec - The tool execution, carrying the loop-set agent.
 * @returns the trusted context payload.
 * @throws PetError when the caller is not a Pet executor with current work.
 */
/**
 * The two-argument overload retains the ordinary Pet return type for existing
 * callers.  Supplying the optional locus dependency enables the child-session
 * branch; the returned discriminant is `scope` and no Invocation is invented.
 */
export function executePetContext(
  repository: PetRepository,
  exec: ToolExecutionLike,
): PetInvocationContextResult
export function executePetContext(
  repository: PetRepository,
  exec: ToolExecutionLike,
  deps: PetContextDependencies,
): PetContextResult
export function executePetContext(
  repository: PetRepository,
  exec: ToolExecutionLike,
  deps: PetContextDependencies = {},
): PetContextResult {
  const sessionId = exec.agent?.session.id
  if (sessionId === undefined) {
    throw new PetError(
      'NOT_A_PET_SESSION',
      'pet_context must be called from a Pet executor Agent session.',
    )
  }

  if (deps.locusRepository !== undefined) {
    const locus = resolveCallerLocus(deps.locusRepository, sessionId)
    if (locus !== undefined) return locus

    // A session explicitly known as an old QA child is not an ordinary Pet
    // root.  It has no Invocation by design, so do not fall through to the
    // legacy Task resolver and accidentally treat retained history as current
    // authorization.  A missing locus row for an otherwise unknown session is
    // still allowed to fall through so ordinary Pet behavior is preserved.
    const legacyTask = repository.findTaskByExecutor(sessionId)
    if (legacyTask !== undefined && isForkChildTaskForm(legacyTask.sourceKind)) {
      throw new PetError(
        'NOT_A_PET_SESSION',
        `Child session ${sessionId} has no active unified locus association; refusing legacy context lookup.`,
      )
    }
  }

  const context = resolveTrustedContext(repository, sessionId)
  const snapshot = context.snapshot
  return {
    scope: 'invocation',
    taskId: context.taskId,
    invocationId: context.invocationId,
    capabilityId: context.capabilityId,
    source: {
      kind: snapshot.sourceKind,
      ...(snapshot.sourceSessionId !== undefined ? { sessionId: snapshot.sourceSessionId } : {}),
      ...(snapshot.sourceWorkspaceId !== undefined
        ? { workspaceId: snapshot.sourceWorkspaceId }
        : {}),
      ...(snapshot.sessionTitle !== undefined ? { sessionTitle: snapshot.sessionTitle } : {}),
      ...(snapshot.workspaceTitle !== undefined ? { workspaceTitle: snapshot.workspaceTitle } : {}),
      ...(snapshot.cwd !== undefined ? { repositoryRoot: snapshot.cwd } : {}),
      ...(snapshot.worktree !== undefined
        ? {
            executionRoot: snapshot.worktree.executionRoot,
            ...(snapshot.worktree.branch !== undefined ? { branch: snapshot.worktree.branch } : {}),
            ...(snapshot.worktree.dependencyMode !== undefined
              ? { dependencyMode: snapshot.worktree.dependencyMode }
              : {}),
          }
        : {}),
      capturedAt: new Date(snapshot.capturedAt).toISOString(),
      ...(snapshot.asOfSeq !== undefined ? { asOfSeq: snapshot.asOfSeq } : {}),
    },
  }
}

/**
 * Resolve a caller's locus identity without ever accepting a model selector.
 * An empty reverse lookup means this is not a locus child, so ordinary Pet
 * Task/Invocation resolution remains unchanged. Any non-empty lookup must
 * prove exactly one current, non-legacy active locus before returning data.
 */
function resolveCallerLocus(
  repository: LocusContextRepository,
  childSessionId: string,
): PetLocusContextResult | undefined {
  let matches: readonly LocusContextRecord[]
  try {
    matches = repository.findByChildSessionId(childSessionId)
  } catch (error) {
    throw new PetError(
      'INTERNAL',
      `Unable to resolve locus context for child ${childSessionId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  if (!Array.isArray(matches)) {
    throw new PetError(
      'INTERNAL',
      `Locus reverse lookup for child ${childSessionId} returned an invalid result.`,
    )
  }
  if (matches.length === 0) return undefined
  if (matches.length !== 1) {
    throw new PetError(
      'NOT_A_PET_SESSION',
      `Child session ${childSessionId} has an ambiguous locus association; refusing context lookup.`,
    )
  }

  const match = matches[0]
  if (match === undefined) return undefined
  if (match.legacy === true || match.source === 'legacy') {
    throw new PetError(
      'NOT_A_PET_SESSION',
      `Child session ${childSessionId} belongs to a legacy locus association; refusing context lookup.`,
    )
  }
  if (match.locus.state !== 'active') {
    const state = match.locus.state ?? 'unknown'
    // Preserve the durable stop marker at the tool boundary. A stopped locus
    // requires explicit rebuild; it is not the same diagnosis as an invalid,
    // retired, legacy, or otherwise unproven child identity.
    const code = state === 'stopped' ? 'LOCUS_STOPPED' : 'LOCUS_INVALID'
    const reason = match.invalidReason === undefined ? '' : ` (${match.invalidReason})`
    throw new PetError(
      code,
      `Child session ${childSessionId} is associated with a ${state} locus${reason}; refusing context lookup.`,
    )
  }
  // Context discovery is not execution authorization. An otherwise valid
  // child must be able to discover that its anchor is missing/unknown and ask
  // its parent for confirmation. Preserve negative existence/authorization
  // facts; dispatch and policy adapters must independently gate execution.
  if (
    !['confirmed', 'missing', 'unknown'].includes(match.contextAnchor.status) ||
    (match.contextAnchor.existence !== undefined &&
      !['exists', 'missing', 'unknown'].includes(match.contextAnchor.existence)) ||
    (match.contextAnchor.authorization !== undefined &&
      !['authorized', 'unauthorized', 'unknown'].includes(match.contextAnchor.authorization))
  ) {
    throw new PetError('NOT_A_PET_SESSION', 'Invalid execution anchor facts; refusing context lookup.')
  }
  if (match.child.sessionId !== childSessionId) {
    throw new PetError(
      'NOT_A_PET_SESSION',
      `Locus reverse lookup for child ${childSessionId} returned a different child identity.`,
    )
  }
  validateLocusContextRecord(match, childSessionId)

  return {
    scope: 'locus',
    endpoint: { ...match.endpoint },
    locus: { ...match.locus },
    main: { ...match.main },
    child: { ...match.child },
    workspace: { ...match.workspace },
    permission: { ...match.permission },
    contextAnchor: {
      ...match.contextAnchor,
      ...(match.contextAnchor.projectResources !== undefined
        ? { projectResources: [...match.contextAnchor.projectResources] }
        : {}),
      ...(match.contextAnchor.constraints !== undefined
        ? { constraints: [...match.contextAnchor.constraints] }
        : {}),
    },
    ...(match.currentDelivery !== undefined
      ? { currentDelivery: cloneCurrentDelivery(match.currentDelivery) }
      : {}),
  }
}

function validateLocusContextRecord(
  match: LocusContextRecord,
  childSessionId: string,
): void {
  if (match.endpoint.chatId.trim() === '') {
    throw new PetError('NOT_A_PET_SESSION', `Locus for child ${childSessionId} has no valid endpoint.`)
  }
  if (match.main.sessionId.trim() === '' || match.workspace.workspaceId.trim() === '') {
    throw new PetError(
      'NOT_A_PET_SESSION',
      `Locus for child ${childSessionId} is missing its main session or workspace identity.`,
    )
  }
  if (match.permission.effective !== 'read' && match.permission.effective !== 'write') {
    throw new PetError(
      'NOT_A_PET_SESSION',
      `Locus for child ${childSessionId} has an unverified permission mode.`,
    )
  }

  const delivery = match.currentDelivery
  if (delivery === undefined) return
  if (
    delivery.childSessionId !== childSessionId ||
    delivery.locusId !== match.locus.locusId ||
    delivery.generation !== match.locus.generation ||
    delivery.endpoint.chatId !== match.endpoint.chatId ||
    (delivery.endpoint.threadId ?? undefined) !== (match.endpoint.threadId ?? undefined)
  ) {
    throw new PetError(
      'NOT_A_PET_SESSION',
      `Current Delivery for child ${childSessionId} does not match its active locus generation.`,
    )
  }
  if (delivery.replyTarget !== undefined && !isSafeLocusReplyTarget(match.endpoint, delivery.replyTarget)) {
    throw new PetError(
      'NOT_A_PET_SESSION',
      `Current Delivery for child ${childSessionId} has an unsafe reply target.`,
    )
  }
}

function cloneCurrentDelivery(delivery: LocusCurrentDelivery): LocusCurrentDelivery {
  return {
    ...delivery,
    endpoint: { ...delivery.endpoint },
    ...(delivery.replyTarget !== undefined ? { replyTarget: { ...delivery.replyTarget } } : {}),
  }
}

// The registered tool definition lives in `host/tools.ts`, built through
// `defineTool` so its schemas are checked at compile time. An unused duplicate
// used to sit here carrying a RAW JSON Schema `parameters` object — the exact
// shape `defineTool` rejects with `parameters.type must be a value schema
// object` — which made a known-broken example the first thing a reader found.
