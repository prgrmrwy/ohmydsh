/**
 * One-way cleanup of Pet state written by the previous Skill model.
 *
 * Pet used to copy each Skill into an immutable, content-addressed revision
 * and pin every Invocation to its digest. Skills are now REGISTERED: Pet
 * records the user's own directory and links to it, so those rows carry
 * `sourcePath` where they used to carry `digest`.
 *
 * A v1 row cannot be upgraded in place — the store copy it referenced is
 * gone, and Pet must never invent a source directory on the user's behalf.
 *
 * The cleanup runs DIRECTLY AGAINST THE DATABASE, before the domain is
 * opened. `storageDomain.open` validates every stored record up front, so a
 * single legacy row makes the whole open fail; a cleanup that ran after open
 * would never be reached. That is exactly the failure this fixes: a Host that
 * previously worked degrades on upgrade, with no way for the user to clear it
 * from the UI.
 */

import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { PET_DOMAIN_NAME, PET_DOMAIN_VERSION } from './spec.js'

/** Tables whose v1 rows are incompatible with the registration model. */
const INCOMPATIBLE_TABLES = [
  'skill_revisions',
  'skill_selections',
  'invocations',
  'tasks',
  'snapshots',
  'runs',
] as const

/**
 * How long to wait for a competing writer before giving up.
 *
 * Deliberately short: an ordinary overlap clears in milliseconds, while a
 * running Host holds the medium exclusively and no timeout would help.
 */
const MIGRATION_BUSY_TIMEOUT_MS = 3000

/**
 * A migration that could not be PROVEN to have run.
 *
 * Distinct from "there was nothing to migrate": the caller contains this and
 * degrades Pet with a visible diagnostic instead of continuing to an open that
 * is now guaranteed to fail on a version mismatch.
 */
export class PetMigrationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions)
    this.name = 'PetMigrationError'
  }
}

/**
 * Extract a human-readable reason from an unknown thrown value.
 * @param error - The caught value.
 * @returns its message.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** What the cleanup removed, for the operator-facing log line. */
export interface LegacyStateCleanup {
  /** Total rows dropped across every incompatible table. */
  readonly removedRows: number
  /** Tables that actually held legacy rows. */
  readonly clearedTables: readonly string[]
}

/**
 * Detect whether a stored row predates the registration model.
 * @param table - Table the row came from.
 * @param row - Parsed record.
 * @returns whether the row must be dropped.
 */
function isLegacyRow(table: string, row: Record<string, unknown>): boolean {
  if (table === 'skill_revisions') return typeof row['sourcePath'] !== 'string'
  if (table === 'skill_selections') return row['enabledDigest'] !== undefined
  if (table === 'invocations') return typeof row['skillSourcePath'] !== 'string'
  // Tasks, snapshots and runs are unchanged in shape, but they reference
  // Invocations that are about to disappear. Dropping an Invocation while
  // leaving its Task behind would strand a Task that can never settle, so the
  // whole work graph is cleared together or not at all.
  return false
}

/**
 * Clear Pet state written by the previous Skill model.
 *
 * Reads defensively and is idempotent: a database already in the current
 * shape, or one that does not exist yet, is left untouched.
 * @param databaseFile - Path to Pet's SQLite file.
 * @returns what was removed.
 */
export function removeLegacyState(databaseFile: string): LegacyStateCleanup {
  try {
    return runLegacyStateCleanup(databaseFile)
  } catch (error) {
    // Already classified (unsupported version, etc.) — keep it as is.
    if (error instanceof PetMigrationError) throw error
    // An inaccessible medium is NOT "nothing to migrate". The exclusive lock
    // the SQLite backend takes surfaces at whichever statement first needs it —
    // open, read, or the restamp write — so the whole pass is classified here
    // rather than at one guessed site. Reporting this as an empty cleanup let a
    // locked medium silently skip the version restamp, after which
    // `storageDomain.open` failed on every boot with a version mismatch and
    // aborted Pet before its routes registered, with no log line anywhere.
    if (isMediumUnavailable(error)) {
      throw new PetMigrationError(
        `Pet database at ${databaseFile} exists but could not be opened or updated: ` +
        `${messageOf(error)}. A running DSH Host holds it exclusively; stop DSH and retry.`,
        { cause: error },
      )
    }
    throw error
  }
}

/**
 * Whether a thrown value means the medium could not be used at all.
 *
 * Matched on SQLite's own busy/locked signals rather than on message text
 * alone, so a genuine schema error is never misreported as a lock.
 */
