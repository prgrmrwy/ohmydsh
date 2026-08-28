import { readdir, realpath } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { CleanResult, OperationRecord, PromoteResult, RepoCleanIgnored, RepoCleanRefusal, RepoCleanResult, StatusResult } from '../wire.js'
import { bindingOf } from '../wire.js'
import { promotePnpmDependencies, promoteDependencies } from './dependencies.js'
import { WsError, messageOf } from './errors.js'
import { withMkdirLock } from './fs.js'
import { createGitClient, discoverRepo, listWorktrees, worktreeStatus, type GitClient } from './git.js'
import { findBySourceSession, loadOperation, operationFile, saveOperation } from './operation.js'
import { runProcess, type ProcessRunner } from './process.js'

function statusOf(operation: OperationRecord): StatusResult {
  return {
    operationId: operation.operationId,
    phase: operation.phase,
    repoRoot: operation.repoRoot,
    baseRef: operation.baseRef,
    baseCommit: operation.baseCommit,
    taskBranch: operation.taskBranch,
    worktreePath: operation.worktreePath,
    dependencyMode: operation.dependencyMode,
    packageManager: operation.packageManager ?? 'npm',
    ...(operation.lockFingerprint === undefined ? {} : { lockFingerprint: operation.lockFingerprint }),
    dshHome: operation.dshHome,
  }
}

export async function resolveOperation(path: string, git = createGitClient()): Promise<OperationRecord> {
  const repo = await discoverRepo(path, git)
  const absolute = await realpath(path)
  const worktree = (await listWorktrees(repo.repoRoot, git))
    .filter(entry => absolute === entry.path || absolute.startsWith(`${entry.path}${sep}`))
    .sort((a, b) => b.path.length - a.path.length)[0]
  if (worktree === undefined) throw new WsError('OPERATION_NOT_FOUND', `No registered worktree owns ${path}`)
  const operationsDir = join(repo.gitCommonDir, 'ws', 'operations')
  let names: string[]
  try { names = await (await import('node:fs/promises')).readdir(operationsDir) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new WsError('OPERATION_NOT_FOUND', 'No Worktree Session operations exist')
    throw error
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const operation = await loadOperation(repo.gitCommonDir, name.slice(0, -'.json'.length))
    if (operation?.worktreePath === worktree.path) return operation
  }
  throw new WsError('OPERATION_NOT_FOUND', `Worktree is not registered to Worktree Session: ${worktree.path}`)
}

export interface MaintenanceTarget {
  path?: string
  sessionId?: string
  repoPath?: string
}

export async function resolveMaintenanceTarget(target: string | MaintenanceTarget, git = createGitClient()): Promise<OperationRecord> {
  if (typeof target === 'string') return resolveOperation(target, git)
  if (target.sessionId !== undefined) {
    if (target.repoPath === undefined) throw new WsError('INVALID_REQUEST', 'repoPath is required with sessionId')
    const repo = await discoverRepo(target.repoPath, git)
    const operation = await findBySourceSession(repo.gitCommonDir, target.sessionId)
    if (operation === undefined) throw new WsError('OPERATION_NOT_FOUND', `No Worktree Session binding exists for Session ${target.sessionId}`)
    return operation
  }
  if (target.path !== undefined) return resolveOperation(target.path, git)
  throw new WsError('INVALID_REQUEST', 'Provide sessionId + repoPath, or an explicit compatibility path')
}

export async function wsStatus(target: string | MaintenanceTarget, git = createGitClient()): Promise<StatusResult> {
  return statusOf(await resolveMaintenanceTarget(target, git))
}

export async function wsPromote(target: string | MaintenanceTarget, options: { runner?: ProcessRunner; git?: GitClient } = {}): Promise<PromoteResult> {
  const initial = await resolveMaintenanceTarget(target, options.git)
  const lock = join(initial.gitCommonDir, 'ws', 'locks', 'repo.lock')
  return withMkdirLock(lock, async () => {
    const operation = await resolveMaintenanceTarget(target, options.git)
    if (operation.phase !== 'prepared') throw new WsError('PROMOTE_REFUSED', `Operation phase ${operation.phase} is not prepared`)
    if (operation.dependencyMode === 'mutable') return { ...statusOf(operation), dependencyMode: 'mutable' }
    if (operation.packageManager === 'pnpm') await promotePnpmDependencies(operation.worktreePath, options.runner ?? runProcess)
    else await promoteDependencies(operation, options.runner ?? runProcess)
    const updated = await saveOperation({ ...operation, dependencyMode: 'mutable' })
    return { ...statusOf(updated), dependencyMode: 'mutable' }
  }, { timeoutMs: 16 * 60_000, staleMs: 30 * 60_000 })
}

