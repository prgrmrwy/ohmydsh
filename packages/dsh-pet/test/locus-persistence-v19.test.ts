/**
 * v19 persistence: the Pet domain carries only three-tier locus rows.
 *
 * Illegal rows are planted straight into SQLite (support/pet-sqlite.ts), never
 * pushed through a typed writer: the point is what the Host does with bytes an
 * older version or a hand edit left behind.
 */
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { buildLocusRecord, endpointKeyOf, type LocusRecord } from '../src/host/locus/aggregate.js'
import { endpointIndexKey, LocusRepository } from '../src/host/locus/persistence.js'
import { PET_DOMAIN_VERSION, type PetLocusMainRecord } from '../src/host/spec.js'
import { emptyMedium, openPetHarness } from './harness.js'
import { enableAtomicTransactions } from './support/three-tier.js'
import { legacyTodoBackend } from '../src/host/ledger/backend.js'
import { SharedFactLedgerStore } from '../src/host/ledger/store.js'
import { retiredInquiryOwnerProjection } from '../src/host/inquiry/retired-history.js'
import { loadPetHost, openDomainOnly, openPetDomain, type LoadedHost } from './support/pet-host-fixture.js'
import { seedPetState, snapshotPetTables, tempPetHome, type RawRows } from './support/pet-sqlite.js'

const hosts: LoadedHost[] = []
afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.close()))
})

