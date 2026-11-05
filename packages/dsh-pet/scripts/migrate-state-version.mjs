#!/usr/bin/env node
/**
 * Offline Pet state migration (v2..v18 -> v19): purge previous-model locus rows.
 *
 * Why this exists as a standalone script rather than in-process migration: the
 * SQLite backend opens Pet's database with `PRAGMA locking_mode = EXCLUSIVE`,
 * so a running DSH Host owns the file and nothing else can touch it. A database
 * stamped below the descriptor version fails `storageDomain.open` on every
 * boot, so Pet stays unready until this script has run while DSH is STOPPED.
 *
 * What v19 does (openspec pet-locus-purge-previous-model):
 *   - A previous-model ("two-tier") locus row is one whose `parentSessionId` has
 *     no record in `locus_mains`. v18 only added that table; it never rewrote
 *     the old rows, which stayed behind and were retired at read time. v19
 *     deletes them, and every row that references them, in ONE transaction:
 *       loci                    id                                  in L
 *       locus_deliveries        locusId                             in L
 *       locus_switch_notices    locusId                             in L
 *       locus_permission_audit  locusId                             in L
 *       locus_operations        locusId | oldLocusId | newLocusId   in L
 *     (L = ids of the deleted `loci` rows; matched on the recorded field, never
 *     on a key prefix.) `locus_indexes` is NOT touched: the Host re-derives it
 *     from the remaining rows when it opens the locus store. Ledger, inquiry,
 *     `chat_bindings` and `invocation_channel` rows are never read or changed.
 *   - It REFUSES (non-zero exit, nothing written) when any Delivery anywhere is
 *     not in a terminal status, any locus operation is not `committed` or
 *     `compensated`, or the rows it would keep would not open under v19. The
 *     last check is the Host's own rule (`validateLocusSetForStorage`, loaded
 *     from this package's `lib/`), not a copy, so "the script let it through"
 *     means "the Host can open it".
 *
 * Order of events:
 *   1. Read-only pre-flight (this is all `--dry-run` and an unconfirmed run do;
 *      no checkpoint, no write of any kind).
 *   2. `--yes`: take the exclusive lock and keep it to the end; re-read the
 *      version stamp, tables and rows under it and redo every check. A refusal
 *      here writes no backup and changes no row or version.
 *   3. Checkpoint the WAL, then write `state.sqlite.v<N>.bak-<ms>` (a complete
 *      snapshot, made before ANY change, DDL included). Rolling back means
 *      restoring it and deploying the previous version.
 *   4. One transaction: create `locus_mains` if the database predates v18,
 *      delete the rows above, stamp v19. Any error rolls everything back.
 *
 * Usage:
 *   dsh-pet-migrate-state [--db <path>] [--dry-run] [--yes]
 */

