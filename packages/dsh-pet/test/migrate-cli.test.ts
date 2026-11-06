/**
 * `dsh-pet-migrate-state` CLI contract and refusal gates, target v20.
 *
 * Arguments, locking, unsupported versions, confirmation, and the preflight /
 * locked re-check refusals. The v20 shaping itself is covered by
 * migrate-cli-v20.test.ts. Databases are real SQLite files in temp
 * directories, seeded with raw v19 bytes (support/v19-seed.ts); the live state
 * file is never an input. The script loads the v20 validator from `lib/`, so
 * these tests need a built package (`npm run build:host`).
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isTerminalDeliveryStatus } from '../src/host/locus/delivery.js'
import { PET_DOMAIN_VERSION, petLocusDeliveryBase, petLocusOperation } from '../src/host/spec.js'
import { openMigratedDomain } from './support/pet-domain-open.js'
import { snapshotPetTables, stampedVersion, tempPetHome } from './support/pet-sqlite.js'
import { seedV19State, v19Delivery, v19Generations, v19Main, v19Row, type V19Rows } from './support/v19-seed.js'

const SCRIPT = new URL('../scripts/migrate-state-version.mjs', import.meta.url).pathname

/** A previous-model row: its parent is the owner's own session, which has no locus_mains record. */
function previousModel(id: string, chatId: string): Record<string, unknown> {
  return { ...v19Row({ id, chatId, main: 'user-session', source: 'explicit' }), childComposition: 'safe-v2' }
}

/** v18: three previous-model rows, four terminal Deliveries on them, two three-tier rows. */
function worldRows(): V19Rows {
  return {
    locus_mains: { 'main-1': v19Main({ id: 'main-1' }) },
    loci: {
      'old-1': previousModel('old-1', 'oc_old1'),
      'old-2': previousModel('old-2', 'oc_old2'),
      'old-3': previousModel('old-3', 'oc_old3'),
      'keep-1': v19Row({ id: 'keep-1', chatId: 'oc_keep1' }),
      'keep-2': v19Row({ id: 'keep-2', chatId: 'oc_keep2' }),
    },
    locus_deliveries: {
      'd-1': v19Delivery('d-1', 'old-1', 'child-old-1'),
      'd-2': v19Delivery('d-2', 'old-1', 'child-old-1'),
      'd-3': v19Delivery('d-3', 'old-2', 'child-old-2'),
      'd-4': v19Delivery('d-4', 'old-3', 'child-old-3'),
      'd-keep': v19Delivery('d-keep', 'keep-1', 'child-keep-1'),
    },
    chat_bindings: { oc_legacy: { opaque: 'legacy chat binding naming old-1', locusId: 'old-1' } },
  }
}

async function plant(version: number, rows: V19Rows) {
  const { home, file } = tempPetHome('pet-migrate-cli-')
  await seedV19State(file, version, rows)
  return { dir: path.dirname(file), home, file }
}

function run(file: string, ...flags: string[]) {
  return spawnSync(process.execPath, [SCRIPT, '--db', file, ...flags], { encoding: 'utf8' })
}

const backupsOf = (dir: string): string[] => readdirSync(dir).filter(name => name.includes('.bak-'))

/** Bytes of the main file plus any WAL: "nothing was written" means both. */
function bytesOf(file: string): Buffer[] {
  return [file, `${file}-wal`].map(item => (existsSync(item) ? readFileSync(item) : Buffer.alloc(0)))
}

function expectUntouched(file: string, dir: string, before: Buffer[]): void {
  expect(bytesOf(file)).toEqual(before)
  expect(backupsOf(dir)).toEqual([])
}

/**
 * Run `--yes` while another writer holds the database, and let that writer
 * commit `inject` only AFTER the script has finished its read-only pre-flight.
 */
