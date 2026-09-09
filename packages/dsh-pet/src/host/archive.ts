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
import {
  TERMINAL_INVOCATION_STATUSES,
  TERMINAL_TASK_STATUSES,
  type PetTaskRecord,
} from '../wire.js'

/** Archives an executor session in DSH. */
export interface ArchiveSink {
  archiveSession(sessionId: string): Promise<void>
}

/**
 * Probe whether a session still exists on disk.
 *
 * `sessionQuery.observeSession` reads PERSISTED state, so it is the only
 * check that separates "unloaded" (DSH unloads idle sessions; resumable)
 * from "deleted" (gone from disk; not resumable). It rejects for a session
 * that no longer exists.
 *
 * `unknown` is a first-class answer, not a fallback: when the probing
 * service is not yet registered there is NO information, and deciding
 * either way would be a guess. The caller keeps the Task active and marks it
 * for a later re-probe rather than destroying live work on a startup
 * ordering quirk.
 * @param sessionId - The session to probe.
 * @returns whether the session exists, or `unknown` when unverifiable.
 */
export type SessionProbe = (sessionId: string) => Promise<boolean | 'unknown'>

/** One reconciliation decision, for diagnostics and tests. */
export interface ArchiveOutcome {
  readonly taskId: string
  readonly action:
    | 'source-archived'
    | 'task-archived'
    | 'executor-archived'
    | 'kept-active'
    | 'probe-unknown'
    | 'noop'
    | 'task-lost'
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
  probe?: SessionProbe,
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
    // Deletion, not only archival, strands a Task. `archivedSessionIds`
    // never contains a session that was DELETED — deletion is what happens to
    // a session that was never archived, or whose archive was later purged —
    // so without this probe such a Task sat in `recovering` forever, its
    // status reporting a work reason while the real cause was that its
    // executor no longer exists. The probe reads PERSISTED state, which is
    // the only thing that separates this from a merely unloaded session.
    //
    // `probe` is optional so existing callers and tests can keep behaving as
    // before; when absent, only the archived set is consulted.
    // Reason needs to be distinguishable later: an archived session is a
    // known, accounted-for loss; a probed-missing one is an unaccounted
    // deletion (the situation the user hit, and the one that needs the
    // "click again" message).
    const wasArchived = archivedSessionIds.has(task.executorSessionId)
    let wasDeleted = false
    // A probe failure is NOT evidence of deletion: it may be a transient
    // service problem, so fall back to "exists" (keep the Task active)
    // rather than destroying it on a flaky probe.
    let probeResult: boolean | 'unknown' | undefined
    if (!wasArchived && probe !== undefined && !TERMINAL_TASK_STATUSES.includes(task.status)) {
      probeResult = await probe(task.executorSessionId).catch(() => 'unknown' as const)
      wasDeleted = probeResult === false
    }
    // `unknown` keeps the Task active AND defers the decision: the probing
    // service was not ready when this run happened, so nothing here can be
    // concluded. The caller (startup reconciliation) is responsible for
    // re-running; this branch must not silently destroy live work on a
    // startup ordering quirk.
    if (probeResult === 'unknown') {
      // A distinct action so the startup caller can tell "nothing known yet,
      // re-probe later" from "normal keep-active (e.g. archived mid-run)".
      outcomes.push({ taskId: task.id, action: 'probe-unknown' })
      continue
    }
    if (!wasArchived && !wasDeleted) continue

    if (TERMINAL_TASK_STATUSES.includes(task.status)) {
      await repository.archiveTask(task.id)
      outcomes.push({ taskId: task.id, action: 'task-archived' })
      continue
    }

    // `recovering` is the one non-terminal status a lost executor settles:
    // the work was already unprovable, and the session it would resume into
    // is now gone, so nothing can ever advance it. Leaving it active strands
    // the Task — its slot stays occupied and every later capability queues
    // behind it forever.
    if (task.status === 'recovering') {
      for (const invocation of repository.listInvocations(task.id)) {
        if (!TERMINAL_INVOCATION_STATUSES.includes(invocation.status)) {
          await repository.setInvocationStatus(invocation.id, 'failed')
        }
      }
      // The diagnostic states the EXPECTED NEXT ACTION when the session was
      // deleted, so the user running into the send-cr failure is told to
      // click again rather than left with a cause and no path forward.
      // Archived and deleted share the same disposition, but not the same
      // message — archival was accounted for, deletion was not.
      await repository.setTaskStatus(
        task.id,
        'failed',
        wasDeleted
          ? `Executor session ${task.executorSessionId} no longer exists, so this ` +
            'Task was ended rather than left stuck. 再次点击该能力将创建新的 Task。'
          : `Executor session ${task.executorSessionId} was archived while this Task was ` +
            'recovering, so its work can no longer be resumed.',
      )
      await repository.archiveTask(task.id)
      outcomes.push({
        taskId: task.id,
        action: wasDeleted ? 'task-lost' : 'task-archived',
        ...(wasDeleted
          ? {
              diagnostic: `Executor session ${task.executorSessionId} no longer exists`,
            }
          : {}),
      })
      continue
    }

    // Any other non-terminal status: keep the Task active and visible.
    // Archiving (or deleting) the executor externally is not proof the work
    // was cancelled.
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
  probe?: SessionProbe,
  onIndeterminate?: () => void,
): () => void {
  void sink
  let previous = new Set(ctx.workspaceRegistry.archivedSessionIds.map(String))
  let tail = Promise.resolve()

  const enqueue = (archived: ReadonlySet<string>): void => {
    tail = tail
      .then(async () => {
        const outcomes = await reconcileArchives(repository, archived, probe)
        if (outcomes.some(outcome => outcome.action === 'probe-unknown')) {
          onIndeterminate?.()
        }
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