function isMediumUnavailable(error: unknown): boolean {
  const code = (error as { errcode?: number } | undefined)?.errcode
  // SQLITE_BUSY (5) and SQLITE_LOCKED (6).
  if (code === 5 || code === 6) return true
  return /\b(locked|busy)\b/i.test(messageOf(error))
}

/**
 * The actual cleanup pass, run against an open database.
 * @param databaseFile - Path to Pet's SQLite file.
 * @returns what was removed.
 */
function runLegacyStateCleanup(databaseFile: string): LegacyStateCleanup {
  // Never CREATE the file. `new DatabaseSync(path)` creates it when absent,
  // which would defeat the ownership proof that runs later: that check treats
  // "the file exists after a durable write" as evidence the write landed at
  // Pet's configured path. Creating it here makes that check pass even when
  // the records actually went to a foreign medium.
  if (!existsSync(databaseFile)) return { removedRows: 0, clearedTables: [] }

  // A busy timeout lets a brief writer overlap resolve itself. It does NOT
  // rescue the exclusive case: the SQLite backend opens Pet's medium with
  // `locking_mode = EXCLUSIVE`, so a running Host never yields the file.
  const db = new DatabaseSync(databaseFile, { timeout: MIGRATION_BUSY_TIMEOUT_MS })

  try {
    // Inspect version before touching any rows. A future/unknown schema is
    // not an older Skill model and must never be restamped or cleaned.
    const stamped = db.prepare('SELECT version FROM units WHERE name = ?')
      .get(PET_DOMAIN_NAME) as { version?: number } | undefined
    if (stamped === undefined) return { removedRows: 0, clearedTables: [] }
    if (stamped.version === PET_DOMAIN_VERSION) return { removedRows: 0, clearedTables: [] }
    if (![1, 2, 3, 4, 5, 6, 7, 8].includes(stamped.version as number)) {
      throw new PetMigrationError(
        `Unsupported Pet storage version ${String(stamped.version)}; refusing migration`,
      )
    }
    // v2+ upgrades are additive. Even malformed rows are retained for domain
    // validation to diagnose, never interpreted as permission to erase history.
    if (stamped.version !== 1) {
      db.prepare('UPDATE units SET version = ? WHERE name = ?').run(PET_DOMAIN_VERSION, PET_DOMAIN_NAME)
      return { removedRows: 0, clearedTables: [] }
    }
    const clearedTables: string[] = []
    let removedRows = 0
    let sawLegacyWork = false

    for (const table of INCOMPATIBLE_TABLES) {
      const name = `u_${PET_DOMAIN_NAME}_${table}`
      const exists = db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
        .get(name)
      if (exists === undefined) continue

      const rows = db.prepare(`SELECT key, value FROM ${name}`).all() as {
        key: string
        value: string
      }[]
      const stale = rows.filter(entry => {
        try {
          return isLegacyRow(table, JSON.parse(entry.value) as Record<string, unknown>)
        } catch {
          // An unparseable row cannot be validated either, so it goes too.
          return true
        }
      })
      if (stale.length === 0) continue

      if (table === 'invocations') sawLegacyWork = true
      const remove = db.prepare(`DELETE FROM ${name} WHERE key = ?`)
      for (const entry of stale) remove.run(entry.key)
      removedRows += stale.length
      clearedTables.push(table)
    }

    // A legacy Invocation drags its whole work graph with it: keeping the Task
    // would leave work that can never settle and never be archived.
    if (sawLegacyWork) {
      for (const table of ['tasks', 'snapshots', 'runs'] as const) {
        const name = `u_${PET_DOMAIN_NAME}_${table}`
        const exists = db
          .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
          .get(name)
        if (exists === undefined) continue
        const count = (db.prepare(`SELECT COUNT(*) AS c FROM ${name}`).get() as { c: number }).c
        if (count === 0) continue
        db.prepare(`DELETE FROM ${name}`).run()
        removedRows += count
        if (!clearedTables.includes(table)) clearedTables.push(table)
      }
    }

    // Only the explicitly supported v1 cleanup reaches this point. Restamp
    // after cleanup; never use row shape to authorize a version downgrade.
    db.prepare('UPDATE units SET version = ? WHERE name = ?').run(
      PET_DOMAIN_VERSION,
      PET_DOMAIN_NAME,
    )

    return { removedRows, clearedTables }
  } finally {
    db.close()
  }
}
