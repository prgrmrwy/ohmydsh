import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { BindSourceResult, OperationPhase, OperationRecord, PreparedOperationResult, SessionStatusResult, SourceBindingState, StartOperationRequest } from '../wire.js'
import { bindingOf, isCurrentBinding, publicBindingLifecycle } from '../wire.js'
import { cacheHealthy, dependencyFingerprint, ensureLeanLink, leanLinkMatches, prepareDependencyCache, preparePnpmDependencies } from './dependencies.js'
import { prepareEnvironment, ensureWorktreeExclude } from './environment.js'
import { WsError, messageOf } from './errors.js'
import { atomicJson, isDirectory, readJson, withMkdirLock } from './fs.js'
import { allocateTask, branchExists, createGitClient, createTaskWorktree, discoverRepo, listWorktrees, pruneInvalidRegistrations, resolveCommit, taskSlug, withinRepo, type GitClient } from './git.js'
import { runProcess, type ProcessRunner } from './process.js'
import { detectPackageManager } from './project.js'

export interface OperationDeps {
  git?: GitClient
  runner?: ProcessRunner
  now?: () => Date
}

const flights = new Map<string, Promise<PreparedOperationResult>>()

export function operationFile(gitCommonDir: string, operationId: string): string {
  return join(gitCommonDir, 'ws', 'operations', `${operationId}.json`)
}

export async function loadOperation(gitCommonDir: string, operationId: string): Promise<OperationRecord | undefined> {
  const record: unknown = await readJson(operationFile(gitCommonDir, operationId))
  if (record === undefined) return undefined
  const schemaVersion = (record as Partial<OperationRecord>).schemaVersion
  if (schemaVersion !== 2) {
    throw new WsError('UNSUPPORTED_SCHEMA_VERSION', `Unsupported Worktree Session operation schemaVersion ${String(schemaVersion)}; the legacy target-Workspace flow has been retired and only schema-v2 source-session bindings are supported`)
  }
  return record as OperationRecord
}

export async function saveOperation(operation: OperationRecord, now = new Date()): Promise<OperationRecord> {
  const next = { ...operation, updatedAt: now.toISOString() }
  await atomicJson(operationFile(operation.gitCommonDir, operation.operationId), next)
  return next
}

function validateOperationId(id: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(id) || id.includes('..')) throw new WsError('INVALID_REQUEST', 'operationId must be 8-128 safe characters')
}

