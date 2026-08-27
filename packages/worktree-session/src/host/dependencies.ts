import { createHash } from 'node:crypto'
import { chmod, cp, lstat, mkdir, readFile, readdir, readlink, rename, rm, stat, symlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { OperationRecord, PackageManager } from '../wire.js'
import { WsError } from './errors.js'
import { atomicJson, pathExists, readJson, withMkdirLock } from './fs.js'
import { checkedProcess, runProcess, type ProcessRunner } from './process.js'

/** Basic facts of a resolved lockfile/CLI dependency snapshot. */
export interface DependencyFacts {
  fingerprint: string
  nodeMajor: number
  cliMajor: number
  packageManager: PackageManager
}

interface ReadyMetadata {
  schemaVersion: 2
  fingerprint: string
  nodeMajor: number
  cliMajor: number
  packageManager: PackageManager
  contentDigest: string
  createdAt: string
}

async function dependencyTreeDigest(nodeModules: string): Promise<string> {
  const hash = createHash('sha256')
  const visit = async (path: string, relativePath: string): Promise<void> => {
    const entries = await readdir(path, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const child = join(path, entry.name)
      const rel = relativePath === '' ? entry.name : `${relativePath}/${entry.name}`
      const info = await lstat(child)
      hash.update(rel).update('\0').update(String(info.mode & 0o777)).update('\0').update(String(info.size)).update('\0').update(String(Math.trunc(info.mtimeMs))).update('\0')
      if (entry.isSymbolicLink()) hash.update(await readlink(child)).update('\0')
      else if (entry.isDirectory()) await visit(child, rel)
    }
  }
  await visit(nodeModules, '')
  return hash.digest('hex')
}

async function makeReadOnlyTree(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) await makeReadOnlyTree(child)
    if (!entry.isSymbolicLink()) {
      const info = await stat(child)
      await chmod(child, info.mode & ~0o222)
    }
  }
  const info = await stat(path)
  await chmod(path, info.mode & ~0o222)
}

function lockfileName(packageManager: PackageManager): string {
  return packageManager === 'pnpm' ? 'pnpm-lock.yaml' : 'package-lock.json'
}

/** Resolve the major version of the configured package-manager CLI. */
export async function cliMajor(cli: 'npm' | 'pnpm', runner: ProcessRunner = runProcess, cwd = process.cwd()): Promise<number> {
  const output = await checkedProcess(runner, cli, ['--version'], { cwd, code: 'DEPENDENCY_FAILED' })
  const value = Number.parseInt(output.trim().split('.')[0] ?? '', 10)
  if (!Number.isSafeInteger(value)) throw new WsError('DEPENDENCY_FAILED', `Unable to determine ${cli} major version`)
  return value
}

export async function dependencyFingerprint(repoPath: string, runner: ProcessRunner = runProcess, packageManager: PackageManager = 'npm'): Promise<DependencyFacts> {
  const lock = await readFile(join(repoPath, lockfileName(packageManager)))
  const node = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10)
  const cli = packageManager === 'pnpm' ? 'pnpm' : 'npm'
  const major = await cliMajor(cli, runner, repoPath)
  const fingerprint = createHash('sha256').update(lock).update(`\0node:${String(node)}\0${cli}:${String(major)}`).digest('hex')
  return { fingerprint, nodeMajor: node, cliMajor: major, packageManager }
}

export async function cacheHealthy(cacheRoot: string, expected: DependencyFacts, runner: ProcessRunner = runProcess): Promise<boolean> {
  const ready = await readJson<ReadyMetadata>(join(cacheRoot, 'ready.json'))
  if (ready?.schemaVersion !== 2 || ready.fingerprint !== expected.fingerprint || ready.nodeMajor !== expected.nodeMajor || ready.cliMajor !== expected.cliMajor || ready.packageManager !== expected.packageManager || typeof ready.contentDigest !== 'string') return false
  const nodeModules = join(cacheRoot, 'node_modules')
  if (!(await pathExists(nodeModules))) return false
  if (await dependencyTreeDigest(nodeModules) !== ready.contentDigest) return false
  const result = await runner('npm', ['ls', '--all', '--ignore-scripts', '--json'], { cwd: cacheRoot, timeoutMs: 120_000 })
  return result.code === 0
}

