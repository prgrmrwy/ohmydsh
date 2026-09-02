/**
 * Archive reconciliation between Pet Tasks and DSH sessions.
 *
 * Three separate relationships, each with different rules:
 *
 * - a SOURCE session being archived only updates display availability;
 * - a TERMINAL executor session being archived archives its Task;
 * - a TERMINAL Task archived from Pet archives its executor session.
 *
 * A running or waiting executor archived externally must NEVER be read as a
 * cancellation: DSH exposes archive but no unarchive, so inferring intent
 * here would silently destroy in-flight work. Pet keeps such a Task visible
 * and diagnosable instead.
 */

import type { Context } from '@deepseek-ai/cordis'
import { workspaceDomainState } from '@deepseek-ai/dsh-workspace'
import { PetError } from './errors.js'
import type { PetRepository } from './repository.js'
import { TERMINAL_TASK_STATUSES, type PetTaskRecord } from '../wire.js'

/** Archives an executor session in DSH. */
export interface ArchiveSink {
  archiveSession(sessionId: string): Promise<void>
}

/** One reconciliation decision, for diagnostics and tests. */
export interface ArchiveOutcome {
  readonly taskId: string
  readonly action:
    | 'source-archived'
    | 'task-archived'
    | 'executor-archived'
    | 'kept-active'
    | 'noop'
  readonly diagnostic?: string
}

/**
 * Reconcile Pet against the durable archived-session set.
 *
 * Idempotent and revision-guarded so repeated startup runs and live events
 * cannot ping-pong between the two systems.
 * @param repository - Pet repository.
 * @param archivedSessionIds - The durable archived session id set.
 * @returns one outcome per affected Task.
 */
export async function reconcileArchives(
  repository: PetRepository,
  archivedSessionIds: ReadonlySet<string>,
): Promise<readonly ArchiveOutcome[]> {
  const outcomes: ArchiveOutcome[] = []

  for (const task of repository.listTasks()) {
    // --- source side: display only, never archives the Task ---------------
    if (task.sourceId !== undefined && archivedSessionIds.has(task.sourceId)) {
      if (task.sourceAvailability !== 'archived') {
        await repository.updateTask(task.id, undefined, current => ({
          ...current,
          sourceAvailability: 'archived',
        }))
        outcomes.push({ taskId: task.id, action: 'source-archived' })
      }
    }

    if (task.archivedAt !== undefined) continue

    // --- executor side ----------------------------------------------------
    if (!archivedSessionIds.has(task.executorSessionId)) continue

    if (TERMINAL_TASK_STATUSES.includes(task.status)) {
      await repository.archiveTask(task.id)
      outcomes.push({ taskId: task.id, action: 'task-archived' })
      continue
    }

    // Non-terminal: keep the Task active and visible. Archiving the executor
    // externally is not proof the work was cancelled.
    const diagnostic =
      `Executor session ${task.executorSessionId} was archived while this Task was ` +
      `${task.status}. The Task remains active; cancel it explicitly or recover the ` +
      'session natively. DSH provides no unarchive operation.'
    if (task.diagnostic !== diagnostic) {
      await repository.setTaskStatus(task.id, task.status, diagnostic)
    }
    outcomes.push({ taskId: task.id, action: 'kept-active', diagnostic })
  }

  return outcomes
}

/**
 * Archive a Task from the Pet panel and sync its executor session.
 *
 * Refuses a non-terminal Task: the caller must cancel and let the
 * cancellation settle first, so archival never silently drops running work.
 * @param repository - Pet repository.
 * @param sink - Session archive sink.
 * @param taskId - Task to archive.
 * @param expectedRevision - Optional revision fence.
 * @returns the archived Task.
 * @throws PetError when the Task is not terminal.
 */
export async function archiveTaskFromPet(
  repository: PetRepository,
  sink: ArchiveSink,
  taskId: string,
  expectedRevision?: number,
): Promise<PetTaskRecord> {
  const task = repository.getTask(taskId)
  if (task === undefined) {
    throw new PetError('TASK_NOT_FOUND', `Pet Task ${taskId} does not exist`)
  }
  if (task.archivedAt !== undefined) return task
  if (!TERMINAL_TASK_STATUSES.includes(task.status)) {
    throw new PetError(
      'ARCHIVE_BLOCKED',
      `Pet Task ${taskId} is ${task.status}. Cancel the current work and let it settle before archiving.`,
    )
  }

  // Pet's record first, then the session: a failure to archive the session
  // leaves a diagnosable mismatch rather than an archived session whose Task
  // still accepts work.
  const archived = await repository.archiveTask(taskId, expectedRevision)
  try {
    await sink.archiveSession(task.executorSessionId)
  } catch (error) {
    await repository.setTaskStatus(
      taskId,
      archived.status,
      `Task archived, but archiving executor session ${task.executorSessionId} failed: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return repository.getTask(taskId) ?? archived
}

/**
 * Observe durable archive changes live, not only at startup.
 *
 * Seeds from the current registry snapshot, then diffs the archived set on
 * every durable workspace-global write. Reconciliation is serialized on a
 * tail promise so overlapping events cannot interleave, and a failure is
 * logged rather than allowed to break the observer.
 * @param ctx - Plugin context providing the workspace registry and events.
 * @param repository - Pet repository.
 * @param sink - Session archive sink used for terminal Task sync.
 * @returns a disposer removing the observer.
 */
export function registerArchiveObserver(
  ctx: Context,
  repository: PetRepository,
  sink: ArchiveSink,
): () => void {
  void sink
  let previous = new Set(ctx.workspaceRegistry.archivedSessionIds.map(String))
  let tail = Promise.resolve()

  const enqueue = (archived: ReadonlySet<string>): void => {
    tail = tail
      .then(async () => {
        await reconcileArchives(repository, archived)
      })
      .catch((error: unknown) => {
        ctx.logger.warn(
          `dsh-pet archive observer failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
  }

  return ctx.on('domain/changed', change => {
    // Only the workspace domain's global row carries the archived set.
    if (
      change.domain !== 'workspace' ||
      change.table !== '' ||
      change.key !== '' ||
      change.operation !== 'put'
    ) {
      return
    }
    const state = workspaceDomainState.parse(change.value)
    const next = new Set(state.archivedSessionIds.map(String))
    let differs = next.size !== previous.size
    if (!differs) {
      for (const id of next) {
        if (!previous.has(id)) {
          differs = true
          break
        }
      }
    }
    previous = next
    if (differs) enqueue(next)
  })
}