function hashTask(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function validateReplay(existing: OperationRecord, request: StartOperationRequest, repoRoot: string): void {
  if (existing.repoRoot !== repoRoot || existing.baseRef !== request.baseRef || existing.taskHash !== hashTask(request.taskText)) {
    throw new WsError('OPERATION_CONFLICT', 'operationId already belongs to a different start request')
  }
}

function resultOf(operation: OperationRecord): PreparedOperationResult {
  if (operation.phase !== 'prepared' || operation.lockFingerprint === undefined) throw new WsError('OPERATION_INVALID', 'Operation is not prepared', { retryable: true, phase: operation.phase })
  return {
    operationId: operation.operationId,
    phase: 'prepared',
    worktreePath: operation.worktreePath,
    taskBranch: operation.taskBranch,
    baseCommit: operation.baseCommit,
    dependencyMode: operation.dependencyMode,
    packageManager: operation.packageManager ?? 'npm',
    lockFingerprint: operation.lockFingerprint,
    dshHome: operation.dshHome,
  }
}

async function validateResource(operation: OperationRecord, phase: OperationPhase, git: GitClient, runner: ProcessRunner): Promise<boolean> {
  if (phase === 'branch-created') return branchExists(operation.repoRoot, operation.taskBranch, git)
  if (phase === 'worktree-created') {
    if (!(await isDirectory(operation.worktreePath))) return false
    return (await listWorktrees(operation.repoRoot, git)).some(entry => entry.path === operation.worktreePath && entry.branch === `refs/heads/${operation.taskBranch}`)
  }
  if (phase === 'dependencies-ready') {
    if (operation.packageManager === 'pnpm') {
      // pnpm installs directly in the worktree (design D2): readiness is the
      // unchanged lockfile fingerprint plus an existing node_modules tree.
      if (operation.lockFingerprint === undefined) return false
      const expected = await dependencyFingerprint(operation.worktreePath, runner, 'pnpm')
      if (expected.fingerprint !== operation.lockFingerprint) return false
      return await isDirectory(join(operation.worktreePath, 'node_modules'))
    }
    if (operation.lockFingerprint === undefined || operation.cacheNodeModules === undefined) return false
    const expected = await dependencyFingerprint(operation.worktreePath, runner, 'npm')
    if (expected.fingerprint !== operation.lockFingerprint) return false
    const cacheRoot = join(operation.cacheNodeModules, '..')
    return await cacheHealthy(cacheRoot, expected, runner) && await leanLinkMatches(operation.worktreePath, operation.cacheNodeModules)
  }
  if (phase === 'environment-ready' || phase === 'prepared') {
    if (!(await validateResource(operation, 'worktree-created', git, runner))) return false
    if (operation.dependencyMode === 'lean' && !(await validateResource(operation, 'dependencies-ready', git, runner))) return false
    if (operation.dshHome === '' || !(await isDirectory(operation.dshHome))) return false
    const env = await readJsonOrText(join(operation.worktreePath, '.env.local'))
    return env.includes(`DSH_HOME='${operation.dshHome.replaceAll("'", "'\\''")}'`)
  }
  return true
}

async function readJsonOrText(path: string): Promise<string> {
  try { return await (await import('node:fs/promises')).readFile(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

async function performStart(request: StartOperationRequest, deps: OperationDeps): Promise<PreparedOperationResult> {
  validateOperationId(request.operationId)
  if (request.taskText.trim() === '') throw new WsError('INVALID_REQUEST', 'taskText must be non-empty')
  if (request.dependencyMode !== 'lean') throw new WsError('INVALID_REQUEST', 'Only lean dependency mode is supported at start')
  const runner = deps.runner ?? runProcess
  const git = deps.git ?? createGitClient(runner)
  const now = deps.now ?? (() => new Date())
  const repo = await discoverRepo(request.repoPath, git)
  const requestedPath = await (await import('node:fs/promises')).realpath(request.repoPath)
  if (!withinRepo(repo.repoRoot, requestedPath)) throw new WsError('OUTSIDE_REPOSITORY', 'Requested path is outside the repository root')
  await ensureWorktreeExclude(repo.gitCommonDir)
  const lock = join(repo.gitCommonDir, 'ws', 'locks', 'repo.lock')
  return withMkdirLock(lock, async () => {
    let operation = await loadOperation(repo.gitCommonDir, request.operationId)
    if (operation !== undefined) validateReplay(operation, request, repo.repoRoot)
    // Resolve the dependency project type before creating ANY Git resource or
    // operation file (fail-closed for unsupported/mixed lockfiles).
    const resolution = operation === undefined
      ? await detectPackageManager(repo.repoRoot, git)
      : { packageManager: operation.packageManager ?? 'npm' }
    const packageManager = resolution.packageManager
    if (operation === undefined) {
      const baseCommit = await resolveCommit(repo.repoRoot, request.baseRef, git)
      const allocation = await allocateTask(repo.repoRoot, request.taskText, git)
      const timestamp = now().toISOString()
      operation = {
        schemaVersion: 2,
        operationId: request.operationId,
        repoRoot: repo.repoRoot,
        gitCommonDir: repo.gitCommonDir,
        baseRef: request.baseRef,
        baseCommit,
        taskBranch: allocation.branch,
        worktreePath: allocation.path,
        taskHash: hashTask(request.taskText),
        dependencyMode: 'lean',
        packageManager,
        ...(resolution.adoption === undefined ? {} : {
          diagnostics: [
            `混合 lockfile 裁决：采信 ${resolution.adoption.packageManager}（依据 ${resolution.adoption.signal === 'packageManager-field' ? 'package.json 的 packageManager 声明' : 'Git 跟踪状态'}），忽略 ${resolution.adoption.ignoredLockfile}`,
          ],
        }),
        dshHome: join(repo.gitCommonDir, 'ws', 'dsh-home', request.operationId),
        phase: 'allocated',
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      await saveOperation(operation, now())
    }
    if (operation.phase === 'cleaned') throw new WsError('OPERATION_CONFLICT', 'A cleaned operation cannot be restarted')
    if (operation.phase === 'prepared' && await validateResource(operation, 'prepared', git, runner)) return resultOf(operation)
    const diagnostics = [...(operation.diagnostics ?? [])]
    try {
      if (!(await validateResource(operation, 'branch-created', git, runner))) {
        await pruneInvalidRegistrations(operation.repoRoot, git)
        await createTaskWorktree(operation.repoRoot, operation.taskBranch, operation.worktreePath, operation.baseCommit, git)
      }
      operation = await saveOperation({ ...operation, phase: 'branch-created' }, now())
      if (!(await validateResource(operation, 'worktree-created', git, runner))) {
        if (await branchExists(operation.repoRoot, operation.taskBranch, git) && !(await isDirectory(operation.worktreePath))) {
          // A crashed/deleted checkout can leave Git's registration behind.
          // Prune it before re-adding the recorded branch; otherwise every
          // replay fails with "missing but already registered worktree".
          await pruneInvalidRegistrations(operation.repoRoot, git)
          await createTaskWorktree(operation.repoRoot, operation.taskBranch, operation.worktreePath, operation.baseCommit, git)
        }
      }
      if (!(await validateResource(operation, 'worktree-created', git, runner))) throw new WsError('OPERATION_INVALID', 'Created worktree failed validation', { phase: 'worktree-created', retryable: true })
      operation = await saveOperation({ ...operation, phase: 'worktree-created' }, now())
      if (!(await validateResource(operation, 'dependencies-ready', git, runner))) {
        if (operation.packageManager === 'pnpm') {
          const prepared = await preparePnpmDependencies(operation.worktreePath, runner)
          operation = { ...operation, lockFingerprint: prepared.fingerprint }
        } else {
          const cache = await prepareDependencyCache(operation.worktreePath, operation.gitCommonDir, runner)
          await ensureLeanLink(operation.worktreePath, cache.nodeModules)
          operation = { ...operation, lockFingerprint: cache.fingerprint, cacheNodeModules: cache.nodeModules }
        }
      }
      operation = await saveOperation({ ...operation, phase: 'dependencies-ready' }, now())
      const dshHome = await prepareEnvironment(operation.repoRoot, operation.worktreePath, operation.gitCommonDir, operation.operationId, git)
      operation = await saveOperation({ ...operation, dshHome, phase: 'environment-ready' }, now())
      operation = await saveOperation({ ...operation, phase: 'prepared' }, now())
      return resultOf(operation)
    } catch (error) {
      diagnostics.push(messageOf(error))
      await saveOperation({ ...operation, diagnostics: diagnostics.slice(-20) }, now())
      if (operation.phase === 'allocated' && await branchExists(operation.repoRoot, operation.taskBranch, git) && !(await isDirectory(operation.worktreePath))) {
        await git.maybe(operation.repoRoot, ['branch', '-D', operation.taskBranch])
      }
      throw error
    }
  }, { timeoutMs: 16 * 60_000, staleMs: 30 * 60_000 })
}

export function startOperation(request: StartOperationRequest, deps: OperationDeps = {}): Promise<PreparedOperationResult> {
  const key = `${request.repoPath}\0${request.operationId}`
  const current = flights.get(key)
  if (current !== undefined) return current
  const flight = performStart(request, deps).finally(() => { flights.delete(key) })
  flights.set(key, flight)
  return flight
}

export function createOperationId(): string {
  return randomUUID()
}

/** Resolve historical/audit metadata for a source Session, including released records. */
export async function findHistoryBySourceSession(gitCommonDir: string, sourceSessionId: string): Promise<OperationRecord | undefined> {
  const dir = join(gitCommonDir, 'ws', 'operations')
  let names: string[]
  try { names = await (await import('node:fs/promises')).readdir(dir) } catch {
    return undefined
  }
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue
    const operation = await loadOperation(gitCommonDir, name.slice(0, -'.json'.length))
    if (operation === undefined) continue
    const binding = bindingOf(operation)
    if (binding?.mode === 'source-session' && binding.sourceSessionId === sourceSessionId) return operation
  }
  return undefined
}

/** Resolve only the operation that currently owns the source Session. */
export async function findBySourceSession(gitCommonDir: string, sourceSessionId: string): Promise<OperationRecord | undefined> {
  const operation = await findHistoryBySourceSession(gitCommonDir, sourceSessionId)
  if (operation === undefined) return undefined
  return isCurrentBinding(bindingOf(operation)) ? operation : undefined
}

export type ArchiveReconcileMode = 'archive-observed' | 'unarchive-observed' | 'current-snapshot'

/**
 * Move a cleaned source binding monotonically through its archive lifecycle.
 * The caller supplies the current archive membership and holds no lock; this
 * helper takes the repository lock so event/status/recovery callers share one
 * idempotent durable transition boundary.
 */
export async function reconcileSourceArchiveLifecycle(options: {
  gitCommonDir: string
  sourceSessionId: string
  archived: boolean
  mode: ArchiveReconcileMode
  now?: () => Date
}): Promise<OperationRecord | undefined> {
  const lock = join(options.gitCommonDir, 'ws', 'locks', 'repo.lock')
  return withMkdirLock(lock, async () => {
    const operation = await findHistoryBySourceSession(options.gitCommonDir, options.sourceSessionId)
    if (operation === undefined) return undefined
    const binding = bindingOf(operation)
    if (binding?.mode !== 'source-session') return operation
    if (binding.state === 'released') return operation
    const legacy = operation.phase === 'cleaned' && binding.state === 'cleaned' && binding.archiveLifecycle === undefined
    let state: SourceBindingState | undefined
    if (legacy && options.mode === 'current-snapshot') state = options.archived ? 'cleaned-archived' : 'released'
    else if (binding.archiveLifecycle?.version === 1 && binding.state === 'cleaned' && options.archived && (options.mode === 'archive-observed' || options.mode === 'current-snapshot')) state = 'cleaned-archived'
    else if (binding.archiveLifecycle?.version === 1 && binding.state === 'cleaned-archived' && !options.archived && (options.mode === 'unarchive-observed' || options.mode === 'current-snapshot')) state = 'released'
    if (state === undefined) return operation
    const now = options.now?.() ?? new Date()
    return saveOperation({
      ...operation,
      binding: { ...binding, state, archiveLifecycle: { version: 1 }, updatedAt: now.toISOString() },
    }, now)
  })
}

function ensureFreshSourceBinding(operation: OperationRecord, sourceSessionId: string): OperationRecord {
  if (operation.binding !== undefined && operation.binding.mode === 'source-session') return operation
  return { ...operation, binding: { mode: 'source-session', sourceSessionId, state: 'bound', updatedAt: new Date().toISOString() } }
}

export async function bindSource(request: { operationId: string; repoPath: string; sourceSessionId: string }): Promise<BindSourceResult> {
  validateOperationId(request.operationId)
  if (request.sourceSessionId.trim() === '') throw new WsError('INVALID_REQUEST', 'sourceSessionId must be non-empty')
  const repo = await discoverRepo(request.repoPath)
  const requestedPath = await (await import('node:fs/promises')).realpath(request.repoPath)
  if (!withinRepo(repo.repoRoot, requestedPath)) throw new WsError('OUTSIDE_REPOSITORY', 'Requested path is outside the repository root')
  const lock = join(repo.gitCommonDir, 'ws', 'locks', 'repo.lock')
  return withMkdirLock(lock, async () => {
    const operation = await loadOperation(repo.gitCommonDir, request.operationId)
    if (operation === undefined || operation.phase !== 'prepared') throw new WsError('OPERATION_NOT_FOUND', 'Prepared operation not found')
    if (operation.repoRoot !== repo.repoRoot) throw new WsError('OPERATION_CONFLICT', 'Operation belongs to a different repository')
    const owned = await findBySourceSession(repo.gitCommonDir, request.sourceSessionId)
    if (owned !== undefined && owned.operationId !== operation.operationId) {
      throw new WsError('OPERATION_CONFLICT', `Session ${request.sourceSessionId} is already bound to operation ${owned.operationId}`)
    }
    const current = bindingOf(operation)
    if (current?.mode === 'source-session' && current.state === 'released') {
      throw new WsError('OPERATION_CONFLICT', 'A released historical operation cannot be rebound')
    }
    if (current?.mode === 'source-session' && current.sourceSessionId !== request.sourceSessionId) {
      throw new WsError('OPERATION_CONFLICT', `Operation is already bound to source Session ${current.sourceSessionId}`)
    }
    const updated = await saveOperation(ensureFreshSourceBinding(operation, request.sourceSessionId))
    const binding = bindingOf(updated)
    return { sourceSessionId: request.sourceSessionId, state: binding?.mode === 'source-session' ? publicBindingLifecycle(binding) : 'bound', submitAllowed: false }
  })
}

export async function updateSourceBinding(request: { operationId: string; repoPath: string; sourceSessionId: string; action: 'bind-source' | 'claim-submit' | 'admitted' | 'uncertain' | 'cleaned' }): Promise<BindSourceResult> {
  validateOperationId(request.operationId)
  const repo = await discoverRepo(request.repoPath)
  const lock = join(repo.gitCommonDir, 'ws', 'locks', 'repo.lock')
  return withMkdirLock(lock, async () => {
    const operation = await loadOperation(repo.gitCommonDir, request.operationId)
    if (operation === undefined || operation.phase !== 'prepared') throw new WsError('OPERATION_NOT_FOUND', 'Prepared operation not found')
    const current = bindingOf(operation)
    if (current?.mode === 'source-session' && (current.state === 'cleaned-archived' || current.state === 'released')) {
      throw new WsError('OPERATION_CONFLICT', `Binding lifecycle ${current.state} is terminal and cannot regress`)
    }
    if (current?.mode === 'source-session' && current.sourceSessionId !== request.sourceSessionId) {
      throw new WsError('OPERATION_CONFLICT', `Operation is already bound to source Session ${current.sourceSessionId}`)
    }
    let next = ensureFreshSourceBinding(operation, request.sourceSessionId)
    const binding = bindingOf(next)
    if (binding === undefined || binding.mode !== 'source-session') throw new WsError('OPERATION_INVALID', 'Binding was not established')
    let state = binding.state
    let submitAllowed = false
    if (request.action === 'claim-submit') {
      if (binding.state === 'bound') { state = 'submit-claimed'; submitAllowed = true }
      else state = binding.state
    } else if (request.action !== 'bind-source') {
      state = request.action
    }
    next = { ...next, binding: { ...binding, state, updatedAt: new Date().toISOString() } }
    await saveOperation(next)
    return { sourceSessionId: request.sourceSessionId, state: publicBindingLifecycle({ ...binding, state }), submitAllowed }
  })
}

export async function sessionStatus(repoPath: string, sourceSessionId: string): Promise<SessionStatusResult> {
  const repo = await discoverRepo(repoPath)
  const operation = await findBySourceSession(repo.gitCommonDir, sourceSessionId)
  if (operation === undefined) return { bound: false }
  const binding = bindingOf(operation)
  if (binding === undefined || binding.mode !== 'source-session') return { bound: false }
  return {
    bound: true,
    operationId: operation.operationId,
    phase: operation.phase,
    taskBranch: operation.taskBranch,
    worktreePath: operation.worktreePath,
    dependencyMode: operation.dependencyMode,
    packageManager: operation.packageManager ?? 'npm',
    lifecycle: publicBindingLifecycle(binding),
    cleaned: binding.state === 'cleaned' || binding.state === 'cleaned-archived',
  }
}