export async function prepareDependencyCache(worktreePath: string, gitCommonDir: string, runner: ProcessRunner = runProcess): Promise<{ fingerprint: string; nodeModules: string }> {
  const fingerprint = await dependencyFingerprint(worktreePath, runner, 'npm')
  const npmRoot = join(gitCommonDir, 'ws', 'cache', 'npm')
  const target = join(npmRoot, fingerprint.fingerprint)
  const lock = join(gitCommonDir, 'ws', 'locks', `npm-${fingerprint.fingerprint}.lock`)
  await withMkdirLock(lock, async () => {
    if (await cacheHealthy(target, fingerprint, runner)) return
    const temporary = join(npmRoot, `.${fingerprint.fingerprint}.tmp-${process.pid}-${Date.now()}`)
    await rm(temporary, { recursive: true, force: true })
    await mkdir(temporary, { recursive: true })
    try {
      await cp(join(worktreePath, 'package.json'), join(temporary, 'package.json'))
      await cp(join(worktreePath, 'package-lock.json'), join(temporary, 'package-lock.json'))
      await checkedProcess(runner, 'npm', ['ci', '--ignore-scripts'], { cwd: temporary, timeoutMs: 15 * 60_000, code: 'DEPENDENCY_FAILED' })
      await checkedProcess(runner, 'npm', ['ls', '--all', '--ignore-scripts', '--json'], { cwd: temporary, timeoutMs: 120_000, code: 'DEPENDENCY_FAILED' })
      await mkdir(join(temporary, 'node_modules'), { recursive: true })
      await makeReadOnlyTree(join(temporary, 'node_modules'))
      const contentDigest = await dependencyTreeDigest(join(temporary, 'node_modules'))
      await atomicJson(join(temporary, 'ready.json'), { schemaVersion: 2, ...fingerprint, contentDigest, createdAt: new Date().toISOString() } satisfies ReadyMetadata)
      await rm(target, { recursive: true, force: true })
      await rename(temporary, target)
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }, { timeoutMs: 15 * 60_000, staleMs: 30 * 60_000 })
  return { fingerprint: fingerprint.fingerprint, nodeModules: join(target, 'node_modules') }
}

/** pnpm dependency preparation: install directly in the bound worktree.
 * pnpm's global content-addressable store provides the cross-worktree reuse
 * that the npm shared cache directory provides for npm projects; a snapshot
 * cache would break workspace-internal links that must resolve to the
 * worktree's own sources (see design D2). */
export async function preparePnpmDependencies(worktreePath: string, runner: ProcessRunner = runProcess): Promise<{ fingerprint: string }> {
  const fingerprint = await dependencyFingerprint(worktreePath, runner, 'pnpm')
  await checkedProcess(runner, 'pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], { cwd: worktreePath, timeoutMs: 15 * 60_000, code: 'DEPENDENCY_FAILED' })
  await checkedProcess(runner, 'pnpm', ['list', '--json'], { cwd: worktreePath, timeoutMs: 120_000, code: 'DEPENDENCY_FAILED' })
  return { fingerprint: fingerprint.fingerprint }
}

/** pnpm promote: reinstall with scripts per the lockfile (mirrors `npm ci`). */
export async function promotePnpmDependencies(worktreePath: string, runner: ProcessRunner = runProcess): Promise<void> {
  await checkedProcess(runner, 'pnpm', ['install', '--frozen-lockfile'], { cwd: worktreePath, timeoutMs: 15 * 60_000, code: 'DEPENDENCY_FAILED' })
  await checkedProcess(runner, 'pnpm', ['list', '--json'], { cwd: worktreePath, timeoutMs: 120_000, code: 'DEPENDENCY_FAILED' })
}

export async function leanLinkMatches(worktreePath: string, expectedNodeModules: string): Promise<boolean> {
  const destination = join(worktreePath, 'node_modules')
  try {
    const info = await lstat(destination)
    return info.isSymbolicLink() && resolve(dirname(destination), await readlink(destination)) === resolve(expectedNodeModules)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function ensureLeanLink(worktreePath: string, expectedNodeModules: string): Promise<void> {
  const destination = join(worktreePath, 'node_modules')
  try {
    const info = await lstat(destination)
    if (!info.isSymbolicLink()) throw new WsError('DEPENDENCY_FAILED', `Refusing to overwrite unexpected node_modules at ${destination}`)
    const current = resolve(dirname(destination), await readlink(destination))
    if (current !== resolve(expectedNodeModules)) throw new WsError('DEPENDENCY_FAILED', `Refusing to replace node_modules link targeting ${current}`)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await symlink(expectedNodeModules, destination, process.platform === 'win32' ? 'junction' : 'dir')
}

export async function promoteDependencies(operation: OperationRecord, runner: ProcessRunner = runProcess): Promise<void> {
  if (operation.dependencyMode === 'mutable') return
  if (operation.cacheNodeModules === undefined) throw new WsError('PROMOTE_REFUSED', 'Operation has no recorded lean dependency target')
  const destination = join(operation.worktreePath, 'node_modules')
  let target: string
  try {
    const info = await lstat(destination)
    if (!info.isSymbolicLink()) throw new WsError('PROMOTE_REFUSED', 'node_modules is not the expected lean link')
    target = resolve(dirname(destination), await readlink(destination))
  } catch (error) {
    if (error instanceof WsError) throw error
    throw new WsError('PROMOTE_REFUSED', 'Expected lean node_modules link is missing')
  }
  if (target !== resolve(operation.cacheNodeModules)) throw new WsError('PROMOTE_REFUSED', `Lean link points to unexpected target ${target}`)
  await rm(destination)
  try {
    await checkedProcess(runner, 'npm', ['ci'], { cwd: operation.worktreePath, timeoutMs: 15 * 60_000, code: 'DEPENDENCY_FAILED' })
    await checkedProcess(runner, 'npm', ['ls', '--all', '--json'], { cwd: operation.worktreePath, timeoutMs: 120_000, code: 'DEPENDENCY_FAILED' })
  } catch (error) {
    await rm(destination, { recursive: true, force: true })
    await ensureLeanLink(operation.worktreePath, operation.cacheNodeModules)
    throw error
  }
}
