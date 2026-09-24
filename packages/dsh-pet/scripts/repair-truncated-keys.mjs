#!/usr/bin/env node
/**
 * One-off repair for Locus rows whose SQL primary key was silently truncated
 * at a NUL byte before `\x1f` became the row-key separator.
 *
 * Why this exists as a standalone script rather than only as an in-process
 * self-heal: the SQLite backend opens Pet's database with
 * `PRAGMA locking_mode = EXCLUSIVE`, so a repair pass cannot acquire the file
 * while a DSH Host is running — the same constraint `migrate-state-version.mjs`
 * documents for the version restamp. This script performs the repair while
 * DSH is STOPPED.
 *
 * What was broken: `node:sqlite` binds TEXT parameters as C strings and
 * truncates at the first NUL byte. Three Locus tables built their row key by
 * joining fields with `\u0000` (`locus_indexes`, `locus_switch_notices`,
 * `locus_permission_audit`); every row whose key needed a separator — i.e.
 * every topic-scoped endpoint, every switch notice, every permission-audit
 * entry past the first in a generation — was stored under a truncated key.
 * Two rows that only differed after the truncation point collided onto one
 * SQL row, and `INSERT ... ON CONFLICT DO UPDATE` silently kept only the
 * last writer. The JSON *value* was never truncated (it is bound as one
 * parameter, not built from the separator), so the intended full key always
 * survived inside the row it landed on — this script uses that surviving
 * copy to reconstruct what should have been stored, using the new `\x1f`
 * separator (see `src/host/locus/storage-key.ts`).
 *
 * This script REWRITES row keys; it does not change the JSON value shape and
 * does not touch `units.version` — this is a data repair, not a schema
 * migration, and runs independently of `migrate-state-version.mjs`.
 *
 * What "repair" means per table:
 *   - locus_indexes: value.key is the full, never-truncated key. If the row
 *     key differs from value.key, the row is moved: delete the truncated
 *     key, put value.key -> value. A collision at the correct key (this
 *     script reports it UNRECOVERABLE from the medium alone and refuses to
 *     guess which write was meant to win) is, for THIS table specifically,
 *     usually already healed by the time an operator would run this script:
 *     `LocusRepository.reconcileStartup` — which every Pet boot runs — derives
 *     the ENTIRE index table fresh from the authoritative `loci` table on
 *     every startup and persists the diff, so a clobbered index row for a
 *     locus whose OWN record is intact self-heals on the next boot with no
 *     help from this script. This script's locus_indexes repair matters for
 *     the interval BEFORE that next boot (a truncated key is invisible to
 *     point lookups by the correct key, so an endpoint can look like it has
 *     no Locus until either this script or a boot fixes it) and for indexes
 *     of Loci that predate this fix but whose OWN row was itself lost in a
 *     separate, unrelated collision — those cannot be re-derived from
 *     anywhere and are exactly what stays UNRECOVERABLE.
 *   - locus_switch_notices: value carries locusId and generation as separate
 *     fields, so the correct key is recomputed from them, not read back from
 *     a value.key field (there is none). Unlike locus_indexes, this table is
 *     NOT re-derived from `loci` on boot — a notice's text is the one-time
 *     rendering of a specific source switch, not something any other durable
 *     record reconstructs. A collision here is a genuine, permanent loss of
 *     one generation's switch notice; this script is the only recovery path.
 *   - locus_permission_audit: value.id is the full key, same shape as
 *     locus_indexes, but likewise NOT re-derived on boot — it is an
 *     append-only audit trail, not a projection of `loci`. A collision here
 *     permanently loses one audit entry; this script is the only recovery
 *     path.
 *
 * Usage:
 *   node scripts/repair-truncated-keys.mjs [--db <path>] [--dry-run] [--yes]
 */

