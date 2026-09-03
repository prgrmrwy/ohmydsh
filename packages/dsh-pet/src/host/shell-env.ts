/**
 * Pet's contribution to the trusted `DSH_*` shell environment.
 *
 * Configured values reach a Skill as ORDINARY ENVIRONMENT VARIABLES, through
 * DSH's own `ctx.shellEnv` registry. That choice is what keeps Pet from
 * inventing a template syntax: a Skill writes `$DSH_PET_CR_GROUP` exactly as
 * it would write any other variable, and the value never passes through the
 * prompt, the envelope or any model-visible text.
 *
 * Which values apply is resolved from the CALLING executor session, the same
 * way `pet_context` resolves its snapshot. The model supplies no selector and
 * therefore cannot reach another workspace's configuration.
 */

import type { PetRepository } from './repository.js'
import { PET_ENV_GLOBAL_SCOPE } from './spec.js'

/**
 * Prefix applied to every configured key.
 *
 * `DSH_` is mandatory: DSH's `DshEnvironmentKey` contract rejects anything
 * else. The extra `PET_` segment keeps Pet's namespace clear of the harness
 * built-ins (`DSH_HOME`, `DSH_SHELL`, `DSH_SESSION_ID`, `DSH_SESSION_JSONL`)
 * and of other plugins' contributions, so ownership can never collide.
 */
export const PET_ENV_PREFIX = 'DSH_PET_'

/** Contributor name registered in `ctx.shellEnv`. */
export const PET_ENV_CONTRIBUTOR = 'dsh-pet-workspace-env'

/** The execution view this contributor reads; mirrors `ToolExecution`. */
export interface ShellEnvExecutionLike {
  readonly agent?: { readonly session: { readonly header: { readonly id: string } } }
}

/** One declared variable, as `ctx.shellEnv` expects it. */
interface DeclaredVariable {
  description: string
}

/** The contributor object handed to `ctx.shellEnv.register`. */
export interface PetEnvContributor {
  readonly name: string
  readonly variables: Record<string, DeclaredVariable>
  resolve(execution: ShellEnvExecutionLike): Readonly<Record<string, string>>
}

/**
 * Build Pet's shell-env contributor.
 *
 * `variables` is deliberately a MUTABLE object that `resolve` refreshes before
 * returning. The registry validates every returned key against this same
 * object on each collection and throws on an undeclared one — which would
 * abort the user's shell call — so a fixed declaration could never support
 * keys the user adds at runtime. Refreshing it inside `resolve` makes the two
 * inseparable: whatever is about to be returned has just been declared.
 *
 * Scope collisions are not a concern here: every key carries the
 * `DSH_PET_` prefix, a namespace this contributor alone owns.
 * @param repository - Pet repository holding the configured entries.
 * @returns the contributor to register.
 */
export function createPetEnvContributor(repository: PetRepository): PetEnvContributor {
  const variables: Record<string, DeclaredVariable> = {}

  return {
    name: PET_ENV_CONTRIBUTOR,
    variables,
    resolve(execution: ShellEnvExecutionLike): Readonly<Record<string, string>> {
      const sessionId = execution.agent?.session.header.id
      // A non-Pet session contributes nothing. Returning empty rather than
      // throwing matters: this runs for EVERY shell call in the Host,
      // including ordinary sessions that have nothing to do with Pet.
      if (sessionId === undefined) return {}

      const task = repository.findTaskByExecutor(sessionId)
      if (task === undefined) return {}

      // Resolve through the current Invocation's immutable snapshot, exactly
      // as `pet_context` does, so the environment and the trusted context can
      // never disagree about which workspace this work belongs to.
      const invocation = repository.findCurrentInvocation(task.id)
      if (invocation === undefined) return {}
      const snapshot = repository.getSnapshot(invocation.snapshotId)

      // Global entries apply everywhere, including an independent Task with
      // no workspace at all; a workspace entry overrides a same-named global
      // one. Merging lives in the repository so there is exactly one place
      // that decides precedence.
      const effective = repository.resolveEnvFor(snapshot?.sourceWorkspaceId)

      const values: Record<string, string> = {}
      // Rebuild the declaration from scratch so a key the user deleted stops
      // being advertised by `list()` instead of lingering as a phantom.
      for (const key of Object.keys(variables)) delete variables[key]
      for (const [key, value] of Object.entries(effective)) {
        const prefixed = `${PET_ENV_PREFIX}${key}`
        variables[prefixed] = {
          description:
            `Pet workspace environment value for ${key}` +
            (snapshot?.sourceWorkspaceId === undefined
              ? ' (global).'
              : ` (workspace ${snapshot.sourceWorkspaceId}, global overridden when set).`),
        }
        values[prefixed] = value
      }
      return values
    },
  }
}

/** Re-exported so callers need not reach into the spec module. */
export { PET_ENV_GLOBAL_SCOPE }
