import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { checkTool } from '../src/host/guard.js'
import { wsCleanRepository } from '../src/host/maintenance.js'
import { bindSource, loadOperation, reconcileSourceArchiveLifecycle, startOperation } from '../src/host/operation.js'
import { discoverRepo } from '../src/host/git.js'
import { bindingOf } from '../src/wire.js'

const exec = promisify(execFile)
const roots: string[] = []

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec('git', args, { cwd, encoding: 'utf8' })).stdout
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ws-then-clean-')); roots.push(root)
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
  await git(root, 'merge', '--no-ff', prepared.taskBranch, '-m', `merge ${id}`)
  return prepared
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('a Session finished through archive-then-clean is released on unarchive', () => {
  // 1.1 The real event order: the candidate is NOT archived when the sweep
  // starts, the user confirms, the Host archives, and only THEN does the clean
  // write the tombstone. The archive observation fires against an operation
  // that is still `prepared`, so the state machine has no edge to take — the
  // clean write is the only place that can still record the archive fact.
  it('reaches released after archive -> clean -> unarchive', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-then-clean', 'session-then-clean')
    const repo = await discoverRepo(root)
    const archivedSet = new Set<string>()

    const result = await wsCleanRepository(root, {
      archivedSessionIds: [],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
      confirmArchive: async () => true,
      archiveSession: async (id: string) => {
        archivedSet.add(id)
        // The Host's archive write is observed by the lifecycle reconciler.
        // At this moment the operation is still `prepared`, so this call is
        // deliberately a no-op — reproducing the exact production ordering.
        await reconcileSourceArchiveLifecycle({ gitCommonDir: repo.gitCommonDir, sourceSessionId: id, archived: true, mode: 'archive-observed' })
      },
    })

    expect(result.cleaned.map(entry => entry.operationId)).toEqual([target.operationId])
    expect(archivedSet.has('session-then-clean')).toBe(true)

    // The user unarchives. This must release the binding.
    await reconcileSourceArchiveLifecycle({ gitCommonDir: repo.gitCommonDir, sourceSessionId: 'session-then-clean', archived: false, mode: 'unarchive-observed' })

    const after = await loadOperation(repo.gitCommonDir, target.operationId)
    expect(bindingOf(after!)?.state).toBe('released')
  }, 120_000)

  // 1.2 The consequence of staying wedged: the guard's terminal branch fires
  // before the TOOL_CONTRACTS lookup, so it denies EVERY tool rather than only
  // the local-capability ones. This pins the blast radius, not just bash.
  it('denies every tool while a binding is still cleaned', async () => {
    const root = await fixture()
    const prepared = await startOperation({ operationId: 'operation-cleaned-guard', repoPath: root, baseRef: 'main', taskText: 'guard', dependencyMode: 'lean' })
    await bindSource({ operationId: prepared.operationId, repoPath: root, sourceSessionId: 'session-cleaned-guard' })
    const loaded = await loadOperation((await discoverRepo(root)).gitCommonDir, prepared.operationId)
    const cleaned = { ...loaded!, phase: 'cleaned' as const, binding: { ...bindingOf(loaded!)!, state: 'cleaned' as const } }

    for (const call of [
      { name: 'bash', args: { workdir: prepared.worktreePath, command: 'ls' } },
      { name: 'read', args: { file_path: join(prepared.worktreePath, 'package.json') } },
      { name: 'grep', args: { pattern: 'x', path: prepared.worktreePath } },
      { name: 'write', args: { file_path: join(prepared.worktreePath, 'out.txt'), content: 'x' } },
    ]) {
      expect(checkTool(call, cleaned), `${call.name} must be denied`).toMatch(/已清理/)
    }
  }, 120_000)
})
