/**
 * `dsh-pet-migrate-state` v2..v18 -> v19: purge previous-model locus rows.
 *
 * Databases are real SQLite files laid out by Pet's own backend and seeded with
 * raw rows (support/pet-sqlite.ts), always in a temp directory: the live
 * `~/.dsh/plugins/dsh-pet/state.sqlite` is never an input. The script loads the
 * Host's validation from `lib/`, so these tests need a built package
 * (`npm run build:host`; `npm test` does it).
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildLocusRecord, type LocusRecord } from '../src/host/locus/aggregate.js'
import { isTerminalDeliveryStatus } from '../src/host/locus/delivery.js'
import { STORAGE_KEY_SEPARATOR } from '../src/host/locus/storage-key.js'
import { PET_DOMAIN_VERSION, petLocusDelivery, petLocusOperation, type PetLocusMainRecord } from '../src/host/spec.js'
import { openDomainOnly, openPetDomain } from './support/pet-host-fixture.js'
import { seedPetState, snapshotPetTables, stampedVersion, tempPetHome, type RawRows } from './support/pet-sqlite.js'

const SCRIPT = new URL('../scripts/migrate-state-version.mjs', import.meta.url).pathname

// -- fixtures -------------------------------------------------------------------

function main(overrides: Partial<PetLocusMainRecord> = {}): PetLocusMainRecord {
  return {
    locusMainSessionId: 'main-1', workSessionId: 'work-1', generation: 1, status: 'active',
    spaceId: 'space-1', workspaceId: 'ws-pet', createdAt: 1, updatedAt: 1, ...overrides,
  }
}

/** A three-tier row as SQLite holds it. */
function tier3(overrides: Partial<Parameters<typeof buildLocusRecord>[0]> = {}): Record<string, unknown> {
  const record: LocusRecord = buildLocusRecord({
    id: 'keep-1', endpoint: { chatId: 'oc_keep1' }, parentSessionId: 'main-1', childSessionId: 'child-keep-1',
    childComposition: 'tier3', workspaceId: 'ws-1', source: 'auto', createdAt: 1, updatedAt: 1, ...overrides,
  })
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>
}

/** A previous-model row: its parent is the owner's own session, which has no locus_mains record. */
function previousModel(id: string, chatId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, generation: 1, endpoint: { chatId }, parentSessionId: 'user-session', childSessionId: `child-${id}`,
    childComposition: 'safe-v2', workspaceId: 'ws-1', source: 'explicit', state: 'active',
    permission: { desired: 'read', effective: 'read' }, busy: false, createdAt: 1, updatedAt: 1, ...extra,
  }
}

const delivery = (id: string, locusId: string, status = 'replied'): Record<string, unknown> => ({ deliveryId: id, locusId, status })
const operation = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id, phase: 'committed', ...extra })

/** v18: three previous-model rows, four terminal Deliveries on them, two three-tier rows. */
function worldRows(): RawRows {
  return {
    locus_mains: { 'main-1': main() },
    loci: {
      'old-1': previousModel('old-1', 'oc_old1'),
      'old-2': previousModel('old-2', 'oc_old2'),
      'old-3': previousModel('old-3', 'oc_old3'),
      'keep-1': tier3(),
      'keep-2': tier3({ id: 'keep-2', endpoint: { chatId: 'oc_keep2' }, childSessionId: 'child-keep-2' }),
    },
    locus_indexes: {
      'endpoint:oc_old1': { kind: 'endpoint-current', key: 'endpoint:oc_old1', locusIds: ['old-1'], updatedAt: 1 },
      'default-qa:user-session': { kind: 'default-qa', key: 'default-qa:user-session', locusIds: ['old-1'], updatedAt: 1 },
      'endpoint:oc_keep1': { kind: 'endpoint-current', key: 'endpoint:oc_keep1', locusIds: ['keep-1'], updatedAt: 1 },
    },
    locus_deliveries: {
      'd-1': delivery('d-1', 'old-1', 'settled'),
      'd-2': delivery('d-2', 'old-1', 'replied'),
      'd-3': delivery('d-3', 'old-2', 'failed'),
      'd-4': delivery('d-4', 'old-3', 'expired'),
      'd-keep': delivery('d-keep', 'keep-1'),
    },
    locus_permission_audit: { 'old-1': { locusId: 'old-1' }, 'keep-1': { locusId: 'keep-1' } },
    locus_operations: {
      'op-old': operation('op-old', { locusId: 'old-1' }),
      'op-replace': operation('op-replace', { oldLocusId: 'old-2', newLocusId: 'keep-2' }),
      'op-new': operation('op-new', { newLocusId: 'old-3' }),
      'op-keep': operation('op-keep', { locusId: 'keep-1' }),
      'op-bare': operation('op-bare', { phase: 'compensated' }),
    },
    chat_bindings: { 'oc_legacy': { opaque: 'legacy chat binding naming old-1', locusId: 'old-1' } },
    invocation_channel: { 'inv-1': { opaque: true } },
    ledger_item: { 'item-1': { opaque: 'todo on old-1', locusId: 'old-1' } },
    inquiries: { 'inq-1': { opaque: 'inquiry on old-1' } },
  }
}

