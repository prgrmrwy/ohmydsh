import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverRepo } from '../src/host/git.js'
import { wsClean } from '../src/host/maintenance.js'
import { bindSource, loadOperation, releaseMissingWorktreeBinding, saveOperation, startOperation } from '../src/host/operation.js'
import { recoverBindingSync } from '../src/host/recovery.js'
import { bindingOf } from '../src/wire.js'

const exec = promisify(execFile)
const roots: string[] = []

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec('git', args, { cwd, encoding: 'utf8' })).stdout
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ws-release-gone-')); roots.push(root)
  await git(root, 'init', '-b', 'main')
  await git(root, 'config', 'user.email', 'ws@example.invalid')
  await git(root, 'config', 'user.name', 'WS Test')
  await writeFile(join(root, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n')
  await writeFile(join(root, 'package-lock.json'), '{"name":"fixture","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fixture","version":"1.0.0"}}}\n')
  await writeFile(join(root, '.gitignore'), '.env.local\nnode_modules/\n')
  await git(root, 'add', '.')
  await git(root, 'commit', '-m', 'initial')
  return root
}

/** A candidate cleaned through the ordinary path, leaving a real tombstone. */
async function cleanedCandidate(root: string, id: string, session: string) {
  const prepared = await startOperation({ operationId: id, repoPath: root, baseRef: 'main', taskText: id, dependencyMode: 'lean' })
  await bindSource({ operationId: prepared.operationId, repoPath: root, sourceSessionId: session })
  await git(root, 'merge', '--no-ff', prepared.taskBranch, '-m', `merge ${id}`)
  await wsClean(prepared.worktreePath, { activePaths: [], cwd: root })
  return prepared
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('ownership follows whether the managed worktree still exists', () => {
  // 3.4 The core assertion of this change. Under the old behaviour a cleaned
  // binding that never went through an archive round trip stayed denied
  // forever, because release was reachable only via `cleaned-archived`.
  it('releases a never-archived cleaned binding whose worktree is gone', async () => {
    const root = await fixture()
    const target = await cleanedCandidate(root, 'operation-never-archived', 'session-never-archived')
    const repo = await discoverRepo(root)

    // Precondition: cleaning left it `cleaned`, never `cleaned-archived`.
    const before = await loadOperation(repo.gitCommonDir, target.operationId)
    expect(bindingOf(before!)?.state).toBe('cleaned')

    const recovered = recoverBindingSync(root, 'session-never-archived')
    expect(recovered?.worktreeGone).toBe(true)

    const released = await releaseMissingWorktreeBinding({ gitCommonDir: repo.gitCommonDir, sourceSessionId: 'session-never-archived' })
    expect(bindingOf(released!)?.state).toBe('released')

    // Released records are excluded from current-binding lookup, so the next
    // session-start installs no guard at all.
    expect(recoverBindingSync(root, 'session-never-archived')).toBeUndefined()
  }, 120_000)

  // 3.5 The opposite case must not regress: a live worktree keeps its binding.
  it('keeps a binding whose managed worktree still passes identity checks', async () => {
    const root = await fixture()
    const prepared = await startOperation({ operationId: 'operation-alive', repoPath: root, baseRef: 'main', taskText: 'alive', dependencyMode: 'lean' })
    await bindSource({ operationId: prepared.operationId, repoPath: root, sourceSessionId: 'session-alive' })

    const recovered = recoverBindingSync(root, 'session-alive')
    expect(recovered).toMatchObject({ valid: true })
    expect(recovered?.worktreeGone).toBeUndefined()
  }, 120_000)

  // 3.6 A bare `statSync` would accept a directory deleted and recreated under
  // the same name. The full identity check must reject it.
  it('treats a recreated same-name directory as not the managed worktree', async () => {
    const root = await fixture()
    const target = await cleanedCandidate(root, 'operation-recreated', 'session-recreated')

    // Recreate the removed worktree path as an ordinary directory.
    await exec('mkdir', ['-p', target.worktreePath])
    await writeFile(join(target.worktreePath, 'decoy.txt'), 'not a worktree\n')

    const recovered = recoverBindingSync(root, 'session-recreated')
    expect(recovered?.worktreeGone).toBe(true)
    expect(recovered?.valid).toBe(false)
  }, 120_000)

  // 3.7 Monotonicity: releasing is idempotent and never rolls a record back.
  it('leaves an already-released record untouched', async () => {
    const root = await fixture()
    const target = await cleanedCandidate(root, 'operation-monotonic', 'session-monotonic')
    const repo = await discoverRepo(root)

    const first = await releaseMissingWorktreeBinding({ gitCommonDir: repo.gitCommonDir, sourceSessionId: 'session-monotonic' })
    expect(bindingOf(first!)?.state).toBe('released')

    const second = await releaseMissingWorktreeBinding({ gitCommonDir: repo.gitCommonDir, sourceSessionId: 'session-monotonic' })
    expect(bindingOf(second!)?.state).toBe('released')
    expect(second!.binding).toEqual(first!.binding)
  }, 120_000)

  // 3.7 A still-live binding must NOT be released by this path: for it, an
  // unprovable worktree means "cannot trust where I execute", which stays
  // fail-closed instead of being granted ordinary-Session freedom.
  it('refuses to release a binding that is not cleaned', async () => {
    const root = await fixture()
    const prepared = await startOperation({ operationId: 'operation-live-broken', repoPath: root, baseRef: 'main', taskText: 'live', dependencyMode: 'lean' })
    await bindSource({ operationId: prepared.operationId, repoPath: root, sourceSessionId: 'session-live-broken' })
    const repo = await discoverRepo(root)

    // Break identity while the binding is still live.
    await git(prepared.worktreePath, 'checkout', '--detach')
    const recovered = recoverBindingSync(root, 'session-live-broken')
    expect(recovered?.valid).toBe(false)
    expect(recovered?.worktreeGone).toBeUndefined()

    const result = await releaseMissingWorktreeBinding({ gitCommonDir: repo.gitCommonDir, sourceSessionId: 'session-live-broken' })
    expect(bindingOf(result!)?.state).not.toBe('released')
  }, 120_000)

  // The tombstone itself is audit history and must survive the release.
  it('preserves the cleaned tombstone and its Git metadata', async () => {
    const root = await fixture()
    const target = await cleanedCandidate(root, 'operation-tombstone', 'session-tombstone')
    const repo = await discoverRepo(root)

    await releaseMissingWorktreeBinding({ gitCommonDir: repo.gitCommonDir, sourceSessionId: 'session-tombstone' })

    const after = await loadOperation(repo.gitCommonDir, target.operationId)
    expect(after).toBeDefined()
    expect(after!.phase).toBe('cleaned')
    expect(after!.taskBranch).toBe(target.taskBranch)
    expect(after!.worktreePath).toBe(target.worktreePath)
  }, 120_000)
})
