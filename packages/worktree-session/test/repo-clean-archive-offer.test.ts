import { execFile } from 'node:child_process'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  const root = await mkdtemp(join(tmpdir(), 'ws-archive-offer-')); roots.push(root)
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

/** Confirm double that always answers the same way and records every offer. */
function confirmer(answer: boolean) {
  return vi.fn(async () => answer)
}

describe('archive-then-clean offer for finished candidates', () => {
  // 1.1 A finished-but-unarchived candidate is archived and cleaned after the
  // user confirms; the summary distinguishes it from an already-archived clean.
  it('archives then cleans a confirmed candidate', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-offer-safe', 'session-offer-safe')
    const confirm = confirmer(true)
    const archived: string[] = []

    const result = await wsCleanRepository(root, {
      archivedSessionIds: [],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
      confirmArchive: confirm,
      archiveSession: async (id: string) => { archived.push(id) },
    })

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(archived).toEqual(['session-offer-safe'])
    expect(result.cleaned.map(entry => entry.operationId)).toEqual([target.operationId])
    expect(result.cleaned[0]).toMatchObject({ archivedBeforeClean: true })
    expect(result.refused).toEqual([])
    await expect(access(target.worktreePath)).rejects.toMatchObject({ code: 'ENOENT' })
    const repo = await discoverRepo(root)
    expect((await loadOperation(repo.gitCommonDir, target.operationId))?.phase).toBe('cleaned')
  }, 300_000)

  // 1.2 Declining keeps the pre-existing refusal and touches nothing.
  it('keeps the not-archived refusal when the user declines', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-offer-declined', 'session-offer-declined')
    const archived: string[] = []

    const result = await wsCleanRepository(root, {
      archivedSessionIds: [],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
      confirmArchive: confirmer(false),
      archiveSession: async (id: string) => { archived.push(id) },
    })

    expect(archived).toEqual([])
    expect(result.cleaned).toEqual([])
    expect(result.refused).toHaveLength(1)
    expect(result.refused[0]).toMatchObject({ operationId: target.operationId, kind: 'not-archived' })
    await expect(access(target.worktreePath)).resolves.toBeUndefined()
    await expect(git(root, 'rev-parse', '--verify', target.taskBranch)).resolves.toBeTruthy()
  }, 300_000)

  // 1.3 The user must be able to judge the offer: it names the exact candidate
  // and the facts that make it safe to finish.
  it('offers with the exact candidate facts', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-offer-facts', 'session-offer-facts')
    const confirm = confirmer(false)

    await wsCleanRepository(root, {
      archivedSessionIds: [],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
      confirmArchive: confirm,
      archiveSession: async () => undefined,
    })

    const offer = confirm.mock.calls[0]![0] as {
      operationId: string
      sourceSessionId: string
      taskBranch: string
      worktreePath: string
      merged: boolean
      clean: boolean
    }
    expect(offer.operationId).toBe(target.operationId)
    expect(offer.sourceSessionId).toBe('session-offer-facts')
    expect(offer.taskBranch).toBe(target.taskBranch)
    expect(offer.worktreePath).toBe(target.worktreePath)
    expect(offer.merged).toBe(true)
    expect(offer.clean).toBe(true)
  }, 300_000)

  // 1.4 An already-archived candidate keeps the existing straight-through path.
  it('never offers for an already archived candidate', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-offer-archived', 'session-offer-archived')
    const confirm = confirmer(true)

    const result = await wsCleanRepository(root, {
      archivedSessionIds: ['session-offer-archived'],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
      confirmArchive: confirm,
      archiveSession: async () => undefined,
    })

    expect(confirm).not.toHaveBeenCalled()
    expect(result.cleaned.map(entry => entry.operationId)).toEqual([target.operationId])
    expect(result.cleaned[0]?.archivedBeforeClean).toBeUndefined()
  }, 300_000)

  // 1.5 Without an injected confirmer (CLI/HTTP paths) the refusal is unchanged.
  it('keeps the historical refusal when no confirmer is injected', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-offer-none', 'session-offer-none')

    const result = await wsCleanRepository(root, {
      archivedSessionIds: [],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
    })

    expect(result.cleaned).toEqual([])
    expect(result.refused[0]).toMatchObject({
      operationId: target.operationId,
      kind: 'not-archived',
      sourceSessionId: 'session-offer-none',
    })
    expect(result.refused[0]?.reason).toMatch(/is not archived/)
    await expect(access(target.worktreePath)).resolves.toBeUndefined()
  }, 300_000)
})

