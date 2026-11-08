/**
 * `dsh-pet-migrate-state` v2..v19 -> v20: shape every locus entry into one
 * isomorphic row (openspec pet-locus-isomorphic-entries, design D13).
 *
 * Every database is a real SQLite file in a temp directory, seeded with raw
 * v19 bytes (support/v19-seed.ts). The script loads the v20 validator from
 * `lib/`, so these tests need a built package (`npm run build:host`).
 */
import { spawn, spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateLocusSetForStorage } from '../src/host/locus/locus-set-v20.js'
import { LocusRepositoryV20 } from '../src/host/locus/persistence-v20.js'
import { snapshotPetTables, stampedVersion, tempPetHome } from './support/pet-sqlite.js'
import { openMigratedDomain } from './support/pet-domain-open.js'
import {
  SEP, dropTable, readTable, seedV19State, v19DefaultQa, v19Delivery, v19Generations, v19Main, v19Row, type V19Rows,
} from './support/v19-seed.js'

const SCRIPT = new URL('../scripts/migrate-state-version.mjs', import.meta.url).pathname
const SESSION_RE = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

async function plant(version: number, rows: V19Rows) {
  const { file } = tempPetHome('pet-migrate-v20-')
  await seedV19State(file, version, rows)
  return { dir: path.dirname(file), file }
}

function run(file: string, ...flags: string[]) {
  return spawnSync(process.execPath, [SCRIPT, '--db', file, ...flags], { encoding: 'utf8' })
}

const backupsOf = (dir: string): string[] => readdirSync(dir).filter(name => name.includes('.bak-'))

function bytesOf(file: string): Buffer[] {
  return [file, `${file}-wal`].map(item => (existsSync(item) ? readFileSync(item) : Buffer.alloc(0)))
}

function expectUntouched(file: string, dir: string, before: Buffer[]): void {
  expect(bytesOf(file)).toEqual(before)
  expect(backupsOf(dir)).toEqual([])
}

const loci = (file: string) => readTable(file, 'loci') ?? {}

function mainIdsOf(file: string): Set<string> {
  return new Set(Object.keys(readTable(file, 'locus_mains') ?? {}))
}

/** The v20 validator over the stored `loci` table: what the Host would open. */
function v20Violations(file: string) {
  return validateLocusSetForStorage(new Map(Object.entries(loci(file))), mainIdsOf(file))
}

/** The `oc_bb0e` shape: group on M0, its topic on M1. */
function bb0eRows(): V19Rows {
  return {
    locus_mains: {
      M0: v19Main({ id: 'M0', work: 'W0' }),
      M1: v19Main({ id: 'M1', work: 'W1' }),
    },
    loci: {
      'g-oc_bb0e': v19Row({ id: 'g-oc_bb0e', chatId: 'oc_bb0e', main: 'M0', revision: 2 }),
      't-1': v19Row({ id: 't-1', chatId: 'oc_bb0e', threadId: 'omt_1', main: 'M1', revision: 3, write: true, shell: true }),
      't-2': v19Row({ id: 't-2', chatId: 'oc_bb0e', threadId: 'omt_2', main: 'M1', state: 'stopped', child: 'child-t-2', stoppedAt: 9, revision: 1 }),
    },
  }
}

/** Same W, unique active M1; Q (default Q&A) and its topics still on retired M0. */
function crossPairingRows(): V19Rows {
  return {
    locus_mains: {
      M0: v19Main({ id: 'M0', work: 'W', status: 'retired', generation: 1 }),
      M1: v19Main({ id: 'M1', work: 'W', generation: 2 }),
    },
    loci: {
      'g-oc_g': v19Row({ id: 'g-oc_g', chatId: 'oc_g', main: 'M1', revision: 4 }),
      'g-oc_q': v19Row({ id: 'g-oc_q', chatId: 'oc_q', main: 'M0', source: 'qa-created', revision: 2 }),
      qt: v19Row({ id: 'qt', chatId: 'oc_q', threadId: 'omt_qt', main: 'M0', revision: 1 }),
      qs: v19Row({ id: 'qs', chatId: 'oc_q', threadId: 'omt_qs', main: 'M0', state: 'stopped', child: 'child-qs', stoppedAt: 9, revision: 6, write: true, shell: true }),
    },
    locus_indexes: { 'default-qa:M0': v19DefaultQa('M0', 'g-oc_q') },
  }
}