import { existsSync, copyFileSync, writeSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import os from 'node:os'

/** Domain identity; must match src/host/spec.ts. */
const PET_DOMAIN_NAME = 'dsh_pet'
const PET_DOMAIN_VERSION = 19
/** Versions this script is allowed to migrate. v1 needs a separate explicit
 * cleanup because its rows reference a store layout that is gone. */
const MIGRATABLE = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
/** Must equal `TERMINAL_STATUSES` in src/host/locus/delivery.ts (a test compares them). */
const TERMINAL_DELIVERY_STATUSES = new Set(['settled', 'failed', 'replied', 'no-reply', 'expired', 'unknown-terminal'])
/** The only operation phases that carry no recovery work. `failed` may owe compensation. */
const SETTLED_OPERATION_PHASES = new Set(['committed', 'compensated'])
/** Locus tables whose rows reference a locus id, with the fields to match. */
const REFERENCING_TABLES = [
  ['locus_deliveries', ['locusId']],
  ['locus_switch_notices', ['locusId']],
  ['locus_permission_audit', ['locusId']],
  ['locus_operations', ['locusId', 'oldLocusId', 'newLocusId']],
]

const physical = name => `u_${PET_DOMAIN_NAME}_${name}`

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

/** Written synchronously: the next step may block on the database lock. */
function announce(line) {
  writeSync(1, `${line}\n`)
}

let args
try {
  args = parseArgs(process.argv.slice(2))
} catch (error) {
  fail(error.message)
}
if (args.help) {
  console.log(
    'Usage: dsh-pet-migrate-state [--db <path>] [--dry-run] [--yes]\n' +
    '  Purges previous-model locus rows and stamps state version 19. Run with DSH stopped.\n' +
    '  --dry-run  read-only: list the rows that would be deleted, or why the migration is refused\n' +
    '  --yes      take the exclusive lock, write a backup, then migrate',
  )
  process.exit(0)
}

const databaseFile = args.db ?? defaultDatabaseFile()

// Never create the file. An absent database is a first boot, which the Host
// materializes correctly on its own; creating one here would fabricate a
// medium that the ownership proof then accepts as genuine.
if (!existsSync(databaseFile)) {
  fail(`Pet database not found at ${databaseFile}; nothing to migrate.`)
}

console.log(`Pet database: ${databaseFile}`)

/**
 * Report a locked medium as actionable guidance.
 *
 * `locking_mode = EXCLUSIVE` defers the conflict until the first statement,
 * so the lock surfaces on `prepare`, not on `new DatabaseSync`. Every site is
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

/** Run a database step, turning lock contention into guidance. */
function guarded(step) {
  try {
    return step()
  } catch (error) {
    failIfLocked(error)
    throw error
  }
}

function openDatabase(options) {
  try {
    // A short timeout is enough: this script requires DSH to be stopped, and a
    // still-running Host holds the file exclusively rather than briefly.
    return new DatabaseSync(databaseFile, { timeout: 3000, ...options })
  } catch (error) {
    failIfLocked(error)
    return fail(`Could not open Pet database: ${error.message}`)
  }
}

/** The stamped version, or a failure when the unit row is missing. */
function readVersion(db) {
  const stamped = guarded(() => db.prepare('SELECT version FROM units WHERE name = ?').get(PET_DOMAIN_NAME))
  if (stamped === undefined) {
    fail(`No '${PET_DOMAIN_NAME}' unit row found; refusing to guess a version.`)
  }
  return stamped.version
}

/** `{ key, value }` rows of one logical table; a table that does not exist yet has none. */
function readRows(db, table) {
  return guarded(() => {
    const exists = db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?").get(physical(table))
    return exists === undefined ? [] : db.prepare(`SELECT key, value FROM "${physical(table)}" ORDER BY key`).all()
  })
}

function describeEndpoint(endpoint) {
  if (endpoint === null || typeof endpoint !== 'object') return '(no endpoint)'
  return `${String(endpoint.chatId)}${endpoint.threadId === undefined ? '' : `#${String(endpoint.threadId)}`}`
}

/**
 * Everything a decision needs, from one consistent read.
 *
 * @param db - an open connection (read-only pre-flight, or the locked one).
 * @param validate - the Host's `validateLocusSetForStorage`.
 * @returns the rows to purge and every reason to refuse.
 */
function analyse(db, validate) {
  const violations = []
  const json = (table, row) => {
    try {
      return JSON.parse(row.value)
    } catch {
      violations.push(`${table} row ${row.key}: value is not valid JSON`)
      return undefined
    }
  }
  const mainIds = new Set(readRows(db, 'locus_mains').map(row => row.key))

  // L: previous-model rows. A row we cannot even attribute is never guessed at.
  const retained = new Map()
  const removed = []
  for (const row of readRows(db, 'loci')) {
    const value = json('loci', row)
    if (value === undefined) continue
    if (value === null || typeof value !== 'object' || typeof value.parentSessionId !== 'string') {
      violations.push(`loci row ${row.key}: unreadable (no parentSessionId); refusing to guess its model`)
    } else if (mainIds.has(value.parentSessionId)) {
      retained.set(row.key, value)
    } else {
      removed.push({ id: row.key, endpoint: describeEndpoint(value.endpoint) })
    }
  }
  const purged = new Set(removed.map(row => row.id))

  const deletions = { loci: removed.map(row => row.id) }
  for (const [table, fields] of REFERENCING_TABLES) {
    deletions[table] = []
    for (const row of readRows(db, table)) {
      const value = json(table, row)
      if (value === undefined) continue
      if (table === 'locus_deliveries' && !TERMINAL_DELIVERY_STATUSES.has(value?.status)) {
        violations.push(`locus_deliveries ${row.key}: status '${String(value?.status)}' is not terminal`)
      }
      if (table === 'locus_operations' && !SETTLED_OPERATION_PHASES.has(value?.phase)) {
        violations.push(`locus_operations ${row.key}: phase '${String(value?.phase)}' is not committed or compensated`)
      }
      if (fields.some(field => typeof value?.[field] === 'string' && purged.has(value[field]))) {
        deletions[table].push(row.key)
      }
    }
  }

  violations.push(...validate(retained, mainIds))
  return { removed, deletions, violations }
}

function refuse(violations) {
  console.error('✗ Migration refused. Nothing was changed:')
  for (const violation of violations) console.error(`  - ${violation}`)
  console.error(
    '\nIn-flight work (queued/running Deliveries, unfinished operations): wait for it to finish, then re-run.\n' +
    'Recovery debt that waiting cannot clear — operations in needs-recovery or failed, Deliveries stuck in a\n' +
    'non-terminal status — must first be cleaned up by a Host of the CURRENT version, or resolved by hand,\n' +
    'before migrating. Stopping DSH does not clear it.',
  )
  process.exit(1)
}

function printPlan(current, analysis) {
  console.log(`Previous-model locus rows to delete (parent has no locus_mains record): ${analysis.removed.length}`)
  for (const row of analysis.removed) console.log(`  - ${row.id}  (${row.endpoint})`)
  console.log('Rows to delete by table:')
  for (const [table, keys] of Object.entries(analysis.deletions)) console.log(`  ${table}: ${keys.length}`)
  console.log('locus_indexes is left alone; the Host re-derives it from the remaining rows when it opens.')
  void current
}

// -- version gate (shared by the pre-flight and the locked re-check) ------------

/** Exits for versions that need no migration or cannot be migrated; returns otherwise. */
function gateVersion(current) {
  console.log(`Stamped version: ${current}  →  target: ${PET_DOMAIN_VERSION}`)
  if (current === PET_DOMAIN_VERSION) {
    console.log('✓ Already at the target version; nothing to do.')
    process.exit(0)
  }
  if (current === 1) {
    fail(
      'Version 1 requires a separate explicit legacy cleanup (it drops rows ' +
      'that reference a removed store layout); this CLI only migrates v2..v18.',
    )
  }
  if (!MIGRATABLE.includes(current)) {
    fail(`Unsupported Pet storage version ${current}; refusing migration.`)
  }
}

// -- 1. read-only pre-flight ----------------------------------------------------

const preflight = openDatabase({ readOnly: true })
let validate
let plan
let planVersion
try {
  planVersion = readVersion(preflight)
  gateVersion(planVersion)
  // Loaded only now: an unsupported or finished database needs none of it. The
  // path is relative to THIS file, so it works from any cwd and through the
  // `.bin` symlink (Node resolves the entry point's real path).
  try {
    ;({ validateLocusSetForStorage: validate } = await import(new URL('../lib/host/locus/persistence.js', import.meta.url).href))
  } catch (error) {
    fail(`Could not load the Host's row validation from this package's lib/: ${error.message}\n  Build the package (npm run build) or reinstall it.`)
  }
  plan = analyse(preflight, validate)
} finally {
  preflight.close()
}

if (plan.violations.length > 0) refuse(plan.violations)
printPlan(planVersion, plan)

if (args.dryRun) {
  console.log(`\n[dry-run] Would migrate ${planVersion} → ${PET_DOMAIN_VERSION}. No write performed.`)
  console.log('Re-run with --yes while DSH remains stopped to perform the migration.')
  process.exit(0)
}

// A migration may be run on several machines by an operator following a log
// line. Never turn an omitted flag or a pasted partial command into a write.
if (!args.yes) {
  fail(
    `Migration ${planVersion} → ${PET_DOMAIN_VERSION} is ready but not confirmed.\n` +
    '  No write was performed. Re-run with --yes while DSH remains stopped.',
  )
}

// -- 2. exclusive lock, held to the end; re-check everything under it -----------

announce('Preflight passed; taking the exclusive lock…')
const db = openDatabase({})
try {
  // Take the write lock FIRST, then switch to EXCLUSIVE locking mode, then
  // commit: the lock is kept until this connection closes, so no writer can slip
  // in below. The order matters. In EXCLUSIVE mode from the start, a connection
  // that is still waiting for the write lock would also keep its read lock and
  // starve the very writer it is waiting for.
  guarded(() => {
    db.exec('BEGIN IMMEDIATE')
    db.exec('PRAGMA locking_mode = EXCLUSIVE')
    db.exec('COMMIT')
  })

  const current = readVersion(db)
  gateVersion(current) // already 19 → exit 0; changed to something unsupported → refuse
  const locked = analyse(db, validate)
  if (locked.violations.length > 0) refuse(locked.violations)

  // -- 3. checkpoint, then a full snapshot before any change -------------------
  guarded(() => db.exec('PRAGMA wal_checkpoint(TRUNCATE)'))
  const backup = `${databaseFile}.v${current}.bak-${Date.now()}`
  copyFileSync(databaseFile, backup)
  console.log(`Backup written: ${backup}`)

  // -- 4. the one mutating transaction -----------------------------------------
  db.exec('BEGIN IMMEDIATE')
  try {
    // A database older than v18 has no pairing table; every locus row in it is
    // previous-model, which is exactly what an empty table says.
    db.exec(`CREATE TABLE IF NOT EXISTS "${physical('locus_mains')}" (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`)
    for (const [table, keys] of Object.entries(locked.deletions)) {
      if (keys.length === 0) continue
      const remove = db.prepare(`DELETE FROM "${physical(table)}" WHERE key = ?`)
      for (const key of keys) remove.run(key)
    }
    db.prepare('UPDATE units SET version = ? WHERE name = ?').run(PET_DOMAIN_VERSION, PET_DOMAIN_NAME)
    const after = db.prepare('SELECT version FROM units WHERE name = ?').get(PET_DOMAIN_NAME)
    if (after?.version !== PET_DOMAIN_VERSION) {
      throw new Error(`Version stamp did not take effect (still ${after?.version}).`)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  console.log(`✓ Migrated ${current} → ${PET_DOMAIN_VERSION}: removed ${locked.removed.length} previous-model locus row(s)`)
  for (const [table, keys] of Object.entries(locked.deletions)) console.log(`  ${table}: ${keys.length}`)
  console.log(
    '\nThe storage backend creates the remaining additive tables on its next open.\n' +
    'Start DSH and confirm the log shows `[dsh-pet] ready`.',
  )
} finally {
  db.close()
}