describe('non-interactive entrypoints keep the historical refusal', () => {
  // 4.4 The operator CLI drives the single-operation `wsClean`, which has no
  // archive precondition at all: it refuses an unmerged branch on its own
  // reason and never gains an archive hook. This pins the boundary so the new
  // orchestration cannot leak into a path that has nobody to ask.
  it('leaves the single-operation clean free of any archive hook', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-cli-unarchived', 'session-cli-unarchived', { merge: false })
    await writeFile(join(target.worktreePath, 'work.txt'), 'unmerged')
    await git(target.worktreePath, 'add', 'work.txt')
    await git(target.worktreePath, 'commit', '-m', 'unmerged work')

    const { main } = await import('../src/cli.js')
    const written: string[] = []
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk)); return true
    })
    const code = await main(['clean', '--dry-run', target.worktreePath])
    stderr.mockRestore()

    expect(code).toBe(1)
    // The refusal is the merge gate, never an archive precondition or offer.
    expect(written.join('')).toMatch(/not proven merged/)
    await expect(access(target.worktreePath)).resolves.toBeUndefined()
  }, 300_000)
})

describe('archiving is never proposed to mask a gate', () => {
  // 2.2 An unmerged or dirty candidate is refused on its real reason.
  it('refuses unmerged and dirty candidates without offering', async () => {
    const root = await fixture()
    const unmerged = await candidate(root, 'operation-offer-unmerged', 'session-offer-unmerged', { merge: false })
    const dirty = await candidate(root, 'operation-offer-dirty', 'session-offer-dirty')
    await writeFile(join(unmerged.worktreePath, 'work.txt'), 'unmerged')
    await git(unmerged.worktreePath, 'add', 'work.txt')
    await git(unmerged.worktreePath, 'commit', '-m', 'unmerged work')
    await writeFile(join(dirty.worktreePath, 'scratch.txt'), 'in progress')
    const confirm = confirmer(true)
    const archived: string[] = []

    const result = await wsCleanRepository(root, {
      archivedSessionIds: [],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
      confirmArchive: confirm,
      archiveSession: async (id: string) => { archived.push(id) },
    })

    expect(confirm).not.toHaveBeenCalled()
    expect(archived).toEqual([])
    expect(result.cleaned).toEqual([])
    const byId = new Map(result.refused.map(entry => [entry.operationId, entry]))
    expect(byId.get(unmerged.operationId)?.reason).toMatch(/not proven merged/)
    expect(byId.get(dirty.operationId)?.reason).toMatch(/dirty/)
    for (const entry of [unmerged, dirty]) {
      await expect(access(entry.worktreePath)).resolves.toBeUndefined()
    }
  }, 600_000)

  // 2.3 An actively occupied candidate is refused without an offer.
  // Occupancy here means a live Session's cwd is inside the worktree — the
  // gate that survives the finishing waiver (see the dedicated test below).
  it('refuses an actively occupied candidate without offering', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-offer-active', 'session-offer-active')
    const confirm = confirmer(true)

    const result = await wsCleanRepository(root, {
      archivedSessionIds: [],
      activePaths: [target.worktreePath],
      activeBoundSessionIds: ['session-offer-active'],
      cwd: root,
      confirmArchive: confirm,
      archiveSession: async () => undefined,
    })

    expect(confirm).not.toHaveBeenCalled()
    expect(result.cleaned).toEqual([])
    expect(result.refused[0]?.reason).toMatch(/active/i)
    await expect(access(target.worktreePath)).resolves.toBeUndefined()
  }, 300_000)

  // A dry run previews; it must not ask the user to decide anything, and it
  // must not archive. Observed in a real run (session-b637a080): a dry run
  // reported `archivedBeforeClean: true`, meaning the confirmation and the
  // archive call had both executed while the user only asked for a preview.
  it('neither confirms nor archives during a dry run', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-offer-dry', 'session-offer-dry')
    const confirm = confirmer(true)
    const archived: string[] = []

    const result = await wsCleanRepository(root, {
      archivedSessionIds: [],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
      dryRun: true,
      confirmArchive: confirm,
      archiveSession: async (id: string) => { archived.push(id) },
    })

    expect(confirm).not.toHaveBeenCalled()
    expect(archived).toEqual([])
    // Still reported honestly, so a preview tells the user what a real run
    // would ask about.
    expect(result.cleaned).toEqual([])
    expect(result.refused[0]).toMatchObject({ operationId: target.operationId, kind: 'not-archived' })
    // The advice must not send the user off to archive by hand what the next
    // real run would offer to do: read that way, a preview looks like
    // "nothing to do here" and the real run never happens.
    expect(result.refused[0]?.reason).toMatch(/a real run asks/)
    expect(result.refused[0]?.reason).not.toMatch(/archive it before cleaning/)
    // Sessions under danger-full-access are told "approval prompts are
    // disabled". A reader took that to mean this offer would be auto-rejected,
    // reported zero cleanable and never made the real run. The offer travels
    // on the ask-a-human channel, so the reply itself must say so.
    expect(result.refused[0]?.reason).toMatch(/ask-a-human channel, not approval/)
    await expect(access(target.worktreePath)).resolves.toBeUndefined()
  }, 300_000)

  // The non-interactive entrypoints have no offer to make, so for them the
  // manual archive genuinely IS the next step.
  it('keeps the manual-archive advice when no offer is possible', async () => {
    const root = await fixture()
    await candidate(root, 'operation-offer-manual', 'session-offer-manual')

    const result = await wsCleanRepository(root, {
      archivedSessionIds: [],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
    })

    expect(result.refused[0]?.reason).toMatch(/archive it before cleaning/)
  }, 300_000)

  // A Session finishing its OWN worktree is the whole point of the flow.
  // Archiving never unloads a Session, so its binding stays live throughout;
  // leaving that gate armed would refuse before the user is ever asked and no
  // Session could ever finish itself — a deadlock, not a safeguard.
  it('offers and cleans when the only occupant is the candidate own Session', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-offer-self', 'session-offer-self')
    const confirm = confirmer(true)
    const archived: string[] = []

    const result = await wsCleanRepository(root, {
      archivedSessionIds: [],
      // The Session is live and bound, but nobody's cwd is inside the worktree.
      activePaths: [root],
      activeBoundSessionIds: ['session-offer-self'],
      cwd: root,
      confirmArchive: confirm,
      archiveSession: async (id: string) => { archived.push(id) },
    })

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(archived).toEqual(['session-offer-self'])
    expect(result.cleaned.map(entry => entry.operationId)).toEqual([target.operationId])
    await expect(access(target.worktreePath)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 300_000)

  // The waiver never extends to "someone is standing inside the worktree":
  // that gate is what stops the clean from deleting live ground.
  it('never waives an occupant whose cwd is inside the worktree', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-offer-inside', 'session-offer-inside')
    const confirm = confirmer(true)

    const result = await wsCleanRepository(root, {
      archivedSessionIds: [],
      // A live Session sits INSIDE the target worktree.
      activePaths: [target.worktreePath],
      activeBoundSessionIds: ['session-offer-inside'],
      cwd: root,
      confirmArchive: confirm,
      archiveSession: async () => undefined,
    })

    expect(confirm).not.toHaveBeenCalled()
    expect(result.cleaned).toEqual([])
    expect(result.refused[0]?.reason).toMatch(/active DSH Session/i)
    await expect(access(target.worktreePath)).resolves.toBeUndefined()
  }, 300_000)

  // 2.4 A gate that fails only at clean time still refuses after archiving.
  it('refuses at clean time even after archiving', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-offer-race', 'session-offer-race')
    const archived: string[] = []

    const result = await wsCleanRepository(root, {
      archivedSessionIds: [],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
      confirmArchive: async () => {
        // The worktree becomes dirty between the offer and the clean.
        await writeFile(join(target.worktreePath, 'late.txt'), 'late change')
        return true
      },
      archiveSession: async (id: string) => { archived.push(id) },
    })

    expect(archived).toEqual(['session-offer-race'])
    expect(result.cleaned).toEqual([])
    expect(result.refused[0]).toMatchObject({ operationId: target.operationId, kind: 'refused' })
    expect(result.refused[0]?.reason).toMatch(/dirty/)
    await expect(access(target.worktreePath)).resolves.toBeUndefined()
  }, 300_000)
})

