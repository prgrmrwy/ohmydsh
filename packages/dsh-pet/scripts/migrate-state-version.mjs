#!/usr/bin/env node
/**
 * Offline Pet state migration (v2..v19 -> v20): one isomorphic row per locus
 * entry (openspec pet-locus-isomorphic-entries, design D13).
 *
 * Why this exists as a standalone script rather than in-process migration: the
 * SQLite backend opens Pet's database with `PRAGMA locking_mode = EXCLUSIVE`,
 * so a running DSH Host owns the file and nothing else can touch it. A database
 * stamped below the descriptor version fails `storageDomain.open` on every
 * boot, so Pet stays unready until this script has run while DSH is STOPPED.
 *
 * Two proofs, never one function standing in for both:
 *   - The v19 (old-shape) preflight is this script's own analysis of the rows
 *     it reads (`analyseV19Shape`). Below 19 the v19 purge runs first: rows
 *     whose `parentSessionId` has no `locus_mains` record are previous-model
 *     and are deleted with the deliveries, notices, audit rows and operations
 *     that reference them.
 *   - The shaped result is checked by the Host's v20
 *     `validateLocusSetForStorage`, loaded from this package's `lib/`, inside
 *     the transaction just before COMMIT. A violation rolls everything back.
 *
 * Shaping (all in one transaction):
 *   loci          latest generation per entry, keyed by entry key, old `id` as
 *                 `locusId`; retired -> stopped; sessionId = child ?? reserved
 *                 ?? fresh `session-<uuid>`; accessMode danger-full-access only
 *                 for effective write + shell; revision kept (missing = 0).
 *                 Topic rows follow their group row's M (in-place rebuild when
 *                 it differed); chats whose group sits on a retired pairing of
 *                 a W that has exactly one active pairing move to that M with
 *                 the resetChat rule. Then default-qa pointers become group-row
 *                 `defaultQa` flags (several candidates under one M: none).
 *   deliveries    all kept: `generation` dropped, `childSessionId` -> `sessionId`.
 *   locus_indexes, locus_switch_notices, locus_operations   emptied.
 *   locus_permission_audit   untouched (except the <19 purge).
 *   Every non-locus table is never written.
 *
 * Order of events: read-only pre-flight (all `--dry-run` and an unconfirmed
 * run do) -> `--yes`: exclusive lock held to the end, re-read and re-check ->
 * WAL checkpoint -> backup `state.sqlite.v<N>.bak-<ms>` -> one transaction.
 *
 * Usage:
 *   dsh-pet-migrate-state [--db <path>] [--dry-run] [--yes] [--self-check]
 */

