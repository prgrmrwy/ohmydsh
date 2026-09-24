/**
 * The QA 1:1 invariant: one group holds at most one source session, and one
 * source session holds at most one group.
 *
 * Both directions matter, and for the same reason: if either side could be
 * claimed twice, "whose child answers this group" would stop having a single
 * answer. The Q&A action only ever needed the session side (its chat does not
 * exist yet when it checks), while `/bind` arrives with a chat that may
 * already be spoken for — so the rule lives here rather than in either caller.
 *
 * Occupancy is decided by an UNARCHIVED Task, never by the mere presence of a
 * binding row: an invalidated binding is kept on purpose (its child's history
 * stays readable), and treating that as occupied would strand the group
 * forever. Archiving is therefore the single documented way to release either
 * side.
 */

import type { PetRepository } from '../repository.js'
import type { PetChatBinding } from '../spec.js'
import type { PetScopeKey, PetTaskRecord } from '../../wire.js'

/**
 * The QA scope key for one source session.
 *
 * Keyed on the SOURCE SESSION, not on the chat: a chat id does not exist
 * until its group has been created, so a chat-keyed lookup could never match
 * an earlier group. Namespaced apart from the ordinary `session:` scope so a
 * session may hold an overlay Task and a QA group at once.
 * @param sessionId - Source session id.
 * @returns the scope key.
 */
export function qaScopeKeyOf(sessionId: string): PetScopeKey {
  return `qa:${sessionId}` as PetScopeKey
}

/** A live QA pairing: an unarchived Task plus the binding it serves. */
export interface QaOccupant {
  readonly task: PetTaskRecord
  readonly binding: PetChatBinding
}

/** What a side of the 1:1 relation currently holds. */
export type QaOccupancy =
  | { readonly held: true; readonly occupant: QaOccupant }
  /**
   * Free, but a broken or invalidated pair must be archived first.
   *
   * `staleTaskId` names a Task that is still unarchived while its binding is
   * gone or invalidated — a pair that can never answer anyone. Callers archive
   * it and proceed rather than reporting the side as occupied.
   */
  | { readonly held: false; readonly staleTaskId?: string }

/**
 * Find the binding a Task serves, if any.
 * @param repository - Pet repository.
 * @param taskId - Task id.
 * @returns the qa binding pointing at that Task.
 */
function bindingForTask(
  repository: PetRepository,
  taskId: string,
): PetChatBinding | undefined {
  return repository
    .listChatBindings()
    .find(row => row.kind === 'qa' && row.activeTaskId === taskId)
}

/**
 * Whether a source session already holds a live QA group.
 * @param repository - Pet repository.
 * @param sessionId - Source session id.
 * @returns the occupancy of the session side.
 */
export function sessionOccupancy(
  repository: PetRepository,
  sessionId: string,
): QaOccupancy {
  const task = repository.findActiveTaskByScope(qaScopeKeyOf(sessionId))
  if (task === undefined) return { held: false }
  const binding = bindingForTask(repository, task.id)
  if (binding === undefined || binding.qaInvalidatedAt !== undefined) {
    return { held: false, staleTaskId: task.id }
  }
  return { held: true, occupant: { task, binding } }
}

/**
 * Whether a chat is already bound to a live QA session.
 * @param repository - Pet repository.
 * @param chatId - Lark chat id.
 * @returns the occupancy of the group side.
 */
export function chatOccupancy(repository: PetRepository, chatId: string): QaOccupancy {
  const binding = repository.getChatBinding(chatId)
  if (binding === undefined || binding.kind !== 'qa') return { held: false }
  // An invalidated binding is a dead pairing, not an occupant: the group is
  // free to be bound again, and its Task is the thing that must be retired.
  if (binding.qaInvalidatedAt !== undefined) {
    return {
      held: false,
      ...(binding.activeTaskId !== undefined ? { staleTaskId: binding.activeTaskId } : {}),
    }
  }
  const task =
    binding.activeTaskId === undefined ? undefined : repository.getTask(binding.activeTaskId)
  if (task === undefined || task.archivedAt !== undefined) {
    // A binding whose Task is gone or archived no longer serves anyone.
    return { held: false }
  }
  return { held: true, occupant: { task, binding } }
}

/**
 * Retire a stale pairing so the side it blocked becomes usable.
 *
 * Failure is swallowed deliberately: the caller is about to build a working
 * pair, and an un-archivable remnant is a diagnostic concern rather than a
 * reason to deny the user their group.
 * @param repository - Pet repository.
 * @param occupancy - A free-but-stale occupancy.
 */
export async function archiveStale(
  repository: PetRepository,
  occupancy: QaOccupancy,
): Promise<void> {
  if (occupancy.held) return
  const staleTaskId = occupancy.staleTaskId
  if (staleTaskId === undefined) return
  await repository.archiveTask(staleTaskId).catch(() => undefined)
}

/**
 * Whether a chat is currently SERVED by a live QA pairing.
 *
 * Distinct from "has a qa row": the row survives `/unbind` and invalidation on
 * purpose, because it holds the pointer to a child whose history stays
 * readable. Treating the row's presence as service is what let a released
 * group keep answering questions — and, worse, keep exempting non-allowlist
 * senders from the allowlist.
 *
 * Every caller that asks "should this group get an answer / an exemption"
 * MUST ask this, not the row.
 * @param repository - Pet repository.
 * @param chatId - Lark chat id.
 * @returns whether the group is still served.
 */
export function isQaChatLive(repository: PetRepository, chatId: string): boolean {
  return chatOccupancy(repository, chatId).held
}
