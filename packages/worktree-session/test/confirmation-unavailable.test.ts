import { execFile } from 'node:child_process'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authorizeExplicitPath } from '../src/host/tool.js'
import { wsCleanRepository } from '../src/host/maintenance.js'
import { bindSource, startOperation } from '../src/host/operation.js'

const exec = promisify(execFile)
const roots: string[] = []

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec('git', args, { cwd, encoding: 'utf8' })).stdout
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ws-unavailable-')); roots.push(root)
  await git(root, 'init', '-b', 'main')
  await git(root, 'config', 'user.email', 'ws@example.invalid')
  await git(root, 'config', 'user.name', 'WS Test')
  await writeFile(join(root, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n')
  await writeFile(join(root, 'package-lock.json'), '{"name":"fixture","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fixture","version":"1.0.0"}}}\n')
  // Without this the lean prepare leaves node_modules/ untracked, the worktree
  // reads dirty, and the dirty gate refuses before the offer is ever reached.
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

/** A seam whose ask throws the way it does for a delegated child agent. */
const delegatedSeam = {
  get: (name: string) => name === 'userQuestions'
    ? { ask: async () => { throw Object.assign(new Error('human interaction is unavailable while the calling agent is owned by another live agent'), { code: 'DELEGATED_CALLER' }) } }
    : undefined,
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('an unreachable confirmation is reported as such, never as a refusal', () => {
  // The production symptom: a Pet executor is a delegated child agent, so the
  // questions seam refuses to ask on its behalf. Reporting `not-archived` told
  // the caller to go archive the Session by hand, when the real blocker was
  // that nobody was ever asked — an unaskable setup looked like a rejection.
  it('distinguishes a dead channel from a declined offer', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-unavailable', 'session-unavailable')

    const unreachable = await wsCleanRepository(root, {
      archivedSessionIds: [],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
      confirmArchive: async () => 'unavailable',
      archiveSession: async () => { throw new Error('must not archive when nobody was asked') },
    })

    expect(unreachable.cleaned).toEqual([])
    expect(unreachable.refused).toHaveLength(1)
    expect(unreachable.refused[0]).toMatchObject({
      operationId: target.operationId,
      kind: 'confirmation-unavailable',
      sourceSessionId: 'session-unavailable',
    })
    // The diagnosis must point at the channel, not at the archive precondition.
    expect(unreachable.refused[0]!.reason).toMatch(/could not reach a human/)
    // Fail closed: every resource survives.
    await access(target.worktreePath)
    expect(await git(root, 'rev-parse', '--verify', target.taskBranch)).toBeTruthy()

    // A real human declining is still `not-archived`, so the two stay apart.
    const declined = await wsCleanRepository(root, {
      archivedSessionIds: [],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
      confirmArchive: async () => false,
      archiveSession: async () => { throw new Error('must not archive on a decline') },
    })
    expect(declined.refused[0]).toMatchObject({ kind: 'not-archived' })
  }, 120_000)

  // The same distinction on the explicit-path channel: both refuse, but the
  // caller must be able to tell "you said no" from "nobody could be asked".
  it('reports an unreachable explicit-path authorization distinctly', async () => {
    await expect(authorizeExplicitPath(delegatedSeam, { agent: { id: 'child' } }, { action: 'clean', path: '/tmp/some-worktree' }))
      .rejects.toThrow(/did not reach a human/)

    const declining = {
      get: (name: string) => name === 'userQuestions'
        ? { ask: async () => ({ answers: [{ id: 'ws-confirm', selected: ['取消'] }] }) }
        : undefined,
    }
    await expect(authorizeExplicitPath(declining, { agent: { id: 'root' } }, { action: 'clean', path: '/tmp/some-worktree' }))
      .rejects.toThrow(/was not authorized by the user/)
  }, 30_000)

  // A missing provider is also "nobody to ask", not a refusal.
  it('treats an absent questions provider as unavailable', async () => {
    const root = await fixture()
    await candidate(root, 'operation-no-provider', 'session-no-provider')
    const confirm = vi.fn(async () => 'unavailable' as const)

    const result = await wsCleanRepository(root, {
      archivedSessionIds: [],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
      confirmArchive: confirm,
      archiveSession: async () => { throw new Error('must not archive') },
    })

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(result.refused[0]).toMatchObject({ kind: 'confirmation-unavailable' })
  }, 120_000)
})
