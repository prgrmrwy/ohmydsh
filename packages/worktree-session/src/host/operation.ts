import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { HandoffRequest, HandoffResult, OperationPhase, OperationRecord, PreparedOperationResult, StartOperationRequest } from '../wire.js'
import { cacheHealthy, dependencyFingerprint, ensureLeanLink, leanLinkMatches, prepareDependencyCache } from './dependencies.js'
import { prepareEnvironment, ensureWorktreeExclude } from './environment.js'
import { WsError, messageOf } from './errors.js'
import { atomicJson, isDirectory, readJson, withMkdirLock } from './fs.js'
import { allocateTask, branchExists, createGitClient, createTaskWorktree, discoverRepo, listWorktrees, pruneInvalidRegistrations, resolveCommit, taskSlug, withinRepo, type GitClient } from './git.js'
import { runProcess, type ProcessRunner } from './process.js'

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
  return readJson<OperationRecord>(operationFile(gitCommonDir, operationId))
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
    if (operation.lockFingerprint === undefined || operation.cacheNodeModules === undefined) return false
    const expected = await dependencyFingerprint(operation.worktreePath, runner)
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
    if (operation === undefined) {
      const baseCommit = await resolveCommit(repo.repoRoot, request.baseRef, git)
      const allocation = await allocateTask(repo.repoRoot, request.taskText, git)
      const timestamp = now().toISOString()
      operation = {
        schemaVersion: 1,
        operationId: request.operationId,
        repoRoot: repo.repoRoot,
        gitCommonDir: repo.gitCommonDir,
        baseRef: request.baseRef,
        baseCommit,
        taskBranch: allocation.branch,
        worktreePath: allocation.path,
        taskHash: hashTask(request.taskText),
        dependencyMode: 'lean',
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
          await createTaskWorktree(operation.repoRoot, operation.taskBranch, operation.worktreePath, operation.baseCommit, git)
        }
      }
      if (!(await validateResource(operation, 'worktree-created', git, runner))) throw new WsError('OPERATION_INVALID', 'Created worktree failed validation', { phase: 'worktree-created', retryable: true })
      operation = await saveOperation({ ...operation, phase: 'worktree-created' }, now())
      if (!(await validateResource(operation, 'dependencies-ready', git, runner))) {
        const cache = await prepareDependencyCache(operation.worktreePath, operation.gitCommonDir, runner)
        await ensureLeanLink(operation.worktreePath, cache.nodeModules)
        operation = { ...operation, lockFingerprint: cache.fingerprint, cacheNodeModules: cache.nodeModules }
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

export async function updateHandoff(request: HandoffRequest): Promise<HandoffResult> {
  validateOperationId(request.operationId)
  const repo = await discoverRepo(request.repoPath)
  const lock = join(repo.gitCommonDir, 'ws', 'locks', 'repo.lock')
  return withMkdirLock(lock, async () => {
    const operation = await loadOperation(repo.gitCommonDir, request.operationId)
    if (operation === undefined || operation.phase !== 'prepared') throw new WsError('OPERATION_NOT_FOUND', 'Prepared operation not found')
    const current = operation.handoff
    if (current !== undefined && current.targetSessionId !== request.targetSessionId) throw new WsError('OPERATION_CONFLICT', 'Operation is already bound to another target Session')
    let state: NonNullable<OperationRecord['handoff']>['state']
    let submitAllowed = false
    if (request.action === 'bind-target') state = current?.state ?? 'target-bound'
    else if (request.action === 'claim-submit') {
      if (current?.state === 'submit-claimed' || current?.state === 'admitted' || current?.state === 'uncertain') state = current.state
      else { state = 'submit-claimed'; submitAllowed = true }
    } else state = request.action
    const updatedAt = new Date().toISOString()
    await saveOperation({ ...operation, handoff: { state, targetSessionId: request.targetSessionId, updatedAt } })
    return { state, targetSessionId: request.targetSessionId, submitAllowed }
  })
}

export function createOperationId(): string {
  return randomUUID()
}
