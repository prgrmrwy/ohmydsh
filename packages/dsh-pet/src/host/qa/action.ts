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
import { scopeKeyOf, type PetTaskRecord } from '../../wire.js'

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
 * Create a QA group for one source session.
 * @param deps - Host collaborators.
 * @param source - The source session to fork from.
 * @returns the created group, child and Task.
 * @throws PetError when any step refuses; nothing partial is left bound.
 */
export async function createQaGroup(
  deps: QaActionDeps,
  source: QaSource,
): Promise<QaGroupResult> {
  const { repository } = deps
  const config = repository.getChannelConfig()

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

  // Step 1: fork. The seed is the source session's completed-turn prefix; an
  // in-flight turn is excluded by the fork provider, which is why the action
  // surface tells the user the child sees "the most recent completed round".
  await deps.seam.subagents.startContinuable({
    provider: FORK_PROVIDER,
    label: chatName,
    childId,
    request: {
      prompt: [{ type: 'text', text: renderQaSeedPrompt(chatName) }],
      parent: liveParent,
    },
    signal,
  })

  // File the child where its parent lives, so it appears under the same
  // project rather than unfiled.
  if (deps.attachToWorkspace !== undefined) {
    try {
      await deps.attachToWorkspace(childId, source.workspaceId)
    } catch (error) {
      // Filing is presentation; the stored binding remains authoritative.
      deps.log?.(
        `qa child ${childId} could not be filed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  // Step 2: the group.
  let chatId: string
  try {
    chatId = await deps.client.createChat(chatName, [owner])
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
      ...(source.workspaceId !== undefined ? { workspaceId: source.workspaceId } : {}),
    })
    await repository.putChatBinding({
      chatId,
      chatType: 'group',
      kind: 'qa',
      chatName,
      qaChildSessionId: childId,
      qaParentSessionId: source.sessionId,
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
    workspaceId?: string
  },
): Promise<PetTaskRecord> {
  const scopeKey = scopeKeyOf('chat', options.chatId)
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
