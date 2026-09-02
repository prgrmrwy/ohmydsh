/**
 * Skill bundle inspection, digesting and bounded copying.
 *
 * A Skill bundle is trusted executable instruction content, so every import
 * is validated BEFORE it becomes a store revision: canonical paths, no
 * symlinks, no special files, no path escapes, and hard file-count/size caps.
 * The digest is computed over a canonical manifest of the bundle's contents,
 * which makes a revision content-addressed and lets projection verify that
 * the directory it points at is still exactly what was installed.
 */

import { createHash } from 'node:crypto'
import { lstat, mkdtemp, readdir, readFile, realpath, rename, rm, mkdir, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import { PetError } from './errors.js'
import { isContainedBy, OWNER_ONLY_DIR_MODE } from './paths.js'

/** Hard bounds applied to every imported or built-in bundle. */
export const BUNDLE_LIMITS = {
  /** Maximum regular files in one bundle, including `SKILL.md`. */
  maxFiles: 200,
  /** Maximum bytes for any single file. */
  maxFileBytes: 2 * 1024 * 1024,
  /** Maximum total bytes across the bundle. */
  maxTotalBytes: 8 * 1024 * 1024,
  /** Maximum directory nesting below the bundle root. */
  maxDepth: 4,
} as const

/** The required entry file of every Skill bundle. */
export const SKILL_ENTRY_FILE = 'SKILL.md'

/** One regular file discovered inside a candidate bundle. */
export interface BundleFile {
  /** POSIX-style path relative to the bundle root. */
  readonly relativePath: string
  readonly bytes: number
}

/** Result of a read-only inspection, shown to the user before any install. */
export interface BundleInspection {
  readonly skillName: string
  readonly description: string
  readonly whenToUse?: string
  /** Digest the revision would receive; stable across inspect and import. */
  readonly digest: string
  readonly files: readonly BundleFile[]
  readonly fileCount: number
  readonly totalBytes: number
  /** Canonicalized source directory, retained as diagnostic provenance only. */
  readonly canonicalSourcePath: string
}

/** Minimal frontmatter parsed from `SKILL.md`. */
interface SkillFrontmatter {
  readonly name?: string
  readonly description?: string
  readonly whenToUse?: string
}

/**
 * Parse the leading YAML-ish frontmatter block of a `SKILL.md`.
 *
 * Deliberately minimal and non-executing: only `key: value` scalars at the
 * top level are read, so a bundle cannot smuggle behavior through parsing.
 * @param content - Full `SKILL.md` text.
 * @returns the parsed frontmatter fields.
 */
export function parseFrontmatter(content: string): SkillFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (match === null) return {}
  const block = match[1] ?? ''
  const fields: Record<string, string> = {}
  for (const line of block.split(/\r?\n/)) {
    const entry = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line)
    if (entry === null) continue
    const key = entry[1]
    let value = (entry[2] ?? '').trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1)
    }
    if (key !== undefined) fields[key] = value
  }
  const result: SkillFrontmatter = {}
  return {
    ...result,
    ...(fields['name'] !== undefined ? { name: fields['name'] } : {}),
    ...(fields['description'] !== undefined ? { description: fields['description'] } : {}),
    ...(fields['whenToUse'] !== undefined ? { whenToUse: fields['whenToUse'] } : {}),
  }
}

/**
 * Walk a candidate bundle, enforcing every structural bound.
 *
 * Uses `lstat` and never follows links: a symlink anywhere inside a
 * user-supplied bundle is rejected outright rather than resolved, because a
 * later edit to its target would silently change installed semantics.
 * @param root - Canonical bundle root.
 * @returns the discovered regular files, sorted by relative path.
 * @throws PetError when a bound or path rule is violated.
 */