import { existsSync, copyFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import os from 'node:os'

/** Domain identity; must match src/host/spec.ts. */
const PET_DOMAIN_NAME = 'dsh_pet'

/** The separator every row key now uses; must match src/host/locus/storage-key.ts. */
const STORAGE_KEY_SEPARATOR = '\x1f'

/** Tables whose row key is `\u0000`-joined and reconstructible from the value. */
const REPAIRABLE_TABLES = /** @type {const} */ ([
  {
    table: 'locus_indexes',
    /** @param {Record<string, unknown>} value */
    correctKey: (value) => (typeof value.key === 'string' ? value.key : undefined),
  },
  {
    table: 'locus_switch_notices',
    correctKey: (value) =>
      typeof value.locusId === 'string' && typeof value.generation === 'number'
        ? `${value.locusId}${STORAGE_KEY_SEPARATOR}${String(value.generation)}`
        : undefined,
  },
  {
    table: 'locus_permission_audit',
    correctKey: (value) => (typeof value.id === 'string' ? value.id : undefined),
  },
])

function parseArgs(argv) {
  const args = { dryRun: false, yes: false, db: undefined, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--yes' || arg === '-y') args.yes = true
    else if (arg === '--db') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--db requires a path value.')
      }
      args.db = value
      i += 1
    } else if (arg === '--help' || arg === '-h') args.help = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (args.dryRun && args.yes) {
    throw new Error('Choose either --dry-run or --yes, not both.')
  }
  return args
}

function defaultDatabaseFile() {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  return path.join(home, 'plugins', 'dsh-pet', 'state.sqlite')
}

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

/**
 * Render a row key for terminal output with its separator visible.
 *
 * `STORAGE_KEY_SEPARATOR` (`\x1f`) is a non-printing control character by
 * design — the same property that makes it safe as a separator makes it
 * invisible in a plain terminal, so an operator reading raw `'a<sep>b'` sees
 * only `'ab'` and can mistake a correctly-computed key for a second
 * truncation. This is display-only; the actual key written to SQLite is
 * never altered by this function.
 */
function displayKey(key) {
  return key.split(STORAGE_KEY_SEPARATOR).join('␟')
}

let args
try {
  args = parseArgs(process.argv.slice(2))
} catch (error) {
  fail(error.message)
}
if (args.help) {
  console.log('Usage: node scripts/repair-truncated-keys.mjs [--db <path>] [--dry-run] [--yes]')
  process.exit(0)
}

const databaseFile = args.db ?? defaultDatabaseFile()

// Never create the file. An absent database is a first boot; nothing to repair.
if (!existsSync(databaseFile)) {
  fail(`Pet database not found at ${databaseFile}; nothing to repair.`)
}

console.log(`Pet database: ${databaseFile}`)

/**
 * Report a locked medium as actionable guidance.
 *
 * `locking_mode = EXCLUSIVE` defers the conflict until the first statement,
 * so the lock surfaces on `prepare`, not on `new DatabaseSync`. Both sites are
 * funnelled here so a running Host never produces a raw stack trace.
 */
function failIfLocked(error) {
  const message = String(error?.message ?? '')
  if (message.includes('locked') || error?.errcode === 5) {
    fail(
      'Pet database is locked — the SQLite backend holds it exclusively.\n' +
      '  Stop DSH first, then re-run this script.\n' +
      `  Underlying error: ${message}`,
    )
  }
}

let db
try {
  // A short timeout is enough: this script requires DSH to be stopped, and a
  // still-running Host holds the file exclusively rather than briefly.
  db = new DatabaseSync(databaseFile, { timeout: 3000 })
} catch (error) {
  failIfLocked(error)
  fail(`Could not open Pet database: ${error.message}`)
}

