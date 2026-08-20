import type { Agent } from '@deepseek-ai/dsh-agent'
import type { OperationRecord, SessionBinding } from '../wire.js'
import { bindingOf } from '../wire.js'

/** Deterministic rules that accompany every active Worktree Session binding. */
export function activeBindingContext(operation: OperationRecord): string {
  return [
    '# Worktree Session (managed execution root)',
    '',
    `源仓库（Session 归属工作区）：${operation.repoRoot}`,
    `托管执行目录：${operation.worktreePath}`,
    `任务分支：${operation.taskBranch}`,
    '',
    '规则：',
    '- 所有 Bash 调用必须显式使用托管执行目录作为 workdir。',
    '- 所有本地文件与搜索工具必须使用托管执行目录中的绝对路径。',
    '- 禁止修改主 checkout（源仓库主工作区）。',
    '- 修改依赖（install/uninstall/update）前必须先通过 ws promote。',
    '',
    '此上下文是稳定绑定不变式；依赖模式、任务阶段与实时状态请通过 ws status 查询。',
  ].join('\n')
}

/** Deterministic terminal context for a cleaned historical binding. */
export function cleanedBindingContext(operation: OperationRecord): string {
  return [
    '# Worktree Session（已清理）',
    '',
    `该 Worktree Session 的旧执行目录已不存在：${operation.worktreePath}`,
    '规则：',
    '- 禁止继续向旧执行目录写入。',
    '- 如要继续开发，请从当前仓库创建新的 Worktree Session。',
    '',
    '此历史 Session 仍归属于源仓库工作区。',
  ].join('\n')
}

/** Deterministic stable context for a bound Session, or undefined when not bound. */
export function boundContextText(operation: OperationRecord | undefined, binding: SessionBinding | undefined): string | undefined {
  if (operation === undefined) return undefined
  if (binding?.mode === 'source-session' && binding.state === 'cleaned') return cleanedBindingContext(operation)
  if (binding?.mode === 'source-session') return activeBindingContext(operation)
  return undefined
}

/**
 * Install the stable Worktree Session runtime context into an exact live Agent
 * scope. Idempotent per Agent: repeated installs dispose the previous named
 * context first, so restart-safe rescue cannot double-register. The disposer
 * is also released automatically when the Agent scope unwinds, so a removed
 * binding leaves no stale context behind.
 */
export function installContext(agent: Agent | undefined, operation: OperationRecord | undefined): void {
  if (agent === undefined) return
  const previous = installed.get(agent)
  if (previous !== undefined) { previous(); installed.delete(agent) }
  if (operation === undefined) return
  const binding = bindingOf(operation)
  const text = boundContextText(operation, binding)
  if (text === undefined) return
  const disposer = agent.ctx.systemPrompt.context({
    name: 'worktree-session',
    order: 110,
    text: () => text,
  })
  installed.set(agent, disposer)
}

const installed = new WeakMap<Agent, () => void>()
