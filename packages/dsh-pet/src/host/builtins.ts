/**
 * Built-in Skill import from the package-owned manifest.
 *
 * Pet ships trusted bundles inside the package but NEVER executes from
 * `node_modules`: declared bundles are validated and copied into immutable
 * content-addressed revisions in the Pet state store, exactly like a local
 * import. Only bundles named in the manifest are considered — the directory
 * is never scanned — so an undeclared directory shipped by accident cannot
 * become an installed capability.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { PetError } from './errors.js'
import type { PetPaths } from './paths.js'
import { PetRepository } from './repository.js'
import { inspectBundle, installBundle } from './skill-bundle.js'
import type { PetSkillRevision } from '../wire.js'

const builtinSkillEntry = z.object({
  /** Directory relative to the manifest file. */
  directory: z.string().min(1),
  /** Installed and enabled automatically on first Host initialization. */
  defaultEnabled: z.boolean().default(false),
  /** Whether the capability appears in the radial shortcut menu. */
  showAsShortcut: z.boolean().default(true),
})

const builtinManifest = z.object({
  version: z.literal(1),
  skills: z.array(builtinSkillEntry),
})

/** One declared built-in bundle. */
export type BuiltinSkillEntry = z.infer<typeof builtinSkillEntry>

/** Result of inventorying the package manifest. */
export interface BuiltinInventoryItem {
  readonly skillName: string
  readonly description: string
  readonly digest: string
  readonly defaultEnabled: boolean
  readonly showAsShortcut: boolean
  readonly sourceDirectory: string
}

/**
 * Resolve the packaged manifest path.
 *
 * Derived from this module's own URL so it works from `lib/` after build and
 * from `src/` during tests.
 * @param override - Explicit manifest path, used by tests.
 * @returns the absolute manifest path.
 */
export function resolveManifestPath(override?: string): string {
  if (override !== undefined) return override
  const here = path.dirname(fileURLToPath(import.meta.url))
  // `lib/host/builtins.js` and `src/host/builtins.ts` are both two levels
  // below the package root that owns `skills/`.
  return path.join(here, '..', '..', 'skills', 'manifest.json')
}

/**
 * Read and validate the package-owned built-in manifest.
 * @param manifestPath - Absolute manifest path.
 * @returns the declared entries, or an empty list when the manifest is absent.
 * @throws PetError when the manifest exists but is malformed.
 */
export async function readBuiltinManifest(
  manifestPath: string,
): Promise<readonly BuiltinSkillEntry[]> {
  const raw = await readFile(manifestPath, 'utf8').catch(() => undefined)
  if (raw === undefined) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new PetError(
      'INTERNAL',
      `Pet built-in manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const result = builtinManifest.safeParse(parsed)
  if (!result.success) {
    throw new PetError('INTERNAL', `Pet built-in manifest is malformed: ${result.error.message}`)
  }
  return result.data.skills
}

/**
 * Inventory every declared built-in without installing it.
 *
 * Used to show upgradable revisions in Settings: a newer packaged digest is
 * reported as available but never silently replaces the selected one.
 * @param manifestPath - Absolute manifest path.
 * @returns the inventory of declared bundles.
 */
export async function inventoryBuiltins(
  manifestPath: string,
): Promise<readonly BuiltinInventoryItem[]> {
  const entries = await readBuiltinManifest(manifestPath)
  const manifestDir = path.dirname(manifestPath)
  const items: BuiltinInventoryItem[] = []
  for (const entry of entries) {
    const directory = path.resolve(manifestDir, entry.directory)
    const inspection = await inspectBundle(directory)
    items.push({
      skillName: inspection.skillName,
      description: inspection.description,
      digest: inspection.digest,
      defaultEnabled: entry.defaultEnabled,
      showAsShortcut: entry.showAsShortcut,
      sourceDirectory: directory,
    })
  }
  return items
}

/** Outcome of the first-boot built-in installation. */
export interface BuiltinInstallResult {
  readonly installed: readonly PetSkillRevision[]
  /** Newer built-in digests available for an explicit, user-applied upgrade. */
  readonly upgradesAvailable: readonly BuiltinInventoryItem[]
}

/**
 * Install declared built-ins into the immutable store and record revisions.
 *
 * First boot enables exactly the `defaultEnabled` declarations. On later
 * boots an already-installed digest is a no-op, and a NEW digest for an
 * already-selected skill is recorded as an available upgrade rather than
 * applied — a package upgrade must never silently change what a Task runs.
 * @param repository - Pet repository.
 * @param paths - Resolved Pet paths.
 * @param packageVersion - Version recorded as provenance.
 * @param manifestPath - Absolute manifest path.
 * @returns what was installed and what can be upgraded.
 */
export async function installBuiltins(
  repository: PetRepository,
  paths: PetPaths,
  packageVersion: string,
  manifestPath: string,
): Promise<BuiltinInstallResult> {
  const inventory = await inventoryBuiltins(manifestPath)
  const firstBoot = !repository.global.builtinsInitialized
  const installed: PetSkillRevision[] = []
  const upgradesAvailable: BuiltinInventoryItem[] = []

  for (const item of inventory) {
    const existing = repository.getSkillRevision(item.skillName, item.digest)
    if (existing === undefined) {
      const inspection = await inspectBundle(item.sourceDirectory)
      await installBundle(inspection, paths.storeRoot, paths.stagingRoot)
      const revision: PetSkillRevision = {
        skillName: inspection.skillName,
        digest: inspection.digest,
        description: inspection.description,
        provenance: { kind: 'builtin', packageVersion, installedAt: Date.now() },
        fileCount: inspection.fileCount,
        totalBytes: inspection.totalBytes,
      }
      await repository.putSkillRevision(revision)
      installed.push(revision)
    }

    const selection = repository.getSkillSelection(item.skillName)
    if (selection === undefined) {
      // Never selected before. Only first boot auto-enables, and only what the
      // manifest marks `defaultEnabled`.
      if (firstBoot && item.defaultEnabled) {
        await repository.putSkillSelection({
          skillName: item.skillName,
          enabledDigest: item.digest,
          showAsShortcut: item.showAsShortcut,
        })
      }
      continue
    }
    if (selection.enabledDigest !== undefined && selection.enabledDigest !== item.digest) {
      upgradesAvailable.push(item)
      await repository.putSkillSelection({ ...selection, upgradeAvailableDigest: item.digest })
    }
  }

  if (firstBoot) {
    await repository.updateGlobal(current => ({ ...current, builtinsInitialized: true }))
  }
  return { installed, upgradesAvailable }
}
