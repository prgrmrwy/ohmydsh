/**
 * The Q&A action: fork a child, create the group, bind the two.
 *
 * Three writes across three systems that share no transaction — the subagent
 * runtime, Lark, and Pet's own store — so the order is chosen by what a
 * failure leaves behind rather than by what reads naturally:
 *
 * 1. fork the child. Cheapest to undo (release it), and it proves the source
 *    session is actually forkable before anything user-visible exists.
 * 2. create the group. The first externally visible effect. If this fails,
 *    step 1 is released and nothing remains.
 * 3. write the binding. Until this row exists the group is NOT a QA group:
 *    a message arriving in that window is judged by the ordinary allowlist,
 *    which is the fail-closed answer.
 *
 * A failure at step 3 releases the child but cannot un-create the group, so
 * the error names it: an orphan group the user can delete beats a binding
 * pointing at a child that no longer exists.
 */

import { randomUUID } from 'node:crypto'
import { PetError } from '../errors.js'
import { renderQaSeedPrompt } from './prompt.js'
import { FORK_PROVIDER, type LiveAgentLike, type SubagentSeam } from './subagents.js'
import type { LarkClient } from '../channel/lark.js'
import type { PetRepository } from '../repository.js'
import { archiveStale, qaScopeKeyOf, sessionOccupancy } from './occupancy.js'
import type { PetTaskRecord } from '../../wire.js'

/** How long the whole transaction may take before it is abandoned. */
const ACTION_TIMEOUT_MS = 60_000

/** Longest source-session title kept in a group name. */
const MAX_TITLE_IN_NAME = 24

/** What the QA action produced. */
export interface QaGroupResult {
  readonly chatId: string
  readonly chatName: string
  readonly childSessionId: string
  readonly taskId: string
  /**
   * Whether an existing group was handed back instead of a new one created.
   *
   * The client needs the difference: "here is your group" and "a group was
   * just created" call for different words, and silently showing the second
   * for the first is how three identically named groups appeared in practice.
   */
  readonly reused?: boolean
}

/** Everything the QA action needs from its Host. */
export interface QaActionDeps {
  readonly repository: PetRepository
  readonly client: LarkClient
  readonly seam: SubagentSeam
  /**
   * Accounts a session to a workspace.
   *
   * The child is filed under the SOURCE session's workspace, matching where
   * its parent lives; without this it exists but shows up unfiled.
   */
  readonly attachToWorkspace?: (sessionId: string, workspaceId?: string) => Promise<void>
  readonly log?: (message: string) => void
}

/** The source session a QA group is created from. */
export interface QaSource {
  readonly sessionId: string
  readonly title?: string
  readonly workspaceId?: string
  /**
   * Managed execution facts of the source session, when it is worktree-bound.
   *
   * Resolved by the caller through the Worktree Session contract and NEVER
   * from a `cwd`: that plugin keeps `header.cwd` at the repository root on
   * purpose, and a fork copies exactly that. Without these facts the child
   * would take the main checkout for its working directory.
   */
  readonly worktree?: {
    readonly executionRoot: string
    readonly branch?: string
    readonly repositoryRoot?: string
  }
}

/**
 * Build the group name from the source session's title.
 * @param title - Source session title, when it has one.
 * @returns the group name.
 */
export function qaGroupName(title: string | undefined): string {
  const trimmed = (title ?? '').trim()
  if (trimmed === '') return '答疑 · DSH'
  const clipped =
    trimmed.length > MAX_TITLE_IN_NAME ? `${trimmed.slice(0, MAX_TITLE_IN_NAME)}…` : trimmed
  return `答疑 · ${clipped}`
}

/**
 * Fork the QA child for one source session and file it beside its parent.
 *
 * Shared by both entry points: the Q&A action creates a group around the
 * child it forks, while `/bind` attaches one that already exists. Only the
 * group step differs, so keeping the fork here means the seed prompt, the
 * execution-root statement and the filing behaviour cannot drift between the
 * two paths.
 * @param deps - Host collaborators.
 * @param options - Child identity, its label, the live parent, and the source.
 * @throws whatever the subagent seam raises; the caller owns rollback.
 */
