import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectPackageManager } from '../src/host/project.js'
import { startOperation } from '../src/host/operation.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), 'ws-project-')); roots.push(value); return value }

describe('project type detection', () => {
  it('resolves npm and pnpm from the repo-root lockfiles', async () => {
    const npmPath = await root()
    await writeFile(join(npmPath, 'package-lock.json'), '{}\n')
    expect(await detectPackageManager(npmPath)).toBe('npm')
    const pnpmPath = await root()
    await writeFile(join(pnpmPath, 'pnpm-lock.yaml'), 'lockfileVersion: \'9.0\'\n')
    expect(await detectPackageManager(pnpmPath)).toBe('pnpm')
  })

  it('rejects a project with no supported lockfile with an explicit diagnostic', async () => {
    const path = await root()
    await writeFile(join(path, 'yarn.lock'), 'lockfileVersion: 1\n')
    await expect(detectPackageManager(path)).rejects.toMatchObject({ code: 'UNSUPPORTED_PROJECT' })
  })

  it('rejects mixed lockfiles with an explicit diagnostic', async () => {
    const path = await root()
    await writeFile(join(path, 'package-lock.json'), '{}\n')
    await writeFile(join(path, 'pnpm-lock.yaml'), 'lockfileVersion: \'9.0\'\n')
    await expect(detectPackageManager(path)).rejects.toMatchObject({ code: 'UNSUPPORTED_PROJECT' })
  })
})

/** Start from a bare git fixture without any supported lockfile: the request
 * must fail closed before creating a branch, worktree, or operation file. */
describe('unsupported project fails closed before resources', () => {
  it('creates no branch, worktree, or operation file for a lockfile-less repo', async () => {
    const rootPath = await root()
    const exec = (async (...args: string[]) => (await import('node:child_process')).execFileSync(args[0]!, args.slice(1), { cwd: rootPath, encoding: 'utf8' })) as (...args: string[]) => string
    await exec('git', 'init', '-b', 'main')
    await exec('git', 'config', 'user.email', 'ws@example.invalid')
    await exec('git', 'config', 'user.name', 'WS Test')
    await writeFile(join(rootPath, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n')
    await exec('git', 'add', 'package.json')
    await exec('git', 'commit', '-m', 'initial')

    const request = { operationId: 'operation-unsupported-1', repoPath: rootPath, baseRef: 'main', taskText: 'never prepared', dependencyMode: 'lean' as const }
    await expect(startOperation(request)).rejects.toMatchObject({ code: 'UNSUPPORTED_PROJECT' })
    expect(await readdir(join(rootPath, '.git', 'ws', 'operations')).catch(() => [])).toHaveLength(0)
    expect(await readdir(join(rootPath, '.worktrees')).catch(() => [])).toHaveLength(0)
    expect((await exec('git', 'branch', '--list', 'ws/*')).trim()).toBe('')
  }, 120_000)

  it('rejects mixed lockfiles without touching Git state', async () => {
    const rootPath = await root()
    const exec = (async (...args: string[]) => (await import('node:child_process')).execFileSync(args[0]!, args.slice(1), { cwd: rootPath, encoding: 'utf8' })) as (...args: string[]) => string
    await exec('git', 'init', '-b', 'main')
    await exec('git', 'config', 'user.email', 'ws@example.invalid')
    await exec('git', 'config', 'user.name', 'WS Test')
    await writeFile(join(rootPath, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n')
    await writeFile(join(rootPath, 'package-lock.json'), '{}\n')
    await writeFile(join(rootPath, 'pnpm-lock.yaml'), 'lockfileVersion: \'9.0\'\n')
    await exec('git', 'add', '.')
    await exec('git', 'commit', '-m', 'initial')

    const request = { operationId: 'operation-mixed-1', repoPath: rootPath, baseRef: 'main', taskText: 'mixed lockfiles', dependencyMode: 'lean' as const }
    await expect(startOperation(request)).rejects.toMatchObject({ code: 'UNSUPPORTED_PROJECT' })
    expect(await readdir(join(rootPath, '.git', 'ws', 'operations')).catch(() => [])).toHaveLength(0)
    expect((await exec('git', 'branch', '--list', 'ws/*')).trim()).toBe('')
    expect((await exec('git', 'status', '--porcelain')).trim()).toBe('')
  }, 120_000)
})
