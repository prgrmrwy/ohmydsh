import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PackageManager } from '../wire.js'
import { WsError } from './errors.js'
import { createGitClient, isTracked, type GitClient } from './git.js'
import { pathExists } from './fs.js'

export const NPM_LOCKFILE = 'package-lock.json'
export const PNPM_LOCKFILE = 'pnpm-lock.yaml'

type AdoptionSignal = 'packageManager-field' | 'git-tracking'

export interface MixedLockfileAdoption {
  packageManager: PackageManager
  signal: AdoptionSignal
  ignoredLockfile: string
}

export interface ProjectResolution {
  packageManager: PackageManager
  adoption?: MixedLockfileAdoption
}

/** Read a supported packageManager declaration without making it authoritative
 * for single-lockfile projects or turning malformed metadata into a new error. */
async function declaredPackageManager(repoPath: string): Promise<PackageManager | undefined> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(join(repoPath, 'package.json'), 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    return undefined
  }
  if (typeof raw !== 'object' || raw === null || !('packageManager' in raw)) return undefined
  const value = (raw as { packageManager?: unknown }).packageManager
  if (typeof value !== 'string') return undefined
  const name = value.split('@', 1)[0]
  return name === 'npm' || name === 'pnpm' ? name : undefined
}

function mixedLockfileError(): WsError {
  return new WsError(
    'UNSUPPORTED_PROJECT',
    `Worktree Session 无法判定混合 lockfile 的仓库意图：同时存在 ${NPM_LOCKFILE} 与 ${PNPM_LOCKFILE}，但没有唯一的 packageManager 声明或 Git 跟踪信号；请删除冗余 lockfile、只跟踪其中一个，或在 package.json 声明 packageManager`,
  )
}

/**
 * Resolve the dependency project type from the repository root lockfiles.
 * Resolution happens before any Worktree resource is created so unsupported
 * projects fail closed with an explicit diagnostic and leave no half-made
 * branch, worktree, or operation file behind.
 */
export async function detectPackageManager(repoPath: string, git: GitClient = createGitClient()): Promise<ProjectResolution> {
  const npm = await pathExists(join(repoPath, NPM_LOCKFILE))
  const pnpm = await pathExists(join(repoPath, PNPM_LOCKFILE))
  if (npm && pnpm) {
    const declared = await declaredPackageManager(repoPath)
    if (declared !== undefined) {
      return {
        packageManager: declared,
        adoption: {
          packageManager: declared,
          signal: 'packageManager-field',
          ignoredLockfile: declared === 'npm' ? PNPM_LOCKFILE : NPM_LOCKFILE,
        },
      }
    }

    const [npmTracked, pnpmTracked] = await Promise.all([
      isTracked(repoPath, NPM_LOCKFILE, git),
      isTracked(repoPath, PNPM_LOCKFILE, git),
    ])
    if (npmTracked !== undefined && pnpmTracked !== undefined && npmTracked !== pnpmTracked) {
      const packageManager = npmTracked ? 'npm' : 'pnpm'
      return {
        packageManager,
        adoption: {
          packageManager,
          signal: 'git-tracking',
          ignoredLockfile: packageManager === 'npm' ? PNPM_LOCKFILE : NPM_LOCKFILE,
        },
      }
    }
    throw mixedLockfileError()
  }
  if (npm) return { packageManager: 'npm' }
  if (pnpm) return { packageManager: 'pnpm' }
  throw new WsError(
    'UNSUPPORTED_PROJECT',
    `项目根目录缺少 ${NPM_LOCKFILE} 或 ${PNPM_LOCKFILE}：Worktree Session 目前仅支持 npm / pnpm 项目（未支持的包管理器如 yarn、bun、rush 暂不支持）`,
  )
}