export async function forkQaChild(
  deps: QaActionDeps,
  options: {
    childId: string
    label: string
    parent: LiveAgentLike
    source: QaSource
    signal: AbortSignal
  },
): Promise<void> {
  const { source } = options
  // The seed is the source session's completed-turn prefix; an in-flight turn
  // is excluded by the fork provider, which is why both entry points tell the
  // user the child sees "the most recent completed round".
  await deps.seam.subagents.startContinuable({
    provider: FORK_PROVIDER,
    label: options.label,
    childId: options.childId,
    request: {
      // The seed states the execution root as well: the owner can talk to the
      // child directly in the GUI, and that path carries no trigger prompt to
      // remind it where it stands.
      prompt: [
        {
          type: 'text',
          text: renderQaSeedPrompt(
            options.label,
            source.worktree === undefined
              ? undefined
              : {
                  executionRoot: source.worktree.executionRoot,
                  ...(source.worktree.branch !== undefined
                    ? { branch: source.worktree.branch }
                    : {}),
                  ...(source.worktree.repositoryRoot !== undefined
                    ? { repositoryRoot: source.worktree.repositoryRoot }
                    : {}),
                },
          ),
        },
      ],
      parent: options.parent,
    },
    signal: options.signal,
  })

  // File the child where its parent lives, so it appears under the same
  // project rather than unfiled.
  if (deps.attachToWorkspace !== undefined) {
    try {
      await deps.attachToWorkspace(options.childId, source.workspaceId)
    } catch (error) {
      // Filing is presentation; the stored binding remains authoritative.
      deps.log?.(
        `qa child ${options.childId} could not be filed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}

/**
 * Create a QA group for one source session, or return the one it already has.
 * @param deps - Host collaborators.
 * @param source - The source session to fork from.
 * @returns the created — or existing — group, child and Task.
 * @throws PetError when any step refuses; nothing partial is left bound.
 */
export async function createQaGroup(
  deps: QaActionDeps,
  source: QaSource,
): Promise<QaGroupResult> {
  const { repository } = deps
  const config = repository.getChannelConfig()

  // Reuse before creating anything. One source session owns at most one live
  // QA group, so clicking again is "show me my group", not "make another".
  // A stale pairing (Task alive, binding gone or invalidated) is retired
  // rather than handed back: returning a chat nobody can be answered in would
  // be worse than building a working one.
  const occupied = sessionOccupancy(repository, source.sessionId)
  if (occupied.held) {
    const { task, binding } = occupied.occupant
    return {
      chatId: binding.chatId,
      chatName: binding.chatName ?? qaGroupName(source.title),
      childSessionId: binding.qaChildSessionId ?? '',
      taskId: task.id,
      reused: true,
    }
  }
  await archiveStale(repository, occupied)

  // The owner is the only member invited at creation; everyone else is pulled
  // in by them afterwards, which is precisely what the admission exemption
  // trusts. Without a known owner there is nobody to trust, so this refuses.
  const owner = config.allowOpenIds[0]
  if (owner === undefined) {
    throw new PetError(
      'BINDING_INVALID',
      'Pet 的飞书 allowlist 为空，无法确定答疑群该邀请谁。请先在设置页配置。',
    )
  }

  // An exact live parent is required by the seam, and a source session that
  // is not resident can be resumed — but a session that cannot be made live
  // cannot be forked either, and saying so here is clearer than a seam error.
  const parent = deps.seam.agents.get(source.sessionId)
  const liveParent: LiveAgentLike | undefined =
    parent ??
    (await deps.seam.agents
      .resume({ resumeSessionId: source.sessionId })
      .then(handle => handle?.agent ?? deps.seam.agents.get(source.sessionId))
      .catch(() => undefined))
  if (liveParent === undefined) {
    throw new PetError('SOURCE_NOT_FOUND', `来源会话 ${source.sessionId} 当前不可用，无法创建答疑群。`)
  }

  const chatName = qaGroupName(source.title)
  const childId = `session-${randomUUID()}`
  const signal = AbortSignal.timeout(ACTION_TIMEOUT_MS)

  // Step 1: fork.
  await forkQaChild(deps, { childId, label: chatName, parent: liveParent, source, signal })

  // Step 2: the group. The owner is both its sole invitee and its OWNER:
  // creating as the bot would otherwise leave the bot in charge, and the
  // person whose group it is could not rename, invite, remove or disband it
  // without asking an agent to act for them.
  let chatId: string
  try {
    chatId = await deps.client.createChat(chatName, [owner], owner)
  } catch (error) {
    await releaseChild(deps, liveParent, childId)
    throw new PetError(
      'BINDING_INVALID',
      `创建飞书群失败，已回收子代理：${error instanceof Error ? error.message : String(error)}`,
    )
  }

  // Step 3: the binding, plus the Task that gives the group a管理位.
  try {
    const task = await createQaTask(deps, {
      chatId,
      chatName,
      childSessionId: childId,
      sourceSessionId: source.sessionId,
      ...(source.workspaceId !== undefined ? { workspaceId: source.workspaceId } : {}),
    })
    await repository.putChatBinding({
      chatId,
      chatType: 'group',
      kind: 'qa',
      chatName,
      qaChildSessionId: childId,
      qaParentSessionId: source.sessionId,
      // Pet built this group, so it is the creator and the invited user owns
      // it — as opposed to a group merely attached with `/bind`.
      qaOrigin: 'created',
      // Captured now, not re-derived per question: the binding is where a
      // later message learns which directory the child may work in, and
      // re-resolving would make every question depend on the worktree plugin
      // still answering.
      ...(source.worktree !== undefined
        ? {
            qaExecutionRoot: source.worktree.executionRoot,
            ...(source.worktree.branch !== undefined ? { qaBranch: source.worktree.branch } : {}),
            ...(source.worktree.repositoryRoot !== undefined
              ? { qaRepositoryRoot: source.worktree.repositoryRoot }
              : {}),
          }
        : {}),
      activeTaskId: task.id,
      // `user`: this binding exists because the user asked for it, and must
      // never be overwritten by default routing.
      boundBy: 'user',
      boundAt: Date.now(),
    })
    return { chatId, chatName, childSessionId: childId, taskId: task.id }
  } catch (error) {
    await releaseChild(deps, liveParent, childId)
    throw new PetError(
      'BINDING_INVALID',
      `答疑群「${chatName}」已在飞书创建，但绑定失败，已回收子代理。` +
        `请手动删除该群后重试：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** Create the Task that represents one QA group in Pet's own model. */
async function createQaTask(
  deps: QaActionDeps,
  options: {
    chatId: string
    chatName: string
    childSessionId: string
    sourceSessionId: string
    workspaceId?: string
  },
): Promise<PetTaskRecord> {
  // Scoped to the SOURCE SESSION, which is what makes reuse possible: the
  // chat id is a product of this very call, so a chat-keyed scope could never
  // match an earlier group and every click would create another one.
  const scopeKey = qaScopeKeyOf(options.sourceSessionId)
  const now = Date.now()
  // Committed as `idle` immediately, unlike an ordinary Task: there is no
  // executor to create — the child already exists — so `creating-executor`
  // would describe a step that never runs.
  return deps.repository.createTask({
    id: `task-${randomUUID()}`,
    scopeKey,
    epoch: await deps.repository.allocateEpoch(scopeKey),
    sourceKind: 'qa-chat',
    sourceId: options.chatId,
    sourceTitle: options.chatName,
    sourceAvailability: 'available',
    executorSessionId: options.childSessionId,
    ...(options.workspaceId !== undefined ? { residentWorkspaceId: options.workspaceId } : {}),
    status: 'idle',
    createdAt: now,
    updatedAt: now,
    revision: 0,
  })
}

/** Release a child created by a transaction that then failed. */
async function releaseChild(
  deps: QaActionDeps,
  parent: LiveAgentLike,
  childId: string,
): Promise<void> {
  try {
    await deps.seam.subagents.drainContinuableChildren(parent, [childId])
  } catch (error) {
    // Reported, not rethrown: the caller is already failing, and the original
    // reason is more useful than a cleanup error stacked on top.
    deps.log?.(
      `qa rollback could not release child ${childId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}
