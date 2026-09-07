/**
 * `/bind`: attaching an EXISTING group to an existing session.
 *
 * The Q&A action and this share everything downstream — the fork, the
 * binding row, delivery, reactions, invalidation, the directory statement.
 * What they cannot share is the trust story.
 *
 * Q&A may exempt a group from the sender allowlist because Pet built that
 * group: it started with the owner and the bot, and everyone else got there
 * because the owner pulled them in. An existing group offers no such
 * guarantee — its members were never vetted for this. So the command itself
 * is restricted to the allowlist, and the exemption the group inherits
 * afterwards rests on a different, equally explicit act: the owner chose to
 * bind THIS group. That is the whole difference, and it is why this lives in
 * its own module rather than as a flag on the create path.
 */

import { randomUUID } from 'node:crypto'
import { PetError } from '../errors.js'
import { forkQaChild, qaGroupName, type QaActionDeps, type QaSource } from './action.js'
import { archiveStale, chatOccupancy, qaScopeKeyOf, sessionOccupancy } from './occupancy.js'
import { resolveSessionByPrefix, type BindableSession } from './resolve-session.js'
import type { PetTaskRecord } from '../../wire.js'

/** How long the whole bind transaction may take before it is abandoned. */
const BIND_TIMEOUT_MS = 60_000

/** What `/bind` produced, in a form the caller can turn into a group reply. */
export type BindOutcome =
  | {
      readonly ok: true
      readonly chatId: string
      readonly childSessionId: string
      readonly taskId: string
      readonly sourceTitle: string
      readonly sourceShortId: string
      /** Members of the group at bind time, so the reply can state the blast radius. */
      readonly memberCount?: number
      /** Present when the source session is worktree-bound. */
      readonly executionRoot?: string
    }
  | {
      readonly ok: false
      /**
       * Why it refused, in the caller's vocabulary.
       *
       * `prefix-unresolved` fuses "no match" and "several matches" on
       * purpose — see `resolve-session.ts`.
       */
      readonly reason:
        | 'prefix-too-short'
        | 'prefix-unresolved'
        | 'chat-occupied'
        | 'session-occupied'
        | 'source-unforkable'
      readonly detail?: string
    }

/** Everything `/bind` needs beyond the shared QA action dependencies. */
export interface BindDeps extends QaActionDeps {
  /** Sessions this Host could bind to; filtered further by the resolver. */
  listSessions(): readonly BindableSession[]
  /**
   * Resolves the managed execution facts of a source session.
   *
   * Same contract the Q&A action uses — never inferred from a `cwd`, which
   * Worktree Session deliberately leaves at the repository root.
   */
  resolveWorktree?(sessionId: string): Promise<QaSource['worktree']>
  /** Current member count of a chat, for the receipt. Failure is tolerated. */
  memberCount?(chatId: string): Promise<number | undefined>
}

/**
 * Bind an existing group to an existing session.
 *
 * @param deps - Host collaborators.
 * @param request - The group, the typed prefix, and the group's display name.
 * @returns the outcome, refusals included; this does not throw for a refusal.
 */
