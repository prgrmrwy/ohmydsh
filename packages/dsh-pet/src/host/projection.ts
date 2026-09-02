/**
 * Managed Skill projection into the Pet Workspace.
 *
 * Pet does not copy enabled revisions into the Workspace: it publishes
 * Pet-created directory symlinks
 *
 *   <workspace>/.dsh/skills/<name> -> <store>/<name>/<digest>/
 *
 * DSH's filesystem Skill provider follows direct child symlinks and treats
 * the resolved directory as a bundle, so one canonical revision serves every
 * runtime without duplicate copies.
 *
 * The projection is NOT the authorization boundary — the Pet allowlist is.
 * Projection exists so DSH discovery can see exactly the enabled revisions,
 * and any entry that is broken, not a symlink, or resolves outside the
 * immutable store is drift that fails closed until an explicit rebuild.
 */

import { lstat, mkdir, readdir, readlink, realpath, rename, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import { PetError } from './errors.js'
import { isContainedBy, OWNER_ONLY_DIR_MODE, type PetPaths } from './paths.js'
import { verifyRevision } from './skill-bundle.js'
import type { PetProjectionEntry, PetProjectionStatus } from '../wire.js'

/** One desired projection entry: a skill name bound to an exact revision. */
export interface DesiredProjection {
  readonly skillName: string
  readonly digest: string
}

/**
 * Inspect one projection entry without changing it.
 * @param paths - Resolved Pet paths.
 * @param skillName - Skill name to inspect.
 * @param expectedDigest - Digest the allowlist says should be published.
 * @returns the entry's observed status.
 */
export async function inspectProjectionEntry(
  paths: PetPaths,
  skillName: string,
  expectedDigest: string,
): Promise<PetProjectionEntry> {
  const entryPath = path.join(paths.projectionRoot, skillName)
  const base = { skillName, expectedDigest } as const

  const link = await lstat(entryPath).catch(() => undefined)
  if (link === undefined) {
    return { ...base, status: 'missing', diagnostic: 'No projection entry exists' }
  }
  // A plain directory or file here means something replaced Pet's managed
  // link; Pet must not treat foreign content as an enabled Skill.
  if (!link.isSymbolicLink()) {
    return {
      ...base,
      status: 'not-a-symlink',
      diagnostic: 'Projection entry is not a Pet-managed symbolic link',
    }
  }

  const resolved = await realpath(entryPath).catch(() => undefined)
  if (resolved === undefined) {
    const rawTarget = await readlink(entryPath).catch(() => undefined)
    return {
      ...base,
      status: 'missing',
      ...(rawTarget !== undefined ? { resolvedTarget: rawTarget } : {}),
      diagnostic: 'Projection symlink is broken',
    }
  }
  // Canonicalize both sides before comparing: `realpath` resolves
  // intermediate symlinks, so comparing against an uncanonicalized store path
  // would misreport valid entries as drift.
  const canonicalStore = await realpath(paths.storeRoot).catch(() => paths.storeRoot)
  if (!isContainedBy(canonicalStore, resolved)) {
    return {
      ...base,
      status: 'out-of-store',
      resolvedTarget: resolved,
      diagnostic: 'Projection target resolves outside the Pet immutable store',
    }
  }

  const expected = await realpath(path.join(paths.storeRoot, skillName, expectedDigest)).catch(
    () => undefined,
  )
  if (expected === undefined || resolved !== expected) {
    return {
      ...base,
      status: 'drifted',
      resolvedTarget: resolved,
      diagnostic: 'Projection target does not match the enabled revision',
    }
  }
  if (!(await verifyRevision(paths.storeRoot, skillName, expectedDigest))) {
    return {
      ...base,
      status: 'drifted',
      resolvedTarget: resolved,
      diagnostic: 'Store revision no longer matches its digest',
    }
  }
  return { ...base, status: 'ok', resolvedTarget: resolved }
}

/**
 * Publish one projection entry atomically.
 *
 * Creates a same-directory temporary symlink, proves the resolved target
 * stays inside the immutable store with the expected digest, and only then
 * renames it over the previous entry. Verifying the temporary link BEFORE the
 * rename is what prevents a bad target from ever being observable.
 * @param paths - Resolved Pet paths.
 * @param desired - The skill/digest pair to publish.
 * @throws PetError when the revision is missing or verification fails.
 */
export async function publishProjectionEntry(
  paths: PetPaths,
  desired: DesiredProjection,
): Promise<void> {
  const target = path.join(paths.storeRoot, desired.skillName, desired.digest)
  if (!isContainedBy(paths.storeRoot, target)) {
    throw new PetError('PROJECTION_DRIFT', 'Projection target escapes the Pet immutable store')
  }
  if (!(await verifyRevision(paths.storeRoot, desired.skillName, desired.digest))) {
    throw new PetError(
      'SKILL_DIGEST_MISMATCH',
      `Store revision ${desired.skillName}@${desired.digest} is missing or does not match its digest`,
    )
  }

  await mkdir(paths.projectionRoot, { recursive: true, mode: OWNER_ONLY_DIR_MODE })
  const entryPath = path.join(paths.projectionRoot, desired.skillName)
  // Same directory, so the final rename is atomic on one filesystem.
  const temporary = path.join(
    paths.projectionRoot,
    `.${desired.skillName}.staging-${process.pid}-${Date.now()}`,
  )

  await rm(temporary, { recursive: true, force: true })
  try {
    await symlink(target, temporary, 'dir')
    // Compare canonical forms on both sides: `realpath` resolves intermediate
    // symlinks (on macOS `/var` -> `/private/var`), so an uncanonicalized
    // expectation would reject a perfectly valid link.
    const resolved = await realpath(temporary)
    const canonicalTarget = await realpath(target)
    const canonicalStore = await realpath(paths.storeRoot)
    if (!isContainedBy(canonicalStore, resolved) || resolved !== canonicalTarget) {
      throw new PetError('PROJECTION_DRIFT', 'Staged projection link did not resolve to its revision')
    }
    await rename(temporary, entryPath)
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
}

/**
 * Remove one projection entry, refusing to delete foreign content.
 * @param paths - Resolved Pet paths.
 * @param skillName - Skill name to unpublish.
 */
export async function removeProjectionEntry(paths: PetPaths, skillName: string): Promise<void> {
  const entryPath = path.join(paths.projectionRoot, skillName)
  const info = await lstat(entryPath).catch(() => undefined)
  if (info === undefined) return
  if (!info.isSymbolicLink()) {
    throw new PetError(
      'PROJECTION_DRIFT',
      `Refusing to remove ${skillName}: the projection entry is not a Pet-managed symbolic link`,
    )
  }
  await rm(entryPath, { force: true })
}

/**
 * Reconcile the whole projection directory against the desired set.
 *
 * Publishes every desired entry and unpublishes Pet-managed links that are no
 * longer enabled. Foreign entries are reported as drift rather than deleted.
 * @param paths - Resolved Pet paths.
 * @param desired - Complete desired projection.
 * @returns the resulting status of every desired entry.
 */
export async function rebuildProjection(
  paths: PetPaths,
  desired: readonly DesiredProjection[],
): Promise<readonly PetProjectionEntry[]> {
  await mkdir(paths.projectionRoot, { recursive: true, mode: OWNER_ONLY_DIR_MODE })
  const desiredNames = new Set(desired.map(entry => entry.skillName))

  const existing = await readdir(paths.projectionRoot).catch(() => [] as string[])
  for (const name of existing) {
    if (desiredNames.has(name)) continue
    if (name.startsWith('.')) {
      // Abandoned staging link from an interrupted publish.
      await rm(path.join(paths.projectionRoot, name), { recursive: true, force: true })
      continue
    }
    const info = await lstat(path.join(paths.projectionRoot, name)).catch(() => undefined)
    if (info?.isSymbolicLink() === true) {
      await rm(path.join(paths.projectionRoot, name), { force: true })
    }
  }

  const results: PetProjectionEntry[] = []
  for (const entry of desired) {
    try {
      // An explicit rebuild is the sanctioned recovery path for drift, so a
      // conflicting entry inside Pet's own projection directory is cleared
      // first. `rename` cannot replace a directory, so a hand-substituted
      // folder would otherwise make repair impossible. Scope is deliberately
      // narrow: only this Pet-owned directory, only the named entry.
      const entryPath = path.join(paths.projectionRoot, entry.skillName)
      const existingEntry = await lstat(entryPath).catch(() => undefined)
      if (existingEntry !== undefined && !existingEntry.isSymbolicLink()) {
        await rm(entryPath, { recursive: true, force: true })
      }
      await publishProjectionEntry(paths, entry)
      results.push(await inspectProjectionEntry(paths, entry.skillName, entry.digest))
    } catch (error) {
      results.push({
        skillName: entry.skillName,
        expectedDigest: entry.digest,
        status: 'drifted' satisfies PetProjectionStatus,
        diagnostic: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return results
}

/**
 * Detect drift across the desired projection without repairing it.
 * @param paths - Resolved Pet paths.
 * @param desired - Complete desired projection.
 * @returns only the entries that are not `ok`.
 */
export async function detectProjectionDrift(
  paths: PetPaths,
  desired: readonly DesiredProjection[],
): Promise<readonly PetProjectionEntry[]> {
  const entries: PetProjectionEntry[] = []
  for (const entry of desired) {
    const observed = await inspectProjectionEntry(paths, entry.skillName, entry.digest)
    if (observed.status !== 'ok') entries.push(observed)
  }
  return entries
}
