import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { bindSource, loadOperation, operationFile, sessionStatus, startOperation } from '../src/host/operation.js'
import { discoverRepo } from '../src/host/git.js'
import { bindingOf } from '../src/wire.js'
import { wsClean, wsPromote, wsStatus } from '../src/host/maintenance.js'

const exec = promisify(execFile)
const roots: string[] = []
async function git(cwd: string, ...args: string[]): Promise<string> { return (await exec('git', args, { cwd, encoding: 'utf8' })).stdout }
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ws-clean-')); roots.push(root)
  await git(root, 'init', '-b', 'main'); await git(root, 'config', 'user.email', 'ws@example.invalid'); await git(root, 'config', 'user.name', 'WS Test')
  await writeFile(join(root, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n')
  await writeFile(join(root, 'package-lock.json'), '{"name":"fixture","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fixture","version":"1.0.0"}}}\n')
  await writeFile(join(root, '.gitignore'), '.env.local\nnode_modules/\n')
  await git(root, 'add', '.'); await git(root, 'commit', '-m', 'initial')
  return root
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('maintenance', () => {
  it('reports status and safely dry-runs merged cleanup', async () => {
    const root = await fixture()
    const prepared = await startOperation({ operationId: 'operation-clean-1', repoPath: root, baseRef: 'main', taskText: 'clean test', dependencyMode: 'lean' })
    await bindSource({ operationId: prepared.operationId, repoPath: root, sourceSessionId: 'session-clean-1' })
    expect((await wsStatus(prepared.worktreePath)).operationId).toBe('operation-clean-1')
    await expect(wsClean(prepared.worktreePath, { cwd: prepared.worktreePath })).rejects.toThrow(/current worktree/)
    await git(root, 'merge', '--no-ff', prepared.taskBranch, '-m', 'merge task')
    const dry = await wsClean(prepared.worktreePath, { dryRun: true, cwd: root })
    expect(dry.cleaned).toBe(false)
    expect(dry.actions).toHaveLength(3)
  }, 120_000)

  it('refuses dirty and unproven cleanup', async () => {
    const root = await fixture()
    const prepared = await startOperation({ operationId: 'operation-clean-2', repoPath: root, baseRef: 'main', taskText: 'dirty test', dependencyMode: 'lean' })
    await writeFile(join(prepared.worktreePath, 'dirty.txt'), 'dirty')
    await expect(wsClean(prepared.worktreePath, { dryRun: true, cwd: root })).rejects.toThrow(/dirty/)
  }, 120_000)

  it('promotes lean dependencies once and preserves mutable metadata on retry', async () => {
    const root = await fixture()
    const prepared = await startOperation({ operationId: 'operation-promote-1', repoPath: root, baseRef: 'main', taskText: 'promote test', dependencyMode: 'lean' })
    const first = await wsPromote(prepared.worktreePath)
    expect(first.dependencyMode).toBe('mutable')
    const second = await wsPromote(prepared.worktreePath)
    expect(second.dependencyMode).toBe('mutable')
    const repo = await discoverRepo(root)
    expect((await loadOperation(repo.gitCommonDir, 'operation-promote-1'))?.dependencyMode).toBe('mutable')
  }, 120_000)

  it('restores the exact lean link when promote installation fails', async () => {
    const root = await fixture()
    const prepared = await startOperation({ operationId: 'operation-promote-2', repoPath: root, baseRef: 'main', taskText: 'failed promote', dependencyMode: 'lean' })
    const runner = async () => ({ code: 1, stdout: '', stderr: 'injected npm failure', timedOut: false })
    await expect(wsPromote(prepared.worktreePath, { runner })).rejects.toThrow(/injected npm failure/)
    const link = await (await import('node:fs/promises')).readlink(join(prepared.worktreePath, 'node_modules'))
    expect(link).toContain('/ws/cache/npm/')
  }, 120_000)

  it('refuses unproven clean even when the worktree is clean', async () => {
    const root = await fixture()
    const prepared = await startOperation({ operationId: 'operation-clean-3', repoPath: root, baseRef: 'main', taskText: 'unproven test', dependencyMode: 'lean' })
    await writeFile(join(prepared.worktreePath, 'commit.txt'), 'work')
    await git(prepared.worktreePath, 'add', 'commit.txt')
    await git(prepared.worktreePath, 'commit', '-m', 'task work')
    await expect(wsClean(prepared.worktreePath, { dryRun: true, cwd: root })).rejects.toThrow(/not proven merged/)
  }, 120_000)

  it('resolves status/promote from a source Session binding without a worktree path', async () => {
    const root = await fixture()
    const prepared = await startOperation({ operationId: 'operation-session-status', repoPath: root, baseRef: 'main', taskText: 'session status', dependencyMode: 'lean' })
    await bindSource({ operationId: prepared.operationId, repoPath: root, sourceSessionId: 'session-status' })
    expect((await wsStatus({ sessionId: 'session-status', repoPath: root })).worktreePath).toBe(prepared.worktreePath)
    expect((await wsPromote({ sessionId: 'session-status', repoPath: root })).dependencyMode).toBe('mutable')
    expect((await sessionStatus(root, 'session-status')).dependencyMode).toBe('mutable')
  }, 120_000)

  it('refuses cleanup while the source Session binding is active', async () => {
    const root = await fixture()
    const prepared = await startOperation({ operationId: 'operation-active-bound', repoPath: root, baseRef: 'main', taskText: 'active bound', dependencyMode: 'lean' })
    await bindSource({ operationId: prepared.operationId, repoPath: root, sourceSessionId: 'session-active' })
    await git(root, 'merge', '--no-ff', prepared.taskBranch, '-m', 'merge active')
    await expect(wsClean({ sessionId: 'session-active', repoPath: root }, { dryRun: true, cwd: root, activeBoundSessionIds: ['session-active'] })).rejects.toThrow(/active source Session/)
  }, 120_000)

  it('retains a cleaned source-session tombstone after safe archived cleanup', async () => {
    const root = await fixture()
    const prepared = await startOperation({ operationId: 'operation-tombstone', repoPath: root, baseRef: 'main', taskText: 'tombstone', dependencyMode: 'lean' })
    await bindSource({ operationId: prepared.operationId, repoPath: root, sourceSessionId: 'session-archived' })
    await git(root, 'merge', '--no-ff', prepared.taskBranch, '-m', 'merge archived')
    const cleaned = await wsClean({ sessionId: 'session-archived', repoPath: root }, { cwd: root, activeBoundSessionIds: [] })
    expect(cleaned.cleaned).toBe(true)
    const repo = await discoverRepo(root)
    const record = await loadOperation(repo.gitCommonDir, prepared.operationId)
    expect(record?.phase).toBe('cleaned')
    expect(bindingOf(record!)?.state).toBe('cleaned')
    expect(bindingOf(record!)?.archiveLifecycle).toEqual({ version: 1 })
    expect((await sessionStatus(root, 'session-archived'))).toMatchObject({ bound: true, cleaned: true, lifecycle: 'cleaned' })
  }, 120_000)

  it('fails closed on malformed schema-v2 metadata before deleting Git resources', async () => {
    const root = await fixture()
    const prepared = await startOperation({ operationId: 'operation-v2-malformed', repoPath: root, baseRef: 'main', taskText: 'malformed metadata', dependencyMode: 'lean' })
    const repo = await discoverRepo(root)
    const record = await loadOperation(repo.gitCommonDir, prepared.operationId)
    const { binding: _binding, ...missingBinding } = record!
    await (await import('../src/host/fs.js')).atomicJson(operationFile(repo.gitCommonDir, prepared.operationId), missingBinding)
    await git(root, 'merge', '--no-ff', prepared.taskBranch, '-m', 'merge malformed')
    await expect(wsClean(prepared.worktreePath, { cwd: root })).rejects.toThrow(/malformed maintenance binding/)
    await expect(loadOperation(repo.gitCommonDir, prepared.operationId)).resolves.toBeTruthy()
    await expect((await import('node:fs/promises')).access(prepared.worktreePath)).resolves.toBeUndefined()
    await expect(git(root, 'rev-parse', '--verify', prepared.taskBranch)).resolves.toBeTruthy()
  }, 120_000)

  it('fails closed on schema-v1 metadata before touching Git resources', async () => {
    const root = await fixture()
    const prepared = await startOperation({ operationId: 'operation-v1-clean', repoPath: root, baseRef: 'main', taskText: 'legacy target', dependencyMode: 'lean' })
    await bindSource({ operationId: prepared.operationId, repoPath: root, sourceSessionId: 'session-v1-clean' })
    const repo = await discoverRepo(root)
    const record = await loadOperation(repo.gitCommonDir, prepared.operationId)
    const { binding: _binding, ...schemaV1 } = record!
    await (await import('../src/host/fs.js')).atomicJson(operationFile(repo.gitCommonDir, prepared.operationId), { ...schemaV1, schemaVersion: 1 })
    // Reading a v1 operation reports a clear unsupported-version diagnostic.
    await expect(loadOperation(repo.gitCommonDir, prepared.operationId)).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA_VERSION' })
    // Every maintenance surface fails closed and leaves Git resources untouched.
    await expect(wsStatus(prepared.worktreePath)).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA_VERSION' })
    await expect(wsPromote(prepared.worktreePath)).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA_VERSION' })
    await git(root, 'merge', '--no-ff', prepared.taskBranch, '-m', 'merge legacy')
    await expect(wsClean(prepared.worktreePath, { cwd: root })).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA_VERSION' })
    await expect(loadOperation(repo.gitCommonDir, prepared.operationId)).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA_VERSION' })
    await expect((await import('node:fs/promises')).access(prepared.worktreePath)).resolves.toBeUndefined()
    await expect(git(root, 'rev-parse', '--verify', prepared.taskBranch)).resolves.toBeTruthy()
    await expect(git(root, 'worktree', 'list', '--porcelain')).resolves.toContain(prepared.worktreePath)
  }, 120_000)

  it('fails closed on unknown future schemaVersion while preserving resources', async () => {
    const root = await fixture()
    const prepared = await startOperation({ operationId: 'operation-v3-unknown', repoPath: root, baseRef: 'main', taskText: 'future schema', dependencyMode: 'lean' })
    await bindSource({ operationId: prepared.operationId, repoPath: root, sourceSessionId: 'session-v3' })
    const repo = await discoverRepo(root)
    const record = await loadOperation(repo.gitCommonDir, prepared.operationId)
    const { binding: _binding, ...schemaVersion2 } = record!
    await (await import('../src/host/fs.js')).atomicJson(operationFile(repo.gitCommonDir, prepared.operationId), { ...schemaVersion2, schemaVersion: 3 })
    await expect(loadOperation(repo.gitCommonDir, prepared.operationId)).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA_VERSION' })
    await expect(wsStatus(prepared.worktreePath)).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA_VERSION' })
    await expect((await import('node:fs/promises')).access(prepared.worktreePath)).resolves.toBeUndefined()
    await expect(git(root, 'rev-parse', '--verify', prepared.taskBranch)).resolves.toBeTruthy()
  }, 120_000)
})