function main(overrides: Partial<PetLocusMainRecord> = {}): PetLocusMainRecord {
  return {
    locusMainSessionId: 'main-1',
    workSessionId: 'work-1',
    generation: 1,
    status: 'active',
    spaceId: 'space-1',
    workspaceId: 'ws-pet',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function locus(overrides: Partial<Parameters<typeof buildLocusRecord>[0]> = {}): LocusRecord {
  return buildLocusRecord({
    id: 'locus-a',
    endpoint: { chatId: 'oc_a' },
    parentSessionId: 'main-1',
    childSessionId: 'child-a',
    childComposition: 'tier3',
    workspaceId: 'ws-1',
    source: 'auto',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  })
}

/** The bytes SQLite would hold: a JSON round trip, with edits applied to the raw object. */
function plain(record: LocusRecord, edit: (row: Record<string, unknown>) => void = () => {}): Record<string, unknown> {
  const row = JSON.parse(JSON.stringify(record)) as Record<string, unknown>
  edit(row)
  return row
}

async function startOver(rows: Parameters<typeof seedPetState>[2], expectDegraded: boolean): Promise<LoadedHost> {
  const { home, file } = tempPetHome()
  await seedPetState(file, PET_DOMAIN_VERSION, rows)
  const host = await loadPetHost([], home, undefined, undefined, { expectDegraded })
  hosts.push(host)
  return host
}

describe('v19 persistence carries only three-tier locus rows', () => {
  it('spec Scenario "safe-v1 行继续服务"', async () => {
    const host = await startOver({
      locus_mains: { 'main-1': main() },
      loci: { 'locus-a': plain(locus(), row => { row.childComposition = 'safe-v1' }) },
    }, true)

    expect(host.degradedDiagnostics.join('\n')).toContain('locus-a')
    expect(host.routes).toEqual([])
  })

  it('spec Scenario "升级前的 legacy child 不可恢复服务"', async () => {
    const host = await startOver({
      locus_mains: { 'main-1': main() },
      loci: { 'locus-a': plain(locus(), row => { delete row.childComposition }) },
    }, true)

    expect(host.degradedDiagnostics.join('\n')).toContain('locus-a')
    expect(host.routes).toEqual([])
  })

  it('spec Scenario "非 tier3 marker 使 Domain 打开失败"', async () => {
    const host = await startOver({
      locus_mains: { 'main-1': main() },
      loci: { 'locus-a': plain(locus(), row => { row.childComposition = 'safe-v2' }) },
    }, true)

    expect(host.degradedDiagnostics.join('\n')).toContain('locus-a')
    expect(host.routes).toEqual([]) // no management route, hence no Feishu intake either
  })

  it('spec Scenario "合规数据正常就绪"', async () => {
    const host = await startOver({
      locus_mains: { 'main-1': main() },
      loci: { 'locus-a': plain(locus()) },
    }, false)

    expect(host.degradedDiagnostics).toEqual([])
    expect(host.routes.length).toBeGreaterThan(0)
  })

  it('spec Scenario "未创建 child 的历史行可以没有 marker": persistence part', async () => {
    const stopped = locus({ id: 'locus-s', endpoint: { chatId: 'oc_s' }, state: 'stopped', childSessionId: undefined, childComposition: undefined, updatedAt: 2, stoppedAt: 2 })
    const invalid = locus({ id: 'locus-i', endpoint: { chatId: 'oc_i' }, state: 'invalid', childSessionId: undefined, childComposition: undefined, updatedAt: 2, invalidReason: 'locus main replaced' })
    const host = await startOver({
      locus_mains: { 'main-1': main() },
      loci: { 'locus-s': plain(stopped), 'locus-i': plain(invalid) },
    }, false)

    expect(host.degradedDiagnostics).toEqual([])
    expect(host.routes.length).toBeGreaterThan(0)
  })

  it('spec Scenario "无配对的行使启动对账失败"', async () => {
    const host = await startOver({
      // The row's parent session has no locus_mains record.
      loci: { 'locus-a': plain(locus()) },
    }, true)

    expect(host.degradedDiagnostics.join('\n')).toContain('locus-a')
    expect(host.routes).toEqual([]) // no management route, so no intake either
  })

  it('spec Scenario "启动早期的冷恢复不读到悬空索引": the repair resolves pending application from the remaining rows', async () => {
    const retained = locus({
      id: 'g1', generation: 1, permission: { desired: 'write', effective: 'read' },
    })
    const medium = emptyMedium()
    medium.version = PET_DOMAIN_VERSION
    // A migrated database: the endpoint index still names a deleted previous-model row.
    const dangling = endpointIndexKey(retained.endpoint)
    medium.tables.locus_mains = { 'main-1': JSON.stringify(main()) }
    medium.tables.loci = { g1: JSON.stringify(retained) }
    medium.tables.locus_indexes = {
      [dangling]: JSON.stringify({ kind: 'endpoint-current', key: dangling, locusIds: ['g2-deleted'], updatedAt: 1 }),
    }
    const harness = await openPetHarness(medium)
    try {
      enableAtomicTransactions(harness)
      const repository = new LocusRepository(harness.domain)
      const resolve = () => repository.resolvePendingApplication({
        locusId: 'g1', generation: 1, childSessionId: 'child-a', expectedRevision: 0, now: 5,
        permission: { desired: 'write', effective: 'write', verifiedAt: 5, grantedBy: 'owner' },
      })

      // Without the repair the early cold resume dereferences the deleted row.
      await expect(resolve()).rejects.toThrow(/invalid locus/)
      expect(repository.getLocus('g1')?.permission.effective).toBe('read') // nothing half-applied

      await repository.repairDerivedIndexes()

      expect(repository.getCurrentLocus(retained.endpoint)?.id).toBe('g1')
      await expect(resolve()).resolves.toMatchObject({ id: 'g1', permission: { desired: 'write', effective: 'write' } })
      expect(JSON.stringify(medium.tables.locus_indexes)).not.toContain('g2-deleted')
    } finally { await harness.close() }
  })

  it('spec Scenario "启动早期的冷恢复不读到悬空索引": Pet repairs indexes before it registers any index reader', async () => {
    // `agent/created` is the early reader: its handler asks the repository
    // whether the new session is a locus main. Probe with a fake session id
    // while the repair is running; the handler must not exist yet.
    const probes: string[] = []
    const original = LocusRepository.prototype.repairDerivedIndexes
    const lookup = LocusRepository.prototype.getLocusMain
    vi.spyOn(LocusRepository.prototype, 'getLocusMain').mockImplementation(function (this: LocusRepository, id: string) {
      if (id.startsWith('probe-')) probes.push(id)
      return lookup.call(this, id)
    })
    let root: Context | undefined
    let repairs = 0
    vi.spyOn(LocusRepository.prototype, 'repairDerivedIndexes').mockImplementation(async function (this: LocusRepository, ...args) {
      const result = await original.apply(this, args)
      repairs += 1
      await root!.serial('agent/created' as never, { agent: { id: 'probe-during-repair', ctx: {} } } as never).catch(() => undefined)
      return result
    })
    try {
      const { home, file } = tempPetHome()
      await seedPetState(file, PET_DOMAIN_VERSION, { locus_mains: { 'main-1': main() }, loci: { 'locus-a': plain(locus()) } })
      const host = await loadPetHost([], home, undefined, async ctx => { root = ctx })
      hosts.push(host)
      expect(repairs).toBe(1)
      expect(probes).toEqual([]) // no reader existed when the repair finished

      // Not vacuous: once Pet is up the same probe reaches the handler.
      await host.ctx.serial('agent/created' as never, { agent: { id: 'probe-after-start', ctx: {} } } as never).catch(() => undefined)
      expect(probes).toEqual(['probe-after-start'])
    } finally { vi.restoreAllMocks() }
  })
})

// -- a database that the real migration script has already processed -----------------

const MIGRATE = new URL('../scripts/migrate-state-version.mjs', import.meta.url).pathname

function previousModelRow(id: string, chatId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, generation: 1, endpoint: { chatId }, parentSessionId: 'user-session', childSessionId: `child-${id}`,
    childComposition: 'safe-v2', workspaceId: 'ws-1', source: 'qa-created', state: 'active',
    permission: { desired: 'read', effective: 'read' }, busy: false, createdAt: 1, updatedAt: 1, ...extra,
  }
}

/** Seed a v18 database, run the real script with --yes, and return its file. */
async function migrated(rows: RawRows): Promise<string> {
  const { file } = tempPetHome()
  await seedPetState(file, 18, rows)
  const result = spawnSync(process.execPath, [MIGRATE, '--db', file, '--yes'], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return file
}

async function withDomain<T>(file: string, body: (domain: Awaited<ReturnType<typeof openPetDomain>> & Record<string, never>) => Promise<T>): Promise<T> {
  const ctx = await openDomainOnly(file)
  try {
    const domain = await openPetDomain(ctx)
    try { return await body(domain as never) } finally { await (domain as unknown as { close(): Promise<void> }).close() }
  } finally { await ctx.fiber.dispose() }
}

describe('a database the offline migration has processed', () => {
  it('spec Scenario "迁移后的库能打开并完成启动对账"', async () => {
    const shared = { chatId: 'oc_shared' }
    const file = await migrated({
      locus_mains: { 'main-1': main() },
      loci: {
        'old-1': previousModelRow('old-1', 'oc_shared'),
        'keep-g2': plain(locus({ id: 'keep-g2', endpoint: shared, generation: 2, state: 'not-created', childSessionId: undefined, childComposition: undefined, replacesLocusId: 'old-1', source: 'qa-created', updatedAt: 2, createdAt: 2 })),
        'keep-1': plain(locus({ id: 'keep-1', endpoint: { chatId: 'oc_keep1' }, childSessionId: 'child-keep-1' })),
      },
      locus_indexes: {
        'endpoint:oc_shared': { kind: 'endpoint-current', key: 'endpoint:oc_shared', locusIds: ['keep-g2'], updatedAt: 1 },
        'parent:user-session': { kind: 'parent-loci', key: 'parent:user-session', locusIds: ['old-1'], updatedAt: 1 },
        'child:child-old-1': { kind: 'child-locus', key: 'child:child-old-1', locusIds: ['old-1'], updatedAt: 1 },
        // The default Q&A pointer names a row the migration deletes.
        'default-qa:user-session': { kind: 'default-qa', key: 'default-qa:user-session', locusIds: ['old-1'], updatedAt: 1 },
      },
    })

    await withDomain(file, async domain => {
      const repository = new LocusRepository(domain as never)
      const report = await repository.reconcileStartup({ now: 50 })
      expect(report.indexStatus).toBe('rebuilt')

      const indexes = Object.fromEntries([...(domain as never as { table(name: string): { entries(): Iterable<[string, { kind: string; locusIds: string[] }]> } }).table('locus_indexes').entries()]
        .map(([key, value]) => [key, [value.kind, ...value.locusIds]]))
      expect(indexes).toEqual({
        'endpoint:oc_shared': ['endpoint-current', 'keep-g2'],
        'endpoint:oc_keep1': ['endpoint-current', 'keep-1'],
        'parent:main-1': ['parent-loci', 'keep-1', 'keep-g2'],
        'child:child-keep-1': ['child-locus', 'keep-1'],
      })
      expect(JSON.stringify(indexes)).not.toContain('old-1')
    })
  })

  it('spec Scenario "删除历史前代后保留行仍可服务与重建"', async () => {
    const endpoint = { chatId: 'oc_e' }
    const file = await migrated({
      locus_mains: { 'main-1': main() },
      loci: {
        'e-1': previousModelRow('e-1', 'oc_e', { generation: 1, state: 'invalid' }),
        'e-2': plain(locus({ id: 'e-2', endpoint, generation: 2, state: 'invalid', childSessionId: undefined, childComposition: undefined, replacesLocusId: 'e-1', updatedAt: 2, createdAt: 2 })),
        'e-3': plain(locus({ id: 'e-3', endpoint, generation: 3, state: 'not-created', childSessionId: undefined, childComposition: undefined, replacesLocusId: 'e-2', updatedAt: 3, createdAt: 3 })),
      },
    })

    await withDomain(file, async domain => {
      const repository = new LocusRepository(domain as never)
      await repository.reconcileStartup({ now: 50 })
      expect(repository.getLocus('e-1')).toBeUndefined()
      expect(repository.getLocus('e-2')).toMatchObject({ generation: 2, replacesLocusId: 'e-1' }) // dangling on purpose
      expect(repository.getLocus('e-3')).toMatchObject({ generation: 3, replacesLocusId: 'e-2' })

      await repository.beginProvisioning({ provisioningId: 'prov-4', kind: 'regenerate', endpoint, startedAt: 60 })
      const successor = locus({ id: 'e-4', endpoint, generation: 4, state: 'not-created', childSessionId: undefined, childComposition: undefined, replacesLocusId: 'e-3', createdAt: 61, updatedAt: 61 })
      await repository.commitRegeneration({ provisioningId: 'prov-4', entries: [{ oldLocusId: 'e-3', reason: 'owner rebuild', locus: successor }] })

      expect(repository.getCurrentLocus(endpoint)).toMatchObject({ id: 'e-4', generation: 4 })
      expect(repository.getLocus('e-3')).toMatchObject({ state: 'invalid' })
    })
  })

  it('spec Scenario "非 locus 表不受影响且仍可读取"', async () => {
    // Real, schema-valid rows from the stores that own them, naming a locus the migration deletes.
    const ledger = await openPetHarness()
    const store = new SharedFactLedgerStore(ledger.domain as never)
    enableAtomicTransactions(ledger)
    await store.registerTodoItem({
      itemId: 'todo-old', parentSessionId: 'user-session', locusId: 'old-1', generation: 1, endpoint: { chatId: 'oc_old1' },
      triggerMessageId: 'om_1', requestedBy: 'ou_a', evidence: { summary: 'legacy todo', detail: 'registered before the migration' }, createdAt: 10,
    })
    const todoRows = ledger.medium.tables
    const requester = { kind: 'main', sessionId: 'user-session' }
    const target = { kind: 'child', sessionId: 'child-old-1', locusId: 'old-1', generation: 1 }
    const inquiry = {
      id: 'inq-old', requester, target, circleParentSessionId: 'user-session', question: 'q', purpose: 'p', origin: { kind: 'local' },
      audience: { kind: 'local-session', sessionId: 'user-session' }, trace: { rootInquiryId: 'inq-old', depth: 1, visited: [requester, target] },
      createdAt: 1, status: 'executing', statusAt: 2, reason: null, appliedEventIds: [], diagnostics: [], droppedDiagnostics: 0,
    }
    const parse = (table: string): Record<string, unknown> => Object.fromEntries(Object.entries(todoRows[table] ?? {}).map(([key, raw]) => [key, JSON.parse(raw)]))
    const planted: RawRows = {
      locus_mains: { 'main-1': main() },
      loci: { 'old-1': previousModelRow('old-1', 'oc_old1'), 'keep-1': plain(locus({ id: 'keep-1' })) },
      ledger_item: parse('ledger_item'),
      shared_fact_ledger: parse('shared_fact_ledger'),
      inquiries: { 'inq-old': inquiry },
    }
    await ledger.close()
    expect(Object.keys(planted.ledger_item ?? {})).toEqual(['todo-old'])

    const { file } = tempPetHome()
    await seedPetState(file, 18, planted)
    const before = snapshotPetTables(file)
    const result = spawnSync(process.execPath, [MIGRATE, '--db', file, '--yes'], { encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)

    const after = snapshotPetTables(file)
    for (const table of ['ledger_item', 'shared_fact_ledger', 'inquiries']) expect(after[table]).toEqual(before[table])
    await withDomain(file, async domain => {
      const todos = await legacyTodoBackend(new SharedFactLedgerStore(domain as never)).listForParent('user-session')
      expect(todos.map(todo => todo.itemId)).toEqual(['todo-old'])
      const rows = [...(domain as never as { table(name: string): { entries(): Iterable<[string, unknown]> } }).table('inquiries').entries()].map(([, row]) => row)
      expect(retiredInquiryOwnerProjection(rows, { parentSessionId: 'user-session' })).toEqual({
        inquiry: { dispatchCapability: 'unavailable', snapshotStatus: 'available', inquiries: [{ inquiryId: 'inq-old', status: 'executing', createdAt: 1 }] },
      })
    })
  })
})
