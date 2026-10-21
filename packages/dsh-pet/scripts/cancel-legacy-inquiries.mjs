#!/usr/bin/env node
/**
 * One-off owner disposition for the two pre-fix inquiries left `queued` on this
 * machine (restore-pet-inquiry-runtime-channel, tasks 6.4/8.5).
 *
 * Both were accepted on 2026-10-14 by the 「豆包下详情访问量异常」 locus child
 * before the runtime channel existed: no target handoff, never dispatched, no
 * result. Their Feishu Delivery has since expired, so per spec they must not be
 * resumed (a reply right could not be restored) and must not be auto-executed.
 * The owner chose to cancel both.
 *
 * Scope is deliberately closed: the ids and their expected requester/target are
 * fixed below, not taken from argv. Every precondition is re-checked inside one
 * exclusive transaction; any mismatch aborts with nothing written. Only the
 * status/statusAt/reason/appliedEventIds of each row change (via the ledger's
 * own `applyInquiryEvent`); question, purpose and every other field are kept.
 *
 * Requires DSH to be STOPPED: the SQLite backend holds the file exclusively.
 *
 * Usage:
 *   node scripts/cancel-legacy-inquiries.mjs [--db <path>] [--dry-run | --yes]
 */
import { existsSync, copyFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import os from 'node:os'
import { applyInquiryEvent, parseInquiry } from '../lib/host/inquiry/ledger.js'

const PET_DOMAIN_NAME = 'dsh_pet'
const PET_DOMAIN_VERSION = 17
const REASON = 'legacy-owner-cancelled-expired-delivery'
const REQUESTER = 'session-7c515792-de91-44ea-b15a-64ebbb283ea9'
const TARGET = 'session-c67ba88b-77c2-47a6-85a0-db295e742dcc'
const TARGET_IDS = Object.freeze(['inquiry-dsharaybdvo', 'inquiry-gysj0ji9q57'])

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

const args = { db: undefined, dryRun: false, yes: false }
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i]
  if (arg === '--dry-run') args.dryRun = true
  else if (arg === '--yes' || arg === '-y') args.yes = true
  else if (arg === '--db') args.db = process.argv[++i]
  else fail(`Unknown argument: ${arg}`)
}
if (args.dryRun && args.yes) fail('Choose either --dry-run or --yes, not both.')

const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const databaseFile = path.resolve(args.db ?? path.join(home, 'plugins', 'dsh-pet', 'state.sqlite'))
if (!existsSync(databaseFile)) fail(`Pet database not found at ${databaseFile}.`)
console.log(`Pet database: ${databaseFile}`)

function failIfLocked(error) {
  const message = String(error?.message ?? '')
  if (message.includes('locked') || error?.errcode === 5) {
    fail(`Pet database is locked — stop DSH first, then re-run.\n  Underlying error: ${message}`)
  }
}

let db
try {
  db = new DatabaseSync(databaseFile, { timeout: 3000 })
} catch (error) {
  failIfLocked(error)
  fail(`Could not open Pet database: ${error.message}`)
}

/** Read and validate every precondition; returns the planned new rows. Throws on any mismatch. */
function plan(now) {
  const unit = db.prepare('SELECT version FROM units WHERE name = ?').get(PET_DOMAIN_NAME)
  if (unit?.version !== PET_DOMAIN_VERSION) throw new Error(`domain version is ${unit?.version}, expected ${PET_DOMAIN_VERSION}`)
  const planned = []
  for (const id of TARGET_IDS) {
    const row = db.prepare('SELECT value FROM u_dsh_pet_inquiries WHERE key = ?').get(id)
    if (row === undefined) throw new Error(`${id}: row missing`)
    const record = parseInquiry(JSON.parse(row.value))
    if (record.id !== id) throw new Error(`${id}: key/value id mismatch`)
    if (record.status === 'cancelled' && record.reason === REASON) { planned.push({ id, record, next: null }); continue }
    if (record.status !== 'queued') throw new Error(`${id}: status is ${record.status}, expected queued`)
    if (record.requester.sessionId !== REQUESTER) throw new Error(`${id}: requester changed`)
    if (record.target.kind !== 'main' || record.target.sessionId !== TARGET) throw new Error(`${id}: target changed`)
    if (record.appliedEventIds.length !== 0) throw new Error(`${id}: has applied events, not a never-dispatched legacy row`)
    const handoff = db.prepare('SELECT key FROM u_dsh_pet_inquiry_handoffs WHERE key = ?').get(JSON.stringify([id, 'target']))
    if (handoff !== undefined) throw new Error(`${id}: has a target handoff, not a legacy row`)
    const result = db.prepare('SELECT key FROM u_dsh_pet_inquiry_results WHERE value LIKE ?').get(`%"inquiryId":"${id}"%`)
    if (result !== undefined) throw new Error(`${id}: already has a result row`)
    const next = applyInquiryEvent(record, {
      type: 'cancel', eventId: `owner-legacy-cancel:${id}`, at: Math.max(now, record.statusAt), reason: REASON,
    })
    planned.push({ id, record, next })
  }
  return planned
}

try {
  let planned
  try {
    planned = plan(Date.now())
  } catch (error) {
    failIfLocked(error)
    fail(`Precondition failed, nothing written: ${error.message}`)
  }
  for (const { id, record, next } of planned) {
    console.log(next === null
      ? `  ${id}: already cancelled (${REASON}); nothing to do`
      : `  ${id}: ${record.status} → ${next.status}  reason=${next.reason}`)
  }
  const pending = planned.filter(p => p.next !== null)
  if (pending.length === 0) { console.log('✓ Nothing to do.'); process.exit(0) }
  if (args.dryRun) { console.log('\n[dry-run] No write performed. Re-run with --yes while DSH remains stopped.'); process.exit(0) }
  if (!args.yes) fail('Not confirmed. No write performed. Re-run with --yes while DSH remains stopped.')

  try {
    db.exec('PRAGMA locking_mode = EXCLUSIVE')
    db.exec('BEGIN IMMEDIATE')
    db.exec('COMMIT')
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } catch (error) {
    failIfLocked(error)
    throw error
  }
  const backup = `${databaseFile}.before-legacy-inquiry-cancel.bak-${Date.now()}`
  copyFileSync(databaseFile, backup)
  console.log(`Backup written: ${backup}`)

  db.exec('BEGIN IMMEDIATE')
  try {
    // Re-plan inside the exclusive transaction so nothing can have changed since the dry check.
    for (const { id, next } of plan(Date.now()).filter(p => p.next !== null)) {
      const changed = db.prepare('UPDATE u_dsh_pet_inquiries SET value = ? WHERE key = ?').run(JSON.stringify(next), id).changes
      if (changed !== 1) throw new Error(`${id}: update touched ${changed} rows`)
      const check = parseInquiry(JSON.parse(db.prepare('SELECT value FROM u_dsh_pet_inquiries WHERE key = ?').get(id).value))
      if (check.status !== 'cancelled' || check.reason !== REASON || check.question !== next.question) throw new Error(`${id}: verification failed`)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    fail(`Rolled back, nothing written: ${error.message}`)
  }
  console.log(`✓ Cancelled ${pending.length} legacy inquir${pending.length === 1 ? 'y' : 'ies'}. Start DSH and check the inquiry-reconcile log line.`)
} finally {
  db.close()
}