async function plant(version: number, rows: RawRows) {
  const { home, file } = tempPetHome('pet-migrate-cli-')
  await seedPetState(file, version, rows)
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
 * commit `inject` only AFTER the script has finished its read-only pre-flight
 * (it announces that before blocking on the lock). This is the window between
 * "pre-flight passed" and "lock acquired".
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
  const status = await closed
  return { status, stdout, stderr }
}

// -- unchanged contract: arguments, locking, unsupported versions ---------------

describe('dsh-pet-migrate-state CLI', () => {
  it.each([5, 14, 15, 17])('checks an additive v%s migration without writing in --dry-run mode', async version => {
    const { dir, file } = await plant(version, {})
    const before = bytesOf(file)
    const output = execFileSync(process.execPath, [SCRIPT, '--db', file, '--dry-run'], { encoding: 'utf8' })

    expect(output).toContain(`[dry-run] Would migrate ${version} → ${PET_DOMAIN_VERSION}`)
    expect(output).toContain('Re-run with --yes')
    expect(stampedVersion(file)).toBe(version)
    expectUntouched(file, dir, before)
  })

  it('refuses an unconfirmed write', async () => {
    const { dir, file } = await plant(5, {})
    const before = bytesOf(file)
    const result = run(file)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('not confirmed')
    expect(result.stderr).toContain('No write was performed')
    expect(stampedVersion(file)).toBe(5)
    expectUntouched(file, dir, before)
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
    const { dir, file } = await plant(5, {})
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
    expect(stampedVersion(file)).toBe(5)
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
    for (const version of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]) {
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

// -- spec scenarios: 旧模型 locus 数据经离线迁移清除 -----------------------------

describe('legacy locus data is purged by the offline migration', () => {
  it('spec Scenario "dry-run 列出将删除的行且不写入"', async () => {
    const { dir, file } = await plant(18, worldRows())
    const before = bytesOf(file)

    const result = run(file, '--dry-run')

    expect(result.status, result.stderr).toBe(0)
    for (const id of ['old-1', 'old-2', 'old-3']) expect(result.stdout).toContain(id)
    expect(result.stdout).not.toContain('keep-1')
    expect(result.stdout).toMatch(/^\s+loci: 3$/m)
    expect(result.stdout).toMatch(/^\s+locus_deliveries: 4$/m)
    expect(result.stdout).toContain('oc_old1')
    expectUntouched(file, dir, before)
    expect(existsSync(`${file}-wal`)).toBe(false)
  })

  it('spec Scenario "dry-run 列出将删除的行且不写入": a WAL with committed frames stays byte-identical', async () => {
    const { dir, file } = await plant(18, worldRows())
    const wal = new DatabaseSync(file)
    wal.exec('PRAGMA journal_mode = WAL')
    wal.exec('PRAGMA wal_autocheckpoint = 0')
    wal.prepare("INSERT OR REPLACE INTO u_dsh_pet_loci (key, value) VALUES ('old-9', ?)").run(JSON.stringify(previousModel('old-9', 'oc_old9')))
    // Snapshot main+WAL while the frames are still un-checkpointed, then release the original.
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
    void dir
  })

  it('spec Scenario "确认后清除旧模型数据"', async () => {
    const { dir, file } = await plant(18, worldRows())
    const before = snapshotPetTables(file)

    const result = run(file, '--yes')

    expect(result.status, result.stderr).toBe(0)
    expect(stampedVersion(file)).toBe(19)
    const after = snapshotPetTables(file)
    const keys = (rows: { key: string }[]) => rows.map(row => row.key)
    expect(keys(after.loci!)).toEqual(['keep-1', 'keep-2'])
    expect(keys(after.locus_deliveries!)).toEqual(['d-keep'])
    expect(keys(after.locus_permission_audit!)).toEqual(['keep-1'])
    expect(keys(after.locus_operations!)).toEqual(['op-bare', 'op-keep']) // op-replace named old-2 as oldLocusId
    // Retained rows and the index table are byte-identical.
    expect(after.loci).toEqual(before.loci!.filter(row => row.key.startsWith('keep')))
    expect(after.locus_indexes).toEqual(before.locus_indexes)
    // Everything outside the locus tables is untouched, including rows that name an old locus.
    for (const table of ['locus_mains', 'chat_bindings', 'invocation_channel', 'ledger_item', 'inquiries']) {
      expect(after[table]).toEqual(before[table])
    }
    // The backup is the complete pre-migration state.
    const backups = backupsOf(dir)
    expect(backups).toHaveLength(1)
    expect(backups[0]).toMatch(/^state\.sqlite\.v18\.bak-\d+$/)
    expect(stampedVersion(path.join(dir, backups[0]!))).toBe(18)
    expect(snapshotPetTables(path.join(dir, backups[0]!))).toEqual(before)
  })

  it('leaves a database the real Domain opens', async () => {
    // Only schema-valid rows: the other fixtures use opaque stand-ins on purpose.
    const { file } = await plant(18, {
      locus_mains: { 'main-1': main() },
      loci: { 'old-1': previousModel('old-1', 'oc_old1'), 'keep-1': tier3() },
      locus_indexes: { 'endpoint:oc_keep1': { kind: 'endpoint-current', key: 'endpoint:oc_keep1', locusIds: ['keep-1'], updatedAt: 1 } },
    })
    expect(run(file, '--yes').status).toBe(0)

    const ctx = await openDomainOnly(file)
    try {
      const domain = await openPetDomain(ctx) as unknown as { close(): Promise<void> }
      await domain.close()
    } finally { await ctx.fiber.dispose() }
  })

  it('spec Scenario "删除中间代际造成断档时拒绝"', async () => {
    const { dir, file } = await plant(18, {
      locus_mains: { 'main-1': main() },
      loci: {
        g1: tier3({ id: 'g1', endpoint: { chatId: 'oc_e' }, generation: 1, state: 'invalid', childSessionId: undefined, childComposition: undefined, updatedAt: 2 }),
        g2: previousModel('g2', 'oc_e', { generation: 2, state: 'invalid' }),
        g3: tier3({ id: 'g3', endpoint: { chatId: 'oc_e' }, generation: 3, state: 'not-created', childSessionId: undefined, childComposition: undefined, replacesLocusId: 'g2' }),
      },
    })
    const before = bytesOf(file)

    const result = run(file, '--yes')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('oc_e')
    expect(result.stderr).toMatch(/contiguously/)
    expectUntouched(file, dir, before)
  })

  it('spec Scenario "未创建 child 的历史行可以没有 marker": the script keeps them byte for byte', async () => {
    const stopped = tier3({ id: 'stopped-1', endpoint: { chatId: 'oc_s' }, state: 'stopped', childSessionId: undefined, childComposition: undefined, updatedAt: 2 })
    const invalid = tier3({ id: 'invalid-1', endpoint: { chatId: 'oc_i' }, state: 'invalid', childSessionId: undefined, childComposition: undefined, updatedAt: 2 })
    const { file } = await plant(18, {
      locus_mains: { 'main-1': main() },
      loci: { 'stopped-1': stopped, 'invalid-1': invalid, 'old-1': previousModel('old-1', 'oc_old1') },
    })
    const before = snapshotPetTables(file)

    const result = run(file, '--yes')

    expect(result.status, result.stderr).toBe(0)
    expect(snapshotPetTables(file).loci).toEqual(before.loci!.filter(row => row.key !== 'old-1'))
  })

  it('spec Scenario "切换通知按 locusId 精确删除"', async () => {
    const notice = (locusId: string) => ({ locusId, generation: 1 })
    const { file } = await plant(18, {
      locus_mains: { 'main-1': main() },
      loci: {
        'locus-a': previousModel('locus-a', 'oc_a'),
        'locus-a2': tier3({ id: 'locus-a2', endpoint: { chatId: 'oc_a2' }, childSessionId: 'child-a2' }),
      },
      locus_switch_notices: {
        [`locus-a${STORAGE_KEY_SEPARATOR}1`]: notice('locus-a'),
        [`locus-a2${STORAGE_KEY_SEPARATOR}1`]: notice('locus-a2'),
      },
    })
    const before = snapshotPetTables(file)

    const result = run(file, '--yes')

    expect(result.status, result.stderr).toBe(0)
    expect(snapshotPetTables(file).locus_switch_notices).toEqual(
      before.locus_switch_notices!.filter(row => row.key.startsWith(`locus-a2${STORAGE_KEY_SEPARATOR}`)),
    )
  })

  it('spec Scenario "预检通过后出现非终态投递时锁内拒绝"', async () => {
    const { dir, file } = await plant(18, worldRows())
    const before = snapshotPetTables(file)

    const result = await runWithWriterInWindow(file, holder => {
      holder.prepare("INSERT INTO u_dsh_pet_locus_deliveries (key, value) VALUES ('d-late', ?)")
        .run(JSON.stringify(delivery('d-late', 'keep-1', 'queued')))
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('d-late')
    expect(result.stderr).toContain('queued')
    expect(backupsOf(dir)).toEqual([]) // refused before checkpoint and backup
    expect(stampedVersion(file)).toBe(18)
    const after = snapshotPetTables(file)
    expect(after.loci).toEqual(before.loci)
    expect(after.locus_deliveries).toEqual([...before.locus_deliveries!, { key: 'd-late', value: JSON.stringify(delivery('d-late', 'keep-1', 'queued')) }].sort((a, b) => a.key.localeCompare(b.key)))
  })

  it('spec Scenario "预检后版本已变化"', async () => {
    const { dir, file } = await plant(18, worldRows())
    const before = snapshotPetTables(file)

    const result = await runWithWriterInWindow(file, holder => {
      holder.prepare('UPDATE units SET version = 19 WHERE name = ?').run('dsh_pet')
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Already at the target version')
    expect(backupsOf(dir)).toEqual([])
    expect(stampedVersion(file)).toBe(19)
    expect(snapshotPetTables(file)).toEqual(before) // not one row deleted
  })

  it('spec Scenario "存在非终态投递时拒绝"', async () => {
    const rows = worldRows()
    rows.locus_deliveries = { ...rows.locus_deliveries, 'd-queued': delivery('d-queued', 'keep-2', 'queued') }
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
    rows.locus_deliveries = { ...rows.locus_deliveries, 'd-queued': delivery('d-queued', 'old-1', 'queued') }
    const { dir, file } = await plant(18, rows)
    const before = bytesOf(file)
    const result = run(file, '--dry-run')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('d-queued')
    expectUntouched(file, dir, before)
  })

  it('treats exactly the Host\'s terminal Delivery statuses as finished', async () => {
    const statuses = petLocusDelivery.shape.status.options
    expect(statuses.length).toBeGreaterThan(6)
    for (const status of statuses) {
      const { file } = await plant(18, { locus_mains: { 'main-1': main() }, loci: { 'keep-1': tier3() }, locus_deliveries: { 'd-x': delivery('d-x', 'keep-1', status) } })
      const result = run(file, '--dry-run')
      expect(result.status === 0, `${status}: ${result.stderr}`).toBe(isTerminalDeliveryStatus(status))
    }
  })

  it('spec Scenario "存在未完成的操作时拒绝"', async () => {
    const rows = worldRows()
    // A provisioning operation carries no locus id at all, so nothing ties it to an entry.
    rows.locus_operations = { ...rows.locus_operations, 'op-wip': { id: 'op-wip', phase: 'provisioning', endpointKey: 'oc_x' } }
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
      const { file } = await plant(18, { locus_mains: { 'main-1': main() }, loci: { 'keep-1': tier3() }, locus_operations: { 'op-x': operation('op-x', { phase }) } })
      const result = run(file, '--dry-run')
      expect(result.status === 0, `${phase}: ${result.stderr}`).toBe(phase === 'committed' || phase === 'compensated')
    }
  })

  it.each([
    ['a paired row marked safe-v2', { loci: { 'bad-1': tier3({ id: 'bad-1', endpoint: { chatId: 'oc_bad' } }) } }, (row: Record<string, unknown>) => { row.childComposition = 'safe-v2' }],
    ['a paired active row without a marker', { loci: { 'bad-1': tier3({ id: 'bad-1', endpoint: { chatId: 'oc_bad' } }) } }, (row: Record<string, unknown>) => { delete row.childComposition }],
  ] as const)('spec Scenario "保留行不满足 v19 条件时拒绝": %s', async (_name, base, damage) => {
    const rows: RawRows = { locus_mains: { 'main-1': main() }, loci: { ...base.loci } as Record<string, unknown> }
    damage((rows.loci as Record<string, Record<string, unknown>>)['bad-1']!)
    const { dir, file } = await plant(18, rows)
    const before = bytesOf(file)

    const result = run(file, '--yes')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('bad-1')
    expectUntouched(file, dir, before)
  })

  it('spec Scenario "保留行不满足 v19 条件时拒绝": a retained topic whose parentLocusId is purged', async () => {
    const { dir, file } = await plant(18, {
      locus_mains: { 'main-1': main() },
      loci: {
        'old-group': previousModel('old-group', 'oc_g'),
        'topic-1': tier3({ id: 'topic-1', endpoint: { chatId: 'oc_g', threadId: 'omt_1' }, parentLocusId: 'old-group', childSessionId: 'child-topic' }),
      },
    })
    const before = bytesOf(file)

    const result = run(file, '--yes')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('old-group')
    expectUntouched(file, dir, before)
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

  it('spec Scenario "已是目标版本时无操作"', async () => {
    const { dir, file } = await plant(19, worldRows())
    const before = bytesOf(file)

    const result = run(file, '--yes')

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Already at the target version')
    expectUntouched(file, dir, before)
  })

  it('spec Scenario "从更早版本迁移时全部 locus 行都是旧模型"', async () => {
    const { dir, file } = await plant(17, {
      loci: { 'old-1': previousModel('old-1', 'oc_old1'), 'old-2': previousModel('old-2', 'oc_old2') },
      locus_deliveries: { 'd-1': delivery('d-1', 'old-1') },
      chat_bindings: { 'oc_legacy': { opaque: true } },
    })
    // A v17 database has no pairing table at all.
    const seed = new DatabaseSync(file)
    seed.exec('DROP TABLE u_dsh_pet_locus_mains')
    seed.close()
    const before = snapshotPetTables(file)
    expect(before.locus_mains).toBeUndefined()

    const result = run(file, '--yes')

    expect(result.status, result.stderr).toBe(0)
    const [backup] = backupsOf(dir)
    expect(backup).toMatch(/\.v17\.bak-\d+$/)
    // The backup was taken before any change, DDL included.
    expect(snapshotPetTables(path.join(dir, backup!))).toEqual(before)
    expect(stampedVersion(file)).toBe(19)
    const after = snapshotPetTables(file)
    expect(after.locus_mains).toEqual([])
    expect(after.loci).toEqual([])
    expect(after.locus_deliveries).toEqual([])
    expect(after.chat_bindings).toEqual(before.chat_bindings)
  })

  it('spec Scenario "升级需离线迁移并先备份": v15 → current takes a snapshot first and purges the v15 locus rows', async () => {
    const { dir, file } = await plant(15, {
      loci: { 'old-1': previousModel('old-1', 'oc_old1') },
      locus_deliveries: { 'd-1': delivery('d-1', 'old-1') },
    })
    const seed = new DatabaseSync(file)
    seed.exec('DROP TABLE u_dsh_pet_locus_mains')
    seed.close()
    const bytesBefore = readFileSync(file)
    const rowsBefore = snapshotPetTables(file)

    const out = run(file, '--yes')

    expect(out.status, out.stderr).toBe(0)
    expect(out.stdout).toContain(`Migrated 15 → ${PET_DOMAIN_VERSION}`)
    expect(stampedVersion(file)).toBe(PET_DOMAIN_VERSION)
    const backups = backupsOf(dir).filter(name => /\.v15\.bak-\d+$/.test(name))
    expect(backups).toHaveLength(1)
    // Without a WAL the snapshot is also byte-identical to the main file before the run.
    expect(readFileSync(path.join(dir, backups[0]!))).toEqual(bytesBefore)
    expect(snapshotPetTables(path.join(dir, backups[0]!))).toEqual(rowsBefore)
    expect(snapshotPetTables(file).loci).toEqual([])
  })
})
