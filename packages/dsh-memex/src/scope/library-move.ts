/**
 * Move a library to another directory without losing its cards or its remote.
 *
 * A library's directory is a config decision (`scopes[].home`), but its git
 * repository and `.sync.json` live *inside* that directory: changing the path
 * alone leaves the remote behind in the old place, and the kernel's `--init`
 * never clones, so the new directory would come up empty and re-push a second
 * history to the same remote. Moving the whole directory is the only way to
 * change the path and keep the sync binding meaningful.
 *
 * The move is a merge, not a replacement: the target's own cards win on a slug
 * they both hold (two libraries may have diverged), and the source is only
 * removed by the caller after the configuration points at the target.
 *
 * @module dsh-memex/scope/library-move
 */
import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { mergeLibraryCards, type LibraryMergeReport } from './primary-migration.js'

/** Top-level entries that make a directory a library rather than a card folder. */
const LIBRARY_ENTRIES = ['.git', '.sync.json', '.gitignore'] as const

/** What one move did. */
export interface LibraryMoveReport {
  readonly from: string
  readonly to: string
  /** Cards copied (the target's copy wins on a shared slug). */
  readonly copied: readonly string[]
  /** Cards left alone because the target already had them. */
  readonly skipped: readonly string[]
  /** Library entries (git repo, sync state) carried over. */
  readonly carried: readonly string[]
}

/** Normalize a configured library path (expands `~`, drops trailing separators). */
export function normalizeLibraryPath(path: string, home = homedir()): string {
  const expanded = path === '~' ? home : path.startsWith('~/') ? join(home, path.slice(2)) : path
  const absolute = resolve(expanded)
  return absolute.length > 1 ? absolute.replace(/[\\/]$/, '') : absolute
}

function contains(parent: string, child: string): boolean {
  return child.startsWith(`${parent}${sep}`)
}

/**
 * Assert that a directory can be used as a library home.
 *
 * Refuses the shapes that would make a move self-destructive or meaningless:
 * the same path, a path inside the source (or the source inside the target), a
 * filesystem root, or a target that is not a directory.
 * @param from - the library's current home.
 * @param to - the requested home.
 */
export function assertLibraryTarget(from: string, to: string): void {
  const source = normalizeLibraryPath(from)
  const target = normalizeLibraryPath(to)
  if (source === target) throw new Error(`the library already lives at ${source}`)
  if (contains(source, target)) throw new Error(`refusing to move ${source} into itself (${target})`)
  if (contains(target, source)) throw new Error(`refusing to move ${source} inside the new home ${target} (choose a path outside the old library)`)
  if (normalizeLibraryPath(homedir()) === target) throw new Error('refusing to use the home directory as a library')
  if (existsSync(target) && !statSync(target).isDirectory()) throw new Error(`${target} exists and is not a directory`)
}

/**
 * Copy a library's cards and repository state into another directory.
 *
 * Cards merge with the primary-switch rule (the target keeps its own copy of a
 * shared slug). `.git`, `.sync.json` and `.gitignore` are carried only when the
 * target does not already have its own, so moving onto a directory that is
 * already a repository keeps that repository instead of half-overwriting it.
 * @param fromHome - the library's current home.
 * @param toHome - the requested home.
 * @returns what was copied, kept and carried.
 */
export function moveLibrary(fromHome: string, toHome: string): LibraryMoveReport {
  const from = normalizeLibraryPath(fromHome)
  const to = normalizeLibraryPath(toHome)
  assertLibraryTarget(from, to)
  if (!existsSync(from)) throw new Error(`the library at ${from} does not exist`)
  mkdirSync(to, { recursive: true })

  const merge: LibraryMergeReport = mergeLibraryCards(from, to)
  const carried: string[] = []
  for (const entry of LIBRARY_ENTRIES) {
    const source = join(from, entry)
    const target = join(to, entry)
    if (!existsSync(source) || existsSync(target)) continue
    cpSync(source, target, { recursive: true })
    carried.push(entry)
  }
  return { from, to, copied: merge.copied, skipped: merge.skipped, carried }
}

/**
 * Whether a directory may be deleted as a retired library home.
 *
 * The caller has already verified that the configuration points elsewhere; this
 * only refuses the shapes whose deletion cannot be justified (a root, the home
 * directory, or a path that contains another live library).
 * @param path - the directory being retired.
 * @param live - homes still in use.
 */
export function assertRetirable(path: string, live: readonly string[]): void {
  const target = normalizeLibraryPath(path)
  if (target === normalizeLibraryPath(homedir()) || normalizeLibraryPath('/') === target) {
    throw new Error(`refusing to delete ${target}`)
  }
  for (const home of live.map(entry => normalizeLibraryPath(entry))) {
    if (home === target || contains(target, home)) {
      throw new Error(`refusing to delete ${target}: ${home} lives inside it`)
    }
  }
}
