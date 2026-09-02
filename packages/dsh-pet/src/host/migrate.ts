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
  let db: DatabaseSync
  try {
    db = new DatabaseSync(databaseFile)
  } catch {
    // No database yet, or it cannot be opened: nothing to clean.
    return { removedRows: 0, clearedTables: [] }
  }

  try {
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

    // Restamp the medium only after the incompatible rows are gone, so a
    // failure part-way through leaves the old version in place and the
    // cleanup simply runs again on the next boot.
    if (removedRows > 0) {
      const stamped = db
        .prepare(`SELECT version FROM units WHERE name = ?`)
        .get(PET_DOMAIN_NAME) as { version?: number } | undefined
      if (stamped !== undefined && stamped.version !== PET_DOMAIN_VERSION) {
        db.prepare(`UPDATE units SET version = ? WHERE name = ?`).run(
          PET_DOMAIN_VERSION,
          PET_DOMAIN_NAME,
        )
      }
    }

    return { removedRows, clearedTables }
  } finally {
    db.close()
  }
}
