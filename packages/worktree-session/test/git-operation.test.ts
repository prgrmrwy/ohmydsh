import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { allocateTask, createGitClient, createTaskWorktree, discoverRepo, listRefs, listWorktrees, resolveCommit, taskSlug } from '../src/host/git.js'
import { loadOperation, startOperation } from '../src/host/operation.js'

const exec = promisify(execFile)
const roots: string[] = []

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec('git', args, { cwd, encoding: 'utf8' })).stdout
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ws-git-'))
  roots.push(root)
  await git(root, 'init', '-b', 'main')
  await git(root, 'config', 'user.email', 'ws@example.invalid')
  await git(root, 'config', 'user.name', 'WS Test')
  await writeFile(join(root, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n')
  await writeFile(join(root, 'package-lock.json'), '{"name":"fixture","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fixture","version":"1.0.0"}}}\n')
  await writeFile(join(root, '.gitignore'), '.env.local\nnode_modules/\n')
  await writeFile(join(root, '.env.local'), 'TOKEN=secret\n')
  await git(root, 'add', 'package.json', 'package-lock.json', '.gitignore')
  await git(root, 'commit', '-m', 'initial')
  return root
}

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('Git worktree operation', () => {
  it('discovers refs and creates two unique worktrees without moving main', async () => {
    const root = await fixture()
    const client = createGitClient()
    const before = await git(root, 'rev-parse', 'HEAD')
    const repo = await discoverRepo(root, client)
    expect((await listRefs(root, client)).some(ref => ref.name === 'main')).toBe(true)
    const one = await allocateTask(root, 'Fix login race', client)
    await createTaskWorktree(root, one.branch, one.path, before.trim(), client)
    const two = await allocateTask(root, 'Fix login race', client)
    expect(two.branch).toBe('ws/fix-login-race-2')
    await createTaskWorktree(root, two.branch, two.path, before.trim(), client)
    expect((await listWorktrees(root, client)).filter(item => item.path.includes('.worktrees')).length).toBe(2)
    expect((await git(root, 'branch', '--show-current')).trim()).toBe('main')
    expect((await git(root, 'rev-parse', 'HEAD')).trim()).toBe(before.trim())
    expect(repo.repoRoot).toBe(await (await import('node:fs/promises')).realpath(root))
  })

  it('supports deterministic non-ascii fallback and remote ref resolution', async () => {
    const root = await fixture()
    expect(taskSlug('修复并发')).toMatch(/^task-[0-9a-f]{10}$/)
    await git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    expect(await resolveCommit(root, 'origin/main')).toBe((await git(root, 'rev-parse', 'HEAD')).trim())
  })

  it('prunes only invalid stale registrations and resumes a partial branch', async () => {
    const root = await fixture()
    const client = createGitClient()
    const head = (await git(root, 'rev-parse', 'HEAD')).trim()
    const allocation = await allocateTask(root, 'partial create', client)
    await git(root, 'branch', allocation.branch, head)
    await createTaskWorktree(root, allocation.branch, allocation.path, head, client)
    expect((await listWorktrees(root, client)).some(item => item.path.endsWith(`/.worktrees/${allocation.slug}`))).toBe(true)
    await rm(allocation.path, { recursive: true, force: true })
    const { pruneInvalidRegistrations } = await import('../src/host/git.js')
    const pruned = await pruneInvalidRegistrations(root, client)
    expect(pruned.some(path => path.endsWith(`/.worktrees/${allocation.slug}`))).toBe(true)
    expect((await listWorktrees(root, client)).some(item => item.path.endsWith(`/.worktrees/${allocation.slug}`))).toBe(false)
  })

  it('serializes two concurrent starts from one base onto unique branches and one cache', async () => {
    const root = await fixture()
    const beforeBranch = (await git(root, 'branch', '--show-current')).trim()
    const beforeHead = (await git(root, 'rev-parse', 'HEAD')).trim()
    const [one, two] = await Promise.all([
      startOperation({ operationId: 'operation-concurrent-1', repoPath: root, baseRef: 'main', taskText: 'first concurrent task', dependencyMode: 'lean' }),
      startOperation({ operationId: 'operation-concurrent-2', repoPath: root, baseRef: 'main', taskText: 'second concurrent task', dependencyMode: 'lean' }),
    ])
    expect(one.taskBranch).not.toBe(two.taskBranch)
    expect(one.worktreePath).not.toBe(two.worktreePath)
    expect(one.lockFingerprint).toBe(two.lockFingerprint)
    expect(one.dshHome).not.toBe(two.dshHome)
    expect((await git(root, 'branch', '--show-current')).trim()).toBe(beforeBranch)
    expect((await git(root, 'rev-parse', 'HEAD')).trim()).toBe(beforeHead)
  }, 120_000)

  it('repairs deleted lean links and managed environment on prepared replay', async () => {
    const root = await fixture()
    const request = { operationId: 'operation-repair-1', repoPath: root, baseRef: 'main', taskText: 'repair prepared', dependencyMode: 'lean' as const }
    const prepared = await startOperation(request)
    await rm(join(prepared.worktreePath, 'node_modules'))
    await writeFile(join(prepared.worktreePath, '.env.local'), 'BROKEN=1\n')
    const replay = await startOperation(request)
    expect(await readlink(join(replay.worktreePath, 'node_modules'))).toContain('/ws/cache/npm/')
    expect(await readFile(join(replay.worktreePath, '.env.local'), 'utf8')).toContain(`DSH_HOME='${replay.dshHome}'`)
  }, 120_000)

  it('prunes a stale registration before recreating a deleted prepared worktree', async () => {
    const root = await fixture()
    const request = { operationId: 'operation-repair-worktree', repoPath: root, baseRef: 'main', taskText: 'repair missing worktree', dependencyMode: 'lean' as const }
    const prepared = await startOperation(request)
    await rm(prepared.worktreePath, { recursive: true, force: true })

    const stale = await listWorktrees(root)
    expect(stale.some(entry => entry.path === prepared.worktreePath && entry.prunable)).toBe(true)

    const replay = await startOperation(request)
    expect(replay).toEqual(prepared)
    expect((await listWorktrees(root)).some(entry => entry.path === prepared.worktreePath && !entry.prunable)).toBe(true)
  }, 120_000)

  it('resumes one operation id and keeps secrets out of metadata', async () => {
    const root = await fixture()
    const request = { operationId: 'operation-12345678', repoPath: root, baseRef: 'main', taskText: 'Prepare docs', dependencyMode: 'lean' as const }
    const first = await startOperation(request)
    const replay = await startOperation(request)
    expect(replay).toEqual(first)
    expect(first.worktreePath).not.toBe(root)
    const repo = await discoverRepo(root)
    const metadata = await readFile(join(repo.gitCommonDir, 'ws', 'operations', `${request.operationId}.json`), 'utf8')
    expect(metadata).not.toContain('TOKEN=secret')
    const operation = await loadOperation(repo.gitCommonDir, request.operationId)
    expect(operation?.phase).toBe('prepared')
    expect(await readFile(join(first.worktreePath, '.env.local'), 'utf8')).toContain(`DSH_HOME='${first.dshHome}'`)
  }, 120_000)
})