try {
  let unitExists
  try {
    unitExists = db.prepare('SELECT 1 FROM units WHERE name = ?').get(PET_DOMAIN_NAME)
  } catch (error) {
    failIfLocked(error)
    throw error
  }
  if (unitExists === undefined) {
    console.log(`✓ No '${PET_DOMAIN_NAME}' unit row found; nothing to repair.`)
    process.exit(0)
  }

  /** @type {{ table: string, key: string, correctKey: string }[]} */
  const toMove = []
  /** @type {{ table: string, key: string, reason: string }[]} */
  const unrecoverable = []

  for (const { table, correctKey } of REPAIRABLE_TABLES) {
    const physical = `u_${PET_DOMAIN_NAME}_${table}`
    const exists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(physical)
    if (exists === undefined) continue

    const rows = /** @type {{ key: string, value: string }[]} */ (
      db.prepare(`SELECT key, value FROM "${physical}"`).all()
    )
    const rowsByKey = new Map(rows.map(row => [row.key, row]))

    for (const row of rows) {
      let value
      try {
        value = JSON.parse(row.value)
      } catch {
        // An unparseable value is a separate, pre-existing problem; domain
        // validation on open already surfaces it. Not this script's job.
        continue
      }
      const correct = correctKey(value)
      if (correct === undefined || correct === row.key) continue

      const collidesWith = rowsByKey.get(correct)
      if (collidesWith !== undefined) {
        unrecoverable.push({
          table,
          key: row.key,
          reason:
            `row already exists at the correct key '${displayKey(correct)}' — the row currently ` +
            `at '${displayKey(row.key)}' is what the truncation-era writer left behind after at ` +
            `least one sibling's write was silently discarded; which one is the ` +
            `intended survivor cannot be reconstructed from this data alone`,
        })
        continue
      }
      toMove.push({ table, key: row.key, correctKey: correct })
    }
  }

  console.log(`Rows needing key repair: ${toMove.length}`)
  console.log(`Rows unrecoverable (collision at the correct key): ${unrecoverable.length}`)

  if (unrecoverable.length > 0) {
    console.log('\nUnrecoverable rows (left untouched):')
    for (const item of unrecoverable) {
      console.log(`  [${item.table}] ${displayKey(item.key)}: ${item.reason}`)
    }
    console.log(
      '\n  These need an owner decision, not a script guess. For locus_indexes an ' +
      'endpoint-current index is fully rederivable by rebuilding the Locus from its ' +
      'chat/thread via a fresh @mention or the settings panel "重建" action — the ' +
      'stale row can then be deleted once the rebuilt index is confirmed correct.',
    )
  }

  if (toMove.length === 0) {
    console.log('\n✓ No repairable truncated-key rows found.')
    process.exit(unrecoverable.length > 0 ? 1 : 0)
  }

  if (args.dryRun) {
    console.log('\n[dry-run] Rows that would be moved:')
    for (const item of toMove) {
      // The target key's separator (`\x1f`) is a non-printing control
      // character by design and would otherwise vanish in this terminal
      // line, making a correct repair look like the row simply lost its
      // separator a second time. `␟` (U+241F, SYMBOL FOR UNIT SEPARATOR) is
      // display-only — the actual bytes written to SQLite are unchanged.
      console.log(`  [${item.table}] '${displayKey(item.key)}' -> '${displayKey(item.correctKey)}'`)
    }
    console.log('\nRe-run with --yes while DSH remains stopped to perform the repair.')
    process.exit(0)
  }

  if (!args.yes) {
    fail(
      `${toMove.length} row(s) ready to repair but not confirmed.\n` +
      '  No write was performed. Re-run with --yes while DSH remains stopped.',
    )
  }

  // Fold committed WAL frames into the main file before copying it. A stopped
  // Host should leave none, but backup correctness must not depend on that
  // assumption. An exclusive lock proves no writer can race the copy.
  try {
    db.exec('PRAGMA locking_mode = EXCLUSIVE')
    db.exec('BEGIN IMMEDIATE')
    db.exec('COMMIT')
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } catch (error) {
    failIfLocked(error)
    throw error
  }

  // Back up before any mutation. Moving a row key is not reversible by this
  // script once committed, so a recoverable copy is mandatory, not optional.
  const backup = `${databaseFile}.pre-key-repair-${Date.now()}.bak`
  copyFileSync(databaseFile, backup)
  console.log(`Backup written: ${backup}`)

  db.exec('BEGIN IMMEDIATE')
  try {
    for (const item of toMove) {
      const physical = `u_${PET_DOMAIN_NAME}_${item.table}`
      const row = db.prepare(`SELECT value FROM "${physical}" WHERE key = ?`).get(item.key)
      if (row === undefined) continue // moved by an earlier iteration's collision check; skip
      db.prepare(`DELETE FROM "${physical}" WHERE key = ?`).run(item.key)
      db.prepare(`INSERT INTO "${physical}" (key, value) VALUES (?, ?)`).run(item.correctKey, row.value)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  console.log(`✓ Repaired ${toMove.length} row(s).`)
  if (unrecoverable.length > 0) {
    console.log(`  ${unrecoverable.length} row(s) left untouched; see guidance above.`)
  }
  console.log('\nStart DSH and confirm the Pet settings tabs / Locus panel load.')
} finally {
  db.close()
}
