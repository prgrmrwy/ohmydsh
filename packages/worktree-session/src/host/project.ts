import { join } from 'node:path'
import type { PackageManager } from '../wire.js'
import { WsError } from './errors.js'
import { pathExists } from './fs.js'

export const NPM_LOCKFILE = 'package-lock.json'
export const PNPM_LOCKFILE = 'pnpm-lock.yaml'

/**
 * Resolve the dependency project type from the repository root lockfiles.
 * Resolution happens before any Worktree resource is created so unsupported
 * projects fail closed with an explicit diagnostic and leave no half-made
 * branch, worktree, or operation file behind.
 */
export async function detectPackageManager(repoPath: string): Promise<PackageManager> {
  const npm = await pathExists(join(repoPath, NPM_LOCKFILE))
  const pnpm = await pathExists(join(repoPath, PNPM_LOCKFILE))
  if (npm && pnpm) {
    throw new WsError(
      'UNSUPPORTED_PROJECT',
      `Worktree Session 不支持混合 lockfile：仓库同时存在 ${NPM_LOCKFILE} 与 ${PNPM_LOCKFILE}，请删除冗余的一个后再试`,
    )
  }
  if (npm) return 'npm'
  if (pnpm) return 'pnpm'
  throw new WsError(
    'UNSUPPORTED_PROJECT',
    `项目根目录缺少 ${NPM_LOCKFILE} 或 ${PNPM_LOCKFILE}：Worktree Session 目前仅支持 npm / pnpm 项目（未支持的包管理器如 yarn、bun、rush 暂不支持）`,
  )
}