export async function bindExistingGroup(
  deps: BindDeps,
  request: { chatId: string; prefix: string; chatName?: string },
): Promise<BindOutcome> {
  const { repository } = deps

  // The group side first: it is the cheapest check and the one the user is
  // most likely to trip, since they are standing in the group as they type.
  const byChat = chatOccupancy(repository, request.chatId)
  if (byChat.held) {
    return {
      ok: false,
      reason: 'chat-occupied',
      detail: byChat.occupant.binding.qaParentSessionId ?? '',
    }
  }

  const resolution = resolveSessionByPrefix(request.prefix, deps.listSessions())
  if (!resolution.resolved) {
    return {
      ok: false,
      reason: resolution.reason === 'too-short' ? 'prefix-too-short' : 'prefix-unresolved',
    }
  }
  const target = resolution.session

  // Then the session side. Checked AFTER resolution because it needs the
  // resolved id — and reporting it separately is safe: the user has already
  // proven they know this session's prefix.
  const bySession = sessionOccupancy(repository, target.id)
  if (bySession.held) {
    return {
      ok: false,
      reason: 'session-occupied',
      detail: bySession.occupant.binding.chatName ?? bySession.occupant.binding.chatId,
    }
  }

  // Both sides free. Retire whatever dead pairings were blocking them so the
  // new binding starts from a clean slate.
  await archiveStale(repository, byChat)
  await archiveStale(repository, bySession)

  const parent = deps.seam.agents.get(target.id)
  const liveParent =
    parent ??
    (await deps.seam.agents
      .resume({ resumeSessionId: target.id })
      .then(handle => handle?.agent ?? deps.seam.agents.get(target.id))
      .catch(() => undefined))
  if (liveParent === undefined) {
    return { ok: false, reason: 'source-unforkable', detail: target.title ?? target.id }
  }

  const worktree = await deps.resolveWorktree?.(target.id).catch(() => undefined)
  const label = request.chatName ?? qaGroupName(target.title)
  const childId = `session-${randomUUID()}`
  const source: QaSource = {
    sessionId: target.id,
    ...(target.title !== undefined ? { title: target.title } : {}),
    ...(worktree !== undefined ? { worktree } : {}),
  }

  await forkQaChild(deps, {
    childId,
    label,
    parent: liveParent,
    source,
    signal: AbortSignal.timeout(BIND_TIMEOUT_MS),
  })

  try {
    const task = await createBoundTask(deps, {
      chatId: request.chatId,
      chatName: label,
      childSessionId: childId,
      sourceSessionId: target.id,
    })
    await repository.putChatBinding({
      chatId: request.chatId,
      chatType: 'group',
      kind: 'qa',
      chatName: label,
      qaChildSessionId: childId,
      qaParentSessionId: target.id,
      // Pet joined this group rather than creating it: it is neither creator
      // nor owner here, and Settings must be able to say so.
      qaOrigin: 'bound',
      ...(worktree !== undefined
        ? {
            qaExecutionRoot: worktree.executionRoot,
            ...(worktree.branch !== undefined ? { qaBranch: worktree.branch } : {}),
            ...(worktree.repositoryRoot !== undefined
              ? { qaRepositoryRoot: worktree.repositoryRoot }
              : {}),
          }
        : {}),
      activeTaskId: task.id,
      boundBy: 'user',
      boundAt: Date.now(),
    })

    const memberCount = await deps.memberCount?.(request.chatId).catch(() => undefined)
    return {
      ok: true,
      chatId: request.chatId,
      childSessionId: childId,
      taskId: task.id,
      sourceTitle: target.title ?? target.id,
      sourceShortId: target.id.replace(/^session-/, '').slice(0, 6),
      ...(memberCount !== undefined ? { memberCount } : {}),
      ...(worktree !== undefined ? { executionRoot: worktree.executionRoot } : {}),
    }
  } catch (error) {
    // Unlike the create path there is no group to strand here — nothing was
    // created in Lark — so rollback is just releasing the child.
    try {
      await deps.seam.subagents.drainContinuableChildren(liveParent, [childId])
    } catch (releaseError) {
      deps.log?.(
        `bind rollback could not release child ${childId}: ${
          releaseError instanceof Error ? releaseError.message : String(releaseError)
        }`,
      )
    }
    throw new PetError(
      'BINDING_INVALID',
      `绑定失败，已回收子代理：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** Create the Task representing a bound group, mirroring the created form. */
async function createBoundTask(
  deps: BindDeps,
  options: {
    chatId: string
    chatName: string
    childSessionId: string
    sourceSessionId: string
  },
): Promise<PetTaskRecord> {
  const scopeKey = qaScopeKeyOf(options.sourceSessionId)
  const now = Date.now()
  return deps.repository.createTask({
    id: `task-${randomUUID()}`,
    scopeKey,
    epoch: await deps.repository.allocateEpoch(scopeKey),
    sourceKind: 'qa-chat',
    sourceId: options.chatId,
    sourceTitle: options.chatName,
    sourceAvailability: 'available',
    executorSessionId: options.childSessionId,
    status: 'idle',
    createdAt: now,
    updatedAt: now,
    revision: 0,
  })
}
