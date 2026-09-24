/**
 * Caller-bound collaborator roster.
 *
 * A member LIST, not a folder and not the owner management view. It carries no
 * endpoint, workspace, permission, anchor or history data, so being listed
 * never implies access to a member's work. Membership is derived from the
 * ACTUAL executing session and the durable Locus indexes; a reference returned
 * here is not authorization, and dispatch must resolve membership again.
 */
import {
  CollaborationUnavailableError, readForCollaborationCaller,
  type CollaborationCallerPorts,
} from './caller.js'

/** Whether a member can be addressed now, without claiming an unproven state. */
export type CollaboratorReachability =
  /** Durable and currently resolvable. */
  | 'available'
  /** Durable and valid, but not loaded; addressing it requires a restore. */
  | 'needs-restore'
  /** Could not be proven either way; callers MUST NOT read this as reachable. */
  | 'unknown'

export interface CollaboratorMember {
  readonly sessionId: string
  /** Present for Locus children; a main session has no locus of its own. */
  readonly locusId?: string
  readonly generation?: number
  readonly relation: 'parent' | 'child' | 'sibling'
  /** Traceable metadata only; never a model-generated summary of history. */
  readonly title?: string
  readonly reachability: CollaboratorReachability
}

export interface CollaboratorRoster {
  readonly self:
    | { readonly sessionId: string; readonly relation: 'self-parent' }
    | { readonly sessionId: string; readonly locusId: string; readonly generation: number; readonly relation: 'self-child' }
  readonly members: readonly CollaboratorMember[]
}

/** Durable, cheap description. It MUST NOT read or summarize session history. */
export interface CollaboratorDescription {
  readonly title?: string
  readonly availability?: 'available' | 'archived' | 'missing' | 'unloaded'
}

export interface CollaboratorRosterDependencies {
  readonly ports: CollaborationCallerPorts
  readonly describe: (sessionId: string) => CollaboratorDescription | undefined
}

/**
 * Map durable availability onto addressability.
 *
 * A failure or an unrecognized value becomes `unknown` rather than `available`:
 * claiming a member is reachable is the answer that causes a wasted dispatch.
 */
function reachabilityOf(
  sessionId: string,
  describe: CollaboratorRosterDependencies['describe'],
): { readonly reachability: CollaboratorReachability; readonly title?: string } {
  let description: CollaboratorDescription | undefined
  try {
    description = describe(sessionId)
  } catch {
    // Never surface the underlying diagnostic: it may carry storage paths.
    return { reachability: 'unknown' }
  }
  const title = typeof description?.title === 'string' && description.title.length > 0
    ? description.title
    : undefined
  switch (description?.availability) {
    case 'available': return { reachability: 'available', ...(title === undefined ? {} : { title }) }
    // Durable but not resident: still a real member, it just needs a restore.
    case 'unloaded': return { reachability: 'needs-restore', ...(title === undefined ? {} : { title }) }
    default: return { reachability: 'unknown', ...(title === undefined ? {} : { title }) }
  }
}

/**
 * List the caller's own collaboration scope.
 *
 * Takes no target parameter by contract: the parent is resolved from the
 * executing session, so a model cannot enumerate another scope. An archived or
 * retired member is omitted entirely rather than listed as unreachable.
 */
export async function listCollaborators(
  execution: unknown,
  deps: CollaboratorRosterDependencies,
): Promise<CollaboratorRoster> {
  try {
    const sessionId = (execution as { agent?: { id?: unknown } } | undefined)?.agent?.id
    if (typeof sessionId !== 'string') throw new CollaborationUnavailableError()
    return await readForCollaborationCaller(sessionId, deps.ports, caller => {
      const members: CollaboratorMember[] = []
      if (caller.callerLocus !== undefined) {
        // A child's parent is a member; the resolver already proved it is the
        // fixed durable parent rather than an inferred one.
        members.push({
          sessionId: caller.parentSessionId,
          relation: 'parent',
          ...reachabilityOf(caller.parentSessionId, deps.describe),
        })
      }
      for (const child of caller.children) {
        if (child.sessionId === caller.callerSessionId) continue
        members.push({
          sessionId: child.sessionId,
          locusId: child.locusId,
          generation: child.generation,
          relation: caller.callerLocus === undefined ? 'child' : 'sibling',
          ...reachabilityOf(child.sessionId, deps.describe),
        })
      }
      return Object.freeze({
        self: caller.callerLocus === undefined
          ? Object.freeze({ sessionId: caller.callerSessionId, relation: 'self-parent' as const })
          : Object.freeze({
            sessionId: caller.callerSessionId,
            locusId: caller.callerLocus.locusId,
            generation: caller.callerLocus.generation,
            relation: 'self-child' as const,
          }),
        members: Object.freeze(members.map(member => Object.freeze(member))),
      })
    })
  } catch {
    throw new CollaborationUnavailableError()
  }
}
