/**
 * Pet runtime path resolution.
 *
 * Every runtime path derives from the ACTIVE DSH home, never from the package
 * checkout, the generated profile or a Cockpit home. This keeps plugin
 * upgrades and profile rebuilds from touching Pet task data.
 */

import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { PET_PLUGIN_ID } from '../wire.js'

/** Owner-only mode for every Pet-created directory. */
export const OWNER_ONLY_DIR_MODE = 0o700

/** Absolute Pet runtime paths resolved from one DSH home. */
export interface PetPaths {
  /** The resolved DSH home this Pet instance belongs to. */
  readonly dshHome: string
  /** `$DSH_HOME/plugins/dsh-pet` — the Pet state root. */
  readonly stateRoot: string
  /** `<stateRoot>/state.sqlite` — the Pet-owned durable database. */
  readonly databaseFile: string
  /** `<stateRoot>/workspace` — the registered `DSH Pet` Workspace path. */
  readonly workspaceRoot: string
  /** `<workspaceRoot>/.dsh/skills` — the managed symlink projection directory. */
  readonly projectionRoot: string
  /** `<stateRoot>/skills/store` — immutable content-addressed Skill revisions. */
  readonly storeRoot: string
  /** `<stateRoot>/skills/staging` — scratch space for verified atomic installs. */
  readonly stagingRoot: string
}

/**
 * Resolve every Pet runtime path from the active DSH home.
 * @param configuredHome - Explicit home override, highest precedence.
 * @param env - Environment mapping used to read `DSH_HOME`.
 * @returns the absolute Pet path set.
 */
export function resolvePetPaths(
  configuredHome?: string,
  env: Record<string, string | undefined> = process.env,
): PetPaths {
  const dshHome = resolveDshHome(configuredHome, env)
  const stateRoot = path.join(dshHome, 'plugins', PET_PLUGIN_ID)
  const workspaceRoot = path.join(stateRoot, 'workspace')
  return {
    dshHome,
    stateRoot,
    databaseFile: path.join(stateRoot, 'state.sqlite'),
    workspaceRoot,
    projectionRoot: path.join(workspaceRoot, '.dsh', 'skills'),
    storeRoot: path.join(stateRoot, 'skills', 'store'),
    stagingRoot: path.join(stateRoot, 'skills', 'staging'),
  }
}

/**
 * Create the owner-only Pet directory tree. Idempotent: an existing tree is
 * accepted, while a non-directory occupying any required path fails loud so a
 * corrupted state root can never be silently treated as usable.
 * @param paths - Resolved Pet paths.
 * @returns resolution once every required directory exists.
 * @throws when a required path exists as a non-directory.
 */
export async function ensurePetDirectories(paths: PetPaths): Promise<void> {
  const required = [
    paths.stateRoot,
    paths.workspaceRoot,
    paths.projectionRoot,
    paths.storeRoot,
    paths.stagingRoot,
  ]
  for (const dir of required) {
    const existing = await stat(dir).catch(() => undefined)
    if (existing !== undefined && !existing.isDirectory()) {
      throw new Error(`Pet path ${dir} exists but is not a directory`)
    }
    await mkdir(dir, { recursive: true, mode: OWNER_ONLY_DIR_MODE })
  }
}

/**
 * Prove a candidate path stays inside a canonical root.
 *
 * Used to keep imported bundles, projection targets and diagnostics from
 * escaping the Pet-managed immutable store.
 * @param root - Canonical containing root.
 * @param candidate - Absolute candidate path.
 * @returns whether `candidate` is `root` itself or a descendant of it.
 */
export function isContainedBy(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root)
  const normalizedCandidate = path.resolve(candidate)
  if (normalizedCandidate === normalizedRoot) return true
  return normalizedCandidate.startsWith(normalizedRoot + path.sep)
}
