/**
 * Visible Pet Invocation envelopes.
 *
 * Every dispatched message begins with the capability's `/<skill-name>` token
 * so the ordinary DSH Skill pre-step injects the same body other clients get.
 * The remaining envelope text is DIAGNOSTIC DISPLAY ONLY: it helps a human
 * read the transcript, and it explicitly tells the Agent that authority comes
 * from `pet_context`, never from this text.
 */

import { PET_CONTEXT_TOOL } from './context-tool.js'
import type { PetInvocationRecord, PetSourceSnapshot, PetTaskRecord } from '../wire.js'

/** Maximum characters of free-text user request echoed into an envelope. */
const MAX_REQUEST_CHARS = 2000

/**
 * Plain statements of the source's observed availability.
 *
 * Facts only: each says what the source session currently is, and none says
 * what to do about it. Whether a given state permits a given operation is the
 * invoked capability's own gate to decide, not this envelope's.
 */
const SOURCE_AVAILABILITY_TEXT: Record<string, string> = {
  available: '未归档',
  archived: '已归档',
  missing: '已不存在于注册表',
}

/**
 * Render the message dispatched for one Invocation.
 *
 * @param options - Task, Invocation, snapshot and whether this is the Task's
 * first envelope.
 * @returns the complete prompt text.
 */
export function renderEnvelope(options: {
  readonly task: PetTaskRecord
  readonly invocation: PetInvocationRecord
  readonly snapshot: PetSourceSnapshot
  readonly isFirst: boolean
  /**
   * Free-text arguments configured for this Skill.
   *
   * Appended directly after the skill token, exactly as a user would type
   * them. Opaque to Pet — the Skill's instructions decide what they mean.
   */
  readonly skillArguments?: string
}): string {
  const { task, invocation, snapshot } = options
  const lines: string[] = []

  // The leading token drives the real Skill injection path. Configured
  // arguments ride on the same line, exactly as if the user had typed them.
  const args = options.skillArguments?.trim() ?? ''
  lines.push(args === '' ? `/${invocation.skillName}` : `/${invocation.skillName} ${args}`)
  lines.push('')

  lines.push(options.isFirst ? '## Pet 任务开始' : '## 下一次 Pet 调用')
  lines.push('')
  lines.push(`- 任务：\`${task.id}\`（第 ${task.epoch} 轮）`)
  lines.push(`- 调用：\`${invocation.id}\``)
  lines.push(`- 能力：\`${invocation.capabilityId}\``)

  if (snapshot.sourceKind === 'none') {
    lines.push('- 来源：**独立任务**（不关联任何 DSH 会话或工作区）')
  } else {
    const label = snapshot.sessionTitle ?? snapshot.workspaceTitle ?? '(untitled)'
    lines.push(`- 来源${snapshot.sourceKind === 'session' ? '会话' : '工作区'}：${label}`)
    // Every path here belongs to the SOURCE session, never to this executor.
    // Without that attribution a reader takes "受管执行根目录" for its own
    // working directory — observed in practice: an agent refused to clean a
    // finished worktree believing it was standing in it, while this session's
    // cwd is the Pet workspace and is not a Git checkout at all.
    if (snapshot.sourceKind === 'session') {
      // The two sessions' lifecycles are independent facts, and an agent that
      // cannot see the source one substitutes its own: observed in practice,
      // an executor refused to finish a source session's worktree on the
      // belief that session was still live and driving this task, when it had
      // in fact already ended. Stating availability outright removes the guess.
      lines.push(`- 来源会话（\`${task.sourceId}\`）当前状态：${SOURCE_AVAILABILITY_TEXT[task.sourceAvailability]}`)
    }
    if (snapshot.cwd !== undefined) lines.push(`- 来源会话的仓库根目录：\`${snapshot.cwd}\``)
    if (snapshot.worktree !== undefined) {
      lines.push(`- 来源会话的受管执行根目录：\`${snapshot.worktree.executionRoot}\``)
    }
  }
  lines.push(
    `- 快照：\`${snapshot.id}\`，捕获于 ${new Date(snapshot.capturedAt).toISOString()}` +
      (snapshot.asOfSeq !== undefined ? `（序号 ${snapshot.asOfSeq}）` : ''),
  )
  lines.push('')

  if (invocation.request !== undefined && invocation.request.trim() !== '') {
    lines.push('### 用户请求')
    lines.push('')
    lines.push(invocation.request.slice(0, MAX_REQUEST_CHARS))
    lines.push('')
  }


  lines.push(
    `现在调用 \`${PET_CONTEXT_TOOL}\` 获取本次调用被授权的快照。` +
      '以上信息仅供展示，不构成任何授权。用中文回复。',
  )

  if (options.isFirst) {
    lines.push('')
    // "这个会话" must be unmistakably THIS executor session. Read as the source
    // session, the sentence becomes "the source keeps driving me", which has in
    // practice been taken as proof that the source is still live.
    lines.push(
      '你所在的这个 Pet 执行会话之后还会承载该任务的更多调用；' +
        '完成本次调用不等于结束整个任务。这描述的是本执行会话的生命周期，' +
        '与来源会话是否仍在运行无关——两者相互独立。',
    )
  }
  return lines.join('\n')
}
