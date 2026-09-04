import { execFile } from 'node:child_process'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { wsCleanRepository } from '../src/host/maintenance.js'
import { bindSource, startOperation } from '../src/host/operation.js'
import { authorizeExplicitPath, cleanTargetFor } from '../src/host/tool.js'

const exec = promisify(execFile)
const roots: string[] = []

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec('git', args, { cwd, encoding: 'utf8' })).stdout
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ws-authorized-clean-')); roots.push(root)
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

async function candidate(root: string, id: string, session: string, options: { merge?: boolean } = {}) {
  const prepared = await startOperation({ operationId: id, repoPath: root, baseRef: 'main', taskText: id, dependencyMode: 'lean' })
  await bindSource({ operationId: prepared.operationId, repoPath: root, sourceSessionId: session })
  if (options.merge !== false) await git(root, 'merge', '--no-ff', prepared.taskBranch, '-m', `merge ${id}`)
  return prepared
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/**
 * A caller whose own cwd is NOT the target repository — the generic shape that
 * previously could not use `ws` at all. Nothing here is specific to any one
 * runtime; only the authorized path matters.
 */
const remoteCaller = {
  agent: { session: { id: 'session-caller', header: { cwd: '/elsewhere/workspace' } } },
  callId: 'call-authorized',
}

describe('authorized explicit path drives the real repository clean', () => {
  // 3.2 An authorized path must reach the identical repository-level scan a
  // main-checkout Session would get.
  it('cleans archived safe candidates through an authorized path', async () => {
    const root = await fixture()
    const first = await candidate(root, 'operation-authorized-1', 'session-authorized-1')
    const second = await candidate(root, 'operation-authorized-2', 'session-authorized-2')

    const questions = { ask: async () => ({ answers: [{ id: 'ws-confirm', selected: ['Yes, proceed'] }] }) }
    const authorizedPath = await authorizeExplicitPath({ get: () => questions }, remoteCaller, { action: 'clean', path: root })
    const { repoPath } = cleanTargetFor(remoteCaller, { boundSessionIds: [], authorizedPath })
    expect(repoPath).toBe(root)

    const result = await wsCleanRepository(repoPath, {
      archivedSessionIds: ['session-authorized-1', 'session-authorized-2'],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
    })

    expect(result.scanned).toBe(2)
    expect(result.refused).toEqual([])
    expect(result.cleaned.map(entry => entry.operationId).sort())
      .toEqual([first.operationId, second.operationId].sort())
    for (const entry of [first, second]) {
      await expect(access(entry.worktreePath)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  }, 300_000)

  // 4.1 Authorization is NOT an exemption: every gate still refuses.
  it('still refuses unsafe candidates after authorization', async () => {
    const root = await fixture()
    const safe = await candidate(root, 'operation-auth-safe', 'session-auth-safe')
    const dirty = await candidate(root, 'operation-auth-dirty', 'session-auth-dirty')
    const unmerged = await candidate(root, 'operation-auth-unmerged', 'session-auth-unmerged', { merge: false })
    const unarchived = await candidate(root, 'operation-auth-unarchived', 'session-auth-unarchived')

    await writeFile(join(dirty.worktreePath, 'scratch.txt'), 'work in progress')
    await writeFile(join(unmerged.worktreePath, 'commit.txt'), 'unmerged work')
    await git(unmerged.worktreePath, 'add', 'commit.txt')
    await git(unmerged.worktreePath, 'commit', '-m', 'unmerged task work')

    const questions = { ask: async () => ({ answers: [{ id: 'ws-confirm', selected: ['Yes, proceed'] }] }) }
    const authorizedPath = await authorizeExplicitPath({ get: () => questions }, remoteCaller, { action: 'clean', path: root })
    const { repoPath } = cleanTargetFor(remoteCaller, { boundSessionIds: [], authorizedPath })

    const result = await wsCleanRepository(repoPath, {
      archivedSessionIds: ['session-auth-safe', 'session-auth-dirty', 'session-auth-unmerged'],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
    })

    expect(result.cleaned.map(entry => entry.operationId)).toEqual([safe.operationId])
    const byId = new Map(result.refused.map(entry => [entry.operationId, entry]))
    expect(byId.get(dirty.operationId)?.reason).toMatch(/dirty/)
    expect(byId.get(unmerged.operationId)?.reason).toMatch(/not proven merged/)
    expect(byId.get(unarchived.operationId)).toMatchObject({ kind: 'not-archived' })
    for (const entry of [dirty, unmerged, unarchived]) {
      await expect(access(entry.worktreePath)).resolves.toBeUndefined()
    }
  }, 600_000)

  // 3.3 An authorized path that is not a repository main checkout is refused by
  // the existing discovery check, before anything is scanned or deleted.
  it('refuses an authorized path that is not a repository', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'ws-authorized-not-repo-')); roots.push(outside)

    const questions = { ask: async () => ({ answers: [{ id: 'ws-confirm', selected: ['Yes, proceed'] }] }) }
    const authorizedPath = await authorizeExplicitPath({ get: () => questions }, remoteCaller, { action: 'clean', path: outside })
    const { repoPath } = cleanTargetFor(remoteCaller, { boundSessionIds: [], authorizedPath })

    await expect(wsCleanRepository(repoPath, {
      archivedSessionIds: [],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: outside,
    })).rejects.toThrow(/Not inside a Git repository/)
  }, 120_000)

  // A refused authorization must never reach the scan at all.
  it('never scans when authorization is refused', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-auth-refused', 'session-auth-refused')

    const questions = { ask: async () => ({ answers: [{ id: 'ws-confirm', selected: ['No, stop'] }] }) }
    await expect(authorizeExplicitPath({ get: () => questions }, remoteCaller, { action: 'clean', path: root }))
      .rejects.toThrow(/not authorized by the user/)

    // Without an authorized path the caller cannot even resolve a target: its
    // own cwd is not this repository.
    const { repoPath } = cleanTargetFor(remoteCaller, { boundSessionIds: [] })
    expect(repoPath).toBe('/elsewhere/workspace')
    await expect(access(target.worktreePath)).resolves.toBeUndefined()
  }, 300_000)
})
