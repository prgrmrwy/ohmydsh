import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, normalize, relative, resolve, sep } from 'node:path'
import type { RefEntry, WorktreeEntry } from '../wire.js'
import { WsError } from './errors.js'
import { isDirectory } from './fs.js'
import { checkedProcess, runProcess, type ProcessRunner } from './process.js'

export interface RepoFacts {
  repoRoot: string
  gitCommonDir: string
  currentBranch?: string
  currentCommit: string
}

export interface GitClient {
  runner: ProcessRunner
  run(cwd: string, args: readonly string[], timeoutMs?: number): Promise<string>
  maybe(cwd: string, args: readonly string[], timeoutMs?: number): Promise<string | undefined>
}

export function createGitClient(runner: ProcessRunner = runProcess): GitClient {
  return {
    runner,
    run: (cwd, args, timeoutMs) => checkedProcess(runner, 'git', args, { cwd, ...(timeoutMs === undefined ? {} : { timeoutMs }), code: 'GIT_FAILED' }),
    async maybe(cwd, args, timeoutMs) {
      const result = await runner('git', args, { cwd, ...(timeoutMs === undefined ? {} : { timeoutMs }) })
      return result.code === 0 ? result.stdout : undefined
    },
  }
}

export async function discoverRepo(path: string, git = createGitClient()): Promise<RepoFacts> {
  if (!isAbsolute(path) || !(await isDirectory(path))) throw new WsError('NOT_A_REPOSITORY', 'Repository path must be an existing absolute directory')
  const top = await git.maybe(path, ['rev-parse', '--show-toplevel'])
  if (top === undefined) throw new WsError('NOT_A_REPOSITORY', `Not inside a Git repository: ${path}`)
  const root = normalize(await realpath(top.trim()))
  const commonOutput = (await git.run(path, ['rev-parse', '--git-common-dir'])).trim()
  const common = normalize(await realpath(resolve(path, commonOutput)))
  const branchOutput = (await git.maybe(path, ['branch', '--show-current']))?.trim()
  const commit = (await git.run(path, ['rev-parse', 'HEAD^{commit}'])).trim()
  return { repoRoot: root, gitCommonDir: common, ...(branchOutput ? { currentBranch: branchOutput } : {}), currentCommit: commit }
}

export async function listRefs(repoRoot: string, git = createGitClient()): Promise<RefEntry[]> {
  const format = '%(refname)%00%(refname:short)%00%(objectname)'
  const output = await git.run(repoRoot, ['for-each-ref', '--format', format, 'refs/heads', 'refs/remotes'])
  const refs: RefEntry[] = []
  for (const line of output.split('\n')) {
    if (line === '') continue
    const [fullName, shortName, commit] = line.split('\0')
    if (fullName === undefined || shortName === undefined || commit === undefined) continue
    if (fullName.startsWith('refs/remotes/') && shortName.endsWith('/HEAD')) continue
    refs.push({ name: shortName, fullName, kind: fullName.startsWith('refs/heads/') ? 'local' : 'remote', commit })
  }
  return refs.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
}

export async function resolveCommit(repoRoot: string, ref: string, git = createGitClient()): Promise<string> {
  if (ref.trim() === '' || ref.startsWith('-')) throw new WsError('INVALID_REQUEST', 'Base ref must be non-empty and must not start with -')
  const result = await git.maybe(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`])
  if (result === undefined || result.trim() === '') throw new WsError('INVALID_REQUEST', `Base ref cannot be resolved to a commit: ${ref}`)
  return result.trim()
}

export async function listWorktrees(repoRoot: string, git = createGitClient()): Promise<WorktreeEntry[]> {
  const output = await git.run(repoRoot, ['worktree', 'list', '--porcelain'])
  const entries: WorktreeEntry[] = []
  let current: Partial<WorktreeEntry> | undefined
  const flush = (): void => {
    if (current?.path === undefined || current.head === undefined) return
    entries.push({ path: normalize(current.path), head: current.head, bare: current.bare === true, detached: current.detached === true, prunable: current.prunable === true, ...(current.branch === undefined ? {} : { branch: current.branch }) })
  }
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) { flush(); current = { path: line.slice(9) } }
    else if (current !== undefined && line.startsWith('HEAD ')) current.head = line.slice(5)
    else if (current !== undefined && line.startsWith('branch ')) current.branch = line.slice(7)
    else if (current !== undefined && line === 'bare') current.bare = true
    else if (current !== undefined && line === 'detached') current.detached = true
    else if (current !== undefined && line.startsWith('prunable')) current.prunable = true
  }
  flush()
  return entries
}

export async function worktreeStatus(path: string, git = createGitClient()): Promise<string> {
  return git.run(path, ['status', '--porcelain=v1', '--untracked-files=all'])
}

export function taskSlug(taskText: string): string {
  const tokens = taskText.toLowerCase().match(/[a-z0-9]+/g) ?? []
  const joined = tokens.join('-').slice(0, 48).replace(/-+$/g, '')
  if (joined !== '') return joined
  return `task-${createHash('sha256').update(taskText).digest('hex').slice(0, 10)}`
}

export async function validateBranch(branch: string, repoRoot: string, git = createGitClient()): Promise<void> {
  const result = await git.runner('git', ['check-ref-format', '--branch', branch], { cwd: repoRoot })
  if (result.code !== 0) throw new WsError('INVALID_REQUEST', `Generated branch is invalid: ${branch}`)
}

export async function branchExists(repoRoot: string, branch: string, git = createGitClient()): Promise<boolean> {
  return (await git.maybe(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])) !== undefined
}

export async function allocateTask(repoRoot: string, taskText: string, git = createGitClient()): Promise<{ slug: string; branch: string; path: string }> {
  const base = taskSlug(taskText)
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const slug = suffix === 1 ? base : `${base}-${String(suffix)}`
    const branch = `ws/${slug}`
    const path = resolve(repoRoot, '.worktrees', slug)
    await validateBranch(branch, repoRoot, git)
    if (await branchExists(repoRoot, branch, git)) continue
    if (await isDirectory(path)) continue
    return { slug, branch, path }
  }
  throw new WsError('OPERATION_CONFLICT', 'Unable to allocate a unique task branch', { retryable: true })
}

export async function createTaskWorktree(repoRoot: string, branch: string, path: string, baseCommit: string, git = createGitClient()): Promise<void> {
  if (await branchExists(repoRoot, branch, git)) {
    const existingCommit = (await git.run(repoRoot, ['rev-parse', '--verify', `refs/heads/${branch}^{commit}`])).trim()
    if (existingCommit !== baseCommit) throw new WsError('OPERATION_CONFLICT', `Existing task branch ${branch} does not match the recorded base commit`)
    await git.run(repoRoot, ['worktree', 'add', path, branch], 120_000)
    return
  }
  await git.run(repoRoot, ['worktree', 'add', '-b', branch, path, baseCommit], 120_000)
}

export async function pruneInvalidRegistrations(repoRoot: string, git = createGitClient()): Promise<readonly string[]> {
  const paths: string[] = []
  for (const entry of await listWorktrees(repoRoot, git)) {
    if (!entry.prunable || await isDirectory(entry.path)) continue
    paths.push(entry.path)
  }
  if (paths.length > 0) await git.run(repoRoot, ['worktree', 'prune', '--expire', 'now'])
  return paths
}

export function withinRepo(repoRoot: string, candidate: string): boolean {
  const rel = relative(repoRoot, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

export function repoNameFromCommonDir(commonDir: string): string {
  return basename(dirname(commonDir))
}