import { existsSync, copyFileSync, writeSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import os from 'node:os'

/** Domain identity; must match src/host/spec.ts. */
const PET_DOMAIN_NAME = 'dsh_pet'
const PET_DOMAIN_VERSION = 20
/** The last version whose `loci` rows have the v19 shape this script analyses. */
const V19 = 19
/** Versions this script is allowed to migrate. v1 needs a separate explicit cleanup. */
const MIGRATABLE = Array.from({ length: V19 - 1 }, (_, index) => index + 2)
/** Must equal `TERMINAL_STATUSES` in src/host/locus/delivery.ts (a test compares them). */
const TERMINAL_DELIVERY_STATUSES = new Set(['settled', 'failed', 'replied', 'no-reply', 'expired', 'unknown-terminal'])
/** The only operation phases that carry no recovery work. `failed` may owe compensation. */
const SETTLED_OPERATION_PHASES = new Set(['committed', 'compensated'])
/** v19 purge: tables whose rows reference a locus id, with the fields to match. */
const REFERENCING_TABLES = [
  ['locus_deliveries', ['locusId']],
  ['locus_switch_notices', ['locusId']],
  ['locus_permission_audit', ['locusId']],
  ['locus_operations', ['locusId', 'oldLocusId', 'newLocusId']],
]
/** Tables v20 empties (all derivable or finished). */
const EMPTIED_TABLES = ['locus_indexes', 'locus_switch_notices', 'locus_operations']
/**
 * Every package module the migration loads, relative to this file. The
 * self-check imports each one, so a missing or unloadable module fails
 * `dsh build` instead of a stopped DSH.
 */
const LIB_MODULES = {
  validator: '../lib/host/locus/locus-set-v20.js',
}

const V19_STATES = new Set(['provisioning', 'not-created', 'active', 'switching', 'invalid', 'stopped', 'retired'])
const V19_SOURCES = new Set(['auto', 'inherited', 'explicit', 'qa-created'])
const V19_UNAVAILABLE = new Set(['invalid', 'stopped', 'retired'])

const physical = name => `u_${PET_DOMAIN_NAME}_${name}`

function parseArgs(argv) {
  const args = { dryRun: false, yes: false, db: undefined, help: false, selfCheck: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--yes' || arg === '-y') args.yes = true
    else if (arg === '--db') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('-')) throw new Error('--db requires a path value.')
      args.db = value
      i += 1
    } else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--self-check') args.selfCheck = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (args.dryRun && args.yes) throw new Error('Choose either --dry-run or --yes, not both.')
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

/** Load every package module; paths are relative to THIS file (works via `.bin`). */
async function loadModules() {
  const loaded = {}
  for (const [name, relative] of Object.entries(LIB_MODULES)) {
    loaded[name] = await import(new URL(relative, import.meta.url).href)
  }
  if (typeof loaded.validator.validateLocusSetForStorage !== 'function' || typeof loaded.validator.endpointKeyV20 !== 'function') {
    throw new Error(`${LIB_MODULES.validator} does not export validateLocusSetForStorage and endpointKeyV20`)
  }
  return loaded
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
    `  Shapes Pet state into version ${PET_DOMAIN_VERSION} (one row per locus entry). Run with DSH stopped.\n` +
    '  --dry-run  read-only: list what would change, or why the migration is refused\n' +
    '  --yes      take the exclusive lock, write a backup, then migrate\n' +
    '  --self-check  only load the migration modules (no database); used by dsh build',
  )
  process.exit(0)
}

// Deploy-time smoke check: load exactly what a real migration loads, without
// touching any database.
if (args.selfCheck) {
  for (const [name, relative] of Object.entries(LIB_MODULES)) {
    try {
      await import(new URL(relative, import.meta.url).href)
    } catch (error) {
      fail(`self-check: cannot load the ${name} module ${relative} from this package: ${error.message}`)
    }
    console.log(`  loaded ${relative}`)
  }
  try {
    await loadModules()
  } catch (error) {
    fail(`self-check: ${error.message}`)
  }
  console.log('✓ self-check: migration modules load standalone')
  process.exit(0)
}

const databaseFile = args.db ?? defaultDatabaseFile()

// Never create the file: an absent database is a first boot.
if (!existsSync(databaseFile)) {
  fail(`Pet database not found at ${databaseFile}; nothing to migrate.`)
}

console.log(`Pet database: ${databaseFile}`)

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
    return new DatabaseSync(databaseFile, { timeout: 3000, ...options })
  } catch (error) {
    failIfLocked(error)
    return fail(`Could not open Pet database: ${error.message}`)
  }
}

function readVersion(db) {
  const stamped = guarded(() => db.prepare('SELECT version FROM units WHERE name = ?').get(PET_DOMAIN_NAME))
  if (stamped === undefined) fail(`No '${PET_DOMAIN_NAME}' unit row found; refusing to guess a version.`)
  return stamped.version
}

