#!/usr/bin/env node
/**
 * One-off Pet state version restamp (v2..v8 -> current PET_DOMAIN_VERSION).
 *
 * Why this exists as a standalone script rather than only as in-process
 * migration: the SQLite backend opens Pet's database with
 * `PRAGMA locking_mode = EXCLUSIVE`, so the in-process `removeLegacyState`
 * pass cannot acquire the file while a DSH Host is running. A database left
 * stamped below the descriptor version therefore fails `storageDomain.open`
 * on every boot, which silently aborts Pet initialization before its routes
 * are registered. This script performs the restamp while DSH is STOPPED.
 *
 * The restamp is safe because v2..v8 -> v9 is purely additive (see
 * src/host/spec.ts): the new locus tables are created by the storage backend
 * on first open, and no existing row is converted, cleared, or rewritten.
 *
 * Usage:
 *   node scripts/migrate-state-version.mjs [--db <path>] [--dry-run] [--yes]
 */

import { existsSync, copyFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import os from 'node:os'

/** Domain identity; must match src/host/spec.ts. */
const PET_DOMAIN_NAME = 'dsh_pet'
const PET_DOMAIN_VERSION = 9
/** Versions this script is allowed to restamp. v1 needs a separate explicit
 * cleanup because its rows reference a store layout that is gone. */
const RESTAMPABLE = [2, 3, 4, 5, 6, 7, 8]

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

let args
try {
  args = parseArgs(process.argv.slice(2))
} catch (error) {
  fail(error.message)
}
if (args.help) {
  console.log('Usage: node scripts/migrate-state-version.mjs [--db <path>] [--dry-run] [--yes]')
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
  let stamped
  try {
    stamped = db.prepare('SELECT version FROM units WHERE name = ?').get(PET_DOMAIN_NAME)
  } catch (error) {
    failIfLocked(error)
    throw error
  }
  if (stamped === undefined) {
    fail(`No '${PET_DOMAIN_NAME}' unit row found; refusing to guess a version.`)
  }

  const current = stamped.version
  console.log(`Stamped version: ${current}  →  target: ${PET_DOMAIN_VERSION}`)

  if (current === PET_DOMAIN_VERSION) {
    console.log('✓ Already at the target version; nothing to do.')
    process.exit(0)
  }
  if (current === 1) {
    fail(
      'Version 1 requires a separate explicit legacy cleanup (it drops rows ' +
      'that reference a removed store layout); this CLI only restamps v2..v8.',
    )
  }
  if (!RESTAMPABLE.includes(current)) {
    fail(`Unsupported Pet storage version ${current}; refusing migration.`)
  }

  const tablesBefore = db
    .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type='table'")
    .get().c
  console.log(`Tables before: ${tablesBefore}`)

  if (args.dryRun) {
    console.log(`\n[dry-run] Would restamp ${current} → ${PET_DOMAIN_VERSION}. No write performed.`)
    console.log('Re-run with --yes while DSH remains stopped to perform the migration.')
    process.exit(0)
  }

  // A migration may be run on several machines by an operator following a log
  // line. Never turn an omitted flag or a pasted partial command into a write.
  if (!args.yes) {
    fail(
      `Migration ${current} → ${PET_DOMAIN_VERSION} is ready but not confirmed.\n` +
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

  // Back up before the only mutating transaction. The restamp itself is a
  // single integer update, but a recoverable copy makes the operation
  // reversible if the later backend open surfaces an unrelated problem.
  const backup = `${databaseFile}.v${current}.bak-${Date.now()}`
  copyFileSync(databaseFile, backup)
  console.log(`Backup written: ${backup}`)

  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('UPDATE units SET version = ? WHERE name = ?')
      .run(PET_DOMAIN_VERSION, PET_DOMAIN_NAME)

    const after = db.prepare('SELECT version FROM units WHERE name = ?').get(PET_DOMAIN_NAME)
    if (after?.version !== PET_DOMAIN_VERSION) {
      throw new Error(`Restamp did not take effect (still ${after?.version}).`)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  console.log(`✓ Restamped ${current} → ${PET_DOMAIN_VERSION}`)
  console.log(
    '\nThe storage backend creates the additive locus tables on its next open.\n' +
    'Start DSH and confirm the Pet settings tabs load.',
  )
} finally {
  db.close()
}
