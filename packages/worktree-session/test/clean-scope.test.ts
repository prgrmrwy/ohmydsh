import { execFile } from 'node:child_process'
import { access, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { wsCleanRepository } from '../src/host/maintenance.js'
import { bindSource, startOperation } from '../src/host/operation.js'
import { cleanTargetFor, requiresPathAuthorization } from '../src/host/tool.js'

/**
 * Cleanup scope is stated by the caller, never inferred from who is calling.
 *
 * Sweeping a repository and finishing one's own worktree are different intents
 * with different blast radii. Deriving the scope from the caller's binding
 * would make the same request mean different things in different sessions, so
 * the choice is explicit and the narrow scope reuses the wide one's machinery
 * rather than introducing a parallel set of rules.
 */

const exec = promisify(execFile)
const roots: string[] = []

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec('git', args, { cwd, encoding: 'utf8' })).stdout
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ws-clean-scope-')); roots.push(root)
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

describe('the specified scope handles exactly one operation', () => {
  // 0.1 / 0.2 The point of the narrow scope: one target, one question, and no
  // opinion offered about anybody else's worktree.
  it('cleans only the bound operation and asks about nothing else', async () => {
    const root = await fixture()
    const mine = await candidate(root, 'operation-mine', 'session-mine')
    const peer = await candidate(root, 'operation-peer', 'session-peer')
    const confirm = vi.fn(async () => true)
    const archived: string[] = []

    const result = await wsCleanRepository(root, {
      archivedSessionIds: [],
      activePaths: [],
      activeBoundSessionIds: ['session-mine'],
      cwd: root,
      onlySourceSessionId: 'session-mine',
      confirmArchive: confirm,
      archiveSession: async (id: string) => { archived.push(id) },
    })

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(archived).toEqual(['session-mine'])
    expect(result.scanned).toBe(1)
    expect(result.cleaned.map(entry => entry.operationId)).toEqual([mine.operationId])
    // The peer is untouched and unmentioned: it was never in scope.
    const mentioned = [...result.cleaned, ...result.refused, ...result.ignored].map(entry => entry.operationId)
    expect(mentioned).not.toContain(peer.operationId)
    await expect(access(peer.worktreePath)).resolves.toBeUndefined()
  }, 300_000)

  // The route for a caller with a path but no binding of its own.
  it('narrows to the operation owning a given worktree path', async () => {
    const root = await fixture()
    const mine = await candidate(root, 'operation-by-path', 'session-by-path')
    const peer = await candidate(root, 'operation-by-path-peer', 'session-by-path-peer')
    const confirm = vi.fn(async () => true)

    const result = await wsCleanRepository(mine.worktreePath, {
      archivedSessionIds: [],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
      onlyWorktreePath: mine.worktreePath,
      confirmArchive: confirm,
      archiveSession: async () => undefined,
    })

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(result.scanned).toBe(1)
    expect(result.cleaned.map(entry => entry.operationId)).toEqual([mine.operationId])
    await expect(access(peer.worktreePath)).resolves.toBeUndefined()
  }, 300_000)

  // Entering through a worktree path makes Git report that worktree as the
  // repository root. Echoing it back would name the wrong repository in a
  // report whose subject IS which repository was scanned.
  it('reports the main checkout, not the worktree it was entered through', async () => {
    const root = await fixture()
    const mine = await candidate(root, 'operation-report-root', 'session-report-root')

    const result = await wsCleanRepository(mine.worktreePath, {
      archivedSessionIds: [],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
      onlyWorktreePath: mine.worktreePath,
      dryRun: true,
    })

    expect(result.repoRoot).not.toBe(mine.worktreePath)
    expect(await realpath(result.repoRoot)).toBe(await realpath(root))
  }, 300_000)

  it('refuses a worktree path no registered operation owns', async () => {
    const root = await fixture()
    await candidate(root, 'operation-path-miss', 'session-path-miss')

    await expect(wsCleanRepository(root, {
      archivedSessionIds: [],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
      onlyWorktreePath: join(root, '.worktrees', 'not-a-worktree'),
      confirmArchive: async () => true,
      archiveSession: async () => undefined,
    })).rejects.toThrow()
  }, 300_000)

  // 0.4 A scope that resolves to nothing is a failed request. Reporting an
  // empty sweep would read as success while the intended target survived.
  it('refuses when the session has no current binding', async () => {
    const root = await fixture()
    await candidate(root, 'operation-other', 'session-other')

    await expect(wsCleanRepository(root, {
      archivedSessionIds: [],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
      onlySourceSessionId: 'session-without-binding',
      confirmArchive: async () => true,
      archiveSession: async () => undefined,
    })).rejects.toThrow(/no current Worktree Session binding/)
  }, 300_000)

  // 0.5 The wide scope is the default and stays exactly as it was.
  it('keeps sweeping the repository when no scope is given', async () => {
    const root = await fixture()
    const first = await candidate(root, 'operation-sweep-a', 'session-sweep-a')
    const second = await candidate(root, 'operation-sweep-b', 'session-sweep-b')

    const result = await wsCleanRepository(root, {
      archivedSessionIds: ['session-sweep-a', 'session-sweep-b'],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
      dryRun: true,
    })

    expect(result.scanned).toBe(2)
    expect(result.cleaned.map(entry => entry.operationId).sort())
      .toEqual([first.operationId, second.operationId].sort())
  }, 300_000)

  // The narrow scope runs the same gates; it is not a shortcut past them.
  it('applies the ordinary gates to its single target', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-gated', 'session-gated')
    await writeFile(join(target.worktreePath, 'scratch.txt'), 'uncommitted')
    const confirm = vi.fn(async () => true)

    const result = await wsCleanRepository(root, {
      archivedSessionIds: ['session-gated'],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
      onlySourceSessionId: 'session-gated',
      confirmArchive: confirm,
      archiveSession: async () => undefined,
    })

    expect(result.cleaned).toEqual([])
    expect(result.refused[0]?.reason).toMatch(/dirty/)
    await expect(access(target.worktreePath)).resolves.toBeUndefined()
  }, 300_000)
})