async function runWithWriterInWindow(file: string, inject: (holder: DatabaseSync) => void) {
  const holder = new DatabaseSync(file, { timeout: 3000 })
  holder.exec('BEGIN IMMEDIATE')
  const child = spawn(process.execPath, [SCRIPT, '--db', file, '--yes'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += String(chunk) })
  const announced = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no pre-flight announcement; stdout=${stdout} stderr=${stderr}`)), 10_000)
    child.stdout.on('data', chunk => {
      stdout += String(chunk)
      if (stdout.includes('Preflight passed')) { clearTimeout(timer); resolve() }
    })
  })
  const closed = new Promise<number | null>(resolve => child.on('close', resolve))
  try {
    await announced
    inject(holder)
    holder.exec('COMMIT')
  } finally {
    holder.close()
  }
  return { status: await closed, stdout, stderr }
}

// -- arguments, locking, unsupported versions ------------------------------------

describe('dsh-pet-migrate-state CLI', () => {
  it.each([5, 14, 15, 17, 19])('checks a v%s migration without writing in --dry-run mode', async version => {
    const { dir, file } = await plant(version, {})
    const before = bytesOf(file)
    const output = execFileSync(process.execPath, [SCRIPT, '--db', file, '--dry-run'], { encoding: 'utf8' })

    expect(output).toContain(`[dry-run] Would migrate ${version} → ${PET_DOMAIN_VERSION}`)
    expect(output).toContain('Re-run with --yes')
    expect(stampedVersion(file)).toBe(version)
    expectUntouched(file, dir, before)
  })

  it('targets domain version 20', () => {
    expect(PET_DOMAIN_VERSION).toBe(20)
  })

  it.each([
    [['--dryrun'], 'Unknown argument'],
    [['--db'], '--db requires a path value'],
    [['--dry-run', '--yes'], 'either --dry-run or --yes'],
  ] as const)('rejects ambiguous arguments %j', (args, message) => {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(message)
  })

  it('fails closed while a Host-like owner holds the database lock', async () => {
    const { dir, file } = await plant(19, {})
    const owner = new DatabaseSync(file)
    owner.exec('PRAGMA locking_mode = EXCLUSIVE')
    owner.exec('BEGIN IMMEDIATE')
    try {
      const result = run(file, '--yes')
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('database is locked')
      expect(result.stderr).toContain('Stop DSH first')
      expect(backupsOf(dir)).toEqual([])
    } finally {
      owner.exec('ROLLBACK')
      owner.close()
    }
    expect(stampedVersion(file)).toBe(19)
  })

  it.each([1, 0, -1, PET_DOMAIN_VERSION + 1, 999])('refuses unsupported v%s without backup or mutation', async version => {
    const { dir, file } = await plant(version, {})
    const before = bytesOf(file)
    const result = run(file, '--yes')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(version === 1 ? 'separate explicit legacy cleanup' : 'Unsupported Pet storage version')
    expectUntouched(file, dir, before)
  })

  it('never creates a database that does not exist', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pet-migrate-cli-'))
    const result = run(path.join(dir, 'state.sqlite'), '--yes')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('nothing to migrate')
    expect(readdirSync(dir)).toEqual([])
  })

  it('backs up each older version, stamps it, keeps non-locus history byte for byte, and is idempotent', async () => {
    for (const version of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]) {
      const { dir, file } = await plant(version, {
        chat_bindings: { retained: { parentSessionId: 'parent', contextAnchor: { projectResources: ['local-only'] } } },
        invocation_channel: { retained: { opaque: true } },
        inquiries: { 'inq-1': { opaque: 'inquiry payload', futureField: [1, 2, 3] } },
        inquiry_results: { 'res-1': { opaque: 'result payload', status: 'unknown-future-status' } },
      })
      const seed = new DatabaseSync(file)
      seed.prepare('INSERT INTO units VALUES (?, ?)').run('other_domain', 77)
      seed.close()
      const logFile = path.join(dir, 'session.jsonl')
      writeFileSync(logFile, 'old parent and child transcript\n')
      const logBefore = readFileSync(logFile)
      const before = snapshotPetTables(file)

      const first = run(file, '--yes')
      expect(first.status, first.stderr).toBe(0)
      expect(stampedVersion(file)).toBe(PET_DOMAIN_VERSION)
      const backups = backupsOf(dir).filter(name => name.includes(`.v${version}.bak-`))
      expect(backups).toHaveLength(1)
      expect(stampedVersion(path.join(dir, backups[0]!))).toBe(version)
      const after = snapshotPetTables(file)
      for (const table of ['chat_bindings', 'invocation_channel', 'inquiries', 'inquiry_results']) {
        expect(after[table]).toEqual(before[table])
      }
      const migrated = new DatabaseSync(file, { readOnly: true })
      try {
        expect(migrated.prepare('SELECT version FROM units WHERE name = ?').get('other_domain')).toEqual({ version: 77 })
        expect(migrated.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
      } finally { migrated.close() }
      expect(readFileSync(logFile)).toEqual(logBefore)

      const second = run(file, '--yes')
      expect(second.status).toBe(0)
      expect(second.stdout).toContain('Already at the target version')
      expect(backupsOf(dir)).toEqual(backups)
    }
  })
})

// -- the v19 purge below 19, then the refusal gates ------------------------------

describe('the offline migration purges previous-model rows and refuses unfinished work', () => {
  it('lists the previous-model rows a v18 purge deletes in --dry-run, and writes nothing', async () => {
    const { dir, file } = await plant(18, worldRows())
    const before = bytesOf(file)

    const result = run(file, '--dry-run')

    expect(result.status, result.stderr).toBe(0)
    for (const id of ['old-1', 'old-2', 'old-3']) expect(result.stdout).toContain(id)
    expect(result.stdout).not.toMatch(/^\s+- keep-1 /m)
    expect(result.stdout).toMatch(/^\s+loci: 3$/m)
    expect(result.stdout).toMatch(/^\s+locus_deliveries: 4$/m)
    expect(result.stdout).toContain('oc_old1')
    expectUntouched(file, dir, before)
    expect(existsSync(`${file}-wal`)).toBe(false)
  })

  it('--dry-run keeps a WAL with committed frames byte-identical', async () => {
    const { file } = await plant(18, worldRows())
    const wal = new DatabaseSync(file)
    wal.exec('PRAGMA journal_mode = WAL')
    wal.exec('PRAGMA wal_autocheckpoint = 0')
    wal.prepare("INSERT OR REPLACE INTO u_dsh_pet_loci (key, value) VALUES ('old-9', ?)").run(JSON.stringify(previousModel('old-9', 'oc_old9')))
    const copyDir = mkdtempSync(path.join(tmpdir(), 'pet-migrate-wal-'))
    const copy = path.join(copyDir, 'state.sqlite')
    writeFileSync(copy, readFileSync(file))
    writeFileSync(`${copy}-wal`, readFileSync(`${file}-wal`))
    wal.close()
    expect(readFileSync(`${copy}-wal`).length).toBeGreaterThan(0)
    const before = bytesOf(copy)

    const result = run(copy, '--dry-run')

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('old-9')
    expect(bytesOf(copy)).toEqual(before)
    expect(backupsOf(copyDir)).toEqual([])
  })

  it('leaves a database the real Domain opens', async () => {
    const { file } = await plant(18, {
      locus_mains: { 'main-1': v19Main({ id: 'main-1' }) },
      loci: { 'old-1': previousModel('old-1', 'oc_old1'), ...v19Generations({ id: 'keep', chatId: 'oc_keep1' }, 2) },
      locus_deliveries: { 'd-keep': v19Delivery('d-keep', 'keep-g2', 'child-keep-g2') },
      locus_indexes: { 'endpoint:oc_keep1': { kind: 'endpoint-current', key: 'endpoint:oc_keep1', locusIds: ['keep-g2'], updatedAt: 1 } },
    })
    const result = run(file, '--yes')
    expect(result.status, result.stderr).toBe(0)

    const opened = await openMigratedDomain(file)
    await opened.close()
  })

  it('refuses a generation gap left by the purge', async () => {
    const { dir, file } = await plant(18, {
      locus_mains: { 'main-1': v19Main({ id: 'main-1' }) },
      loci: {
        g1: v19Row({ id: 'g1', chatId: 'oc_e', generation: 1, state: 'invalid', child: null }),
        g2: { ...previousModel('g2', 'oc_e'), generation: 2, state: 'invalid' },
        g3: v19Row({ id: 'g3', chatId: 'oc_e', generation: 3, state: 'not-created', child: null, replacesLocusId: 'g2' }),
      },
    })
    const before = bytesOf(file)

    const result = run(file, '--yes')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('oc_e')
    expect(result.stderr).toMatch(/contiguously/)
    expectUntouched(file, dir, before)
  })

  it.each([
    ['a paired row marked safe-v2', (row: Record<string, unknown>) => { row.childComposition = 'safe-v2' }],
    ['a paired active row without a marker', (row: Record<string, unknown>) => { delete row.childComposition }],
    ['a v19 row whose parent has no pairing', (row: Record<string, unknown>) => { row.parentSessionId = 'user-session' }],
  ] as const)('refuses retained rows that do not satisfy the v19 load conditions: %s', async (_name, damage) => {
    const bad = v19Row({ id: 'bad-1', chatId: 'oc_bad' })
    damage(bad)
    const { dir, file } = await plant(19, { locus_mains: { 'main-1': v19Main({ id: 'main-1' }) }, loci: { 'bad-1': bad } })
    const before = bytesOf(file)

    const result = run(file, '--yes')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('bad-1')
    expectUntouched(file, dir, before)
  })

  it('refuses a retained topic whose parentLocusId is purged', async () => {
    const { dir, file } = await plant(18, {
      locus_mains: { 'main-1': v19Main({ id: 'main-1' }) },
      loci: {
        'old-group': previousModel('old-group', 'oc_g'),
        'topic-1': v19Row({ id: 'topic-1', chatId: 'oc_g', threadId: 'omt_1', parentLocusId: 'old-group' }),
      },
    })
    const before = bytesOf(file)

    const result = run(file, '--yes')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('old-group')
    expectUntouched(file, dir, before)
  })

  it('spec Scenario "预检通过后出现非终态投递时锁内拒绝"', async () => {
    const { dir, file } = await plant(18, worldRows())
    const before = snapshotPetTables(file)
    const late = v19Delivery('d-late', 'keep-1', 'child-keep-1', { status: 'queued' })

    const result = await runWithWriterInWindow(file, holder => {
      holder.prepare("INSERT INTO u_dsh_pet_locus_deliveries (key, value) VALUES ('d-late', ?)").run(JSON.stringify(late))
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('d-late')
    expect(result.stderr).toContain('queued')
    expect(backupsOf(dir)).toEqual([]) // refused before checkpoint and backup
    expect(stampedVersion(file)).toBe(18)
    const after = snapshotPetTables(file)
    expect(after.loci).toEqual(before.loci)
    expect(after.locus_deliveries).toEqual([...before.locus_deliveries!, { key: 'd-late', value: JSON.stringify(late) }].sort((a, b) => a.key.localeCompare(b.key)))
  })

  it('spec Scenario "存在非终态投递时拒绝"', async () => {
    const rows = worldRows()
    rows.locus_deliveries = { ...rows.locus_deliveries, 'd-queued': v19Delivery('d-queued', 'keep-2', 'child-keep-2', { status: 'queued' }) }
    const { dir, file } = await plant(18, rows)
    const before = bytesOf(file)

    const result = run(file, '--yes')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('d-queued')
    expect(result.stderr).toContain('queued')
    expect(result.stderr).toContain('needs-recovery') // says how to clear recovery debt
    expectUntouched(file, dir, before)
    expect(stampedVersion(file)).toBe(18)
  })

  it('refuses a non-terminal Delivery on --dry-run too, and writes nothing', async () => {
    const rows = worldRows()
    rows.locus_deliveries = { ...rows.locus_deliveries, 'd-queued': v19Delivery('d-queued', 'old-1', 'child-old-1', { status: 'queued' }) }
    const { dir, file } = await plant(18, rows)
    const before = bytesOf(file)
    const result = run(file, '--dry-run')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('d-queued')
    expectUntouched(file, dir, before)
  })

  it('treats exactly the Host\'s terminal Delivery statuses as finished', async () => {
    const statuses = petLocusDeliveryBase.shape.status.options
    expect(statuses.length).toBeGreaterThan(6)
    for (const status of statuses) {
      const { file } = await plant(19, {
        locus_mains: { 'main-1': v19Main({ id: 'main-1' }) },
        loci: { 'keep-1': v19Row({ id: 'keep-1', chatId: 'oc_keep1' }) },
        locus_deliveries: { 'd-x': { deliveryId: 'd-x', locusId: 'keep-1', status } },
      })
      const result = run(file, '--dry-run')
      expect(result.status === 0, `${status}: ${result.stderr}`).toBe(isTerminalDeliveryStatus(status))
    }
  })

  it('spec Scenario "存在未完成的操作时拒绝"', async () => {
    const rows = worldRows()
    // A provisioning operation carries no locus id at all, so nothing ties it to an entry.
    rows.locus_operations = { 'op-wip': { id: 'op-wip', phase: 'provisioning', endpointKey: 'oc_x' } }
    const { dir, file } = await plant(18, rows)
    const before = bytesOf(file)

    const result = run(file, '--yes')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('op-wip')
    expect(result.stderr).toContain('provisioning')
    expectUntouched(file, dir, before)
  })

  it('accepts only committed and compensated operations', async () => {
    for (const phase of petLocusOperation.shape.phase.options) {
      const { file } = await plant(19, {
        locus_mains: { 'main-1': v19Main({ id: 'main-1' }) },
        loci: { 'keep-1': v19Row({ id: 'keep-1', chatId: 'oc_keep1' }) },
        locus_operations: { 'op-x': { id: 'op-x', phase } },
      })
      const result = run(file, '--dry-run')
      expect(result.status === 0, `${phase}: ${result.stderr}`).toBe(phase === 'committed' || phase === 'compensated')
    }
  })

  it('spec Scenario "未确认时不写入"', async () => {
    const { dir, file } = await plant(18, worldRows())
    const before = bytesOf(file)

    const result = run(file)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('not confirmed')
    expect(result.stderr).toContain('No write was performed')
    expectUntouched(file, dir, before)
  })
})
