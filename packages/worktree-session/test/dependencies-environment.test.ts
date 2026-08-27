import { mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cacheHealthy, dependencyFingerprint, ensureLeanLink, prepareDependencyCache, preparePnpmDependencies, promotePnpmDependencies } from '../src/host/dependencies.js'
import { ensureWorktreeExclude, managedEnvironment, prepareEnvironment } from '../src/host/environment.js'
import { createGitClient } from '../src/host/git.js'
import type { ProcessRunner } from '../src/host/process.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), 'ws-deps-')); roots.push(value); return value }

const npm11: ProcessRunner = async () => ({ code: 0, stdout: '11.6.2\n', stderr: '', timedOut: false })
const npm10: ProcessRunner = async () => ({ code: 0, stdout: '10.9.0\n', stderr: '', timedOut: false })
const pnpm10: ProcessRunner = async () => ({ code: 0, stdout: '10.23.0\n', stderr: '', timedOut: false })
const pnpm9: ProcessRunner = async () => ({ code: 0, stdout: '9.15.0\n', stderr: '', timedOut: false })

describe('dependencies and environment', () => {
  it('fingerprints npm lockfile plus npm major', async () => {
    const path = await root()
    await writeFile(join(path, 'package-lock.json'), '{"lockfileVersion":3}\n')
    const one = await dependencyFingerprint(path, npm11)
    const two = await dependencyFingerprint(path, npm10)
    expect(one.fingerprint).not.toBe(two.fingerprint)
    expect(one.packageManager).toBe('npm')
    expect(one.cliMajor).toBe(11)
    await writeFile(join(path, 'package-lock.json'), '{"lockfileVersion":3,"x":1}\n')
    expect((await dependencyFingerprint(path, npm11)).fingerprint).not.toBe(one.fingerprint)
  })

  it('fingerprints pnpm lockfile plus pnpm major', async () => {
    const path = await root()
    await writeFile(join(path, 'pnpm-lock.yaml'), 'lockfileVersion: \'9.0\'\n')
    const one = await dependencyFingerprint(path, pnpm10, 'pnpm')
    const two = await dependencyFingerprint(path, pnpm9, 'pnpm')
    expect(one.fingerprint).not.toBe(two.fingerprint)
    expect(one.packageManager).toBe('pnpm')
    expect(one.cliMajor).toBe(10)
    await writeFile(join(path, 'pnpm-lock.yaml'), 'lockfileVersion: \'9.0\'\nchanged: true\n')
    expect((await dependencyFingerprint(path, pnpm10, 'pnpm')).fingerprint).not.toBe(one.fingerprint)
  })

  it('refuses an unexpected node_modules and accepts exact lean target', async () => {
    const path = await root()
    const cache = join(path, 'cache', 'node_modules')
    await mkdir(cache, { recursive: true })
    await mkdir(join(path, 'node_modules'))
    await expect(ensureLeanLink(path, cache)).rejects.toThrow(/Refusing to overwrite/)
    await rm(join(path, 'node_modules'), { recursive: true })
    await ensureLeanLink(path, cache)
    expect(resolve(dirname(join(path, 'node_modules')), await readlink(join(path, 'node_modules')))).toBe(resolve(cache))
    await ensureLeanLink(path, cache)
  })

  it('rejects partial or unhealthy cache metadata', async () => {
    const path = await root()
    await mkdir(join(path, 'node_modules'), { recursive: true })
    const expected = { fingerprint: 'abc', nodeMajor: 24, cliMajor: 11, packageManager: 'npm' as const }
    expect(await cacheHealthy(path, expected, npm11)).toBe(false)
    // schemaVersion 1 (pre-pnpm legacy) metadata is treated as stale and rebuilt.
    await writeFile(join(path, 'ready.json'), JSON.stringify({ schemaVersion: 1, fingerprint: expected.fingerprint, nodeMajor: 24, cliMajor: 11, npmMajor: 11, packageManager: 'npm', createdAt: new Date().toISOString() }))
    expect(await cacheHealthy(path, expected, npm11)).toBe(false)
    await writeFile(join(path, 'ready.json'), JSON.stringify({ schemaVersion: 2, ...expected, createdAt: new Date().toISOString() }))
    const unhealthy: ProcessRunner = async () => ({ code: 1, stdout: '', stderr: 'broken', timedOut: false })
    expect(await cacheHealthy(path, expected, unhealthy)).toBe(false)
  })

  it('detects mutation of ready shared dependency content', async () => {
    const path = await root()
    const common = join(path, '.git')
    await mkdir(common)
    await writeFile(join(path, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n')
    await writeFile(join(path, 'package-lock.json'), '{"name":"fixture","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fixture","version":"1.0.0"}}}\n')
    const prepared = await prepareDependencyCache(path, common)
    const cacheRoot = dirname(prepared.nodeModules)
    const expected = await dependencyFingerprint(path)
    expect(await cacheHealthy(cacheRoot, expected)).toBe(true)
    await (await import('node:fs/promises')).chmod(join(cacheRoot, 'node_modules'), 0o755)
    await writeFile(join(cacheRoot, 'node_modules', 'tampered.txt'), 'tampered')
    expect(await cacheHealthy(cacheRoot, expected)).toBe(false)
  }, 120_000)

  it('writes one idempotent exclude and managed block', async () => {
    const path = await root()
    const git = join(path, '.git')
    await ensureWorktreeExclude(git)
    await ensureWorktreeExclude(git)
    const exclude = await readFile(join(git, 'info', 'exclude'), 'utf8')
    expect(exclude.split('/.worktrees/').length - 1).toBe(1)
    expect(exclude.split('node_modules').length - 1).toBe(1)
    const one = managedEnvironment('A=1\n', '/tmp/home-one')
    const two = managedEnvironment(one, '/tmp/home-two')
    expect(two).toContain('A=1')
    expect(two).not.toContain('/tmp/home-one')
    expect(two.split('# BEGIN worktree-session managed').length - 1).toBe(1)
  })

  it('refuses a tracked .env.local source and gives operations distinct homes', async () => {
    const path = await root()
    const exec = async (...args: string[]) => (await import('node:child_process')).execFileSync(args[0]!, args.slice(1), { cwd: path, encoding: 'utf8' })
    await exec('git', 'init', '-b', 'main')
    await exec('git', 'config', 'user.email', 'ws@example.invalid')
    await exec('git', 'config', 'user.name', 'WS Test')
    await writeFile(join(path, '.env.local'), 'TRACKED=1\n')
    await exec('git', 'add', '.env.local')
    await exec('git', 'commit', '-m', 'tracked env')
    const common = join(path, '.git')
    const worktree = join(path, 'worktree')
    await mkdir(worktree)
    await expect(prepareEnvironment(path, worktree, common, 'op-one', createGitClient())).rejects.toThrow(/not Git-ignored/)
    await exec('git', 'rm', '--cached', '.env.local')
    await writeFile(join(path, '.gitignore'), '.env.local\n')
    await exec('git', 'add', '.gitignore')
    await exec('git', 'commit', '-m', 'ignore env')
    const first = await prepareEnvironment(path, worktree, common, 'op-one', createGitClient())
    const secondDir = join(path, 'worktree-two'); await mkdir(secondDir)
    const second = await prepareEnvironment(path, secondDir, common, 'op-two', createGitClient())
    expect(first).not.toBe(second)
    expect((await (await import('node:fs/promises')).stat(join(worktree, '.env.local'))).mode & 0o777).toBe(0o600)
  })

  it('prepares pnpm dependencies in place with a real minimal lockfile', async () => {
    const path = await root()
    await writeFile(join(path, 'package.json'), '{"name":"fixture","version":"1.0.0","private":true}\n')
    await writeFile(join(path, 'pnpm-lock.yaml'), 'lockfileVersion: \'9.0\'\n\nimporters:\n\n  .: {}\n')
    const prepared = await preparePnpmDependencies(path)
    expect(prepared.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect((await (await import('node:fs/promises')).stat(join(path, 'node_modules'))).isDirectory()).toBe(true)
    // frozen-lockfile plus pnpm list verify the tree; a promote reinstall also succeeds.
    await promotePnpmDependencies(path)
    expect(prepared.fingerprint).toBe((await dependencyFingerprint(path, runProcess(), 'pnpm')).fingerprint)
  }, 120_000)

  it('fails pnpm preparation with a clear dependency diagnostic when review fails', async () => {
    const path = await root()
    await writeFile(join(path, 'package.json'), '{"name":"fixture","version":"1.0.0","private":true}\n')
    await writeFile(join(path, 'pnpm-lock.yaml'), 'lockfileVersion: \'9.0\'\n\nimporters:\n\n  .: {}\n')
    const broken: ProcessRunner = async (file, args, options) => file === 'pnpm' && args[0] === 'install' && (options.cwd === path)
      ? { code: 1, stdout: '', stderr: 'PNPM_BROKEN', timedOut: false }
      : { code: 0, stdout: '10.23.0\n', stderr: '', timedOut: false }
    await expect(preparePnpmDependencies(path, broken)).rejects.toMatchObject({ code: 'DEPENDENCY_FAILED' })
  })
})

function runProcess(): ProcessRunner {
  return (file, args, options) => new Promise(resolvePromise => {
    (async () => {
      const { execFile } = await import('node:child_process')
      execFile(file, [...args], { cwd: options.cwd, encoding: 'utf8', timeout: options.timeoutMs ?? 30_000 }, (error, stdout, stderr) => {
        const candidate = error as NodeJS.ErrnoException
        resolvePromise({ code: typeof candidate?.code === 'number' ? candidate.code : error === null ? 0 : 1, stdout: stdout ?? '', stderr: stderr ?? (error?.message ?? ''), timedOut: candidate?.killed === true || candidate?.code === 'ETIMEDOUT' })
      })
    })()
  })
}
