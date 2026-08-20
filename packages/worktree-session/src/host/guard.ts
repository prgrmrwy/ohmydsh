import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { isAbsolute, normalize, relative, sep } from 'node:path'
import type { OperationRecord } from '../wire.js'
import { bindingOf } from '../wire.js'
import { confinePath, firstPathOf } from './containment.js'

/** Exact audited argument contracts for the pinned DSH tool surface. */
export interface ToolContract {
  kind: 'bash' | 'paths' | 'search' | 'delegation' | 'maintenance' | 'non-local'
  pathFields: readonly string[]
  requiredAbsolute: boolean
}

/**
 * Installed rc.7 contracts. This table is deliberately exported for inventory
 * tests and upgrade review: a schema/name change must fail tests before release.
 */
export const TOOL_CONTRACTS: Readonly<Record<string, ToolContract>> = Object.freeze({
  bash: { kind: 'bash', pathFields: ['workdir'], requiredAbsolute: true },
  read: { kind: 'paths', pathFields: ['file_path'], requiredAbsolute: true },
  read_image: { kind: 'paths', pathFields: ['file_path'], requiredAbsolute: true },
  edit: { kind: 'paths', pathFields: ['file_path'], requiredAbsolute: true },
  write: { kind: 'paths', pathFields: ['file_path'], requiredAbsolute: true },
  glob: { kind: 'search', pathFields: ['path'], requiredAbsolute: true },
  grep: { kind: 'search', pathFields: ['path'], requiredAbsolute: true },
  subagent: { kind: 'delegation', pathFields: [], requiredAbsolute: false },
  send_message: { kind: 'delegation', pathFields: [], requiredAbsolute: false },
  ws: { kind: 'maintenance', pathFields: ['path'], requiredAbsolute: true },
})

function lexicalWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel))
}

function firstPathObject(args: unknown): Record<string, unknown> {
  return (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>
}

/**
 * Pure synchronous fail-closed check for a bound Worktree Session. Returns a
 * denial reason, or undefined to let the call continue to existing policy.
 */
export function checkTool({ name, args }: { name: string; args: unknown }, operation: OperationRecord, validationFailure?: string, continuableDelegationTools: readonly string[] = []): string | undefined {
  const binding = bindingOf(operation)
  if (binding === undefined || binding.mode !== 'source-session') return undefined
  if (binding.state === 'cleaned') return `Worktree Session ${operation.operationId} 已清理；禁止继续操作旧执行目录`
  const contract = TOOL_CONTRACTS[name]
  if (validationFailure !== undefined && (contract === undefined || contract.kind !== 'non-local')) return `Worktree Session 绑定校验失败，已禁止本地工具：${validationFailure}`
  if (contract === undefined) {
    // Known one-shot and unknown delegation providers cannot prove unpublished
    // child setup inheritance, so deny them explicitly.
    if (name.startsWith('subagent') || name === 'ralph' || name === 'workflow') return `Worktree Session 无法证明委派工具 ${name} 在首步前继承托管执行目录，已拒绝调用`
    // Unknown tools are unaffected unless their frozen arguments expose a path,
    // cwd/workdir, command, or child-execution capability. Such schema drift is
    // local-capability until audited and therefore fails closed.
    const object = firstPathObject(args)
    const suspicious = ['path', 'file_path', 'filePath', 'cwd', 'workdir', 'command', 'root', 'directory', 'target'].some(key => key in object)
    return suspicious ? `Worktree Session 不支持未经审计的本地能力工具 contract：${name}` : undefined
  }
  if (contract.kind === 'delegation') {
    if (name === 'send_message') return undefined
    if (!continuableDelegationTools.includes(name) || firstPathObject(args).run_in_background === false) return `Worktree Session 只允许 Host 配置已审计且可证明首步前继承策略的 continuable background delegation：${name}`
    return undefined
  }
  if (contract.kind === 'maintenance') return undefined
  const managedRoot = normalize(operation.worktreePath)

  if (contract.kind === 'bash') {
    const argsObject = firstPathObject(args)
    const workdir = typeof argsObject.workdir === 'string' ? argsObject.workdir : undefined
    if (workdir === undefined || workdir === '') return `bash 需要显式指定托管执行目录（worktree）内的 workdir：${managedRoot}`
    if (!isAbsolute(workdir)) return 'bash workdir 必须是托管执行目录内的绝对路径'
    const normalized = normalize(workdir)
    if (!lexicalWithin(managedRoot, normalized)) return `bash workdir ${normalized} 超出托管执行目录 ${managedRoot}`
    return undefined
  }

  if (contract.kind === 'search') {
    const path = firstPathOf(args)
    if (path === undefined) return 'worktree root policy 要求显式指定托管执行目录内的搜索根'
    if (!isAbsolute(path)) return `搜索工具必须使用托管执行目录内的绝对路径：${path}`
    if (!lexicalWithin(managedRoot, normalize(path))) return `搜索根 ${path} 超出托管执行目录 ${managedRoot}`
    return undefined
  }

  // path-bearing tools (read/edit/write): all local targets must be inside the
  // managed root. Multi-target tools iterate their path-bearing fields.
  const argsObject = firstPathObject(args)
  for (const key of contract.pathFields) {
    const raw = argsObject[key]
    const entries = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : (typeof raw === 'string' ? [raw] : [])
    for (const entry of entries) {
      if (!isAbsolute(entry)) return `文件工具必须使用托管执行目录内的绝对路径：${entry}`
      if (!lexicalWithin(managedRoot, normalize(entry))) return `文件目标 ${entry} 超出托管执行目录 ${managedRoot}`
    }
  }
  return undefined
}

function auditedPaths(name: string, args: unknown): readonly string[] {
  const contract = TOOL_CONTRACTS[name]
  if (contract === undefined || contract.kind === 'delegation' || contract.kind === 'maintenance' || contract.kind === 'non-local') return []
  const object = firstPathObject(args)
  return contract.pathFields.flatMap(field => {
    const raw = object[field]
    if (typeof raw === 'string') return [raw]
    return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : []
  })
}

/** Physical canonical gate for symlinked ancestors and non-existent outputs. */
export async function physicalDecision(exec: Pick<ToolExecution, 'name' | 'arguments'>, operation: OperationRecord): Promise<PreToolDecision> {
  if (bindingOf(operation)?.state === 'cleaned') return { kind: 'allow' } // monotonic guard owns the stable terminal denial
  const contract = TOOL_CONTRACTS[exec.name]
  if (contract === undefined || contract.kind === 'delegation' || contract.kind === 'non-local') return { kind: 'allow' }
  for (const path of auditedPaths(exec.name, exec.arguments)) {
    const result = await confinePath(operation.worktreePath, path, { requireAbsolute: contract.requiredAbsolute })
    if (!result.allowed) return { kind: 'deny', reason: result.reason }
  }
  return { kind: 'allow' }
}

/** Install synchronous contract guard plus asynchronous physical containment. */
export function installGuard(agent: Agent, operation: OperationRecord, validationFailure?: string, continuableDelegationTools: readonly string[] = []): () => void {
  const disposeGuard = agent.ctx.tools.guard((exec: ToolExecution) => checkTool({ name: exec.name, args: exec.arguments }, operation, validationFailure, continuableDelegationTools))
  const disposePhysical = agent.ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await physicalDecision(exec, operation)
    return decision.kind === 'allow' ? next() : decision
  })
  return () => { disposePhysical(); disposeGuard() }
}

export { confinePath, firstPathOf } from './containment.js'
