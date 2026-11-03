/**
 * Cards travel with the primary entry.
 *
 * A workspace's primary entry carries routing: recall, the graph-level
 * operations, and default reads and writes. Switching it is a replacement — the
 * old entry stops serving that workspace — so cards written under the old entry
 * would become unreachable the moment the new routing takes effect. The switch
 * is therefore split in two: copy what the old primary's library holds into the
 * new primary's library, and only then let the new routing apply.
 *
 * Conflicts are never overwritten. A card slug present in both libraries may
 * have diverged, so the target's copy wins and the incoming one is reported as
 * skipped; picking silently would destroy the other side. The merge is
 * idempotent, so a retry after a partial failure copies only what is missing.
 *
 * Boundary: this works on library directories, not on cards the settings page
 * knows about. It does not create, rewrite, or delete anything in the source
 * library, and it does not sync either library's remote.
 *
 * @module dsh-memex/scope/primary-migration
 */
import { constants, copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import type { ScopeConfig } from './types.js'

/** Library subdirectories whose cards move with the primary entry. */
const MERGED_DIRS = ['cards', 'archive'] as const

/** How one library's cards were handled while the primary switched. */
export interface LibraryMergeReport {
  /** Source library home, as merged. */
  readonly from: string
  /** Target library home, as merged. */
  readonly to: string
  /** Card files copied, relative to the library root (`cards/x.md`). */
  readonly copied: readonly string[]
  /** Card files left alone because the target already had that slug. */
  readonly skipped: readonly string[]
}

/** One primary switch that has to move cards before it can apply. */
export interface PrimaryMigration {
  /** The claimed workspace path whose primary entry changed. */
  readonly workspace: string
  /** Scope name that was primary before the edit. */
  readonly from: string
  /** Scope name that becomes primary. */
  readonly to: string
  /** Library home of the old primary. */
  readonly fromHome: string
  /** Library home of the new primary. */
  readonly toHome: string
}

export interface MigrationOptions {
  /** Namespace holding the default library homes; defaults to `~/.dsh-memex`. */
  readonly namespaceDir?: string
  /** Home directory used to expand `~/…` prefixes. */
  readonly homeDir?: string
}

function normalizeHome(path: string, home: string): string {
  const expanded = path === '~' ? home : path.startsWith('~/') ? join(home, path.slice(2)) : path
  const absolute = resolve(expanded)
  return absolute.length > 1 ? absolute.replace(/[\\/]$/, '') : absolute
}

/** True when `child` sits inside `parent` (not equal). */
function contains(parent: string, child: string): boolean {
  return child.startsWith(`${parent}${sep}`)
}

/**
 * Copy one library's cards into another, never overwriting an existing slug.
 * @param fromHome - source library home.
 * @param toHome - target library home.
 * @returns what was copied and what was left alone.
 */
export function mergeLibraryCards(fromHome: string, toHome: string): LibraryMergeReport {
  const from = normalizeHome(fromHome, homedir())
  const to = normalizeHome(toHome, homedir())
  const copied: string[] = []
  const skipped: string[] = []
  if (from === to) return { from, to, copied, skipped }
  if (contains(from, to) || contains(to, from)) {
    throw new Error(`refusing to merge ${from} into ${to}: one library path contains the other`)
  }

  for (const dir of MERGED_DIRS) {
    const source = join(from, dir)
    if (!existsSync(source)) continue
    let names: string[]
    try {
      names = readdirSync(source).filter(name => name.toLowerCase().endsWith('.md')).sort()
    } catch {
      continue
    }
    const target = join(to, dir)
    for (const name of names) {
      const relative = join(dir, name)
      try {
        mkdirSync(target, { recursive: true })
        // COPYFILE_EXCL: the target's own card always wins, even if it appeared
        // between the directory listing and this copy.
        copyFileSync(join(source, name), join(target, name), constants.COPYFILE_EXCL)
        copied.push(relative)
      } catch (error) {
        if ((error as { code?: string }).code === 'EEXIST') {
          skipped.push(relative)
          continue
        }
        throw error
      }
    }
  }
  return { from, to, copied, skipped }
}

/** The library home of one declared scope. */
function homeOf(config: ScopeConfig, name: string, namespaceDir: string, homeDir: string): string {
  const entry = config.scopes.find(candidate => candidate.name === name)
  return normalizeHome(entry?.home ?? join(namespaceDir, name), homeDir)
}

/** Every path prefix any entry claims, normalized, in a stable order. */
function claimedPaths(config: ScopeConfig, homeDir: string): string[] {
  const paths = new Set<string>()
  for (const entry of config.scopes) {
    for (const prefix of entry.pathPrefixes ?? []) {
      if (prefix.trim() === '') continue
      paths.add(normalizeHome(prefix, homeDir))
    }
  }
  return [...paths].sort()
}

/**
 * The primary entry of one claimed path, or `undefined` when the configuration
 * does not identify exactly one.
 *
 * Same precedence the resolver uses: a path declaration naming a claimer wins,
 * then the single entry marked primary, then a lone claimer.
 */
function primaryNameOf(config: ScopeConfig, path: string, homeDir: string): string | undefined {
  const claimers = config.scopes.filter(entry =>
    (entry.pathPrefixes ?? []).some(prefix => prefix.trim() !== '' && normalizeHome(prefix, homeDir) === path))
  if (claimers.length === 0) return undefined
  const declared = (config.workspaces ?? []).find(declaration => normalizeHome(declaration.path, homeDir) === path)?.primary
  if (declared !== undefined && claimers.some(entry => entry.name === declared)) return declared
  const marked = claimers.filter(entry => entry.primary === true)
  if (marked.length === 1) return marked[0]!.name
  if (claimers.length === 1) return claimers[0]!.name
  return undefined
}

/**
 * List the primary switches an edit makes, without touching any file.
 *
 * One entry pair is reported at most once even when several workspaces share
 * both entries, because the libraries are the unit that has to move.
 * @param previous - the configuration that is serving now.
 * @param next - the validated configuration taking over.
 * @param options - namespace and home overrides.
 * @returns migrations, in workspace path order.
 */
export function planPrimaryMigrations(
  previous: ScopeConfig,
  next: ScopeConfig,
  options: MigrationOptions = {},
): readonly PrimaryMigration[] {
  const homeDir = options.homeDir ?? homedir()
  const namespaceDir = normalizeHome(options.namespaceDir ?? join(homeDir, '.dsh-memex'), homeDir)
  const paths = new Set([...claimedPaths(previous, homeDir), ...claimedPaths(next, homeDir)])
  const migrations: PrimaryMigration[] = []
  const seen = new Set<string>()
  for (const workspace of [...paths].sort()) {
    const from = primaryNameOf(previous, workspace, homeDir)
    const to = primaryNameOf(next, workspace, homeDir)
    if (from === undefined || to === undefined || from === to) continue
    const fromHome = homeOf(previous, from, namespaceDir, homeDir)
    const toHome = homeOf(next, to, namespaceDir, homeDir)
    const key = `${fromHome}\u0000${toHome}`
    if (seen.has(key)) continue
    seen.add(key)
    migrations.push({ workspace, from, to, fromHome, toHome })
  }
  return migrations
}

/**
 * Plan and perform every primary switch an edit makes.
 *
 * Throws when a merge cannot complete; the caller is expected to keep the
 * running routing in that case, so nothing is orphaned by a half-done move.
 * @param previous - the configuration that is serving now.
 * @param next - the validated configuration taking over.
 * @param options - namespace and home overrides.
 * @returns one report per migration, in workspace path order.
 */
export function migratePrimarySwitches(
  previous: ScopeConfig,
  next: ScopeConfig,
  options: MigrationOptions = {},
): readonly (PrimaryMigration & { readonly report: LibraryMergeReport })[] {
  return planPrimaryMigrations(previous, next, options).map(migration => ({
    ...migration,
    report: mergeLibraryCards(migration.fromHome, migration.toHome),
  }))
}