export async function wsClean(targetInput: string | MaintenanceTarget, options: {
  dryRun?: boolean
  activePaths?: readonly string[]
  activeBoundSessionIds?: readonly string[]
  cwd?: string
  git?: GitClient
  requireActivePaths?: boolean
} = {}): Promise<CleanResult> {
  const git = options.git ?? createGitClient()
  const initial = await resolveMaintenanceTarget(targetInput, git)
  const lock = join(initial.gitCommonDir, 'ws', 'locks', 'repo.lock')
  return withMkdirLock(lock, async () => {
    const operation = await resolveMaintenanceTarget(targetInput, git)
    const cwd = resolve(options.cwd ?? process.cwd())
    const target = resolve(operation.worktreePath)
    if (options.requireActivePaths === true && options.activePaths === undefined) throw new WsError('CLEAN_REFUSED', 'Active DSH Session paths were not supplied by the trusted Host')
    const active = (options.activePaths ?? []).map(item => resolve(item))
    if (cwd === target || cwd.startsWith(`${target}${sep}`)) throw new WsError('CLEAN_REFUSED', 'Refusing to clean the caller current worktree')
    if (active.some(item => item === target || item.startsWith(`${target}${sep}`))) throw new WsError('CLEAN_REFUSED', 'Refusing to clean a worktree used by an active DSH Session')
    const binding = bindingOf(operation)
    if (binding?.mode === 'source-session' && (options.activeBoundSessionIds ?? []).includes(binding.sourceSessionId)) throw new WsError('CLEAN_REFUSED', `Refusing to clean a worktree bound to active source Session ${binding.sourceSessionId}`)
    if (operation.phase !== 'prepared') throw new WsError('CLEAN_REFUSED', `Operation is in-flight at phase ${operation.phase}`)
    if ((await worktreeStatus(target, git)).trim() !== '') throw new WsError('CLEAN_REFUSED', 'Refusing to clean a dirty worktree')
    const baseTip = await git.run(operation.repoRoot, ['rev-parse', '--verify', `${operation.baseRef}^{commit}`])
    const taskHead = await git.run(operation.repoRoot, ['rev-parse', '--verify', `${operation.taskBranch}^{commit}`])
    const hasProgress = await git.runner('git', ['merge-base', '--is-ancestor', operation.baseCommit, taskHead.trim()], { cwd: operation.repoRoot })
    if (hasProgress.code !== 0) throw new WsError('CLEAN_REFUSED', `Task branch ${operation.taskBranch} no longer descends from its recorded base commit`)
    const ancestor = await git.runner('git', ['merge-base', '--is-ancestor', taskHead.trim(), baseTip.trim()], { cwd: operation.repoRoot })
    if (ancestor.code !== 0) throw new WsError('CLEAN_REFUSED', `Task branch ${operation.taskBranch} is not proven merged into ${operation.baseRef}`)
    const sourceBinding = operation.schemaVersion === 2 && binding?.mode === 'source-session' ? binding : undefined
    if (sourceBinding === undefined) throw new WsError('CLEAN_REFUSED', `Operation ${operation.operationId} has an unsupported or malformed maintenance binding`)
    const actions = [
      `git worktree remove ${target}`,
      `git branch -d ${operation.taskBranch}`,
      `retain cleaned tombstone ${operationFile(operation.gitCommonDir, operation.operationId)}`,
    ]
    if (options.dryRun === true) return { dryRun: true, operationId: operation.operationId, worktreePath: target, taskBranch: operation.taskBranch, actions, cleaned: false }
    await git.run(operation.repoRoot, ['worktree', 'remove', target])
    await git.run(operation.repoRoot, ['branch', '-d', operation.taskBranch])
    const { diagnostics: _diagnostics, cacheNodeModules: _cacheNodeModules, ...tombstone } = operation
    await saveOperation({
      ...tombstone,
      phase: 'cleaned',
      binding: { ...sourceBinding, state: 'cleaned', archiveLifecycle: { version: 1 }, updatedAt: new Date().toISOString() },
    })
    return { dryRun: false, operationId: operation.operationId, worktreePath: target, taskBranch: operation.taskBranch, actions, cleaned: true }
  }, { timeoutMs: 30_000, staleMs: 30 * 60_000 })
}