describe('a preview does not need path authorization', () => {
  // A preview reads. Guarding it with the same prompt as a deletion made the
  // recommended flow cost two prompts before anything could happen, and a
  // prompt that guards nothing devalues the one that guards the real run.
  it('exempts a clean preview and nothing else', () => {
    expect(requiresPathAuthorization({ action: 'clean', dry_run: true })).toBe(false)
    expect(requiresPathAuthorization({ action: 'clean', dry_run: false })).toBe(true)
    // An omitted dry_run means a real run.
    expect(requiresPathAuthorization({ action: 'clean' })).toBe(true)
  })

  it('never exempts the actions that have no preview', () => {
    for (const action of ['status', 'promote']) {
      expect(requiresPathAuthorization({ action })).toBe(true)
      // Even if a caller passes dry_run where it has no meaning.
      expect(requiresPathAuthorization({ action, dry_run: true })).toBe(true)
    }
  })
})

describe('scope selection at the tool boundary', () => {
  const boundExec = {
    agent: { session: { id: 'session-bound', header: { cwd: '/repo' } } },
  }

  // 0.3 Being bound blocks a sweep but is precisely what the narrow scope
  // resolves from, so it must stop being a refusal there.
  it('lets a bound Session resolve its own target', () => {
    expect(cleanTargetFor(boundExec, { boundSessionIds: ['session-bound'], specified: true }))
      .toEqual({ repoPath: '/repo', sessionId: 'session-bound' })
  })

  it('still refuses a bound Session that asks for a repository sweep', () => {
    expect(() => cleanTargetFor(boundExec, { boundSessionIds: ['session-bound'] }))
      .toThrow(/ordinary main-checkout Session/)
  })

  // A caller whose cwd is outside the repository has no binding of its own to
  // narrow from — a Pet executor runs in the plugin workspace while the
  // binding lives on its source Session. Under the narrow scope the path names
  // the one worktree to finish; refusing the combination left the scope
  // unreachable in exactly the setting it was built for.
  it('reads an authorized path as the single worktree under the narrow scope', () => {
    expect(cleanTargetFor({}, { boundSessionIds: [], authorizedPath: '/repo/.worktrees/task', specified: true }))
      .toEqual({ worktreePath: '/repo/.worktrees/task' })
  })

  it('keeps the authorized path working for a sweep', () => {
    expect(cleanTargetFor(boundExec, { boundSessionIds: [], authorizedPath: '/elsewhere' }))
      .toEqual({ repoPath: '/elsewhere' })
  })
})