/**
 * Run `--yes` while another writer holds the database, and let that writer
 * commit `inject` only after the script announced its finished pre-flight.
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

describe('旧数据经 v20 离线迁移清除并整形', () => {
  it('spec Scenario "dry-run 只读并列出归并"', async () => {
    const { dir, file } = await plant(19, bb0eRows())
    const before = bytesOf(file)

    const result = run(file, '--dry-run')

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toMatch(/Topic rows merged onto their group row's M[^\n]*: 2/)
    expect(result.stdout).toMatch(/^\s+- t-1 \(oc_bb0e#omt_1\) M M1 → M0$/m)
    expect(result.stdout).toMatch(/^\s+- t-2 \(oc_bb0e#omt_2\) M M1 → M0$/m)
    expect(result.stdout).toContain('[dry-run] Would migrate 19 → 20')
    expectUntouched(file, dir, before)
    expect(existsSync(`${file}-wal`)).toBe(false)
  })

  it('spec Scenario "确认后整形 locus 行"', async () => {
    const rows: V19Rows = {
      locus_mains: { 'main-1': v19Main({ id: 'main-1' }) },
      loci: v19Generations({ id: 'E', chatId: 'oc_e' }, 3, { state: 'active', child: 'S3', write: true, shell: true, revision: 5 }),
    }
    const { dir, file } = await plant(19, rows)
    const before = snapshotPetTables(file)

    const result = run(file, '--yes')

    expect(result.status, result.stderr).toBe(0)
    const after = loci(file)
    expect(Object.keys(after)).toEqual(['oc_e'])
    expect(after.oc_e).toMatchObject({
      endpoint: { chatId: 'oc_e' }, locusId: 'E-g3', sessionId: 'S3', state: 'active',
      accessMode: 'danger-full-access', revision: 5, locusMainSessionId: 'main-1', workspaceId: 'ws-1',
    })
    // Offline: who granted it is a fact; a readback never happened, so no verifiedAt.
    expect(after.oc_e!.grantedBy).toBe('owner-1')
    expect(after.oc_e).not.toHaveProperty('verifiedAt')
    for (const removed of ['generation', 'id', 'parentSessionId', 'childSessionId', 'permission', 'toolTier', 'busy', 'source', 'childComposition', 'replacesLocusId']) {
      expect(after.oc_e).not.toHaveProperty(removed)
    }
    expect(stampedVersion(file)).toBe(20)
    const backups = backupsOf(dir)
    expect(backups).toHaveLength(1)
    expect(backups[0]).toMatch(/^state\.sqlite\.v19\.bak-\d+$/)
    expect(snapshotPetTables(path.join(dir, backups[0]!))).toEqual(before)
    expect(v20Violations(file)).toEqual([])
  })

  it('spec Scenario "accessMode 只在写加 shell 时为完全访问"', async () => {
    const { file } = await plant(19, {
      locus_mains: { 'main-1': v19Main({ id: 'main-1' }) },
      loci: {
        a: v19Row({ id: 'a', chatId: 'oc_a', write: true, shell: false }),
        b: v19Row({ id: 'b', chatId: 'oc_b', write: false, shell: true }),
        c: v19Row({ id: 'c', chatId: 'oc_c' }),
      },
    })

    const result = run(file, '--yes')

    expect(result.status, result.stderr).toBe(0)
    const after = loci(file)
    for (const key of ['oc_a', 'oc_b', 'oc_c']) expect(after[key]!.accessMode).toBe('read-only')
  })

  it('spec Scenario "retired 改为 stopped 并保留停止时间"', async () => {
    const { file } = await plant(19, {
      locus_mains: { 'main-1': v19Main({ id: 'main-1' }) },
      loci: {
        r: v19Row({ id: 'r', chatId: 'oc_r', state: 'retired', child: 'child-r', retiredAt: 111, updatedAt: 111 }),
        s: v19Row({ id: 's', chatId: 'oc_s', state: 'stopped', child: 'child-s', updatedAt: 222 }),
      },
    })

    const result = run(file, '--yes')

    expect(result.status, result.stderr).toBe(0)
    const after = loci(file)
    expect(after.oc_r).toMatchObject({ state: 'stopped', stoppedAt: 111 })
    expect(after.oc_s).toMatchObject({ state: 'stopped', stoppedAt: 222 })
    expect(v20Violations(file)).toEqual([])
  })

  it('spec Scenario "没有任何会话 id 的非 active 行得到新的预留 sessionId"', async () => {
    const v19 = await plant(19, {
      locus_mains: { 'main-1': v19Main({ id: 'main-1' }) },
      loci: {
        s: v19Row({ id: 's', chatId: 'oc_s', state: 'stopped', child: null, createdAt: 3, updatedAt: 4 }),
        i: v19Row({ id: 'i', chatId: 'oc_i', state: 'invalid', child: null, createdAt: 5, updatedAt: 6 }),
        n: v19Row({ id: 'n', chatId: 'oc_n', state: 'not-created', child: null, createdAt: 7, updatedAt: 8 }),
      },
    })
    const v18 = await plant(18, {
      locus_mains: { 'main-1': v19Main({ id: 'main-1' }) },
      loci: {
        s18: v19Row({ id: 's18', chatId: 'oc_s18', state: 'stopped', child: null, createdAt: 3, updatedAt: 4 }),
        old: { ...v19Row({ id: 'old', chatId: 'oc_old', main: 'user-session' }), childComposition: 'safe-v2' },
      },
    })

    for (const { file } of [v19, v18]) {
      const result = run(file, '--yes')
      expect(result.status, result.stderr).toBe(0)
      expect(v20Violations(file)).toEqual([])
    }
    const a = loci(v19.file)
    const b = loci(v18.file)
    const sessions = [a.oc_s!.sessionId, a.oc_i!.sessionId, a.oc_n!.sessionId, b.oc_s18!.sessionId]
    for (const session of sessions) expect(session).toMatch(SESSION_RE)
    expect(new Set(sessions).size).toBe(4)
    expect(a.oc_s).toMatchObject({ state: 'stopped', locusId: 's', createdAt: 3, updatedAt: 4 })
    expect(a.oc_i).toMatchObject({ state: 'invalid', locusId: 'i', createdAt: 5, updatedAt: 6 })
    expect(a.oc_n).toMatchObject({ state: 'not-created', locusId: 'n', createdAt: 7, updatedAt: 8 })
    expect(b.oc_s18).toMatchObject({ state: 'stopped', locusId: 's18', createdAt: 3, updatedAt: 4 })
    expect(Object.keys(b)).toEqual(['oc_s18'])
  })

  it('spec Scenario "话题与群的 M 不一致时归并并原地重建"', async () => {
    const { file } = await plant(19, bb0eRows())

    const result = run(file, '--yes')

    expect(result.status, result.stderr).toBe(0)
    const after = loci(file)
    const active = after[`oc_bb0e${SEP}omt_1`]!
    const stopped = after[`oc_bb0e${SEP}omt_2`]!
    for (const topic of [active, stopped]) {
      expect(topic).not.toHaveProperty('locusMainSessionId')
      expect(topic).not.toHaveProperty('workspaceId')
    }
    expect(after.oc_bb0e!.locusMainSessionId).toBe('M0')
    expect(active).toMatchObject({ locusId: 't-1', state: 'not-created', accessMode: 'read-only', revision: 4 })
    expect(active.sessionId).toMatch(SESSION_RE)
    expect(active.sessionId).not.toBe('child-t-1')
    expect(stopped).toMatchObject({ locusId: 't-2', state: 'stopped', accessMode: 'read-only', sessionId: 'child-t-2' })
    // The old child stays under M1: the migration touches no session and no pairing.
    expect(readTable(file, 'locus_mains')).toEqual(bb0eRows().locus_mains)
    expect(v20Violations(file)).toEqual([])
  })

  it('spec Scenario "同 W 跨配对群被归并到唯一 active M"', async () => {
    const { dir, file } = await plant(19, crossPairingRows())
    const before = bytesOf(file)

    const dry = run(file, '--dry-run')
    expect(dry.status, dry.stderr).toBe(0)
    expect(dry.stdout).toMatch(/^\s+- oc_q \(group g-oc_q\) pairing M0 \(retired\) → M1, W W; reset: g-oc_q, qs, qt$/m)
    expect(dry.stdout).toMatch(/context of the reset entries is not carried over/)
    expect(dry.stdout).not.toMatch(/^\s+- oc_g /m)
    expectUntouched(file, dir, before)

    const startedAt = Date.now()
    const result = run(file, '--yes')
    expect(result.status, result.stderr).toBe(0)
    const after = loci(file)
    const q = after.oc_q!
    const qt = after[`oc_q${SEP}omt_qt`]!
    const qs = after[`oc_q${SEP}omt_qs`]!
    expect(q).toMatchObject({ locusId: 'g-oc_q', locusMainSessionId: 'M1', state: 'not-created', accessMode: 'read-only', revision: 3, defaultQa: true })
    expect(qt).toMatchObject({ locusId: 'qt', state: 'not-created', accessMode: 'read-only', revision: 2 })
    expect(qs).toMatchObject({ locusId: 'qs', state: 'stopped', accessMode: 'read-only', revision: 7, sessionId: 'child-qs' })
    expect(q.sessionId).toMatch(SESSION_RE)
    expect(qt.sessionId).toMatch(SESSION_RE)
    expect(after.oc_g).toMatchObject({ locusId: 'g-oc_g', locusMainSessionId: 'M1', sessionId: 'child-g-oc_g', state: 'active', revision: 4 })
    expect(after.oc_g).not.toHaveProperty('defaultQa')
    // Reset rows: updatedAt = migration time, createdAt kept (as resetChat does); G untouched.
    for (const row of [q, qt, qs]) {
      expect(row.createdAt).toBe(1)
      expect(row.updatedAt as number).toBeGreaterThanOrEqual(startedAt)
    }
    expect(after.oc_g!.updatedAt).toBe(10)
    expect(v20Violations(file)).toEqual([])
  })

  it('spec Scenario "归并后默认 Q&A 可发现且不外部建群" (persistence half: discovery through the v20 repository, also after reopening)', async () => {
    const { file } = await plant(19, crossPairingRows())
    expect(run(file, '--yes').status).toBe(0)

    for (let open = 0; open < 2; open += 1) {
      const opened = await openMigratedDomain(file)
      try {
        const repository = new LocusRepositoryV20(opened.domain as ConstructorParameters<typeof LocusRepositoryV20>[0])
        expect(repository.findActiveMain('W')?.locusMainSessionId).toBe('M1')
        expect(repository.findDefaultQa('W')).toMatchObject({ locusId: 'g-oc_q', endpoint: { chatId: 'oc_q' } })
      } finally { await opened.close() }
    }
  })

  it('spec Scenario "同 W 没有 active 配对时不归并"', async () => {
    const { dir, file } = await plant(19, {
      locus_mains: {
        M0: v19Main({ id: 'M0', work: 'W', status: 'retired' }),
        M1: v19Main({ id: 'M1', work: 'W', status: 'retired', generation: 2 }),
      },
      loci: {
        g1: v19Row({ id: 'g1', chatId: 'oc_1', main: 'M0' }),
        g2: v19Row({ id: 'g2', chatId: 'oc_2', main: 'M1' }),
      },
    })
    const before = bytesOf(file)

    const dry = run(file, '--dry-run')
    expect(dry.status, dry.stderr).toBe(0)
    expect(dry.stdout).toMatch(/Chats left on a retired pairing[^\n]*: 2/)
    expect(dry.stdout).toMatch(/^\s+- oc_1 \(group g1\) pairing M0 \(retired\), W W has no active pairing$/m)
    expect(dry.stdout).toMatch(/runtime whole-W migration/)
    expectUntouched(file, dir, before)

    expect(run(file, '--yes').status).toBe(0)
    const after = loci(file)
    expect(after.oc_1).toMatchObject({ locusMainSessionId: 'M0', sessionId: 'child-g1', state: 'active' })
    expect(after.oc_2).toMatchObject({ locusMainSessionId: 'M1', sessionId: 'child-g2', state: 'active' })
  })

  it('spec Scenario "归并后出现多个默认 Q&A 候选时全部清除（含 stopped 群行）"', async () => {
    const rows = crossPairingRows()
    rows.loci = {
      ...rows.loci,
      'g-oc_g': v19Row({ id: 'g-oc_g', chatId: 'oc_g', main: 'M1', state: 'stopped', child: 'child-g', stoppedAt: 9 }),
    }
    rows.locus_indexes = { ...rows.locus_indexes, 'default-qa:M1': v19DefaultQa('M1', 'g-oc_g') }
    const { dir, file } = await plant(19, rows)
    const before = bytesOf(file)

    const dry = run(file, '--dry-run')
    expect(dry.status, dry.stderr).toBe(0)
    expect(dry.stdout).toMatch(/^\s+- default-qa:M0 → g-oc_q: one of 2 candidates under M M1/m)
    expect(dry.stdout).toMatch(/^\s+- default-qa:M1 → g-oc_g: one of 2 candidates under M M1/m)
    expectUntouched(file, dir, before)

    expect(run(file, '--yes').status).toBe(0)
    const flagged = Object.values(loci(file)).filter(row => row.defaultQa === true)
    expect(flagged).toEqual([])
    expect(v20Violations(file)).toEqual([])
  })

  it('spec Scenario "全部投递保留并改名"', async () => {
    const { file } = await plant(19, {
      locus_mains: { 'main-1': v19Main({ id: 'main-1' }) },
      loci: v19Generations({ id: 'E', chatId: 'oc_d' }, 2),
      locus_deliveries: {
        'd-old': v19Delivery('d-old', 'E-g1', 'child-E-g1'),
        'd-new': v19Delivery('d-new', 'E-g2', 'child-E-g2', { status: 'expired', finishOutcome: undefined, outboundResult: 'none', finishedAt: undefined, expiredAt: 3 }),
      },
    })

    expect(run(file, '--yes').status).toBe(0)
    const deliveries = readTable(file, 'locus_deliveries')!
    expect(Object.keys(deliveries).sort()).toEqual(['d-new', 'd-old'])
    expect(deliveries['d-old']).toMatchObject({ locusId: 'E-g1', sessionId: 'child-E-g1' })
    expect(deliveries['d-new']).toMatchObject({ locusId: 'E-g2', sessionId: 'child-E-g2', status: 'expired' })
    for (const row of Object.values(deliveries)) {
      expect(row).not.toHaveProperty('generation')
      expect(row).not.toHaveProperty('childSessionId')
    }
  })

  it('spec Scenario "default-qa 指针按表改写为群行标记"', async () => {
    const rows: V19Rows = {
      locus_mains: {
        MA: v19Main({ id: 'MA', work: 'WA' }), MB: v19Main({ id: 'MB', work: 'WB' }), MC: v19Main({ id: 'MC', work: 'WC' }),
        MD: v19Main({ id: 'MD', work: 'WD' }), ME: v19Main({ id: 'ME', work: 'WE' }), MF: v19Main({ id: 'MF', work: 'WF' }),
      },
      loci: {
        latest: v19Row({ id: 'latest', chatId: 'oc_latest', main: 'MA' }),
        ...v19Generations({ id: 'L', chatId: 'oc_old', main: 'MB' }, 3),
        trunc: v19Row({ id: 'trunc', chatId: 'oc_trunc', main: 'MC' }),
        'g-oc_t': v19Row({ id: 'g-oc_t', chatId: 'oc_t', main: 'MD' }),
        topic: v19Row({ id: 'topic', chatId: 'oc_t', threadId: 'omt_t', main: 'MD' }),
        f1: v19Row({ id: 'f1', chatId: 'oc_f1', main: 'MF' }),
        f2: v19Row({ id: 'f2', chatId: 'oc_f2', main: 'MF', state: 'stopped', child: 'child-f2', stoppedAt: 9 }),
      },
      locus_indexes: {
        'endpoint:oc_latest': { kind: 'endpoint-current', key: 'endpoint:oc_latest', locusIds: ['latest'], updatedAt: 1 },
        'parent:MA': { kind: 'parent-loci', key: 'parent:MA', locusIds: ['latest'], updatedAt: 1 },
        'child:child-latest': { kind: 'child-locus', key: 'child:child-latest', locusIds: ['latest'], updatedAt: 1 },
        'default-qa:MA': v19DefaultQa('MA', 'latest'),
        'default-qa:MB': v19DefaultQa('MB', 'L-g1'),
        // A row key truncated by the NUL-era binding, and a value.key naming another M: neither is read.
        'default-qa:M': v19DefaultQa('MZ', 'trunc', 'default-qa:MZZ'),
        'default-qa:ME': v19DefaultQa('ME', 'ghost'),
        'default-qa:MD': v19DefaultQa('MD', 'topic'),
        'default-qa:MF': v19DefaultQa('MF', 'f1'),
        'default-qa:MF2': v19DefaultQa('MF', 'f2', 'default-qa:MF2'),
      },
    }
    const { dir, file } = await plant(19, rows)
    const before = bytesOf(file)

    const dry = run(file, '--dry-run')
    expect(dry.status, dry.stderr).toBe(0)
    expect(dry.stdout).toMatch(/Default Q&A pointers cleared: 4/)
    expect(dry.stdout).toMatch(/^\s+- default-qa:ME → ghost: no such locus row/m)
    expect(dry.stdout).toMatch(/^\s+- default-qa:MD → topic: the entry's latest row is a topic row/m)
    expect(dry.stdout).toMatch(/^\s+- default-qa:MF → f1: one of 2 candidates under M MF/m)
    expect(dry.stdout).toMatch(/^\s+- default-qa:MF2 → f2: one of 2 candidates under M MF/m)
    expectUntouched(file, dir, before)

    const result = run(file, '--yes')
    expect(result.status, result.stderr).toBe(0)
    const after = loci(file)
    expect(after.oc_latest!.defaultQa).toBe(true)
    expect(after.oc_old).toMatchObject({ locusId: 'L-g3', defaultQa: true })
    expect(after.oc_trunc!.defaultQa).toBe(true)
    expect(after.oc_t).not.toHaveProperty('defaultQa')
    expect(after.oc_f1).not.toHaveProperty('defaultQa')
    expect(after.oc_f2).not.toHaveProperty('defaultQa')
    expect(readTable(file, 'locus_indexes')).toEqual({})
    expect(v20Violations(file)).toEqual([])
  })

  it('spec Scenario "切换通知与操作被清空，权限审计不变"', async () => {
    const audit = {
      [`E${SEP}1${SEP}1`]: { id: `E${SEP}1${SEP}1`, locusId: 'E', generation: 1, sequence: 1, desired: 'write', effective: 'write', grantedBy: 'owner-1', verifiedAt: 5 },
      [`E${SEP}1${SEP}2`]: { id: `E${SEP}1${SEP}2`, locusId: 'E', generation: 1, sequence: 2, desired: 'read', effective: 'read', grantedBy: 'owner-1', verifiedAt: 6 },
    }
    const { file } = await plant(19, {
      locus_mains: { 'main-1': v19Main({ id: 'main-1' }) },
      loci: { E: v19Row({ id: 'E', chatId: 'oc_e' }) },
      locus_switch_notices: { [`E${SEP}1`]: { locusId: 'E', generation: 1, endpoint: { chatId: 'oc_e' }, text: 'switched', createdAt: 1, attempts: 0 } },
      locus_operations: {
        'op-1': { id: 'op-1', kind: 'ensure', phase: 'committed', locusId: 'E', step: 1, attempts: 1, createdAt: 1, updatedAt: 1 },
        'op-2': { id: 'op-2', kind: 'busy', phase: 'compensated', step: 1, attempts: 1, createdAt: 1, updatedAt: 1 },
      },
      locus_permission_audit: audit,
    })
    const before = snapshotPetTables(file)

    expect(run(file, '--yes').status).toBe(0)
    const after = snapshotPetTables(file)
    expect(after.locus_switch_notices).toEqual([])
    expect(after.locus_operations).toEqual([])
    expect(after.locus_permission_audit).toEqual(before.locus_permission_audit)
  })

  it('spec Scenario "非 locus 表逐字节不变"', async () => {
    const todo = {
      itemId: 'item-1', parentSessionId: 'main-1', kind: 'todo', locusId: 'locus:oc_e', generation: 2,
      endpoint: { chatId: 'oc_e' }, triggerMessageId: 'om-1', requestedBy: 'ou_1',
      evidence: { summary: 'ship it', detail: '' }, status: 'open', createdAt: 1, statusChangedAt: 1,
    }
    const { file } = await plant(19, {
      locus_mains: { 'main-1': v19Main({ id: 'main-1' }) },
      loci: { E: v19Row({ id: 'E', chatId: 'oc_e' }) },
      ledger_item: { 'item-1': todo },
      shared_fact_ledger: { 'main-1': { parentSessionId: 'main-1', createdAt: 1 } },
      chat_bindings: { oc_legacy: { opaque: 'legacy binding naming E', locusId: 'E' } },
      invocation_channel: { 'inv-1': { opaque: true } },
      inquiries: { 'inq-1': { opaque: 'inquiry naming E', scope: { kind: 'child', locusId: 'E', generation: 1 } } },
    })
    const before = snapshotPetTables(file)

    expect(run(file, '--yes').status).toBe(0)
    const after = snapshotPetTables(file)
    for (const table of ['ledger_item', 'shared_fact_ledger', 'chat_bindings', 'invocation_channel', 'inquiries', 'locus_mains']) {
      expect(after[table], table).toEqual(before[table])
    }
  })

  it('spec Scenario "话题行没有群行时拒绝"', async () => {
    const { dir, file } = await plant(19, {
      locus_mains: { 'main-1': v19Main({ id: 'main-1' }) },
      loci: { orphan: v19Row({ id: 'orphan', chatId: 'oc_x', threadId: 'omt_x', parentLocusId: 'gone' }) },
    })
    const before = bytesOf(file)

    const result = run(file, '--yes')

    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/orphan[^\n]*no group row/)
    expectUntouched(file, dir, before)
  })

  it.each([
    ['switching', { s: v19Row({ id: 's', chatId: 'oc_s', state: 'switching' }) }, /s[^\n]*state 'switching'/],
    ['provisioning', { p: v19Row({ id: 'p', chatId: 'oc_p', state: 'provisioning', child: null }) }, /p[^\n]*state 'provisioning'/],
    ['inherited', { i: v19Row({ id: 'i', chatId: 'oc_i', source: 'inherited' }) }, /i[^\n]*inherited/],
  ] as const)('spec Scenario "switching、provisioning 与 inherited 行时拒绝": %s', async (_name, rows, message) => {
    const { dir, file } = await plant(19, { locus_mains: { 'main-1': v19Main({ id: 'main-1' }) }, loci: rows })
    const before = bytesOf(file)

    const result = run(file, '--yes')

    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(message)
    expectUntouched(file, dir, before)
  })

  it('spec Scenario "旧形状预检与最终校验分离"', async () => {
    // Valid under v19 (topic M ≠ group M is allowed there), not v20-shaped at all.
    const { file } = await plant(19, bb0eRows())
    const script = readFileSync(SCRIPT, 'utf8')
    // The old-shape proof is the script's own analysis, never the v19 Host validator.
    expect(script).not.toContain('persistence.js')
    expect(script).toContain('locus-set-v20.js')

    const result = run(file, '--yes')

    expect(result.status, result.stderr).toBe(0)
    expect(v20Violations(file)).toEqual([])
  })

  it('spec Scenario "整形结果校验失败时回滚"', async () => {
    // v19 only proves `childSessionId` unique; a reserved id equal to another
    // row's child is legal there and a duplicate `sessionId` in v20.
    const { dir, file } = await plant(19, {
      locus_mains: { 'main-1': v19Main({ id: 'main-1' }) },
      loci: {
        a: v19Row({ id: 'a', chatId: 'oc_a', child: 'S' }),
        b: v19Row({ id: 'b', chatId: 'oc_b', state: 'not-created', child: null, reserved: 'S' }),
      },
    })
    const before = snapshotPetTables(file)

    const result = run(file, '--yes')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('DUPLICATE_SESSION_ID')
    expect(result.stderr).toContain('rolled back')
    expect(stampedVersion(file)).toBe(19)
    expect(snapshotPetTables(file)).toEqual(before)
    const backups = backupsOf(dir)
    expect(backups).toHaveLength(1)
    expect(snapshotPetTables(path.join(dir, backups[0]!))).toEqual(before)
  })

  it('spec Scenario "从 v18 迁移时先清除旧模型行"', async () => {
    const old = (id: string) => ({ ...v19Row({ id, chatId: `oc_${id}`, main: 'user-session', source: 'explicit' }), childComposition: 'safe-v2' })
    const { dir, file } = await plant(18, {
      locus_mains: { 'main-1': v19Main({ id: 'main-1' }) },
      loci: {
        'old-1': old('old-1'), 'old-2': old('old-2'), 'old-3': old('old-3'),
        'keep-1': v19Row({ id: 'keep-1', chatId: 'oc_keep1' }),
        'keep-2': v19Row({ id: 'keep-2', chatId: 'oc_keep2' }),
      },
      locus_deliveries: {
        'd-1': v19Delivery('d-1', 'old-1', 'child-old-1'), 'd-2': v19Delivery('d-2', 'old-1', 'child-old-1'),
        'd-3': v19Delivery('d-3', 'old-2', 'child-old-2'), 'd-4': v19Delivery('d-4', 'old-3', 'child-old-3'),
        'd-keep': v19Delivery('d-keep', 'keep-1', 'child-keep-1'),
      },
      locus_permission_audit: { 'a-old': { locusId: 'old-1' }, 'a-keep': { locusId: 'keep-1' } },
      locus_operations: { 'op-old': { id: 'op-old', phase: 'committed', oldLocusId: 'old-2' } },
    })
    const before = snapshotPetTables(file)

    const result = run(file, '--yes')

    expect(result.status, result.stderr).toBe(0)
    expect(stampedVersion(file)).toBe(20)
    expect(Object.keys(loci(file)).sort()).toEqual(['oc_keep1', 'oc_keep2'])
    expect(loci(file).oc_keep1).toMatchObject({ locusId: 'keep-1', sessionId: 'child-keep-1' })
    expect(Object.keys(readTable(file, 'locus_deliveries')!)).toEqual(['d-keep'])
    expect(Object.keys(readTable(file, 'locus_permission_audit')!)).toEqual(['a-keep'])
    expect(readTable(file, 'locus_operations')).toEqual({})
    const [backup] = backupsOf(dir)
    expect(backup).toMatch(/\.v18\.bak-\d+$/)
    expect(snapshotPetTables(path.join(dir, backup!))).toEqual(before)
    expect(v20Violations(file)).toEqual([])
  })

  it('spec Scenario "从更早版本迁移时全部 locus 行都是旧模型"', async () => {
    const old = (id: string) => ({ ...v19Row({ id, chatId: `oc_${id}`, main: 'user-session', source: 'explicit' }), childComposition: 'safe-v2' })
    const { dir, file } = await plant(17, {
      loci: { 'old-1': old('old-1'), 'old-2': old('old-2') },
      locus_deliveries: { 'd-1': v19Delivery('d-1', 'old-1', 'child-old-1') },
    })
    dropTable(file, 'locus_mains')
    const before = snapshotPetTables(file)
    expect(before.locus_mains).toBeUndefined()

    const result = run(file, '--yes')

    expect(result.status, result.stderr).toBe(0)
    const [backup] = backupsOf(dir)
    expect(backup).toMatch(/\.v17\.bak-\d+$/)
    expect(snapshotPetTables(path.join(dir, backup!))).toEqual(before)
    expect(stampedVersion(file)).toBe(20)
    const after = snapshotPetTables(file)
    expect(after.locus_mains).toEqual([])
    expect(after.loci).toEqual([])
    expect(after.locus_deliveries).toEqual([])
  })

  it('spec Scenario "预检后版本已变化"', async () => {
    const { dir, file } = await plant(19, bb0eRows())
    const before = snapshotPetTables(file)

    const result = await runWithWriterInWindow(file, holder => {
      holder.prepare('UPDATE units SET version = 20 WHERE name = ?').run('dsh_pet')
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Already at the target version')
    expect(backupsOf(dir)).toEqual([])
    expect(stampedVersion(file)).toBe(20)
    expect(snapshotPetTables(file)).toEqual(before)
  })

  it('spec Scenario "已是目标版本时无操作"', async () => {
    const { dir, file } = await plant(20, {})
    const before = bytesOf(file)

    const result = run(file, '--yes')

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Already at the target version')
    expectUntouched(file, dir, before)
  })

  it('spec Scenario "升级需离线迁移并先备份"', async () => {
    const { dir, file } = await plant(19, bb0eRows())
    const bytesBefore = readFileSync(file)
    const rowsBefore = snapshotPetTables(file)

    const result = run(file, '--yes')

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Migrated 19 → 20')
    const [backup] = backupsOf(dir)
    expect(backup).toMatch(/^state\.sqlite\.v19\.bak-\d+$/)
    expect(readFileSync(path.join(dir, backup!))).toEqual(bytesBefore)
    expect(snapshotPetTables(path.join(dir, backup!))).toEqual(rowsBefore)
    expect(stampedVersion(file)).toBe(20)
  })
})