/** Deterministic operation-id list for one repository, oldest file name first. */
async function listOperationIds(gitCommonDir: string): Promise<readonly string[]> {
  let names: string[]
  try { names = await readdir(join(gitCommonDir, 'ws', 'operations')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return names.filter(name => name.endsWith('.json')).sort().map(name => name.slice(0, -'.json'.length))
}

export interface RepoCleanOptions {
  /** Source Sessions proven archived by the trusted Host; required, never inferred here. */
  archivedSessionIds: readonly string[]
  /** Native cwd of every live DSH Session, forwarded to each single-operation gate. */
  activePaths: readonly string[]
  /** Source Sessions currently protected by a live Agent/Session. */
  activeBoundSessionIds?: readonly string[]
  dryRun?: boolean
  cwd?: string
  git?: GitClient
}

/**
 * Scan one repository from its main checkout and clean every Worktree Session
 * whose source Session is archived and whose worktree passes the existing
 * single-operation safety gates.
 *
 * Candidates are independent: each one runs through `wsClean`, which takes the
 * repository lock and re-validates from disk, so a dirty, active, in-flight,
 * unmerged, malformed or unsupported record is reported and skipped without
 * blocking the rest. Nothing here deletes remote branches, shared caches,
 * Session history, or already-cleaned tombstones.
 */
export async function wsCleanRepository(repoPath: string, options: RepoCleanOptions): Promise<RepoCleanResult> {
  const git = options.git ?? createGitClient()
  const repo = await discoverRepo(repoPath, git)
  const cleaned: CleanResult[] = []
  const refused: RepoCleanRefusal[] = []
  const ignored: RepoCleanIgnored[] = []
  const archived = new Set(options.archivedSessionIds)
  const operationIds = await listOperationIds(repo.gitCommonDir)

  for (const operationId of operationIds) {
    let operation: OperationRecord | undefined
    try {
      operation = await loadOperation(repo.gitCommonDir, operationId)
    } catch (error) {
      // Retired schema versions and corrupt metadata are reported, never fixed
      // or deleted here: the operator decides what to do with the record.
      refused.push({ operationId, kind: 'unreadable', reason: messageOf(error), ...(error instanceof WsError ? { code: error.code } : {}) })
      continue
    }
    if (operation === undefined) continue
    const binding = bindingOf(operation)
    if (binding?.mode !== 'source-session') {
      refused.push({ operationId, kind: 'unreadable', reason: `Operation ${operationId} has an unsupported or malformed maintenance binding`, code: 'CLEAN_REFUSED', worktreePath: operation.worktreePath, taskBranch: operation.taskBranch })
      continue
    }
    if (binding.state === 'released') {
      ignored.push({ operationId, lifecycle: 'released', worktreePath: operation.worktreePath, taskBranch: operation.taskBranch })
      continue
    }
    if (operation.phase === 'cleaned' || binding.state === 'cleaned' || binding.state === 'cleaned-archived') {
      ignored.push({ operationId, lifecycle: 'cleaned', worktreePath: operation.worktreePath, taskBranch: operation.taskBranch })
      continue
    }
    const candidate = { operationId, sourceSessionId: binding.sourceSessionId, worktreePath: operation.worktreePath, taskBranch: operation.taskBranch }
    if (!archived.has(binding.sourceSessionId)) {
      refused.push({ ...candidate, kind: 'not-archived', reason: `Source Session ${binding.sourceSessionId} is not archived; archive it before cleaning its Worktree Session` })
      continue
    }
    try {
      cleaned.push(await wsClean(operation.worktreePath, {
        ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
        requireActivePaths: true,
        activePaths: options.activePaths,
        ...(options.activeBoundSessionIds === undefined ? {} : { activeBoundSessionIds: options.activeBoundSessionIds }),
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        git,
      }))
    } catch (error) {
      refused.push({ ...candidate, kind: 'refused', reason: messageOf(error), ...(error instanceof WsError ? { code: error.code } : {}) })
    }
  }

  return {
    dryRun: options.dryRun === true,
    repoRoot: repo.repoRoot,
    scanned: operationIds.length,
    cleaned,
    refused,
    ignored,
  }
}
