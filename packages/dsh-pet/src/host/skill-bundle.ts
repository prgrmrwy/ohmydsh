/**
 * Skill bundle inspection.
 *
 * A Skill is REGISTERED, not copied: Pet records the user's own directory and
 * projects a symlink to it, so editing the source takes effect immediately.
 * Inspection therefore exists to show the user what they are about to add and
 * to reject a bundle Pet must not project — one containing symlinks, special
 * files, path escapes, or missing its `SKILL.md` — rather than to fix content
 * in place.
 */

import { createHash } from 'node:crypto'
import { lstat, mkdtemp, readdir, readFile, realpath, rename, rm, mkdir, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import type { PetContextRequirement } from '../wire.js'
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
  /** Pet presentation and context declarations owned by the Skill. */
  readonly pet?: {
    readonly label?: string
    readonly icon?: string
    readonly context?: PetContextRequirement
    readonly confirm?: boolean
  }
  readonly files: readonly BundleFile[]
  readonly fileCount: number
  readonly totalBytes: number
  /** Canonicalized source directory, retained as diagnostic provenance only. */
  readonly canonicalSourcePath: string
}

/**
 * Minimal frontmatter parsed from `SKILL.md`.
 *
 * A Skill declares its own Pet requirements here. Pet ships NO per-capability
 * adapter: everything an installed Skill needs to appear as a capability
 * travels in this block, so adding one is an install, not a code change.
 */
interface SkillFrontmatter {
  readonly name?: string
  readonly description?: string
  readonly whenToUse?: string
  /** Menu label; defaults to the Skill name. */
  readonly petLabel?: string
  /** Menu glyph. */
  readonly petIcon?: string
  /**
   * One of `none` | `optional` | `workspace-required` | `session-required`;
   * anything else (or absent) falls back to `optional`.
   */
  readonly petContext?: string
  /** `true` makes the radial menu ask for a second, explicit click. */
  readonly petConfirm?: string
}

/**
 * Accept only the declared context vocabulary.
 *
 * An unknown or misspelled value is dropped rather than trusted, so a bundle
 * can never widen its own context authority through a typo.
 * @param value - Raw frontmatter value.
 * @returns the valid requirement, or `undefined`.
 */
function normalizeContext(value: string | undefined): PetContextRequirement | undefined {
  return value === 'none' ||
    value === 'optional' ||
    value === 'workspace-required' ||
    value === 'session-required'
    ? value
    : undefined
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
    ...(fields['petLabel'] !== undefined ? { petLabel: fields['petLabel'] } : {}),
    ...(fields['petIcon'] !== undefined ? { petIcon: fields['petIcon'] } : {}),
    ...(fields['petContext'] !== undefined ? { petContext: fields['petContext'] } : {}),
    ...(fields['petConfirm'] !== undefined ? { petConfirm: fields['petConfirm'] } : {}),
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

  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0)
  return {
    skillName,
    description: frontmatter.description,
    ...(frontmatter.whenToUse !== undefined ? { whenToUse: frontmatter.whenToUse } : {}),
    ...(frontmatter.petLabel !== undefined ||
    frontmatter.petIcon !== undefined ||
    frontmatter.petContext !== undefined ||
    frontmatter.petConfirm !== undefined
      ? {
          pet: {
            ...(frontmatter.petLabel !== undefined ? { label: frontmatter.petLabel } : {}),
            ...(frontmatter.petIcon !== undefined ? { icon: frontmatter.petIcon } : {}),
            ...(normalizeContext(frontmatter.petContext) !== undefined
              ? { context: normalizeContext(frontmatter.petContext)! }
              : {}),
            ...(frontmatter.petConfirm !== undefined
              ? { confirm: frontmatter.petConfirm === 'true' }
              : {}),
          },
        }
      : {}),
    files,
    fileCount: files.length,
    totalBytes,
    canonicalSourcePath: canonical,
  }
}



