import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { OperationRecord } from '../wire.js'
import { bindingOf } from '../wire.js'

export interface RecoveredBinding {
  operation: OperationRecord
  valid: boolean
  diagnostic?: string
  /**
   * The managed worktree could not be proven to still exist. Ownership follows
   * this fact alone: a binding whose execution directory is gone is released to
   * an ordinary Session, whatever its archive history. Archive history and
   * directory existence have no causal relation, so deciding ownership by the
   * former left two identically-deleted worktrees with different outcomes —
   * one recoverable, the other stuck denying every tool.
   *
   * Proof is the full identity check, never a bare path test: a directory
   * deleted and recreated under the same name is not the same managed worktree.
   */
  worktreeGone?: boolean
}

function gitCommonDir(repoRoot: string): string | undefined {
  const dotGit = join(repoRoot, '.git')
  try {
    if (statSync(dotGit).isDirectory()) return realpathSync(dotGit)
    const line = readFileSync(dotGit, 'utf8').trim()
    if (!line.startsWith('gitdir:')) return undefined
    const gitDirText = line.slice('gitdir:'.length).trim()
    const gitDir = realpathSync(isAbsolute(gitDirText) ? gitDirText : resolve(repoRoot, gitDirText))
    try {
      const commonText = readFileSync(join(gitDir, 'commondir'), 'utf8').trim()
      return realpathSync(resolve(gitDir, commonText))
    } catch { return gitDir }
  } catch { return undefined }
}

function identityDiagnostic(operation: OperationRecord): string | undefined {
  const binding = bindingOf(operation)
  if (binding?.mode !== 'source-session') return 'operation is not a source-session binding'
  try {
    if (!statSync(operation.worktreePath).isDirectory()) return `managed worktree is not a directory: ${operation.worktreePath}`
    const repoReal = realpathSync(operation.repoRoot)
    const worktreeReal = realpathSync(operation.worktreePath)
    if (!worktreeReal.startsWith(`${repoReal}/.worktrees/`)) return `managed worktree escaped repository allocation root: ${worktreeReal}`
    const branch = execFileSync('git', ['-C', operation.worktreePath, 'branch', '--show-current'], { encoding: 'utf8', timeout: 10_000 }).trim()
    if (branch !== operation.taskBranch) return `managed worktree branch ${branch || '(detached)'} does not equal ${operation.taskBranch}`
    const common = execFileSync('git', ['-C', operation.worktreePath, 'rev-parse', '--git-common-dir'], { encoding: 'utf8', timeout: 10_000 }).trim()
    const commonReal = realpathSync(isAbsolute(common) ? common : resolve(operation.worktreePath, common))
    if (commonReal !== realpathSync(operation.gitCommonDir)) return `managed worktree Git common dir does not match operation metadata`
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** Synchronously recover one Session binding so session-start can install policy before first assembly. */
export function recoverBindingSync(repoPath: string | undefined, sourceSessionId: string): RecoveredBinding | undefined {
  if (repoPath === undefined) return undefined
  let repoRoot: string
  try { repoRoot = realpathSync(repoPath) } catch { return undefined }
  const common = gitCommonDir(repoRoot)
  if (common === undefined) return undefined
  const operationsDir = join(common, 'ws', 'operations')
  let names: string[]
  try { names = readdirSync(operationsDir).filter(name => name.endsWith('.json')).sort() } catch { return undefined }
  for (const name of names) {
    let operation: OperationRecord
    try { operation = JSON.parse(readFileSync(join(operationsDir, name), 'utf8')) as OperationRecord } catch { continue }
    const binding = bindingOf(operation)
    if (binding?.mode !== 'source-session' || binding.sourceSessionId !== sourceSessionId || binding.state === 'released') continue
    let operationRepoRoot: string
    try { operationRepoRoot = realpathSync(operation.repoRoot) } catch { return { operation, valid: false, diagnostic: 'operation repository root is missing or invalid' } }
    if (operationRepoRoot !== repoRoot) return { operation, valid: false, diagnostic: 'source Session cwd no longer equals operation repository root' }
    const diagnostic = identityDiagnostic(operation)
    if (diagnostic === undefined) return { operation, valid: true }
    // Which failure this is depends on the binding's lifecycle, and the two
    // outcomes are opposites. For a CLEANED binding, an unprovable worktree is
    // the expected end state — its directory was deliberately removed — so the
    // binding is released and the Session becomes ordinary. For a binding that
    // is still live, the same failure means the managed directory it is
    // supposed to be executing in cannot be trusted, which keeps the existing
    // fail-closed denial. Releasing there would hand a broken binding MORE
    // freedom, so the distinction is deliberate.
    const cleaned = binding.state === 'cleaned' || binding.state === 'cleaned-archived'
    return cleaned
      ? { operation, valid: false, diagnostic, worktreeGone: true }
      : { operation, valid: false, diagnostic }
  }
  return undefined
}
