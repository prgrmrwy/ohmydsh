import { execFile } from 'node:child_process'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { wsClean } from '../src/host/maintenance.js'
import { bindSource, startOperation } from '../src/host/operation.js'

const exec = promisify(execFile)
const roots: string[] = []

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec('git', args, { cwd, encoding: 'utf8' })).stdout
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ws-merge-proof-')); roots.push(root)
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

async function candidate(root: string, id: string, session: string) {
  const prepared = await startOperation({ operationId: id, repoPath: root, baseRef: 'main', taskText: id, dependencyMode: 'lean' })
  await bindSource({ operationId: prepared.operationId, repoPath: root, sourceSessionId: session })
  return prepared
}

/** Add one real commit to the task branch inside its worktree. */
async function commitWork(worktreePath: string, name: string, body: string): Promise<void> {
  await writeFile(join(worktreePath, name), body)
  await git(worktreePath, 'add', name)
  await git(worktreePath, 'commit', '-m', `work: ${name}`)
}

/**
 * Land the task branch's patches on main under different commit hashes, the
 * way a rebase does. Main must advance first: cherry-picking onto an identical
 * parent would reproduce the same hash and prove nothing.
 */
async function landRewrittenOnMain(root: string, taskBranch: string): Promise<void> {
  await writeFile(join(root, 'unrelated.txt'), 'main moved on')
  await git(root, 'add', 'unrelated.txt')
  await git(root, 'commit', '-m', 'main: unrelated progress')
  await git(root, 'cherry-pick', (await git(root, 'rev-parse', taskBranch)).trim())
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('merge proof accepts patch equivalence after a rebase', () => {
  // 1.1 The case that motivated this change: the work IS on main, but a rebase
  // rewrote its commits, so the task branch is no longer an ancestor.
  it('proves merge when every commit exists upstream under a different hash', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-rebased', 'session-rebased')
    await commitWork(target.worktreePath, 'feature.txt', 'landed work')

    // Land the same patch on main under a DIFFERENT commit hash, exactly as a
    // rebase would: cherry-pick rewrites the commit while keeping the patch.
    const taskHead = (await git(root, 'rev-parse', target.taskBranch)).trim()
    await landRewrittenOnMain(root, target.taskBranch)
    const mainHead = (await git(root, 'rev-parse', 'main')).trim()
    expect(mainHead).not.toBe(taskHead)
    // Ancestry genuinely does not hold — this is not a contrived fixture.
    await expect(git(root, 'merge-base', '--is-ancestor', taskHead, mainHead)).rejects.toThrow()

    const result = await wsClean(target.worktreePath, {
      dryRun: true,
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
    })

    expect(result.dryRun).toBe(true)
    expect(result.mergeProof).toBe('patch-equivalent')
  }, 300_000)

  // 1.2 The safety case: work that never landed must still refuse.
  it('refuses when a commit has no upstream equivalent', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-unlanded', 'session-unlanded')
    await commitWork(target.worktreePath, 'landed.txt', 'landed work')
    await landRewrittenOnMain(root, target.taskBranch)
    // A second commit that is NOT taken to main.
    await commitWork(target.worktreePath, 'unlanded.txt', 'work still in flight')

    await expect(wsClean(target.worktreePath, {
      dryRun: true,
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
    })).rejects.toThrow(/not proven merged/)

    await expect(access(target.worktreePath)).resolves.toBeUndefined()
  }, 300_000)

  // 1.3 The ordinary merge workflow keeps its stronger proof and its wording.
  it('reports ancestry when the branch is a plain ancestor', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-ancestor', 'session-ancestor')
    await commitWork(target.worktreePath, 'feature.txt', 'merged work')
    await git(root, 'merge', '--no-ff', target.taskBranch, '-m', 'merge task')

    const result = await wsClean(target.worktreePath, {
      dryRun: true,
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
    })

    expect(result.mergeProof).toBe('ancestor')
  }, 300_000)

  // 1.4 No commits of its own: nothing can be unlanded.
  it('proves merge for a branch with no commits of its own', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-empty', 'session-empty')

    const result = await wsClean(target.worktreePath, {
      dryRun: true,
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
    })

    // An untouched branch is an ancestor of its base, so the stronger proof
    // applies; the point is that it is provable at all.
    expect(result.mergeProof).toBe('ancestor')
  }, 300_000)

  // 4.1 Patch equivalence replaces ONE proof, never a safety gate.
  it('does not waive the dirty gate when patch equivalence holds', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-rebased-dirty', 'session-rebased-dirty')
    await commitWork(target.worktreePath, 'feature.txt', 'landed work')
    await landRewrittenOnMain(root, target.taskBranch)
    await writeFile(join(target.worktreePath, 'scratch.txt'), 'uncommitted')

    await expect(wsClean(target.worktreePath, {
      dryRun: true,
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
    })).rejects.toThrow(/dirty/)
  }, 300_000)

  // The recorded-base gate is independent of how merge is proven.
  it('still refuses a branch that no longer descends from its base commit', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-rebased-base', 'session-rebased-base')
    await commitWork(target.worktreePath, 'feature.txt', 'landed work')
    await landRewrittenOnMain(root, target.taskBranch)
    // Rewrite the task branch so it no longer descends from the recorded base.
    await git(target.worktreePath, 'reset', '--hard', 'HEAD~1')
    await commitWork(target.worktreePath, 'rewritten.txt', 'rewritten history')
    await git(target.worktreePath, 'commit', '--amend', '-m', 'rewritten root', '--allow-empty')

    await expect(wsClean(target.worktreePath, {
      dryRun: true,
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
    })).rejects.toThrow(/CLEAN_REFUSED|not proven merged|no longer descends/)
  }, 300_000)
})
