/**
 * Source capture: browser handoff, Host validation and provider enrichment.
 *
 * The browser's active session is local UI state that the Host cannot observe
 * or reconstruct later, so it MUST be captured at the moment the user
 * confirms an Invocation. Everything after that point resolves the persisted
 * snapshot — never the browser's live `current` value.
 */

import { randomUUID } from 'node:crypto'
import { PetError } from './errors.js'
import type { PetRepository } from './repository.js'
import {
  scopeKeyOf,
  type PetInvocationCapture,
  type PetScmFacts,
  type PetSourceSnapshot,
  type PetWorktreeFacts,
} from '../wire.js'

/** Durable session facts the Host can prove, independent of the browser. */
export interface HostSessionFacts {
  readonly id: string
  readonly title?: string
  readonly cwd?: string
  /** Durable event position, anchoring the snapshot in the session log. */
  readonly asOfSeq?: number
}

/** Durable workspace facts the Host can prove. */
export interface HostWorkspaceFacts {
  readonly id: string
  readonly title?: string
  readonly path?: string
}

/** Host-side view used to validate a browser capture. */
export interface SourceResolver {
  getSession(sessionId: string): HostSessionFacts | undefined
  getWorkspace(workspaceId: string): HostWorkspaceFacts | undefined
}

/**
 * A bounded provider contributing optional structured facts to a snapshot.
 *
 * Providers are additive and failure-isolated in one direction only: a
 * provider that ERRORS surfaces its diagnostic rather than being silently
 * dropped, because silently omitting worktree facts would let Pet treat a
 * repository root as a managed execution root.
 */
export interface SourceContextProvider {
  readonly name: string
  enrich(base: {
    readonly session?: HostSessionFacts
    readonly workspace?: HostWorkspaceFacts
  }): Promise<{ worktree?: PetWorktreeFacts; scm?: PetScmFacts } | undefined>
}

/** Bounded registry of source context providers. */
export class SourceContextRegistry {
  private readonly providers: SourceContextProvider[] = []

  /**
   * Register a provider.
   * @param provider - The provider to add.
   * @returns a disposer removing it.
   */
  register(provider: SourceContextProvider): () => void {
    this.providers.push(provider)
    return () => {
      const index = this.providers.indexOf(provider)
      if (index >= 0) this.providers.splice(index, 1)
    }
  }

  /** Registered provider names, for diagnostics. */
  get names(): readonly string[] {
    return this.providers.map(provider => provider.name)
  }

