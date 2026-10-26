import { execFile } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import { bindSource, loadOperation, saveOperation, sessionStatus, startOperation } from '../src/host/operation.js'
import { discoverRepo } from '../src/host/git.js'
import { wsClean, wsPreparePreview, wsPromote, wsStatus } from '../src/host/maintenance.js'

const exec = promisify(execFile)
const roots: string[] = []
const git = async (cwd: string, ...args: string[]) => (await exec('git', args, { cwd })).stdout
async function fixture(body?: string, teardown?: string) {
  const root = await mkdtemp(join(tmpdir(), 'ws-preview-')); roots.push(root)
  await git(root, 'init', '-b', 'main'); await git(root, 'config', 'user.email', 'test@example.invalid'); await git(root, 'config', 'user.name', 'Test')
  await writeFile(join(root, 'package.json'), '{"name":"fixture","version":"1.0.0"}')
  await writeFile(join(root, 'package-lock.json'), '{"name":"fixture","version":"1.0.0","lockfileVersion":3,"packages":{"":{"name":"fixture","version":"1.0.0"}}}')
  await writeFile(join(root, '.gitignore'), '.env.local\nnode_modules/\n')
  await mkdir(join(root, '.ws'))
  for (const [name, script] of [['prepare-preview', body], ['teardown-preview', teardown]]) {
    if (script === undefined) continue
    await writeFile(join(root, '.ws', name!), `#!/usr/bin/env node\n${script}`, { mode: 0o755 })
  }
  await git(root, 'add', '.'); await git(root, 'commit', '-m', 'fixture')
  const request = { operationId: 'preview-operation-1', repoPath: root, baseRef: 'main', taskText: 'preview', dependencyMode: 'lean' as const }
  const prepared = await startOperation(request)
  await bindSource({ operationId: prepared.operationId, repoPath: root, sourceSessionId: 'preview-session' })
  const repo = await discoverRepo(root)
  return { root, prepared, repo, request, target: { sessionId: 'preview-session', repoPath: root } }
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it('is opt-in, passes trusted context, recreates home and preserves binding', async () => {
  const f = await fixture('console.log(JSON.stringify(process.env))')
  expect((await wsStatus(f.target)).preview).toBeNull()
  await rm(f.prepared.dshHome, { recursive: true })
  const before = await loadOperation(f.repo.gitCommonDir, f.prepared.operationId)
  const first = await wsPreparePreview(f.target, { env: { PATH: process.env.PATH!, DSH_HOME: '/source/home' } })
  const context = JSON.parse(first.preview!.outputTail)
  expect(context).toMatchObject({ DSH_HOME: f.prepared.dshHome, WS_DSH_HOME: f.prepared.dshHome, WS_SOURCE_DSH_HOME: '/source/home', WS_WORKTREE: f.prepared.worktreePath, WS_SOURCE_REPO: f.repo.repoRoot, WS_GIT_COMMON_DIR: f.repo.gitCommonDir, WS_OPERATION_ID: f.prepared.operationId, WS_HOOK: 'prepare-preview' })
  expect((await lstat(f.prepared.dshHome)).mode & 0o777).toBe(0o700)
  const after = await loadOperation(f.repo.gitCommonDir, f.prepared.operationId)
  expect({ ...after, preview: undefined, updatedAt: '' }).toEqual({ ...before, preview: undefined, updatedAt: '' })
  expect((await wsPreparePreview(f.target)).preview?.status).toBe('ok')
}, 120_000)

it('skips absent hooks and refuses untracked, non-executable and linked hooks', async () => {
  const f = await fixture()
  expect((await wsPreparePreview(f.target)).preview?.status).toBe('skipped')
  const path = join(f.prepared.worktreePath, '.ws', 'prepare-preview')
  await mkdir(join(f.prepared.worktreePath, '.ws'), { recursive: true })
  await writeFile(path, '#!/usr/bin/env node\nconsole.log("should not run")', { mode: 0o755 })
  expect((await wsPreparePreview(f.target)).preview?.outputTail).toMatch(/tracked/)
  await git(f.prepared.worktreePath, 'add', '.ws/prepare-preview')
  await chmod(path, 0o600)
  expect((await wsPreparePreview(f.target)).preview?.status).toBe('failed')
  await rm(path); await symlink(join(f.root, 'package.json'), path)
  expect((await wsPreparePreview(f.target)).preview?.outputTail).toMatch(/links/)
}, 120_000)

it('records bounded output, nonzero exit and timeout without changing phase', async () => {
  const f = await fixture('console.log("x".repeat(10000)); process.exitCode = 7')
  const failed = await wsPreparePreview(f.target)
  expect(failed.preview).toMatchObject({ status: 'failed', exitCode: 7 })
  expect(failed.preview!.outputTail.length).toBeLessThanOrEqual(4096)
  await writeFile(join(f.prepared.worktreePath, '.ws', 'prepare-preview'), '#!/usr/bin/env node\nsetInterval(() => {}, 1000)')
  const timed = await wsPreparePreview(f.target, { timeoutMs: 50 })
  expect(timed.preview?.status).toBe('failed'); expect(timed.preview?.outputTail).toMatch(/timed out/)
  expect(timed.phase).toBe('prepared')
}, 120_000)

it('does not hold the repo lock, refuses duplicates, and never resurrects a cleaned operation', async () => {
  const f = await fixture('const fs = require("node:fs"); setInterval(() => { if (fs.existsSync(process.env.WS_SOURCE_REPO + "/release-hook")) process.exit(0) }, 10)')
  const running = wsPreparePreview(f.target, { timeoutMs: 30_000 })
  // Wait for the exclusive lock rather than a fixed timing assumption.
  const lock = join(f.repo.gitCommonDir, 'ws', 'locks', `preview-${f.prepared.operationId}.lock`)
  for (let i = 0; i < 200; i++) { if (await lstat(lock).then(() => true, () => false)) break; await new Promise(r => setTimeout(r, 10)) }
  await expect(wsPreparePreview(f.target)).rejects.toThrow(/already running/)
  const other = await startOperation({ ...f.request, operationId: 'preview-operation-2', taskText: 'other' })
  await bindSource({ operationId: other.operationId, repoPath: f.root, sourceSessionId: 'other-session' })
  expect((await wsPromote(other.worktreePath)).dependencyMode).toBe('mutable')
  expect((await wsClean(other.worktreePath, { cwd: f.root })).cleaned).toBe(true)
  const pending = running.catch(error => error as Error)
  expect((await wsClean(f.target, { cwd: f.root })).cleaned).toBe(true)
  await writeFile(join(f.root, 'release-hook'), '')
  expect(await pending).toMatchObject({ code: 'OPERATION_CONFLICT' })
  expect((await loadOperation(f.repo.gitCommonDir, f.prepared.operationId))?.phase).toBe('cleaned')
  await expect(wsPreparePreview(f.target)).rejects.toThrow()
}, 120_000)

it('reclaims a dead preview lock but refuses malformed and live owners', async () => {
  const f = await fixture()
  const lock = join(f.repo.gitCommonDir, 'ws', 'locks', `preview-${f.prepared.operationId}.lock`)
  await writeFile(lock, JSON.stringify({ pid: 2147483647 }))
  expect((await wsPreparePreview(f.target)).preview?.status).toBe('skipped')
  await writeFile(lock, JSON.stringify({ pid: process.pid }))
  await expect(wsPreparePreview(f.target)).rejects.toThrow(/already running/)
  await writeFile(lock, '{}')
  await expect(wsPreparePreview(f.target)).rejects.toThrow(/Unreadable/)
}, 120_000)

it('tears down before deletion; dry-run and refused clean do not execute hooks', async () => {
  const f = await fixture(undefined, 'require("node:fs").writeFileSync(process.env.WS_SOURCE_REPO + "/teardown-ran", process.env.WS_HOOK)')
  await wsClean(f.target, { cwd: f.root, dryRun: true })
  await expect(readFile(join(f.root, 'teardown-ran'))).rejects.toThrow()
  await expect(wsClean(f.target, { cwd: f.prepared.worktreePath })).rejects.toThrow()
  const cleaned = await wsClean(f.target, { cwd: f.root })
  expect(await readFile(join(f.root, 'teardown-ran'), 'utf8')).toBe('teardown-preview')
  expect(cleaned.isolatedHome?.status).toBe('removed')
  await expect(lstat(f.prepared.dshHome)).rejects.toThrow()
  expect((await sessionStatus(f.root, 'preview-session')).cleaned).toBe(true)
}, 120_000)

it('warns on teardown timeout and still cleans, while refusing unsafe home deletion', async () => {
  const f = await fixture(undefined, 'setInterval(() => {}, 1000)')
  const record = (await loadOperation(f.repo.gitCommonDir, f.prepared.operationId))!
  await saveOperation({ ...record, dshHome: f.root })
  const cleaned = await wsClean(f.target, { cwd: f.root, hookTimeoutMs: 50 })
  expect(cleaned.cleaned).toBe(true)
  expect(cleaned.warnings?.join('\n')).toMatch(/may still be running/)
  expect(cleaned.isolatedHome?.status).toBe('skipped')
  expect((await lstat(f.root)).isDirectory()).toBe(true)
}, 120_000)

it('rejects symlinked hook ancestors and isolated homes without touching their targets', async () => {
  const f = await fixture('console.log("must not run")')
  const hooks = join(f.prepared.worktreePath, '.ws')
  await rm(hooks, { recursive: true }); await symlink(join(f.root, '.ws'), hooks)
  expect((await wsPreparePreview(f.target)).preview?.outputTail).toMatch(/links/)
  await rm(hooks); await git(f.prepared.worktreePath, 'checkout', '--', '.ws')
  await rm(f.prepared.dshHome, { recursive: true }); await symlink(f.root, f.prepared.dshHome)
  await expect(wsPreparePreview(f.target)).rejects.toThrow(/regular directory/)
  const cleaned = await wsClean(f.target, { cwd: f.root })
  expect(cleaned.isolatedHome?.status).toBe('skipped')
  expect((await lstat(f.root)).isDirectory()).toBe(true)
}, 120_000)

it('treats missing home as already removed and rejects unbound prepare', async () => {
  const f = await fixture()
  const record = (await loadOperation(f.repo.gitCommonDir, f.prepared.operationId))!
  const { binding: _, ...unbound } = record
  await saveOperation(unbound)
  await expect(wsPreparePreview(f.prepared.worktreePath)).rejects.toThrow(/bound/)
  await saveOperation(record)
  await rm(f.prepared.dshHome, { recursive: true })
  expect((await wsClean(f.target, { cwd: f.root })).isolatedHome?.status).toBe('removed')
}, 120_000)
