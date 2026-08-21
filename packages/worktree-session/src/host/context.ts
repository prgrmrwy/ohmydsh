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
    '- 禁止把主 checkout（源仓库主工作区）当作工作区做日常编辑（写文件、跑工具、改源码）。',
    '- 版本收尾动作（合入任务分支、删除已合并分支、归档后清理 worktree）是任务闭环的必要步骤，仅可在用户明确批准后、通过受控命令执行（如 scripts/ws-merge.mjs / scripts/ws-cleanup.mjs），不得裸跑 git merge 或强删。',
    '- 修改依赖（install/uninstall/update）前必须先通过 ws promote。',
    '- 上述仓库、执行目录与分支已经由 Host 绑定并强制执行；不要再用 pwd、目录枚举或 ws status 例行确认。仅在任务确实需要实时依赖模式/阶段时调用 ws status，且不要传 path。',
    '',
    '此上下文是稳定绑定不变式；动态状态仅按需通过无 path 的 ws status 查询。',
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
  if (binding?.mode === 'source-session' && binding.state === 'released') return undefined
  if (binding?.mode === 'source-session' && (binding.state === 'cleaned' || binding.state === 'cleaned-archived')) return cleanedBindingContext(operation)
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