function tableExists(db, table) {
  return guarded(() => db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?").get(physical(table))) !== undefined
}

/** `{ key, value }` rows of one logical table; a table that does not exist yet has none. */
function readRows(db, table) {
  return guarded(() => (tableExists(db, table)
    ? db.prepare(`SELECT key, value FROM "${physical(table)}" ORDER BY key`).all()
    : []))
}

function describeEndpoint(endpoint) {
  if (endpoint === null || typeof endpoint !== 'object') return '(no endpoint)'
  return `${String(endpoint.chatId)}${endpoint.threadId === undefined ? '' : `#${String(endpoint.threadId)}`}`
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isId = value => typeof value === 'string' && value.trim() !== ''
const isTime = value => Number.isSafeInteger(value) && value >= 0
const isTopic = row => row.endpoint.threadId !== undefined

// -- the v19 (old-shape) analysis ------------------------------------------------

/**
 * The v19 load conditions over the retained `loci` rows, as this script's own
 * analysis: per-row shape, pairing, and the set rules the v19 Host enforced
 * (topic parents, contiguous generations, one current row per endpoint, unique
 * child, one workspace per parent, at most one active pairing per W).
 */
function analyseV19Shape(rows, mains) {
  const violations = []
  const parsed = new Map()
  for (const [key, row] of rows) {
    const problems = []
    if (!isObject(row)) problems.push('not an object')
    else {
      if (!isId(row.id)) problems.push('no id')
      else if (key !== row.id) problems.push(`stored under a key that does not match its id ${row.id}`)
      if (!Number.isSafeInteger(row.generation) || row.generation < 1) problems.push('generation is not a positive integer')
      if (!isObject(row.endpoint) || !isId(row.endpoint.chatId) ||
          (row.endpoint.threadId !== undefined && !isId(row.endpoint.threadId))) problems.push('endpoint is malformed')
      if (!isId(row.parentSessionId)) problems.push('no parentSessionId')
      if (!isId(row.workspaceId)) problems.push('no workspaceId')
      if (!V19_SOURCES.has(row.source)) problems.push(`unknown source '${String(row.source)}'`)
      if (!V19_STATES.has(row.state)) problems.push(`unknown state '${String(row.state)}'`)
      if (!isObject(row.permission) || !['read', 'write'].includes(row.permission.effective)) problems.push('permission is malformed')
      if (typeof row.busy !== 'boolean') problems.push('busy is not a boolean')
      if (!isTime(row.createdAt) || !isTime(row.updatedAt) || row.updatedAt < row.createdAt) problems.push('timestamps are not ordered non-negative integers')
      if (row.childComposition !== undefined && row.childComposition !== 'tier3') problems.push(`child composition '${String(row.childComposition)}' is not tier3`)
      if (row.state === 'active' && (row.childComposition !== 'tier3' || !isId(row.childSessionId))) problems.push('an active row requires a tier3 child')
      if (isObject(row.endpoint)) {
        if (row.endpoint.threadId !== undefined && !isId(row.parentLocusId)) problems.push('topic row requires parentLocusId')
        if (row.endpoint.threadId === undefined && row.parentLocusId !== undefined) problems.push('chat-level row cannot carry parentLocusId')
      }
      if (isId(row.parentSessionId) && !mains.has(row.parentSessionId)) {
        problems.push(`has no locus_mains pairing for its parent session ${row.parentSessionId}`)
      }
    }
    if (problems.length > 0) violations.push(`locus row ${key} is not a valid v${V19} row: ${problems.join('; ')}`)
    else parsed.set(key, row)
  }
  if (parsed.size !== rows.size) return violations // set rules on a broken set only mislead

  const generations = new Map()
  const current = new Map()
  const children = new Map()
  const workspaces = new Map()
  for (const row of parsed.values()) {
    const entry = describeEndpoint(row.endpoint)
    if (row.parentLocusId !== undefined) {
      const parent = parsed.get(row.parentLocusId)
      if (parent === undefined) {
        violations.push(`locus row ${row.id} (${entry}): parent locus ${row.parentLocusId} does not exist, so the topic row has no group row`)
      } else if (isTopic(parent) || parent.endpoint.chatId !== row.endpoint.chatId) {
        violations.push(`locus row ${row.id} (${entry}): parent locus ${row.parentLocusId} is not the chat-level row of ${row.endpoint.chatId}`)
      }
    }
    generations.set(entry, [...(generations.get(entry) ?? []), row.generation])
    if (!V19_UNAVAILABLE.has(row.state)) {
      if (current.has(entry)) violations.push(`endpoint ${entry} has two current rows: ${current.get(entry)} and ${row.id}`)
      current.set(entry, row.id)
    }
    if (row.childSessionId !== undefined) {
      if (children.has(row.childSessionId)) violations.push(`child session ${row.childSessionId} belongs to ${children.get(row.childSessionId)} and ${row.id}`)
      children.set(row.childSessionId, row.id)
    }
    const workspace = workspaces.get(row.parentSessionId)
    if (workspace !== undefined && workspace !== row.workspaceId) {
      violations.push(`parent ${row.parentSessionId} is associated with workspaces ${workspace} and ${row.workspaceId}`)
    }
    workspaces.set(row.parentSessionId, row.workspaceId)
  }
  for (const [entry, list] of generations) {
    const sorted = [...list].sort((left, right) => left - right)
    if (new Set(sorted).size !== sorted.length) violations.push(`endpoint ${entry} has a duplicate locus generation`)
    else if (sorted.some((value, index) => index > 0 && value !== sorted[index - 1] + 1)) {
      violations.push(`locus generations for endpoint ${entry} must advance contiguously`)
    }
  }
  const activeByWork = new Map()
  for (const main of mains.values()) {
    if (main?.status === 'active') activeByWork.set(main.workSessionId, [...(activeByWork.get(main.workSessionId) ?? []), main.locusMainSessionId])
  }
  for (const [work, list] of activeByWork) {
    if (list.length > 1) violations.push(`work session ${work} has ${list.length} active locus mains: ${list.join(', ')}`)
  }
  return violations
}

/** The v20 refusals that v19 allowed or could not express. */
function analyseV20Refusals(rows) {
  const violations = []
  const groups = new Set([...rows.values()].filter(row => !isTopic(row)).map(row => row.endpoint.chatId))
  for (const row of rows.values()) {
    if (row.state === 'switching' || row.state === 'provisioning') {
      violations.push(`locus row ${row.id} (${describeEndpoint(row.endpoint)}) is in state '${row.state}'; finish or recover it with a current Host first`)
    }
    if (!isTopic(row) && row.source === 'inherited') {
      violations.push(`locus row ${row.id} (${describeEndpoint(row.endpoint)}) is a group row with source 'inherited'`)
    }
    if (isTopic(row) && !groups.has(row.endpoint.chatId)) {
      violations.push(`locus row ${row.id} (${describeEndpoint(row.endpoint)}) is a topic row with no group row for chat ${row.endpoint.chatId}`)
    }
  }
  return violations
}

// -- the v20 shaping -------------------------------------------------------------

/** The latest generation of every entry (ties broken like the v19 Host). */
function latestPerEntry(rows, entryKey) {
  const latest = new Map()
  for (const row of rows.values()) {
    const key = entryKey(row.endpoint)
    const previous = latest.get(key)
    if (previous === undefined || row.generation > previous.generation ||
        (row.generation === previous.generation && row.id.localeCompare(previous.id) > 0)) latest.set(key, row)
  }
  return latest
}

/** One v19 row in v20 shape, before any merge. */
function shapeRow(row, groupMain, fresh) {
  const state = row.state === 'retired' ? 'stopped' : row.state
  let sessionId = row.childSessionId ?? row.reservedChildSessionId
  if (sessionId === undefined) {
    sessionId = `session-${randomUUID()}`
    fresh.push(row)
  }
  const full = row.permission?.effective === 'write' && row.toolTier?.effective === 'shell'
  const shaped = {
    endpoint: isTopic(row) ? { chatId: row.endpoint.chatId, threadId: row.endpoint.threadId } : { chatId: row.endpoint.chatId },
    locusId: row.id,
    sessionId,
    state,
    accessMode: full ? 'danger-full-access' : 'read-only',
    // Who granted it is carried; `verifiedAt` is not: no readback happened offline,
    // and the next composition verifies anyway.
    ...(full && row.permission.grantedBy !== undefined ? { grantedBy: row.permission.grantedBy } : {}),
    revision: Number.isSafeInteger(row.revision) && row.revision >= 0 ? row.revision : 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(state === 'stopped' ? { stoppedAt: row.retiredAt ?? row.stoppedAt ?? row.updatedAt } : {}),
    ...(state === 'invalid' ? { invalidReason: row.invalidReason ?? 'invalid before the v20 migration (reason not recorded)' } : {}),
  }
  if (!isTopic(row)) {
    shaped.locusMainSessionId = groupMain
    shaped.workspaceId = row.workspaceId
  }
  return shaped
}

/** The resetChat rule on one shaped row (design D17): `updatedAt` = migration time, `createdAt` kept. */
function resetRow(row, at) {
  const { verifiedAt: _verifiedAt, grantedBy: _grantedBy, invalidReason: _invalidReason, ...rest } = row
  const updatedAt = Math.max(row.updatedAt, at)
  if (row.state === 'stopped') return { ...rest, accessMode: 'read-only', revision: row.revision + 1, updatedAt }
  const { stoppedAt: _stoppedAt, ...live } = rest
  return { ...live, sessionId: `session-${randomUUID()}`, state: 'not-created', accessMode: 'read-only', revision: row.revision + 1, updatedAt }
}

/**
 * Turn the retained v19 rows into the v20 `loci` table plus the plan to print.
 * Order: same-W cross-pairing merge and topic M merge, then default-Q&A mapping.
 */
function shape(retained, mains, indexRows, entryKey, migratedAt) {
  const latest = latestPerEntry(retained, entryKey)
  const finalMain = new Map() // chatId -> M of its group row after the merge
  const reset = new Set() // entry keys
  const topicMerges = []
  const chatMerges = []
  const chatsLeft = []

  for (const row of latest.values()) {
    if (isTopic(row)) continue
    const pairing = mains.get(row.parentSessionId)
    let target = row.parentSessionId
    if (pairing?.status === 'retired') {
      const active = [...mains.values()].filter(main => main?.workSessionId === pairing.workSessionId && main.status === 'active')
      if (active.length === 1) {
        target = active[0].locusMainSessionId
        const entries = [...latest.entries()].filter(([, other]) => other.endpoint.chatId === row.endpoint.chatId)
        for (const [entry] of entries) reset.add(entry)
        chatMerges.push({ chatId: row.endpoint.chatId, groupId: row.id, from: row.parentSessionId, to: target, work: pairing.workSessionId, reset: entries.map(([, other]) => other.id) })
      } else {
        chatsLeft.push({ chatId: row.endpoint.chatId, groupId: row.id, from: row.parentSessionId, work: pairing.workSessionId })
      }
    }
    finalMain.set(row.endpoint.chatId, target)
  }
  for (const [key, row] of latest) {
    if (!isTopic(row)) continue
    const group = latest.get(entryKey({ chatId: row.endpoint.chatId }))
    if (row.parentSessionId !== group.parentSessionId) {
      reset.add(key)
      topicMerges.push({ id: row.id, endpoint: describeEndpoint(row.endpoint), from: row.parentSessionId, to: finalMain.get(row.endpoint.chatId) })
    }
  }

  const fresh = []
  const shaped = new Map()
  for (const [key, row] of latest) {
    const base = shapeRow(row, isTopic(row) ? undefined : finalMain.get(row.endpoint.chatId), fresh)
    shaped.set(key, reset.has(key) ? resetRow(base, migratedAt) : base)
  }

  // default-qa pointers: locusIds[0] -> original row (any generation) -> latest
  // row of that entry, which must be a group row. The index key is never parsed.
  const byId = new Map([...retained.values()].map(row => [row.id, row]))
  const cleared = []
  const candidates = new Map() // M -> [{pointer, locusId, entry}]
  for (const { key, value } of indexRows) {
    if (value?.kind !== 'default-qa') continue
    const pointer = typeof value.key === 'string' && value.key !== '' ? value.key : key
    const locusId = Array.isArray(value.locusIds) ? value.locusIds[0] : undefined
    const original = byId.get(locusId)
    if (original === undefined) { cleared.push({ pointer, locusId, reason: 'no such locus row' }); continue }
    const entry = entryKey(original.endpoint)
    const target = shaped.get(entry)
    if (target === undefined || target.endpoint.threadId !== undefined) {
      cleared.push({ pointer, locusId, reason: "the entry's latest row is a topic row" })
      continue
    }
    const list = candidates.get(target.locusMainSessionId) ?? []
    list.push({ pointer, locusId, entry })
    candidates.set(target.locusMainSessionId, list)
  }
  const flagged = []
  for (const [main, list] of candidates) {
    const distinct = new Set(list.map(item => item.entry))
    if (distinct.size > 1) {
      for (const item of list) cleared.push({ pointer: item.pointer, locusId: item.locusId, reason: `one of ${distinct.size} candidates under M ${main}` })
      continue
    }
    const [entry] = distinct
    shaped.set(entry, { ...shaped.get(entry), defaultQa: true })
    flagged.push({ entry, main })
  }

  return {
    rows: shaped,
    historyDropped: retained.size - latest.size,
    topicMerges, chatMerges, chatsLeft, fresh, flagged, cleared,
  }
}

/** One delivery row in v20 shape: `generation` dropped, `childSessionId` -> `sessionId`. */
function shapeDelivery(value) {
  const { generation: _generation, childSessionId, ...rest } = value
  return childSessionId === undefined ? rest : { ...rest, sessionId: childSessionId }
}

/**
 * Everything a decision needs, from one consistent read.
 *
 * @param db - an open connection (read-only pre-flight, or the locked one).
 * @param version - the stamped version.
 * @param modules - the loaded package modules.
 * @returns the purge, the shaping plan, and every reason to refuse.
 */
function analyse(db, version, modules) {
  const violations = []
  const json = (table, row) => {
    try {
      return JSON.parse(row.value)
    } catch {
      violations.push(`${table} row ${row.key}: value is not valid JSON`)
      return undefined
    }
  }
  const mains = new Map()
  for (const row of readRows(db, 'locus_mains')) mains.set(row.key, json('locus_mains', row))

  // v19 purge (sources below 19 only). A row we cannot attribute is never guessed at.
  const retained = new Map()
  const removed = []
  for (const row of readRows(db, 'loci')) {
    const value = json('loci', row)
    if (value === undefined) continue
    if (!isObject(value) || typeof value.parentSessionId !== 'string') {
      violations.push(`loci row ${row.key}: unreadable (no parentSessionId); refusing to guess its model`)
    } else if (version < V19 && !mains.has(value.parentSessionId)) {
      removed.push({ id: row.key, endpoint: describeEndpoint(value.endpoint) })
    } else {
      retained.set(row.key, value)
    }
  }
  const purged = new Set(removed.map(row => row.id))
  const deletions = { loci: removed.map(row => row.id) }
  const keptDeliveries = []
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
      if (fields.some(field => typeof value?.[field] === 'string' && purged.has(value[field]))) deletions[table].push(row.key)
      else if (table === 'locus_deliveries') keptDeliveries.push({ key: row.key, value })
    }
  }
  const indexRows = []
  for (const row of readRows(db, 'locus_indexes')) {
    const value = json('locus_indexes', row)
    if (value !== undefined) indexRows.push({ key: row.key, value })
  }

  violations.push(...analyseV19Shape(retained, mains))
  if (violations.length > 0) return { violations }
  violations.push(...analyseV20Refusals(retained))
  if (violations.length > 0) return { violations }

  const plan = shape(retained, mains, indexRows, modules.validator.endpointKeyV20, Date.now())
  const emptied = Object.fromEntries(EMPTIED_TABLES.map(table => [table, readRows(db, table).length - (deletions[table]?.length ?? 0)]))
  return { violations, removed, deletions, keptDeliveries, plan, emptied, mainIds: new Set(mains.keys()) }
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

function printPlan(version, analysis) {
  const { plan } = analysis
  if (version < V19) {
    console.log(`Previous-model locus rows to delete (parent has no locus_mains record): ${analysis.removed.length}`)
    for (const row of analysis.removed) console.log(`  - ${row.id}  (${row.endpoint})`)
    console.log('Rows to delete by table:')
    for (const [table, keys] of Object.entries(analysis.deletions)) console.log(`  ${table}: ${keys.length}`)
  }
  console.log(`Topic rows merged onto their group row's M (in-place rebuild; the old child context is not carried over): ${plan.topicMerges.length}`)
  for (const item of plan.topicMerges) console.log(`  - ${item.id} (${item.endpoint}) M ${item.from} → ${item.to}`)
  console.log(`Chats merged onto their W's unique active pairing (the context of the reset entries is not carried over): ${plan.chatMerges.length}`)
  for (const item of plan.chatMerges) {
    console.log(`  - ${item.chatId} (group ${item.groupId}) pairing ${item.from} (retired) → ${item.to}, W ${item.work}; reset: ${item.reset.join(', ')}`)
  }
  console.log(`Chats left on a retired pairing (no merge; the runtime whole-W migration handles them): ${plan.chatsLeft.length}`)
  for (const item of plan.chatsLeft) {
    console.log(`  - ${item.chatId} (group ${item.groupId}) pairing ${item.from} (retired), W ${item.work} has no active pairing`)
  }
  console.log(`Default Q&A flags set: ${plan.flagged.length}`)
  for (const item of plan.flagged) console.log(`  - ${item.entry} (M ${item.main})`)
  console.log(`Default Q&A pointers cleared: ${plan.cleared.length}`)
  for (const item of plan.cleared) console.log(`  - ${item.pointer} → ${String(item.locusId)}: ${item.reason}`)
  console.log(`Fresh reserved sessionIds (row had no child or reserved id): ${plan.fresh.length}`)
  for (const row of plan.fresh) console.log(`  - ${row.id} (${describeEndpoint(row.endpoint)})`)
  console.log('v20 shaping:')
  console.log(`  entries: ${plan.rows.size}`)
  console.log(`  history rows dropped: ${plan.historyDropped}`)
  console.log(`  deliveries rewritten: ${analysis.keptDeliveries.length}`)
  for (const [table, count] of Object.entries(analysis.emptied)) console.log(`  ${table} emptied: ${count}`)
  console.log('locus_permission_audit is left unchanged.')
}

function predictedViolations(analysis, validate) {
  const rows = new Map([...analysis.plan.rows].map(([key, value]) => [key, JSON.parse(JSON.stringify(value))]))
  return validate(rows, analysis.mainIds)
}

// -- version gate (shared by the pre-flight and the locked re-check) ------------

function gateVersion(current) {
  console.log(`Stamped version: ${current}  →  target: ${PET_DOMAIN_VERSION}`)
  if (current === PET_DOMAIN_VERSION) {
    console.log('✓ Already at the target version; nothing to do.')
    process.exit(0)
  }
  if (current === 1) {
    fail(
      'Version 1 requires a separate explicit legacy cleanup (it drops rows ' +
      `that reference a removed store layout); this CLI only migrates v2..v${V19}.`,
    )
  }
  if (!MIGRATABLE.includes(current) && current !== V19) {
    fail(`Unsupported Pet storage version ${current}; refusing migration.`)
  }
}

// -- 1. read-only pre-flight ----------------------------------------------------

const preflight = openDatabase({ readOnly: true })
let modules
let plan
let planVersion
try {
  planVersion = readVersion(preflight)
  gateVersion(planVersion)
  try {
    modules = await loadModules()
  } catch (error) {
    fail(`Could not load the Host's v20 row validation from this package's lib/: ${error.message}\n  Build the package (npm run build) or reinstall it.`)
  }
  plan = analyse(preflight, planVersion, modules)
} finally {
  preflight.close()
}

if (plan.violations.length > 0) refuse(plan.violations)
printPlan(planVersion, plan)

if (args.dryRun) {
  const predicted = predictedViolations(plan, modules.validator.validateLocusSetForStorage)
  if (predicted.length > 0) {
    console.error('✗ The shaped result would fail the v20 validation; a --yes run would roll back:')
    for (const violation of predicted) console.error(`  - ${violation.code} ${violation.key}: ${violation.message}`)
    process.exit(1)
  }
  console.log(`\n[dry-run] Would migrate ${planVersion} → ${PET_DOMAIN_VERSION}. No write performed.`)
  console.log('Re-run with --yes while DSH remains stopped to perform the migration.')
  process.exit(0)
}

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
  // commit: the lock is kept until this connection closes.
  guarded(() => {
    db.exec('BEGIN IMMEDIATE')
    db.exec('PRAGMA locking_mode = EXCLUSIVE')
    db.exec('COMMIT')
  })

  const current = readVersion(db)
  gateVersion(current) // already 20 → exit 0; changed to something unsupported → refuse
  const locked = analyse(db, current, modules)
  if (locked.violations.length > 0) refuse(locked.violations)

  // -- 3. checkpoint, then a full snapshot before any change -------------------
  guarded(() => db.exec('PRAGMA wal_checkpoint(TRUNCATE)'))
  const backup = `${databaseFile}.v${current}.bak-${Date.now()}`
  copyFileSync(databaseFile, backup)
  console.log(`Backup written: ${backup}`)

  // -- 4. the one mutating transaction -----------------------------------------
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS "${physical('locus_mains')}" (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`)
    db.exec(`CREATE TABLE IF NOT EXISTS "${physical('loci')}" (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`)
    for (const [table, keys] of Object.entries(locked.deletions)) {
      if (keys.length === 0) continue
      const remove = db.prepare(`DELETE FROM "${physical(table)}" WHERE key = ?`)
      for (const key of keys) remove.run(key)
    }
    db.exec(`DELETE FROM "${physical('loci')}"`)
    const putLocus = db.prepare(`INSERT INTO "${physical('loci')}" (key, value) VALUES (?, ?)`)
    for (const [key, row] of locked.plan.rows) putLocus.run(key, JSON.stringify(row))
    if (locked.keptDeliveries.length > 0) {
      const putDelivery = db.prepare(`UPDATE "${physical('locus_deliveries')}" SET value = ? WHERE key = ?`)
      for (const { key, value } of locked.keptDeliveries) putDelivery.run(JSON.stringify(shapeDelivery(value)), key)
    }
    for (const table of EMPTIED_TABLES) {
      if (tableExists(db, table)) db.exec(`DELETE FROM "${physical(table)}"`)
    }
    db.prepare('UPDATE units SET version = ? WHERE name = ?').run(PET_DOMAIN_VERSION, PET_DOMAIN_NAME)
    const after = db.prepare('SELECT version FROM units WHERE name = ?').get(PET_DOMAIN_NAME)
    if (after?.version !== PET_DOMAIN_VERSION) throw new Error(`Version stamp did not take effect (still ${after?.version}).`)

    // The v20 proof, over what is actually stored now.
    const stored = new Map(db.prepare(`SELECT key, value FROM "${physical('loci')}"`).all().map(row => [row.key, JSON.parse(row.value)]))
    const mainIds = new Set(db.prepare(`SELECT key FROM "${physical('locus_mains')}"`).all().map(row => row.key))
    const violations = modules.validator.validateLocusSetForStorage(stored, mainIds)
    if (violations.length > 0) {
      const error = new Error(`the shaped result fails the v20 validation:\n${violations.map(item => `  - ${item.code} ${item.key}: ${item.message}`).join('\n')}`)
      error.validation = true
      throw error
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    if (error.validation === true) {
      fail(`Migration rolled back; version and every row are unchanged. The backup is kept at ${backup}.\n  Reason: ${error.message}`)
    }
    throw error
  }

  console.log(`✓ Migrated ${current} → ${PET_DOMAIN_VERSION}: ${locked.plan.rows.size} entr${locked.plan.rows.size === 1 ? 'y' : 'ies'}, ${locked.plan.historyDropped} history row(s) dropped`)
  if (current < V19) {
    console.log(`  removed ${locked.removed.length} previous-model locus row(s)`)
    for (const [table, keys] of Object.entries(locked.deletions)) console.log(`  ${table}: ${keys.length}`)
  }
  console.log('\nStart DSH and confirm the log shows `[dsh-pet] ready`.')
} finally {
  db.close()
}