describe('archive and clean failures are reported per candidate', () => {
  // 5.1 A failing archive leaves the candidate untouched and is reported.
  it('reports an archive failure without touching resources', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-offer-archive-fail', 'session-offer-archive-fail')

    const result = await wsCleanRepository(root, {
      archivedSessionIds: [],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
      confirmArchive: async () => true,
      archiveSession: async () => { throw new Error('registry unavailable') },
    })

    expect(result.cleaned).toEqual([])
    expect(result.refused[0]).toMatchObject({ operationId: target.operationId, kind: 'archive-failed' })
    expect(result.refused[0]?.reason).toMatch(/registry unavailable/)
    await expect(access(target.worktreePath)).resolves.toBeUndefined()
    await expect(git(root, 'rev-parse', '--verify', target.taskBranch)).resolves.toBeTruthy()
  }, 300_000)

  // 5.3 One candidate's failure must not block an independent eligible one.
  it('continues with other candidates after one fails', async () => {
    const root = await fixture()
    const failing = await candidate(root, 'operation-offer-mixed-fail', 'session-offer-mixed-fail')
    const eligible = await candidate(root, 'operation-offer-mixed-ok', 'session-offer-mixed-ok')

    const result = await wsCleanRepository(root, {
      archivedSessionIds: ['session-offer-mixed-ok'],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
      confirmArchive: async () => true,
      archiveSession: async () => { throw new Error('archive refused by registry') },
    })

    expect(result.cleaned.map(entry => entry.operationId)).toEqual([eligible.operationId])
    expect(result.refused.map(entry => entry.operationId)).toEqual([failing.operationId])
    await expect(access(failing.worktreePath)).resolves.toBeUndefined()
    await expect(access(eligible.worktreePath)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 600_000)

  // 5.2 Archived-then-refused is reported honestly and the archive is kept.
  it('does not report an archived-but-refused candidate as cleaned', async () => {
    const root = await fixture()
    const target = await candidate(root, 'operation-offer-kept', 'session-offer-kept')
    const repo = await discoverRepo(root)
    const record = await loadOperation(repo.gitCommonDir, target.operationId)
    const archived: string[] = []

    const result = await wsCleanRepository(root, {
      archivedSessionIds: [],
      activePaths: [],
      activeBoundSessionIds: [],
      cwd: root,
      confirmArchive: async () => {
        // Make the operation in-flight after the offer is accepted.
        await atomicJson(operationFile(repo.gitCommonDir, target.operationId), { ...record!, phase: 'submitting' })
        return true
      },
      archiveSession: async (id: string) => { archived.push(id) },
    })

    expect(archived).toEqual(['session-offer-kept'])
    expect(result.cleaned).toEqual([])
    expect(result.refused[0]?.reason).toMatch(/in-flight/)
    // The archive is deliberately NOT rolled back; the record survives.
    const after = await loadOperation(repo.gitCommonDir, target.operationId)
    expect(after?.phase).toBe('submitting')
    expect(bindingOf(after!)?.state).not.toBe('cleaned')
  }, 300_000)
})