export async function collectBundleFiles(root: string): Promise<readonly BundleFile[]> {
  const files: BundleFile[] = []
  let totalBytes = 0

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > BUNDLE_LIMITS.maxDepth) {
      throw new PetError(
        'SKILL_IMPORT_REJECTED',
        `Skill bundle nests deeper than ${BUNDLE_LIMITS.maxDepth} directories`,
      )
    }
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name)
      const info = await lstat(absolute)

      if (info.isSymbolicLink()) {
        throw new PetError(
          'SKILL_IMPORT_REJECTED',
          `Skill bundle contains a symbolic link (${path.relative(root, absolute)}); ` +
            'imported bundles must be self-contained copies',
        )
      }
      if (info.isDirectory()) {
        await walk(absolute, depth + 1)
        continue
      }
      if (!info.isFile()) {
        throw new PetError(
          'SKILL_IMPORT_REJECTED',
          `Skill bundle contains a non-regular file (${path.relative(root, absolute)})`,
        )
      }
      if (info.size > BUNDLE_LIMITS.maxFileBytes) {
        throw new PetError(
          'SKILL_IMPORT_REJECTED',
          `Skill bundle file ${path.relative(root, absolute)} exceeds ` +
            `${BUNDLE_LIMITS.maxFileBytes} bytes`,
        )
      }
      totalBytes += info.size
      if (totalBytes > BUNDLE_LIMITS.maxTotalBytes) {
        throw new PetError(
          'SKILL_IMPORT_REJECTED',
          `Skill bundle exceeds ${BUNDLE_LIMITS.maxTotalBytes} total bytes`,
        )
      }
      files.push({
        relativePath: path.relative(root, absolute).split(path.sep).join('/'),
        bytes: info.size,
      })
      if (files.length > BUNDLE_LIMITS.maxFiles) {
        throw new PetError(
          'SKILL_IMPORT_REJECTED',
          `Skill bundle contains more than ${BUNDLE_LIMITS.maxFiles} files`,
        )
      }
    }
  }

  await walk(root, 1)
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

/**
 * Compute the content-addressed digest of a bundle.
 *
 * The digest covers each file's relative path AND its bytes, so neither a
 * rename nor an edit can preserve a digest. Path ordering is canonical, which
 * makes the digest reproducible across machines and filesystems.
 * @param root - Bundle root.
 * @param files - Files previously collected from `root`.
 * @returns the `sha256:<hex>` digest.
 */
export async function digestBundle(
  root: string,
  files: readonly BundleFile[],
): Promise<string> {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file.relativePath)
    hash.update('\0')
    const bytes = await readFile(path.join(root, ...file.relativePath.split('/')))
    hash.update(bytes)
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

/**
 * Inspect a candidate bundle read-only.
 *
 * This is the first half of the two-step import: it performs no writes, so
 * the user can be shown the exact name, digest and file inventory before
 * separately confirming installation.
 * @param sourcePath - Absolute path on the Host running `dsh web`.
 * @returns the inspection result.
 * @throws PetError when the path or bundle contents are invalid.
 */
export async function inspectBundle(sourcePath: string): Promise<BundleInspection> {
  if (!path.isAbsolute(sourcePath)) {
    throw new PetError(
      'SKILL_IMPORT_REJECTED',
      'Skill import requires an absolute path on the Host running dsh web',
    )
  }
  const canonical = await realpath(sourcePath).catch(() => undefined)
  if (canonical === undefined) {
    throw new PetError('SKILL_IMPORT_REJECTED', `No such directory: ${sourcePath}`)
  }
  const rootInfo = await lstat(canonical)
  if (!rootInfo.isDirectory()) {
    throw new PetError('SKILL_IMPORT_REJECTED', `${sourcePath} is not a directory`)
  }

  const entryPath = path.join(canonical, SKILL_ENTRY_FILE)
  const entryInfo = await lstat(entryPath).catch(() => undefined)
  if (entryInfo === undefined || !entryInfo.isFile()) {
    throw new PetError(
      'SKILL_IMPORT_REJECTED',
      `Skill bundle is missing a regular ${SKILL_ENTRY_FILE}`,
    )
  }

  const files = await collectBundleFiles(canonical)
  if (!files.some(file => file.relativePath === SKILL_ENTRY_FILE)) {
    throw new PetError('SKILL_IMPORT_REJECTED', `Skill bundle is missing ${SKILL_ENTRY_FILE}`)
  }

  const content = await readFile(entryPath, 'utf8')
  const frontmatter = parseFrontmatter(content)
  const skillName = frontmatter.name ?? path.basename(canonical)
  if (!isSkillName(skillName)) {
    throw new PetError(
      'SKILL_IMPORT_REJECTED',
      `Skill name '${skillName}' is not a valid kebab-case skill name`,
    )
  }
  if (frontmatter.description === undefined || frontmatter.description === '') {
    throw new PetError(
      'SKILL_IMPORT_REJECTED',
      `${SKILL_ENTRY_FILE} frontmatter must declare a description`,
    )
  }

  const digest = await digestBundle(canonical, files)
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0)
  return {
    skillName,
    description: frontmatter.description,
    ...(frontmatter.whenToUse !== undefined ? { whenToUse: frontmatter.whenToUse } : {}),
    digest,
    files,
    fileCount: files.length,
    totalBytes,
    canonicalSourcePath: canonical,
  }
}

