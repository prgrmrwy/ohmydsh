import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { wsPromote, wsStatus } from '../src/host/maintenance.js'
import { startOperation } from '../src/host/operation.js'

const exec = promisify(execFile)
const roots: string[] = []

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec('git', args, { cwd, encoding: 'utf8' })).stdout
}

/** Minimal pnpm workspace fixture: root + `packages/shared` (no deps) +
 * `packages/app` depends on the sibling via the pnpm `workspace:*` protocol,
 * zero external dependencies so `pnpm install --lockfile-only` needs no
 * network and produces a deterministic lockfile. */
async function pnpmWorkspaceFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ws-pnpm-op-'))
  roots.push(root)
  await git(root, 'init', '-b', 'main')
  await git(root, 'config', 'user.email', 'ws@example.invalid')
  await git(root, 'config', 'user.name', 'WS Test')
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture-workspace', version: '1.0.0', private: true, packageManager: 'pnpm@10.23.0' }))
  await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
  await writeFile(join(root, '.gitignore'), '.env.local\nnode_modules/\n')
  await mkdir(join(root, 'packages', 'shared'), { recursive: true })
  await mkdir(join(root, 'packages', 'app'), { recursive: true })
  await writeFile(join(root, 'packages', 'shared', 'package.json'), JSON.stringify({ name: '@fixture/shared', version: '1.0.0', private: true }))
  await writeFile(join(root, 'packages', 'shared', 'index.ts'), 'export const answer = 42\n')
  await writeFile(join(root, 'packages', 'app', 'package.json'), JSON.stringify({ name: '@fixture/app', version: '1.0.0', private: true, dependencies: { '@fixture/shared': 'workspace:*' } }))
  await writeFile(join(root, 'packages', 'app', 'main.ts'), 'import { answer } from \'@fixture/shared\'\nexport const value = answer\n')
  // Generate the deterministic lockfile (no external deps → no network, no store).
  await exec('pnpm', ['install', '--lockfile-only', '--reporter', 'silent'], { cwd: root, encoding: 'utf8' })
  await git(root, 'add', '.')
  await git(root, 'commit', '-m', 'initial')
  return root
}

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('pnpm workspace end-to-end', () => {
  it('prepares a pnpm workspace, reports pnpm, and promotes to mutable', async () => {
    const root = await pnpmWorkspaceFixture()
    const beforeBranch = (await git(root, 'branch', '--show-current')).trim()
    const request = { operationId: 'operation-pnpm-1', repoPath: root, baseRef: 'main', taskText: 'pnpm workspace task', dependencyMode: 'lean' as const }
    const prepared = await startOperation(request)
    expect(prepared.packageManager).toBe('pnpm')
    expect(prepared.lockFingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(prepared.dependencyMode).toBe('lean')
    const stat = await (await import('node:fs/promises')).stat(join(prepared.worktreePath, 'node_modules'))
    expect(stat.isDirectory()).toBe(true)
    // Workspace-internal dependency resolves to the worktree's own sources:
    // the app importer links @fixture/shared to packages/shared via a relative
    // symlink that must stay inside the worktree (never into a shared cache).
    const linkDir = join(prepared.worktreePath, 'packages', 'app', 'node_modules', '@fixture', 'shared')
    const link = await readlink(linkDir)
    const { dirname, resolve, sep } = await import('node:path')
    const resolved = resolve(dirname(linkDir), link)
    expect(resolved.startsWith(`${prepared.worktreePath}${sep}`)).toBe(true)
    expect(resolved.endsWith(join('packages', 'shared'))).toBe(true)
    const mutable = await wsPromote({ path: prepared.worktreePath })
    expect(mutable.dependencyMode).toBe('mutable')
    expect(mutable.packageManager).toBe('pnpm')
    expect((await git(root, 'branch', '--show-current')).trim()).toBe(beforeBranch)
  }, 180_000)

  it('status reports the package manager and lean mode for a bound pnpm operation', async () => {
    const root = await pnpmWorkspaceFixture()
    const request = { operationId: 'operation-pnpm-2', repoPath: root, baseRef: 'main', taskText: 'session-bound status', dependencyMode: 'lean' as const }
    const prepared = await startOperation(request)
    const status = await wsStatus(prepared.worktreePath)
    expect(status.packageManager).toBe('pnpm')
    expect(status.dependencyMode).toBe('lean')
  }, 180_000)
})
