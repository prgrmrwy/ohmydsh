import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadOperation, startOperation } from '../src/host/operation.js'
import { createGitClient, discoverRepo } from '../src/host/git.js'
import { detectPackageManager } from '../src/host/project.js'
import type { ProcessRunner } from '../src/host/process.js'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

async function gitProject(options: { tracked: 'npm' | 'pnpm' | 'both' | 'none'; packageManager?: string } = { tracked: 'none' }): Promise<string> {
  const path = await root()
  git(path, 'init', '-b', 'main')
  git(path, 'config', 'user.email', 'ws@example.invalid')
  git(path, 'config', 'user.name', 'WS Test')
  await writeFile(join(path, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', private: true, ...(options.packageManager === undefined ? {} : { packageManager: options.packageManager }) }) + '\n')
  await writeFile(join(path, 'package-lock.json'), '{"name":"fixture","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fixture","version":"1.0.0"}}}\n')
  await writeFile(join(path, 'pnpm-lock.yaml'), 'lockfileVersion: \'9.0\'\n\nimporters:\n\n  .: {}\n')
  git(path, 'add', 'package.json', ...(options.tracked === 'npm' || options.tracked === 'both' ? ['package-lock.json'] : []), ...(options.tracked === 'pnpm' || options.tracked === 'both' ? ['pnpm-lock.yaml'] : []))
  git(path, 'commit', '-m', 'initial')
  return path
}

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), 'ws-project-')); roots.push(value); return value }

describe('project type detection', () => {
  it('resolves npm and pnpm from the repo-root lockfiles', async () => {
    const npmPath = await root()
    await writeFile(join(npmPath, 'package-lock.json'), '{}\n')
    const npmResolution = await detectPackageManager(npmPath)
    expect(npmResolution.packageManager).toBe('npm')
    expect(npmResolution.adoption).toBeUndefined()
    const pnpmPath = await root()
    await writeFile(join(pnpmPath, 'pnpm-lock.yaml'), 'lockfileVersion: \'9.0\'\n')
    const pnpmResolution = await detectPackageManager(pnpmPath)
    expect(pnpmResolution.packageManager).toBe('pnpm')
    expect(pnpmResolution.adoption).toBeUndefined()
  })

  it('rejects a project with no supported lockfile with an explicit diagnostic', async () => {
    const path = await root()
    await writeFile(join(path, 'yarn.lock'), 'lockfileVersion: 1\n')
    await expect(detectPackageManager(path)).rejects.toMatchObject({ code: 'UNSUPPORTED_PROJECT' })
  })

  it('adopts the one tracked lockfile in a mixed project', async () => {
    const pnpmPath = await gitProject({ tracked: 'pnpm' })
    await expect(detectPackageManager(pnpmPath)).resolves.toMatchObject({
      packageManager: 'pnpm',
      adoption: { packageManager: 'pnpm', signal: 'git-tracking', ignoredLockfile: 'package-lock.json' },
    })

    const npmPath = await gitProject({ tracked: 'npm' })
    await expect(detectPackageManager(npmPath)).resolves.toMatchObject({
      packageManager: 'npm',
      adoption: { packageManager: 'npm', signal: 'git-tracking', ignoredLockfile: 'pnpm-lock.yaml' },
    })
  })

  it('uses packageManager declaration before tracking state', async () => {
    const path = await gitProject({ tracked: 'npm', packageManager: 'pnpm@10.23.0' })
    await expect(detectPackageManager(path)).resolves.toMatchObject({
      packageManager: 'pnpm',
      adoption: { packageManager: 'pnpm', signal: 'packageManager-field', ignoredLockfile: 'package-lock.json' },
    })
  })

  it('falls back from unsupported packageManager declarations to tracking state', async () => {
    const path = await gitProject({ tracked: 'pnpm', packageManager: 'yarn@4.0.0' })
    await expect(detectPackageManager(path)).resolves.toMatchObject({ packageManager: 'pnpm', adoption: { signal: 'git-tracking' } })
  })

  it('refuses to guess when Git tracking cannot be queried', async () => {
    const path = await gitProject({ tracked: 'pnpm' })
    const brokenRunner: ProcessRunner = async () => { throw new Error('git unavailable') }
    await expect(detectPackageManager(path, createGitClient(brokenRunner))).rejects.toMatchObject({ code: 'UNSUPPORTED_PROJECT' })
  })

  it('rejects mixed lockfiles without a distinguishing signal', async () => {
    const bothTracked = await gitProject({ tracked: 'both' })
    await expect(detectPackageManager(bothTracked)).rejects.toMatchObject({ code: 'UNSUPPORTED_PROJECT', message: expect.stringContaining('无法判定混合 lockfile') })

    const bothUntracked = await gitProject({ tracked: 'none' })
    await expect(detectPackageManager(bothUntracked)).rejects.toMatchObject({ code: 'UNSUPPORTED_PROJECT', message: expect.stringContaining('无法判定混合 lockfile') })

    const nonGit = await root()
    await writeFile(join(nonGit, 'package-lock.json'), '{}\n')
    await writeFile(join(nonGit, 'pnpm-lock.yaml'), 'lockfileVersion: \'9.0\'\n')
    await expect(detectPackageManager(nonGit)).rejects.toMatchObject({ code: 'UNSUPPORTED_PROJECT' })
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

  it('persists a mixed-lockfile adoption diagnostic when starting', async () => {
    const rootPath = await gitProject({ tracked: 'pnpm' })
    const request = { operationId: 'operation-adopted-1', repoPath: rootPath, baseRef: 'main', taskText: 'adopt pnpm lockfile', dependencyMode: 'lean' as const }
    const prepared = await startOperation(request)
    const replay = await startOperation(request)
    const repo = await discoverRepo(rootPath)
    const operation = await loadOperation(repo.gitCommonDir, request.operationId)
    expect(replay).toEqual(prepared)
    expect(prepared.packageManager).toBe('pnpm')
    expect(operation?.diagnostics?.filter(value => value.includes('混合 lockfile 裁决'))).toHaveLength(1)
    expect(operation?.diagnostics?.some(value => value.includes('采信 pnpm') && value.includes('Git 跟踪状态') && value.includes('package-lock.json'))).toBe(true)
    expect(operation?.lockFingerprint).toMatch(/^[0-9a-f]{64}$/)
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