  /**
   * Run every provider over the resolved base facts.
   * @param base - Proven session/workspace facts.
   * @returns merged optional facts.
   * @throws PetError when a provider fails, rather than inferring defaults.
   */
  async enrich(base: {
    readonly session?: HostSessionFacts
    readonly workspace?: HostWorkspaceFacts
  }): Promise<{ worktree?: PetWorktreeFacts; scm?: PetScmFacts }> {
    let merged: { worktree?: PetWorktreeFacts; scm?: PetScmFacts } = {}
    for (const provider of this.providers) {
      let contribution: Awaited<ReturnType<SourceContextProvider['enrich']>>
      try {
        contribution = await provider.enrich(base)
      } catch (error) {
        throw new PetError(
          'SOURCE_NOT_FOUND',
          `Source context provider '${provider.name}' failed: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        )
      }
      if (contribution === undefined) continue
      merged = {
        ...merged,
        ...(contribution.worktree !== undefined ? { worktree: contribution.worktree } : {}),
        ...(contribution.scm !== undefined ? { scm: contribution.scm } : {}),
      }
    }
    return merged
  }
}

/** A validated capture ready to become a Task/Invocation. */
export interface ValidatedCapture {
  readonly scopeKey: ReturnType<typeof scopeKeyOf>
  readonly snapshot: PetSourceSnapshot
  readonly sourceTitle?: string
}

/**
 * Validate a browser capture and build the immutable snapshot.
 *
 * Validates that the NAMED source actually exists — it does not judge whether
 * that source is sufficient for the capability. Pet applies no per-capability
 * context gate: a Skill decides at execution time whether its snapshot gives
 * it what it needs and stops to ask when it does not. Gating here would
 * require Pet to understand every Skill's prerequisites, which is exactly the
 * Skill-adapts-to-Pet coupling this design removes.
 * @param capture - The browser's atomic capture.
 * @param resolver - Host-side source view.
 * @param registry - Source context providers.
 * @returns the validated capture.
 * @throws PetError when the named source is missing or unknown.
 */
export async function validateCapture(
  capture: PetInvocationCapture,
  resolver: SourceResolver,
  registry: SourceContextRegistry,
): Promise<ValidatedCapture> {
  let session: HostSessionFacts | undefined
  let workspace: HostWorkspaceFacts | undefined

  if (capture.sourceKind === 'session') {
    if (capture.sourceSessionId === undefined) {
      throw new PetError('INVALID_REQUEST', 'A session source requires sourceSessionId')
    }
    session = resolver.getSession(capture.sourceSessionId)
    if (session === undefined) {
      throw new PetError(
        'SOURCE_NOT_FOUND',
        `Source session ${capture.sourceSessionId} is not known to this Host`,
      )
    }
    if (capture.sourceWorkspaceId !== undefined) {
      workspace = resolver.getWorkspace(capture.sourceWorkspaceId)
    }
  } else if (capture.sourceKind === 'workspace') {
    if (capture.sourceWorkspaceId === undefined) {
      throw new PetError('INVALID_REQUEST', 'A workspace source requires sourceWorkspaceId')
    }
    workspace = resolver.getWorkspace(capture.sourceWorkspaceId)
    if (workspace === undefined) {
      throw new PetError(
        'SOURCE_NOT_FOUND',
        `Source workspace ${capture.sourceWorkspaceId} is not known to this Host`,
      )
    }
  }

  const enrichment = await registry.enrich({
    ...(session !== undefined ? { session } : {}),
    ...(workspace !== undefined ? { workspace } : {}),
  })

  const snapshot: PetSourceSnapshot = {
    id: `snap-${randomUUID()}`,
    // Bound to the Invocation by the coordinator, which owns id allocation.
    invocationId: capture.clientInvocationId,
    sourceKind: capture.sourceKind,
    ...(session !== undefined ? { sourceSessionId: session.id } : {}),
    ...(workspace !== undefined ? { sourceWorkspaceId: workspace.id } : {}),
    // Host-proven titles win over browser-supplied display strings.
    ...(session?.title !== undefined ? { sessionTitle: session.title } : {}),
    ...(workspace?.title !== undefined ? { workspaceTitle: workspace.title } : {}),
    ...(session?.cwd !== undefined ? { cwd: session.cwd } : {}),
    ...(session?.asOfSeq !== undefined ? { asOfSeq: session.asOfSeq } : {}),
    ...(enrichment.worktree !== undefined ? { worktree: enrichment.worktree } : {}),
    ...(enrichment.scm !== undefined ? { scm: enrichment.scm } : {}),
    capturedAt: Date.now(),
  }

  const scopeKey =
    capture.sourceKind === 'session'
      ? scopeKeyOf('session', session?.id)
      : capture.sourceKind === 'workspace'
        ? scopeKeyOf('workspace', workspace?.id)
        : scopeKeyOf('none')

  const sourceTitle = session?.title ?? workspace?.title
  return {
    scopeKey,
    snapshot,
    ...(sourceTitle !== undefined ? { sourceTitle } : {}),
  }
}

/** The trusted context returned to a Pet executor Agent. */
export interface TrustedContext {
  readonly taskId: string
  readonly invocationId: string
  readonly capabilityId: string
  readonly snapshot: PetSourceSnapshot
}

/**
 * Resolve trusted context from the EXACT executing session id.
 *
 * The model supplies no selector at all, so target substitution is
 * structurally impossible. Every failure mode fails closed rather than
 * exposing another Task's context.
 * @param repository - Pet repository.
 * @param executorSessionId - The real executing session id from `exec.agent`.
 * @returns the trusted context.
 * @throws PetError for non-Pet sessions, archived Tasks and missing work.
 */
export function resolveTrustedContext(
  repository: PetRepository,
  executorSessionId: string,
): TrustedContext {
  const task = repository.findTaskByExecutor(executorSessionId)
  if (task === undefined) {
    throw new PetError(
      'NOT_A_PET_SESSION',
      'This session is not bound to a Pet Task, so no Pet context is available.',
    )
  }
  if (task.archivedAt !== undefined) {
    throw new PetError(
      'TASK_ARCHIVED',
      `Pet Task ${task.id} is archived; its previous snapshot is not a new authorization.`,
    )
  }
  const invocation = repository.findCurrentInvocation(task.id)
  if (invocation === undefined) {
    throw new PetError(
      'NO_CURRENT_INVOCATION',
      `Pet Task ${task.id} has no running or waiting Invocation right now.`,
    )
  }
  const snapshot = repository.getSnapshot(invocation.snapshotId)
  if (snapshot === undefined) {
    throw new PetError(
      'INTERNAL',
      `Pet Invocation ${invocation.id} references missing snapshot ${invocation.snapshotId}`,
    )
  }
  return {
    taskId: task.id,
    invocationId: invocation.id,
    capabilityId: invocation.capabilityId,
    snapshot,
  }
}
