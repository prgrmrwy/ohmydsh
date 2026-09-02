/**
 * Pet-owned Workspace preparation and executor relationship titles.
 *
 * Executor sessions are ORDINARY DSH root sessions grouped into one
 * Pet-owned Workspace. They are deliberately visible and openable: the user
 * needs native history, approval and question surfaces, so Pet does not
 * invent a hidden session protocol.
 *
 * The Workspace lives in the Pet state directory, never in the plugin install
 * directory, so a profile rebuild cannot destroy it.
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { OWNER_ONLY_DIR_MODE, type PetPaths } from './paths.js'
import { PET_WORKSPACE_TITLE, type PetSourceKind } from '../wire.js'

/** Package-owned standing instructions file, edited as ordinary Markdown. */
const STANDING_INSTRUCTIONS_FILE = 'AGENTS.md'

/**
 * Read the standing instructions the package ships.
 *
 * The text lives in the package's own `AGENTS.md` rather than inlined in
 * TypeScript, so it can be reviewed and edited as prose. It is COPIED into
 * the Workspace, never symlinked: the package directory is deleted and
 * recreated on every deploy, which would leave a dangling link and strip the
 * executor of its identity briefing. The spec also requires Pet state to stay
 * independent of the install directory.
 * @returns the instructions text.
 */
async function readStandingInstructions(): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url))
  // `lib/host/` at runtime, `src/host/` in tests: walk up to the package root.
  for (const candidate of ['..', '../..', '../../..']) {
    const file = path.resolve(here, candidate, STANDING_INSTRUCTIONS_FILE)
    const text = await readFile(file, 'utf8').catch(() => undefined)
    if (text !== undefined) return text
  }
  throw new Error(`dsh-pet: ${STANDING_INSTRUCTIONS_FILE} is missing from the package`)
}


/**
 * Prepare the Pet Workspace directory and its package-owned instructions.
 *
 * Idempotent: re-running refreshes the instruction file and leaves the
 * registered Workspace and any projected Skills untouched.
 * @param paths - Resolved Pet paths.
 * @returns the absolute Workspace path to register.
 */
export async function preparePetWorkspace(paths: PetPaths): Promise<string> {
  await mkdir(paths.workspaceRoot, { recursive: true, mode: OWNER_ONLY_DIR_MODE })
  await mkdir(paths.projectionRoot, { recursive: true, mode: OWNER_ONLY_DIR_MODE })
  // A cwd with no nearer `.git` falls back to this directory as the project
  // root, which is what lets DSH discover `.dsh/skills` here.
  // Copy, so the Workspace keeps working after the package is reinstalled.
  await writeFile(
    path.join(paths.workspaceRoot, STANDING_INSTRUCTIONS_FILE),
    await readStandingInstructions(),
    { mode: 0o600 },
  )
  return paths.workspaceRoot
}

/** Minimal registry surface Pet needs, so tests need no full DSH Host. */
export interface WorkspaceRegistryLike {
  create(path: string, title?: string): Promise<{ id: string }>
}

/**
 * Idempotently register the Pet Workspace.
 *
 * `create` is canonical-path keyed and returns the existing entity without
 * changing its title, so repeated Host starts converge on one Workspace.
 * @param registry - The DSH workspace registry.
 * @param paths - Resolved Pet paths.
 * @returns the registered workspace id.
 */
export async function ensurePetWorkspace(
  registry: WorkspaceRegistryLike,
  paths: PetPaths,
): Promise<string> {
  const workspacePath = await preparePetWorkspace(paths)
  const workspace = await registry.create(workspacePath, PET_WORKSPACE_TITLE)
  return workspace.id
}

/** Maximum characters in a generated executor session title. */
export const MAX_TITLE_LENGTH = 80

/**
 * Generate the bounded executor relationship title.
 *
 * The title is a VISIBLE PROJECTION only. Pet never parses it back into
 * routing, so a user rename is always safe.
 * @param options - Source facts and Task identity.
 * @returns the generated title.
 */
export function executorTitle(options: {
  readonly sourceKind: PetSourceKind
  readonly sourceTitle?: string
  readonly shortId: string
  readonly epoch: number
}): string {
  const label =
    options.sourceKind === 'none'
      ? 'Independent'
      : (options.sourceTitle ?? '').trim() === ''
        ? 'Untitled'
        : (options.sourceTitle ?? '').trim()

  const suffix = ` [${options.shortId}] · #${options.epoch}`
  const prefix = '🐾 '
  const budget = MAX_TITLE_LENGTH - prefix.length - suffix.length
  const trimmed = label.length > budget ? `${label.slice(0, Math.max(1, budget - 1))}…` : label
  return `${prefix}${trimmed}${suffix}`
}

/**
 * Derive the short display identity used in titles and panels.
 * @param id - Full Task or source id.
 * @returns a stable short form.
 */
export function shortIdOf(id: string): string {
  const cleaned = id.replace(/^(task|session)-/, '')
  return cleaned.slice(0, 6)
}
