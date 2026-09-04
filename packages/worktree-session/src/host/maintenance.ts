import { readdir, realpath } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { CleanResult, MergeProof, OperationRecord, PromoteResult, RepoCleanArchiveOffer, RepoCleanIgnored, RepoCleanRefusal, RepoCleanResult, StatusResult } from '../wire.js'
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
  /**
   * The user confirmed finishing THIS operation's own source Session, so its
   * still-being-loaded state no longer blocks the clean.
   *
   * Narrow on purpose. Archiving a Session only adds it to the archive set; it
   * never unloads the agent, so the "bound source Session is live" gate would
   * otherwise never clear and a Session could never finish its own worktree —
   * a deadlock, not a safeguard. This waiver covers exactly that gate for
   * exactly that Session; every other gate, including the two that prove
   * nobody is standing INSIDE the worktree, still runs unchanged.
   */
  finishedSourceSessionId?: string
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
    // A live binding blocks the clean UNLESS the user just confirmed finishing
    // this exact Session. Note the two gates above already proved no live
    // Session — including this one — has its cwd inside the target, so the
    // waiver can never delete the ground someone is standing on.
    const finishedByUser = options.finishedSourceSessionId !== undefined
      && binding?.mode === 'source-session'
      && binding.sourceSessionId === options.finishedSourceSessionId
    if (!finishedByUser && binding?.mode === 'source-session' && (options.activeBoundSessionIds ?? []).includes(binding.sourceSessionId)) throw new WsError('CLEAN_REFUSED', `Refusing to clean a worktree bound to active source Session ${binding.sourceSessionId}`)
    if (operation.phase !== 'prepared') throw new WsError('CLEAN_REFUSED', `Operation is in-flight at phase ${operation.phase}`)
    if ((await worktreeStatus(target, git)).trim() !== '') throw new WsError('CLEAN_REFUSED', 'Refusing to clean a dirty worktree')
    const baseTip = await git.run(operation.repoRoot, ['rev-parse', '--verify', `${operation.baseRef}^{commit}`])
    const taskHead = await git.run(operation.repoRoot, ['rev-parse', '--verify', `${operation.taskBranch}^{commit}`])
    const hasProgress = await git.runner('git', ['merge-base', '--is-ancestor', operation.baseCommit, taskHead.trim()], { cwd: operation.repoRoot })
    if (hasProgress.code !== 0) throw new WsError('CLEAN_REFUSED', `Task branch ${operation.taskBranch} no longer descends from its recorded base commit`)
    // Merge is proven two ways. Ancestry is the strongest and stays first, so
    // the ordinary merge workflow is unchanged and costs nothing extra.
    const ancestor = await git.runner('git', ['merge-base', '--is-ancestor', taskHead.trim(), baseTip.trim()], { cwd: operation.repoRoot })
    let mergeProof: MergeProof = 'ancestor'
    if (ancestor.code !== 0) {
      // A rebase rewrites commit hashes, so work that IS on the base ref stops
      // being an ancestor of it. `git cherry` compares patch-ids instead:
      // every commit it prefixes with `-` already exists upstream, and a `+`
      // marks one that does not. Requiring the whole range to be `-` keeps the
      // invariant that unlanded work is never deleted, while letting a rebased
      // branch be recognised as landed.
      const cherry = await git.runner('git', ['cherry', operation.baseRef, operation.taskBranch], { cwd: operation.repoRoot })
      const lines = cherry.code === 0 ? cherry.stdout.split('\n').map(line => line.trim()).filter(line => line !== '') : undefined
      // An empty range means the branch carries no commits of its own — there
      // is nothing that could be unlanded. A failed command proves nothing.
      const equivalent = lines !== undefined && lines.every(line => line.startsWith('-'))
      if (!equivalent) throw new WsError('CLEAN_REFUSED', `Task branch ${operation.taskBranch} is not proven merged into ${operation.baseRef}`)
      mergeProof = 'patch-equivalent'
    }
    const sourceBinding = operation.schemaVersion === 2 && binding?.mode === 'source-session' ? binding : undefined
    if (sourceBinding === undefined) throw new WsError('CLEAN_REFUSED', `Operation ${operation.operationId} has an unsupported or malformed maintenance binding`)
    // `git branch -d` re-derives "merged" from ancestry alone, so after a
    // rebase it refuses a branch this clean has just proven landed by patch
    // equivalence — removing the worktree and then leaving the branch and the
    // lifecycle behind. Where our own proof is the stronger statement, `-D`
    // carries it out; an ancestry-proven branch keeps `-d` so Git's check
    // stays an independent second opinion.
    const deleteFlag = mergeProof === 'patch-equivalent' ? '-D' : '-d'
    const actions = [
      `git worktree remove ${target}`,
      `git branch ${deleteFlag} ${operation.taskBranch}`,
      `retain cleaned tombstone ${operationFile(operation.gitCommonDir, operation.operationId)}`,
    ]
    if (options.dryRun === true) return { dryRun: true, operationId: operation.operationId, worktreePath: target, taskBranch: operation.taskBranch, actions, cleaned: false, mergeProof }
    await git.run(operation.repoRoot, ['worktree', 'remove', target])
    await git.run(operation.repoRoot, ['branch', deleteFlag, operation.taskBranch])
    const { diagnostics: _diagnostics, cacheNodeModules: _cacheNodeModules, ...tombstone } = operation
    await saveOperation({
      ...tombstone,
      phase: 'cleaned',
      binding: { ...sourceBinding, state: 'cleaned', archiveLifecycle: { version: 1 }, updatedAt: new Date().toISOString() },
    })
    return { dryRun: false, operationId: operation.operationId, worktreePath: target, taskBranch: operation.taskBranch, actions, cleaned: true, mergeProof }
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
  /**
   * Asks the user whether to finish one unarchived-but-otherwise-safe
   * candidate. Injected by the trusted Host (the approval channel); omitted on
   * the operator CLI and HTTP paths, which have no trustworthy way to ask and
   * therefore keep the historical `not-archived` refusal.
   */
  confirmArchive?: (offer: RepoCleanArchiveOffer) => Promise<boolean>
  /**
   * Archives one source Session. Injected alongside `confirmArchive` so this
   * layer stays free of any DSH registry dependency and remains testable
   * without a running Host.
   */
  archiveSession?: (sourceSessionId: string) => Promise<void>
  /**
   * Restrict the whole pass to this one operation.
   *
   * The caller states the scope; nothing here infers it from who is calling.
   * Finishing one's own worktree and sweeping a repository are different
   * intents, and asking about unrelated candidates would turn a single
   * finishing action into a series of questions. Everything else — the gates,
   * the archive-then-clean offer, the per-candidate reporting — runs through
   * the same code path, so a narrow scope introduces no second set of rules.
   */
  onlyOperationId?: string
  /**
   * Restrict the pass to the operation bound to this source Session.
   *
   * Resolution lives here because this layer already discovered the repository
   * and owns the binding lookup; the tool layer would otherwise have to
   * rediscover both. Mutually exclusive with `onlyOperationId` in practice —
   * both express the same narrowed scope from different starting facts.
   */
  onlySourceSessionId?: string
  /**
   * Restrict the pass to the operation that owns this worktree path.
   *
   * The counterpart of `onlySourceSessionId` for a caller that holds a path
   * but no binding of its own — a Pet executor, whose cwd is the plugin
   * workspace while the binding lives on its source Session. All three
   * `only*` options express one narrowed scope; they differ only in which
   * fact the caller happens to have.
   */
  onlyWorktreePath?: string
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
  const allOperationIds = await listOperationIds(repo.gitCommonDir)
  // A narrowed scope that resolves to nothing is a failed request, not an
  // empty sweep: reporting "nothing to do" would read as success while the
  // intended target went untouched.
  let onlyOperationId = options.onlyOperationId
  // Entering through a worktree path makes `discoverRepo` report that worktree
  // as the repository root — correct for Git, wrong to echo back here, where
  // `repoRoot` means the main checkout the operations belong to. The operation
  // record carries that value, so the report names the same repository however
  // the call arrived.
  let reportedRepoRoot = repo.repoRoot
  if (options.onlyWorktreePath !== undefined) {
    // Resolution is the existing path lookup, which proves a registered
    // worktree owns the path before naming any operation.
    const owner = await resolveOperation(options.onlyWorktreePath, git)
    onlyOperationId = owner.operationId
    reportedRepoRoot = owner.repoRoot
  }
  if (options.onlySourceSessionId !== undefined) {
    const bound = await findBySourceSession(repo.gitCommonDir, options.onlySourceSessionId)
    if (bound === undefined) throw new WsError('OPERATION_NOT_FOUND', `Session ${options.onlySourceSessionId} has no current Worktree Session binding in ${repo.repoRoot}`)
    onlyOperationId = bound.operationId
  }
  if (onlyOperationId !== undefined && !allOperationIds.includes(onlyOperationId)) {
    throw new WsError('OPERATION_NOT_FOUND', `Operation ${onlyOperationId} is not registered in ${repo.repoRoot}`)
  }
  const operationIds = onlyOperationId === undefined ? allOperationIds : [onlyOperationId]

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
    let archivedBeforeClean = false
    if (!archived.has(binding.sourceSessionId)) {
      // The advice differs by caller because the next step differs. When this
      // call CAN offer to finish the candidate, telling the user to go archive
      // it by hand would send them off to do exactly what the next real run
      // would ask about — the reason a preview was read as "nothing to do".
      const offerable = options.confirmArchive !== undefined && options.archiveSession !== undefined
      const notArchived = {
        ...candidate,
        kind: 'not-archived' as const,
        reason: offerable
          // The channel is named because a danger-full-access session is told
          // "approval prompts are disabled", from which a caller can only
          // conclude this offer would be auto-rejected too. It travels on the
          // ask-a-human seam instead, and nothing else in the caller's context
          // reveals that.
          ? `Source Session ${binding.sourceSessionId} is not archived; a real run asks the user whether to archive it and finish this Worktree Session. That question uses the ask-a-human channel, not approval, so it is delivered even when approval prompts are disabled.`
          : `Source Session ${binding.sourceSessionId} is not archived; archive it before cleaning its Worktree Session`,
      }
      // Without an injected asker (operator CLI, HTTP) the historical refusal
      // stands: there is no trustworthy channel to obtain user intent.
      //
      // A dry run is refused here too. Previewing must not put a decision to
      // the user and must not archive anything: the caller asked what WOULD
      // happen, not to start it. Reporting the honest `not-archived` reason
      // tells them exactly what a real run would ask about.
      if (options.dryRun === true || options.confirmArchive === undefined || options.archiveSession === undefined) {
        refused.push(notArchived)
        continue
      }
      // Only offer to finish a candidate that is ALREADY safe on every other
      // gate. The existing dry run is that proof — it takes the repository
      // lock and evaluates every gate without removing anything — so no gate
      // is reimplemented here and none can be masked by archiving.
      //
      // The probe waives exactly one gate: "this candidate's own source
      // Session is still loaded". Finishing a Session necessarily happens
      // while it is loaded (archiving never unloads it), so leaving that gate
      // armed here would refuse every candidate before the user is ever asked
      // — the deadlock this flow exists to break. Every other gate, including
      // the two proving nobody's cwd is inside the worktree, stays armed.
      try {
        await wsClean(operation.worktreePath, {
          dryRun: true,
          requireActivePaths: true,
          activePaths: options.activePaths,
          ...(options.activeBoundSessionIds === undefined ? {} : { activeBoundSessionIds: options.activeBoundSessionIds }),
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          finishedSourceSessionId: binding.sourceSessionId,
          git,
        })
      } catch (error) {
        // The real blocker is reported instead of the archive precondition.
        refused.push({ ...candidate, kind: 'refused', reason: messageOf(error), ...(error instanceof WsError ? { code: error.code } : {}) })
        continue
      }
      const confirmed = await options.confirmArchive({ ...candidate, merged: true, clean: true })
      if (!confirmed) {
        refused.push(notArchived)
        continue
      }
      try {
        await options.archiveSession(binding.sourceSessionId)
      } catch (error) {
        // Nothing was removed: the candidate keeps every resource.
        refused.push({ ...candidate, kind: 'archive-failed', reason: messageOf(error), ...(error instanceof WsError ? { code: error.code } : {}) })
        continue
      }
      archivedBeforeClean = true
    }
    try {
      const result = await wsClean(operation.worktreePath, {
        ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
        requireActivePaths: true,
        activePaths: options.activePaths,
        ...(options.activeBoundSessionIds === undefined ? {} : { activeBoundSessionIds: options.activeBoundSessionIds }),
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        // Carry the waiver only for a candidate the user just confirmed
        // finishing in THIS call. An already-archived candidate never gets it:
        // its live-binding gate must still hold on its own.
        ...(archivedBeforeClean ? { finishedSourceSessionId: binding.sourceSessionId } : {}),
        git,
      })
      cleaned.push(archivedBeforeClean ? { ...result, archivedBeforeClean: true } : result)
    } catch (error) {
      // A candidate archived earlier in this call stays archived: archiving is
      // idempotent and user-reversible, while an automatic rollback would add
      // a second failure surface and could fight a concurrent user action. The
      // refusal is reported honestly instead of being dressed up as success.
      refused.push({ ...candidate, kind: 'refused', reason: messageOf(error), ...(error instanceof WsError ? { code: error.code } : {}) })
    }
  }

  // A preview's `cleaned: []` was read as "nothing to do here" more than once,
  // and the real run never happened — the offer the user is waiting for shows
  // up only as a refusal, which reads like a dead end. Counting the offerable
  // candidates makes the actionable outcome a first-class field instead of
  // something to be inferred from refusal prose.
  const wouldOfferToFinish = options.dryRun === true && options.confirmArchive !== undefined && options.archiveSession !== undefined
    ? refused.filter(entry => entry.kind === 'not-archived').length
    : 0
  return {
    dryRun: options.dryRun === true,
    repoRoot: reportedRepoRoot,
    scanned: operationIds.length,
    cleaned,
    refused,
    ignored,
    ...(wouldOfferToFinish > 0 ? { wouldOfferToFinish } : {}),
  }
}
