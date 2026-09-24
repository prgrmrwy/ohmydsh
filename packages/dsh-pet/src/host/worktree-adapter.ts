/**
 * Optional Worktree Session context adapter.
 *
 * The installed Worktree Session keeps `Session.header.cwd` at the REPOSITORY
 * ROOT while the managed execution root lives in its binding state. Pet must
 * therefore resolve worktree facts through that contract and must never infer
 * a managed execution root from `cwd` — doing so would silently point
 * capabilities at the main checkout instead of the isolated worktree.
 *
 * The adapter is optional: when Worktree Session is not installed, snapshots
 * simply carry no managed-worktree fields. A provider ERROR, by contrast, is
 * surfaced rather than swallowed.
 */

import type { HostSessionFacts, HostWorkspaceFacts, SourceContextProvider } from './capture.js'
import type { PetWorktreeFacts } from '../wire.js'

/** The Worktree Session status shape Pet consumes. */
export interface WorktreeStatusLike {
  readonly bound: boolean
  readonly worktreePath?: string
  readonly taskBranch?: string
  readonly dependencyMode?: string
  readonly lifecycle?: string
}

/** The installed Worktree Session contract Pet depends on, narrowed. */
export interface WorktreeContract {
  /**
   * Resolve the binding for one source session.
   * @param sessionId - Source session id.
   * @returns the binding status, or `undefined` when the session is unbound.
   */
  sessionStatus(sessionId: string): Promise<WorktreeStatusLike | undefined>
}

/**
 * Build the optional Worktree Session source-context provider.
 * @param contract - The installed Worktree Session contract.
 * @returns a source context provider.
 */
export function createWorktreeProvider(contract: WorktreeContract): SourceContextProvider {
  return {
    name: 'worktree-session',
    enrich: async (base: {
      readonly session?: HostSessionFacts
      readonly workspace?: HostWorkspaceFacts
    }): Promise<{ worktree?: PetWorktreeFacts } | undefined> => {
      const session = base.session
      if (session === undefined) return undefined

      // A throw here propagates: the caller turns it into a diagnostic rather
      // than treating an unknown worktree state as "no worktree".
      const status = await contract.sessionStatus(session.id)
      if (status === undefined || !status.bound) return undefined
      if (status.worktreePath === undefined) {
        // Bound but without a managed execution root: report nothing rather
        // than falling back to the repository root in `cwd`.
        return undefined
      }

      return {
        worktree: {
          executionRoot: status.worktreePath,
          ...(status.taskBranch !== undefined ? { branch: status.taskBranch } : {}),
          ...(status.dependencyMode !== undefined
            ? { dependencyMode: status.dependencyMode }
            : {}),
          ...(status.lifecycle !== undefined ? { lifecycle: status.lifecycle } : {}),
        },
      }
    },
  }
}