/**
 * Copy an inspected bundle into the immutable store atomically.
 *
 * Copies through a staging directory, re-digests the COPY, and only then
 * renames it into place. Re-digesting after the copy is what makes a
 * concurrent modification of the source during import fail instead of
 * producing a revision whose contents do not match its digest.
 * @param inspection - Result of a prior {@link inspectBundle}.
 * @param storeRoot - Canonical immutable store root.
 * @param stagingRoot - Staging directory root.
 * @returns the absolute revision directory.
 * @throws PetError when verification fails.
 */
export async function installBundle(
  inspection: BundleInspection,
  storeRoot: string,
  stagingRoot: string,
): Promise<string> {
  const target = path.join(storeRoot, inspection.skillName, inspection.digest)
  const existing = await lstat(target).catch(() => undefined)
  // Content-addressed: an identical digest is already installed and immutable.
  if (existing !== undefined && existing.isDirectory()) return target

  await mkdir(stagingRoot, { recursive: true, mode: OWNER_ONLY_DIR_MODE })
  const staging = await mkdtemp(path.join(stagingRoot, 'import-'))
  try {
    for (const file of inspection.files) {
      const segments = file.relativePath.split('/')
      const destination = path.join(staging, ...segments)
      await mkdir(path.dirname(destination), { recursive: true, mode: OWNER_ONLY_DIR_MODE })
      await copyFile(path.join(inspection.canonicalSourcePath, ...segments), destination)
    }

    const copiedFiles = await collectBundleFiles(staging)
    const copiedDigest = await digestBundle(staging, copiedFiles)
    if (copiedDigest !== inspection.digest) {
      throw new PetError(
        'SKILL_IMPORT_REJECTED',
        `Skill bundle changed during import (expected ${inspection.digest}, copied ${copiedDigest})`,
      )
    }
    if (!isContainedBy(storeRoot, target)) {
      throw new PetError('SKILL_IMPORT_REJECTED', 'Resolved store target escapes the Pet store')
    }

    await mkdir(path.dirname(target), { recursive: true, mode: OWNER_ONLY_DIR_MODE })
    await rename(staging, target)
    return target
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

/**
 * Re-verify an installed revision still matches its digest.
 *
 * Used by projection publication and startup drift detection: a revision that
 * no longer hashes to its own directory name has been tampered with.
 * @param storeRoot - Canonical store root.
 * @param skillName - Skill name.
 * @param digest - Expected digest.
 * @returns whether the revision is intact.
 */
export async function verifyRevision(
  storeRoot: string,
  skillName: string,
  digest: string,
): Promise<boolean> {
  const target = path.join(storeRoot, skillName, digest)
  const info = await lstat(target).catch(() => undefined)
  if (info === undefined || !info.isDirectory()) return false
  const entry = await lstat(path.join(target, SKILL_ENTRY_FILE)).catch(() => undefined)
  if (entry === undefined || !entry.isFile()) return false
  const files = await collectBundleFiles(target).catch(() => undefined)
  if (files === undefined) return false
  return (await digestBundle(target, files)) === digest
}

/**
 * Physically remove one immutable revision directory from the store.
 *
 * Callers MUST first prove the digest is unreferenced (see
 * `collectableRevisions`): a revision fixed by an unarchived Task or a
 * non-terminal Invocation has to survive so that queued work keeps running
 * the exact version it was accepted with.
 * @param storeRoot - Canonical store root.
 * @param skillName - Skill name.
 * @param digest - Revision digest.
 * @returns whether a directory was removed.
 * @throws PetError when the resolved path escapes the store.
 */
export async function removeRevisionDirectory(
  storeRoot: string,
  skillName: string,
  digest: string,
): Promise<boolean> {
  const target = path.join(storeRoot, skillName, digest)
  if (!isContainedBy(storeRoot, target)) {
    throw new PetError('SKILL_IMPORT_REJECTED', 'Revision path escapes the Pet immutable store')
  }
  const info = await lstat(target).catch(() => undefined)
  if (info === undefined) return false
  if (!info.isDirectory()) {
    throw new PetError(
      'SKILL_IMPORT_REJECTED',
      `Refusing to remove ${target}: not a revision directory`,
    )
  }
  await rm(target, { recursive: true, force: true })
  return true
}
