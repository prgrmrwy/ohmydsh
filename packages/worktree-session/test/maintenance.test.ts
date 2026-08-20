import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { loadOperation, startOperation } from '../src/host/operation.js'
import { discoverRepo } from '../src/host/git.js'
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
})
