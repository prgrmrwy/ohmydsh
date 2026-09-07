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
import { displayShortId, resolveSessionByPrefix, type BindableSession } from './resolve-session.js'
import { TERMINAL_TASK_STATUSES, type PetTaskRecord } from '../../wire.js'

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
  // What this chat was BEFORE `/bind` — kept so `/unbind` can hand it back
  // rather than leaving a group permanently mute. A group that was routing to
  // a workspace should return to doing so; one that had no binding at all
  // should return to having none.
  const priorBinding = repository.getChatBinding(request.chatId)
  const priorWorkspaceId =
    priorBinding !== undefined && priorBinding.kind === 'workspace'
      ? priorBinding.workspaceId
      : undefined

  const byChat = chatOccupancy(repository, request.chatId)
  if (byChat.held) {
    // The reply goes to a GROUP, so it must not carry a full session id:
    // everyone present would see an internal identifier they have no use for
    // and no business holding. The short form is enough to recognise it.
    const boundTo = byChat.occupant.binding.qaParentSessionId
    return {
      ok: false,
      reason: 'chat-occupied',
      ...(boundTo !== undefined ? { detail: displayShortId(boundTo) } : {}),
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
      detail:
        bySession.occupant.binding.chatName ??
        // No cached name: say nothing identifying rather than printing a raw
        // chat id into a different group's transcript.
        '另一个群',
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
    return {
      ok: false,
      reason: 'source-unforkable',
      detail: target.title ?? displayShortId(target.id),
    }
  }

  const worktree = await deps.resolveWorktree?.(target.id).catch(() => undefined)
  // The group's OWN name, read from Lark — never one Pet invents. A `/bind`
  // group belongs to someone else: renaming it (even only in Pet's own
  // display) would contradict the standing rule that Pet promises no
  // group-management capability there, and would leave Settings showing a
  // name nobody sees in Lark. `qaGroupName` is the Q&A action's business,
  // where Pet actually created the group.
  const chatName =
    request.chatName ?? (await deps.client.chatName(request.chatId).catch(() => undefined))
  // The CHILD's label is a different thing: it is Pet's own object, shown in
  // the subagent list, so naming it after the group it serves is right.
  const label = chatName === undefined ? qaGroupName(target.title) : `答疑 · ${chatName}`
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
      // The group's real name, or nothing — never an invented one.
      ...(chatName !== undefined ? { chatName } : {}),
      qaChildSessionId: childId,
      qaParentSessionId: target.id,
      // Pet joined this group rather than creating it: it is neither creator
      // nor owner here, and Settings must be able to say so.
      qaOrigin: 'bound',
      // Carried, not discarded: releasing the binding restores this route.
      ...(priorWorkspaceId !== undefined ? { qaPriorWorkspaceId: priorWorkspaceId } : {}),
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
      sourceTitle: target.title ?? displayShortId(target.id),
      sourceShortId: displayShortId(target.id),
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

/** What `/unbind` decided. */
export type UnbindOutcome =
  | {
      readonly ok: true
      readonly chatName?: string
      readonly sourceTitle?: string
      /** Present when the group was handed back to a workspace route. */
      readonly restoredWorkspaceId?: string
    }
  | {
      readonly ok: false
      /**
       * Why it refused.
       *
       * `not-bound` also covers a group bound to nothing meaningful; the
       * caller treats it as "nothing to undo".
       */
      readonly reason: 'not-bound' | 'not-unbindable' | 'busy'
    }

/**
 * Release a group that was attached with `/bind`.
 *
 * Deliberately narrower than "undo any QA binding": a group Pet CREATED is
 * entered from the GUI and must be ended there, while a group Pet merely
 * joined was entered from the group and can be left from it. Keeping the exit
 * on the same side as the entrance is what stops `/unbind` from becoming a
 * way to dismantle, from inside a chat, something set up elsewhere.
 *
 * Archiving is the single mechanism underneath — the same one the panel uses
 * — so there is still only one notion of "this pairing is over".
 * @param deps - Host collaborators.
 * @param chatId - The group asking to be released.
 * @returns the outcome; refusals do not throw.
 */
export async function unbindGroup(
  deps: Pick<BindDeps, 'repository'>,
  chatId: string,
): Promise<UnbindOutcome> {
  const binding = deps.repository.getChatBinding(chatId)
  if (binding === undefined || binding.kind !== 'qa') return { ok: false, reason: 'not-bound' }

  // The entrance decides the exit. A `created` group belongs to the Q&A
  // action that built it; unbinding it here would leave a group Pet owns with
  // nothing pointing at it, and the user would have no way back in.
  if (binding.qaOrigin !== 'bound') return { ok: false, reason: 'not-unbindable' }

  const taskId = binding.activeTaskId
  const task = taskId === undefined ? undefined : deps.repository.getTask(taskId)
  if (task === undefined || task.archivedAt !== undefined) {
    // Nothing live to retire: the pairing is already over, so report success
    // rather than inventing an error for a state the user asked for anyway.
    return {
      ok: true,
      ...(binding.chatName !== undefined ? { chatName: binding.chatName } : {}),
    }
  }

  // Archiving requires a settled Task. Refusing while the child is mid-answer
  // is deliberate: interrupting an agent that may be part-way through writing
  // files is a worse failure than asking the user to try again in a moment.
  if (!TERMINAL_TASK_STATUSES.includes(task.status)) {
    return { ok: false, reason: 'busy' }
  }

  await deps.repository.archiveTask(task.id)

  // Hand the group back to whatever it was doing before `/bind` took it over.
  // Leaving it as a mute `qa` row would be a third state — neither served nor
  // free — and a group that used to route to a workspace would silently stop
  // working with no way back except re-binding.
  const restored = binding.qaPriorWorkspaceId
  if (restored !== undefined) {
    await deps.repository.putChatBinding({
      chatId: binding.chatId,
      chatType: binding.chatType,
      kind: 'workspace',
      workspaceId: restored,
      ...(binding.chatName !== undefined ? { chatName: binding.chatName } : {}),
      qaOrigin: 'created',
      boundBy: 'user',
      boundAt: Date.now(),
    })
  } else {
    // Nothing to restore: the group had no binding before, so it should have
    // none now. Removing the row is what makes it truly free again — a
    // retained `qa` row would keep it out of default routing forever.
    await deps.repository.deleteChatBinding(binding.chatId)
  }

  // The child and its history survive either way: the session remains
  // readable in the GUI, it simply stops receiving this group's messages.
  return {
    ok: true,
    ...(binding.chatName !== undefined ? { chatName: binding.chatName } : {}),
    ...(task.sourceTitle !== undefined ? { sourceTitle: task.sourceTitle } : {}),
    ...(restored !== undefined ? { restoredWorkspaceId: restored } : {}),
  }
}
