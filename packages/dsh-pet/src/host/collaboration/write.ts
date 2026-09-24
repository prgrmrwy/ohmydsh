/**
 * Caller-bound shared-fact updates.
 *
 * Authorization is scope membership derived from the ACTUAL executing session,
 * never a model-supplied parent, author, timestamp or scope. Shared facts grant
 * no capability, so no human confirmation and no Locus read/write level gate
 * this path; an out-of-scope, retired or unresolvable caller is refused.
 */
import {
  CollaborationUnavailableError, readForCollaborationCaller,
  type CollaborationCallerPorts,
} from './caller.js'
import {
  CollaborationContextError, COLLABORATION_CONTEXT_SHARING_SCOPE,
  type AuthoredCollaborationContext, type CollaborationContextAuthorLocus,
} from './context.js'

export interface CollaborationWriteDependencies {
  readonly ports: CollaborationCallerPorts
  readonly store: {
    update(parentSessionId: string, replacement: unknown, verifiedAuthor: unknown): Promise<AuthoredCollaborationContext>
  }
  /** Host clock; a client/model timestamp is never accepted as provenance. */
  readonly now: () => number
}

/**
 * Resolve the caller, derive provenance, then commit through the store's CAS.
 *
 * A revision conflict is surfaced unchanged so the caller rereads the current
 * revision instead of overwriting a peer's update. Every other failure — an
 * unproven caller, invalid input, or a storage fault — collapses to the uniform
 * unavailable error so no storage detail or foreign state leaks to a model.
 */
export async function updateCollaborationContextForCaller(
  execution: unknown,
  replacement: unknown,
  deps: CollaborationWriteDependencies,
): Promise<AuthoredCollaborationContext> {
  let commit: (() => Promise<AuthoredCollaborationContext>) | undefined
  try {
    const sessionId = (execution as { agent?: { id?: unknown } } | undefined)?.agent?.id
    if (typeof sessionId !== 'string') throw new CollaborationUnavailableError()
    // Derive provenance inside the resolver's final fence, then commit outside
    // it: the store performs its own atomic recheck, and holding the fence
    // across that await would prove nothing extra.
    commit = await readForCollaborationCaller(sessionId, deps.ports, caller => {
      const authorLocus: CollaborationContextAuthorLocus = caller.callerLocus === undefined
        ? { kind: 'parent' }
        : { kind: 'child', locusId: caller.callerLocus.locusId, generation: caller.callerLocus.generation }
      const verifiedAuthor = {
        parentSessionId: caller.parentSessionId,
        authoredBy: caller.callerSessionId,
        authoredAt: deps.now(),
        authorLocus,
        sharingScope: COLLABORATION_CONTEXT_SHARING_SCOPE,
      }
      return () => deps.store.update(caller.parentSessionId, replacement, verifiedAuthor)
    })
  } catch {
    throw new CollaborationUnavailableError()
  }
  try {
    return await commit()
  } catch (error) {
    // Concurrency is an expected outcome with an actionable answer: reread.
    if (error instanceof CollaborationContextError && error.code === 'REVISION_CONFLICT') throw error
    throw new CollaborationUnavailableError()
  }
}
