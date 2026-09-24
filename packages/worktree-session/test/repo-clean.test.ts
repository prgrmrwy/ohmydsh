import { execFile } from 'node:child_process'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { atomicJson } from '../src/host/fs.js'
import { discoverRepo } from '../src/host/git.js'
import { wsCleanRepository } from '../src/host/maintenance.js'
import { bindSource, loadOperation, operationFile, startOperation } from '../src/host/operation.js'
import { bindingOf } from '../src/wire.js'

const exec = promisify(execFile)
const roots: string[] = []

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec('git', args, { cwd, encoding: 'utf8' })).stdout
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ws-repo-clean-')); roots.push(root)
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

/** Prepare one bound Worktree Session and merge its branch unless asked not to. */
async function candidate(root: string, id: string, session: string, options: { merge?: boolean } = {}): Promise<{ operationId: string; worktreePath: string; taskBranch: string }> {
  const prepared = await startOperation({ operationId: id, repoPath: root, baseRef: 'main', taskText: id, dependencyMode: 'lean' })
  await bindSource({ operationId: prepared.operationId, repoPath: root, sourceSessionId: session })
  if (options.merge !== false) await git(root, 'merge', '--no-ff', prepared.taskBranch, '-m', `merge ${id}`)
  return { operationId: prepared.operationId, worktreePath: prepared.worktreePath, taskBranch: prepared.taskBranch }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('repository-wide cleanup', () => {
  it('cleans every archived safe candidate in one pass', async () => {
    const root = await fixture()
    const first = await candidate(root, 'operation-repo-safe-1', 'session-safe-1')
    const second = await candidate(root, 'operation-repo-safe-2', 'session-safe-2')

    const result = await wsCleanRepository(root, {
      archivedSessionIds: ['session-safe-1', 'session-safe-2'],
      activePaths: [root],
      activeBoundSessionIds: [],
      cwd: root,
    })

    expect(result.scanned).toBe(2)
    expect(result.refused).toEqual([])
    expect(result.cleaned.map(entry => entry.operationId).sort()).toEqual([first.operationId, second.operationId])
    expect(result.cleaned.every(entry => entry.cleaned)).toBe(true)
    for (const entry of [first, second]) {
      await expect(access(entry.worktreePath)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(git(root, 'rev-parse', '--verify', entry.taskBranch)).rejects.toThrow()
      const repo = await discoverRepo(root)
      const record = await loadOperation(repo.gitCommonDir, entry.operationId)
      expect(record?.phase).toBe('cleaned')
      // Both source Sessions were archived at clean time, so the tombstone
      // records that fact. Writing a bare `cleaned` here used to discard it and
      // strand the binding with no edge left to `released`.
      expect(bindingOf(record!)?.state).toBe('cleaned-archived')
    }
  }, 300_000)

  it('refuses a safe worktree whose source Session is not archived', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-repo-unarchived', 'session-unarchived')

    const result = await wsCleanRepository(root, {
      archivedSessionIds: [],
      activePaths: [root],
      activeBoundSessionIds: [],
      cwd: root,
    })

    expect(result.cleaned).toEqual([])
    expect(result.refused).toHaveLength(1)
    expect(result.refused[0]).toMatchObject({ operationId: target.operationId, kind: 'not-archived', sourceSessionId: 'session-unarchived' })
    await expect(access(target.worktreePath)).resolves.toBeUndefined()
    await expect(git(root, 'rev-parse', '--verify', target.taskBranch)).resolves.toBeTruthy()
  }, 300_000)

  it('cleans safe candidates while leaving every refused candidate intact', async () => {
    const root = await fixture()
    const safe = await candidate(root, 'operation-mixed-safe', 'session-mixed-safe')
    const dirty = await candidate(root, 'operation-mixed-dirty', 'session-mixed-dirty')
    const unmerged = await candidate(root, 'operation-mixed-unmerged', 'session-mixed-unmerged', { merge: false })
    const active = await candidate(root, 'operation-mixed-active', 'session-mixed-active')
    const unarchived = await candidate(root, 'operation-mixed-unarchived', 'session-mixed-unarchived')
    const unsupported = await candidate(root, 'operation-mixed-unsupported', 'session-mixed-unsupported')

    await writeFile(join(dirty.worktreePath, 'scratch.txt'), 'work in progress')
    await writeFile(join(unmerged.worktreePath, 'commit.txt'), 'unmerged work')
    await git(unmerged.worktreePath, 'add', 'commit.txt')
    await git(unmerged.worktreePath, 'commit', '-m', 'unmerged task work')

    const repo = await discoverRepo(root)
    const record = await loadOperation(repo.gitCommonDir, unsupported.operationId)
    await atomicJson(operationFile(repo.gitCommonDir, unsupported.operationId), { ...record!, schemaVersion: 3 })

    const result = await wsCleanRepository(root, {
      archivedSessionIds: ['session-mixed-safe', 'session-mixed-dirty', 'session-mixed-unmerged', 'session-mixed-active', 'session-mixed-unsupported'],
      activePaths: [root],
      activeBoundSessionIds: ['session-mixed-active'],
      cwd: root,
    })

    expect(result.scanned).toBe(6)
    expect(result.cleaned.map(entry => entry.operationId)).toEqual([safe.operationId])
    const byId = new Map(result.refused.map(entry => [entry.operationId, entry]))
    expect(byId.get(dirty.operationId)).toMatchObject({ kind: 'refused', code: 'CLEAN_REFUSED' })
    expect(byId.get(dirty.operationId)?.reason).toMatch(/dirty/)
    expect(byId.get(unmerged.operationId)?.reason).toMatch(/not proven merged/)
    expect(byId.get(active.operationId)?.reason).toMatch(/active source Session/)
    expect(byId.get(unarchived.operationId)).toMatchObject({ kind: 'not-archived' })
    expect(byId.get(unsupported.operationId)).toMatchObject({ kind: 'unreadable', code: 'UNSUPPORTED_SCHEMA_VERSION' })

    for (const entry of [dirty, unmerged, active, unarchived, unsupported]) {
      await expect(access(entry.worktreePath)).resolves.toBeUndefined()
      await expect(git(root, 'rev-parse', '--verify', entry.taskBranch)).resolves.toBeTruthy()
    }
  }, 600_000)

  it('returns a successful zero-clean summary when nothing is eligible', async () => {
    const root = await fixture()

    const empty = await wsCleanRepository(root, { archivedSessionIds: [], activePaths: [root], activeBoundSessionIds: [], cwd: root })
    expect(empty).toMatchObject({ scanned: 0, cleaned: [], refused: [], ignored: [], dryRun: false })
    expect(empty.repoRoot).toBe((await discoverRepo(root)).repoRoot)
  }, 120_000)

  it('ignores cleaned and released history without lifecycle regression', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-repo-history', 'session-history')

    const first = await wsCleanRepository(root, { archivedSessionIds: ['session-history'], activePaths: [root], activeBoundSessionIds: [], cwd: root })
    expect(first.cleaned).toHaveLength(1)

    const repo = await discoverRepo(root)
    const cleanedRecord = await loadOperation(repo.gitCommonDir, target.operationId)
    const second = await wsCleanRepository(root, { archivedSessionIds: ['session-history'], activePaths: [root], activeBoundSessionIds: [], cwd: root })
    expect(second.cleaned).toEqual([])
    expect(second.refused).toEqual([])
    expect(second.ignored).toEqual([{ operationId: target.operationId, lifecycle: 'cleaned', worktreePath: target.worktreePath, taskBranch: target.taskBranch }])

    await atomicJson(operationFile(repo.gitCommonDir, target.operationId), {
      ...cleanedRecord!,
      binding: { ...bindingOf(cleanedRecord!), state: 'released' },
    })
    const third = await wsCleanRepository(root, { archivedSessionIds: ['session-history'], activePaths: [root], activeBoundSessionIds: [], cwd: root })
    expect(third.cleaned).toEqual([])
    expect(third.refused).toEqual([])
    expect(third.ignored[0]).toMatchObject({ operationId: target.operationId, lifecycle: 'released' })
    // The tombstone stays released; scanning must not roll it back.
    expect(bindingOf((await loadOperation(repo.gitCommonDir, target.operationId))!)?.state).toBe('released')
  }, 300_000)

  it('previews without deleting when dryRun is requested', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-repo-dry', 'session-dry')

    const result = await wsCleanRepository(root, {
      archivedSessionIds: ['session-dry'],
      activePaths: [root],
      activeBoundSessionIds: [],
      cwd: root,
      dryRun: true,
    })

    expect(result.dryRun).toBe(true)
    expect(result.cleaned).toHaveLength(1)
    expect(result.cleaned[0]).toMatchObject({ dryRun: true, cleaned: false, operationId: target.operationId })
    await expect(access(target.worktreePath)).resolves.toBeUndefined()
    await expect(git(root, 'rev-parse', '--verify', target.taskBranch)).resolves.toBeTruthy()
    const repo = await discoverRepo(root)
    expect((await loadOperation(repo.gitCommonDir, target.operationId))?.phase).toBe('prepared')
  }, 300_000)
})
