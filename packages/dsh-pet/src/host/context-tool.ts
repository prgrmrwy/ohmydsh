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
import type { PetRepository } from './repository.js'

/** Tool name registered in the Pet executor composition. */
export const PET_CONTEXT_TOOL = 'pet_context'

/** The model-facing payload returned by a successful lookup. */
export interface PetContextResult {
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
export function executePetContext(
  repository: PetRepository,
  exec: ToolExecutionLike,
): PetContextResult {
  const sessionId = exec.agent?.session.id
  if (sessionId === undefined) {
    throw new PetError(
      'NOT_A_PET_SESSION',
      'pet_context must be called from a Pet executor Agent session.',
    )
  }

  const context = resolveTrustedContext(repository, sessionId)
  const snapshot = context.snapshot
  return {
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

/** The tool definition registered on the Pet executor's scoped context. */
export const petContextToolDefinition = {
  name: PET_CONTEXT_TOOL,
  description:
    'Return the trusted source context of the Pet Invocation this session is currently ' +
    'executing. Takes no arguments: the target is resolved from the calling session, so it ' +
    'cannot be redirected. Call this at the start of every Invocation.',
  // Zero-argument by contract: there is no selector to substitute.
  parameters: {
    type: 'object' as const,
    properties: {},
    additionalProperties: false as const,
  },
} as const
