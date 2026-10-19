/**
 * Pet's own `StorageBackend`: the guarantees that used to come from patching
 * four upstream packages must hold now that they come from a registered
 * backend instead.
 *
 * These pin BEHAVIOR, not wiring: a batch is all-or-nothing, the medium is
 * owned by exactly one process, an undeclared table rejects the whole
 * transaction before anything is durable, and a missing unit fails closed
 * rather than degrading to per-record writes.
 */
import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isMediumLocked, PetStorageBackend, PetStorageError } from '../src/host/storage/backend.js'
import { runAtomicDomain, withAtomicWrites } from '../src/host/storage/atomic-domain.js'
import Storage, { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'

const SPEC = {
  name: 'dsh_pet_probe',
  version: 1,
  tables: ['tasks', 'invocations'] as const,
  hasGlobal: true,
}

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'pet-backend-'))
  return { dir, file: join(dir, 'state.sqlite'), dispose: () => rmSync(dir, { recursive: true, force: true }) }
}

async function openUnit(file: string) {
  const backend = new PetStorageBackend(file)
  const unit = await backend.kv.open({ ...SPEC, tables: [...SPEC.tables] })
  return { backend, unit }
}

type LifecycleUnit = {
  loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }>
  putRecord(table: string, key: string, value: unknown): Promise<void>
  deleteRecord(table: string, key: string): Promise<void>
  setGlobal(value: unknown): Promise<void>
  applyBatch(writes: readonly { kind: 'put' | 'delete' | 'global'; table?: string; key?: string; value?: unknown }[]): Promise<void>
  close(): Promise<void>
}

let lifecycleDomainId = 0
async function openOfficialDomain(unit: LifecycleUnit) {
  const id = ++lifecycleDomainId
  const backendName = `pet_lifecycle_${id}`
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = { kv: { open: async () => unit } }
  await ctx.plugin({
    name: `pet-lifecycle-backend-${id}`,
    inject: ['storage'],
    apply(c: Context) {
      c.effect(() => c.storage.backend.register(backendName, backend as never))
      c.provide(storageBackendServiceKey(backendName), backend as never)
    },
  })
  await ctx.plugin(StorageDomain, { backend: backendName })
  const domain = await ctx.storage.domain.open(StorageDomain.defineDomain({
    name: `pet_lifecycle_${id}`,
    version: 1,
    tables: { counter: StorageDomain.domainTable(z.unknown()) },
  }))
  withAtomicWrites(domain as never, unit)
  return { ctx, domain: domain as typeof domain & {
    transaction(body: (tx: { put(table: string, key: string, value: unknown): void }) => void): Promise<void>
  } }
}

describe('PetStorageBackend medium ownership', () => {
  it('claims the medium exclusively at open time, not at first write', async () => {
    const s = scratch()
    const first = new PetStorageBackend(s.file)
    try {
      await first.whenReady()
      // A second backend on the same file must fail HERE, while it is still
      // only opening — not later, when it may already believe it owns state.
      const second = new PetStorageBackend(s.file)
      await expect(second.whenReady()).rejects.toMatchObject({
        name: 'PetStorageError', code: 'medium-locked',
      })
      await second.close()
    } finally {
      await first.close()
      s.dispose()
    }
  })

  it('claims the medium on an EXISTING database, where the pragma alone would not', async () => {
    // The sharp case. `PRAGMA locking_mode = EXCLUSIVE` is lazy: SQLite takes
    // the lock at the next write, not when the pragma is set. On a fresh file
    // the schema bootstrap happens to write, so the lock is taken as a side
    // effect and a second opener is refused even without the forced
    // acquisition — which makes the fresh-file case unable to detect its
    // absence. On an EXISTING database every `CREATE TABLE IF NOT EXISTS` is
    // a no-op, nothing writes, and a second Host would sail straight in and
    // start processing the same durable work. Measured: without the forced
    // `BEGIN IMMEDIATE`/`COMMIT`, the second opener succeeds here.
    const s = scratch()
    try {
      const seed = new PetStorageBackend(s.file)
      await seed.whenReady()
      const unit = await seed.kv.open({ ...SPEC, tables: [...SPEC.tables] })
      await unit.close()
      await seed.close()

      const owner = new PetStorageBackend(s.file)
      await owner.whenReady()
      try {
        const intruder = new PetStorageBackend(s.file)
        await expect(intruder.whenReady()).rejects.toMatchObject({
          name: 'PetStorageError', code: 'medium-locked',
        })
        await intruder.close()
      } finally { await owner.close() }
    } finally { s.dispose() }
  })

  it('releases the medium on close so a later process can take it', async () => {
    const s = scratch()
    try {
      const first = new PetStorageBackend(s.file)
      await first.whenReady()
      await first.close()

      const second = new PetStorageBackend(s.file)
      await expect(second.whenReady()).resolves.toBeDefined()
      await second.close()
    } finally { s.dispose() }
  })

  it('refuses a unit whose medium stamp disagrees with the descriptor', async () => {
    const s = scratch()
    try {
      const a = await openUnit(s.file)
      await a.unit.close()
      await a.backend.close()

      const b = new PetStorageBackend(s.file)
      try {
        await expect(b.kv.open({ ...SPEC, tables: [...SPEC.tables], version: SPEC.version + 1 }))
          .rejects.toMatchObject({ name: 'PetStorageError', code: 'version-mismatch' })
      } finally { await b.close() }
    } finally { s.dispose() }
  })
})

describe('applyBatch', () => {
  it('persists every write in the batch', async () => {
    const s = scratch()
    const { backend, unit } = await openUnit(s.file)
    try {
      await unit.applyBatch([
        { kind: 'put', table: 'tasks', key: 'a', value: { label: 'one' } },
        { kind: 'put', table: 'invocations', key: 'b', value: { label: 'two' } },
        { kind: 'global', value: { generation: 2 } },
      ])
      const snapshot = await unit.loadAll()
      expect(snapshot.tables.tasks?.a).toEqual({ label: 'one' })
      expect(snapshot.tables.invocations?.b).toEqual({ label: 'two' })
      expect(snapshot.global).toEqual({ generation: 2 })
    } finally { await unit.close(); await backend.close(); s.dispose() }
  })

  it('persists NOTHING when one write in the batch is invalid', async () => {
    const s = scratch()
    const { backend, unit } = await openUnit(s.file)
    try {
      await unit.applyBatch([{ kind: 'put', table: 'tasks', key: 'seed', value: { label: 'before' } }])
      await expect(unit.applyBatch([
        { kind: 'put', table: 'tasks', key: 'a', value: { label: 'staged' } },
        { kind: 'put', table: 'nonexistent', key: 'b', value: {} },
      ])).rejects.toThrow(/declared no table/)

      const snapshot = await unit.loadAll()
      expect(snapshot.tables.tasks?.a).toBeUndefined()
      // The pre-existing row proves the rollback did not also discard history.
      expect(snapshot.tables.tasks?.seed).toEqual({ label: 'before' })
    } finally { await unit.close(); await backend.close(); s.dispose() }
  })

  it('leaves the medium writable after a failed batch', async () => {
    // Asserting only the rejection would pass even with the ROLLBACK removed:
    // the next writer would then inherit an open transaction and fail with
    // "cannot start a transaction within a transaction", turning one bad
    // write into a permanently dead store.
    const s = scratch()
    const { backend, unit } = await openUnit(s.file)
    try {
      await expect(unit.applyBatch([
        { kind: 'put', table: 'tasks', key: 'a', value: {} },
        { kind: 'put', table: 'nope', key: 'b', value: {} },
      ])).rejects.toThrow()

      await unit.applyBatch([{ kind: 'put', table: 'tasks', key: 'after', value: { ok: true } }])
      const snapshot = await unit.loadAll()
      expect(snapshot.tables.tasks?.after).toEqual({ ok: true })
    } finally { await unit.close(); await backend.close(); s.dispose() }
  })

  it('treats an empty batch as a no-op', async () => {
    const s = scratch()
    const { backend, unit } = await openUnit(s.file)
    try {
      await expect(unit.applyBatch([])).resolves.toBeUndefined()
    } finally { await unit.close(); await backend.close(); s.dispose() }
  })

  it('rejects once the unit is closed', async () => {
    const s = scratch()
    const { backend, unit } = await openUnit(s.file)
    try {
      await unit.close()
      await expect(unit.applyBatch([{ kind: 'put', table: 'tasks', key: 'a', value: {} }]))
        .rejects.toMatchObject({ name: 'PetStorageError', code: 'closed' })
    } finally { await backend.close(); s.dispose() }
  })
})

/** Minimal stand-in for the official Domain's write surface. */
function fakeDomain(options: { failPut?: (table: string, key: string) => boolean } = {}) {
  const tables = new Map<string, Map<string, unknown>>()
  let globalValue: unknown
  const declared = new Set(['tasks', 'invocations'])
  const domain = {
    table(name: string) {
      if (!declared.has(name)) throw new Error(`domain declared no table '${name}'`)
      const rows = tables.get(name) ?? new Map<string, unknown>()
      tables.set(name, rows)
      return {
        get: (key: string) => rows.get(key),
        put: async (key: string, value: unknown) => {
          if (options.failPut?.(name, key) === true) throw new Error(`injected view replay failure ${name}:${key}`)
          rows.set(key, value)
        },
        delete: async (key: string) => { rows.delete(key) },
      }
    },
    global: { get: () => globalValue, set: async (v: unknown) => { globalValue = v } },
  }
  return { domain, read: (t: string, k: string) => tables.get(t)?.get(k), count: (t: string) => tables.get(t)?.size ?? 0 }
}

describe('withAtomicWrites', () => {
  it('advertises support only when a unit is present', () => {
    const fx = fakeDomain()
    expect((withAtomicWrites(fx.domain, undefined) as { supportsTransaction?: boolean }).supportsTransaction).toBe(false)
    const fx2 = fakeDomain()
    const unit = { applyBatch: async () => {} }
    expect((withAtomicWrites(fx2.domain, unit) as { supportsTransaction?: boolean }).supportsTransaction).toBe(true)
  })

  it('fails closed without a unit, applying nothing', async () => {
    const fx = fakeDomain()
    await expect(runAtomicDomain(fx.domain, undefined, (tx) => { tx.put('tasks', 'a', {}) }))
      .rejects.toMatchObject({ name: 'AtomicDomainError', code: 'medium-unavailable' })
    expect(fx.count('tasks')).toBe(0)
  })

  it('applies nothing when the body throws', async () => {
    const fx = fakeDomain()
    const committed: unknown[] = []
    const unit = { applyBatch: async (w: readonly unknown[]) => { committed.push(...w) } }
    await expect(runAtomicDomain(fx.domain, unit, (tx) => {
      tx.put('tasks', 'a', { label: 'staged' })
      throw new Error('refused by the model layer')
    })).rejects.toThrow('refused by the model layer')
    expect(committed).toEqual([])
    expect(fx.count('tasks')).toBe(0)
  })

  it('rejects an undeclared table BEFORE committing to the medium', async () => {
    const fx = fakeDomain()
    const committed: unknown[] = []
    const unit = { applyBatch: async (w: readonly unknown[]) => { committed.push(...w) } }
    await expect(runAtomicDomain(fx.domain, unit, (tx) => {
      tx.put('tasks', 'a', { label: 'fine' })
      tx.put('undeclared', 'b', {})
    })).rejects.toThrow(/declared no table/)
    expect(committed).toEqual([])
    expect(fx.count('tasks')).toBe(0)
  })

  it('refreshes the domain view after the medium commits', async () => {
    const fx = fakeDomain()
    const order: string[] = []
    const unit = { applyBatch: async () => { order.push('medium') } }
    const domain = withAtomicWrites(fx.domain, unit)
    await (domain as unknown as { transaction(b: (tx: { put(t: string, k: string, v: unknown): void }) => void): Promise<void> })
      .transaction((tx) => { tx.put('tasks', 'a', { label: 'one' }) })
    order.push('view')
    expect(order).toEqual(['medium', 'view'])
    expect(fx.read('tasks', 'a')).toEqual({ label: 'one' })
  })

  it('fails closed after a committed batch cannot fully refresh the Domain view', async () => {
    let failReplay = true
    const fx = fakeDomain({ failPut: table => table === 'invocations' && failReplay })
    const batches: unknown[][] = []
    const unit = { applyBatch: async (writes: readonly unknown[]) => { batches.push([...writes]) } }
    const domain = withAtomicWrites(fx.domain, unit) as typeof fx.domain & {
      transaction(body: (tx: { put(table: string, key: string, value: unknown): void }) => void): Promise<void>
    }

    await expect(domain.transaction(tx => {
      tx.put('tasks', 'answer', { state: 'committed' })
      tx.put('invocations', 'resume', { state: 'pending' })
    })).rejects.toMatchObject({ name: 'AtomicDomainError', code: 'view-corrupted' })
    expect(fx.read('tasks', 'answer')).toEqual({ state: 'committed' })
    expect(fx.read('invocations', 'resume')).toBeUndefined()
    expect(batches).toHaveLength(1)

    failReplay = false
    let nextBodyRan = false
    await expect(domain.transaction(() => { nextBodyRan = true }))
      .rejects.toMatchObject({ name: 'AtomicDomainError', code: 'view-corrupted' })
    expect(nextBodyRan).toBe(false)
    expect(batches).toHaveLength(1)
  })

  it('serializes each read-modify-write through commit and view refresh', async () => {
    const fx = fakeDomain()
    await fx.domain.table('tasks').put('counter', { value: 0 })

    let releaseFirst!: () => void
    let enteredFirst!: () => void
    const firstCommit = new Promise<void>(resolve => { releaseFirst = resolve })
    const firstStarted = new Promise<void>(resolve => { enteredFirst = resolve })
    let commits = 0
    let bodies = 0
    const unit = {
      applyBatch: async () => {
        commits += 1
        if (commits === 1) {
          enteredFirst()
          await firstCommit
        }
      },
    }
    const domain = withAtomicWrites(fx.domain, unit) as typeof fx.domain & {
      transaction(body: (tx: { put(table: string, key: string, value: unknown): void }) => void): Promise<void>
    }
    const increment = () => domain.transaction(tx => {
      bodies += 1
      const current = domain.table('tasks').get('counter') as { value: number }
      tx.put('tasks', 'counter', { value: current.value + 1 })
    })

    const first = increment()
    await firstStarted
    const second = increment()
    expect(bodies).toBe(1)
    releaseFirst()
    await Promise.all([first, second])

    expect(fx.read('tasks', 'counter')).toEqual({ value: 2 })
    expect(bodies).toBe(2)
  })

  it('drains accepted transactions before official Domain.close, including synchronous commits', async () => {
    const medium = { tables: { counter: {} as Record<string, unknown> }, global: null as unknown }
    let closed = false
    let releaseFirst!: () => void
    let enteredFirst!: () => void
    const firstStarted = new Promise<void>(resolve => { enteredFirst = resolve })
    const held = new Promise<void>(resolve => { releaseFirst = resolve })
    let calls = 0
    const unit: LifecycleUnit = {
      loadAll: async () => structuredClone(medium),
      putRecord: async (table, key, value) => {
        expect(closed).toBe(false)
        medium.tables[table]![key] = value
      },
      deleteRecord: async (table, key) => { delete medium.tables[table]![key] },
      setGlobal: async value => { medium.global = value },
      async applyBatch(writes) {
        expect(closed).toBe(false)
        calls += 1
        if (calls === 1) { enteredFirst(); await held }
        for (const write of writes) {
          if (write.kind === 'put') medium.tables[write.table!]![write.key!] = write.value
        }
      },
      close: async () => { closed = true },
    }
    const { ctx, domain } = await openOfficialDomain(unit)
    try {
      const first = domain.transaction(tx => tx.put('counter', 'first', { count: 1 }))
      await firstStarted
      let secondBodyRan = false
      const second = domain.transaction(tx => {
        secondBodyRan = true
        tx.put('counter', 'second', { count: 2 })
      })
      let bodyRanAfterClose = false
      const closing = domain.close()
      const rejected = domain.transaction(() => { bodyRanAfterClose = true })
      await expect(rejected).rejects.toMatchObject({ name: 'AtomicDomainError', code: 'domain-closing' })
      await expect(domain.table('counter').put('ordinary', { count: 9 }))
        .rejects.toMatchObject({ name: 'DomainError', code: 'closed' })
      expect(bodyRanAfterClose).toBe(false)
      expect(secondBodyRan).toBe(false)
      expect(closed).toBe(false)
      releaseFirst()
      await Promise.all([first, second, closing])
      expect(medium.tables.counter).toEqual({ first: { count: 1 }, second: { count: 2 } })
      expect(closed).toBe(true)
      await domain.close()
      expect(closed).toBe(true)
    } finally {
      releaseFirst()
      await domain.close()
      await ctx.fiber.dispose()
    }
  })

  it('drains an accepted immediate transaction, drains after failed transactions, and closes a corrupted view', async () => {
    const medium = { tables: { counter: {} as Record<string, unknown> }, global: null as unknown }
    let closed = false
    let failReplay = false
    let rejectCommit = false
    const unit: LifecycleUnit = {
      loadAll: async () => structuredClone(medium),
      putRecord: async (table, key, value) => {
        expect(closed).toBe(false)
        if (failReplay) throw new Error('injected replay failure')
        medium.tables[table]![key] = value
      },
      deleteRecord: async (table, key) => { delete medium.tables[table]![key] },
      setGlobal: async value => { medium.global = value },
      applyBatch(writes) {
        expect(closed).toBe(false)
        if (rejectCommit) return Promise.reject(new Error('commit rejected'))
        for (const write of writes) {
          if (write.kind === 'put') medium.tables[write.table!]![write.key!] = write.value
        }
        return Promise.resolve()
      },
      close: async () => { closed = true },
    }
    const { ctx, domain } = await openOfficialDomain(unit)
    try {
      const immediate = domain.transaction(tx => tx.put('counter', 'fast', { count: 1 }))
      const closeFast = domain.close()
      await Promise.all([immediate, closeFast])
      expect(medium.tables.counter.fast).toEqual({ count: 1 })
      expect(closed).toBe(true)
    } finally { await domain.close(); await ctx.fiber.dispose() }

    // A separate official Domain verifies clean transaction rejection cannot
    // poison the drain, while postcommit corruption remains closable.
    closed = false
    failReplay = true
    const second = await openOfficialDomain(unit)
    try {
      await expect(second.domain.transaction(tx => tx.put('counter', 'broken', { count: 2 })))
        .rejects.toMatchObject({ name: 'AtomicDomainError', code: 'view-corrupted' })
      failReplay = false
      await second.domain.close()
      expect(closed).toBe(true)
    } finally { await second.domain.close(); await second.ctx.fiber.dispose() }

    closed = false
    rejectCommit = true
    const third = await openOfficialDomain(unit)
    try {
      await expect(third.domain.transaction(() => { throw new Error('body rejected') })).rejects.toThrow('body rejected')
      await expect(third.domain.transaction(tx => tx.put('counter', 'commit-fails', { count: 3 }))).rejects.toThrow('commit rejected')
      rejectCommit = false
      await expect(third.domain.transaction(tx => tx.put('counter', 'after-rejection', { count: 4 }))).resolves.toBeUndefined()
      await third.domain.close()
      expect(closed).toBe(true)
    } finally { await third.domain.close(); await third.ctx.fiber.dispose() }
  })

  it('commits a real batch end to end through the backend unit', async () => {
    const s = scratch()
    const { backend, unit } = await openUnit(s.file)
    const fx = fakeDomain()
    try {
      const domain = withAtomicWrites(fx.domain, unit)
      await (domain as unknown as { transaction(b: (tx: { put(t: string, k: string, v: unknown): void }) => void): Promise<void> })
        .transaction((tx) => {
          tx.put('tasks', 'a', { label: 'one' })
          tx.put('invocations', 'b', { label: 'two' })
        })
      const snapshot = await unit.loadAll()
      expect(snapshot.tables.tasks?.a).toEqual({ label: 'one' })
      expect(snapshot.tables.invocations?.b).toEqual({ label: 'two' })
      expect(fx.read('tasks', 'a')).toEqual({ label: 'one' })
    } finally { await unit.close(); await backend.close(); s.dispose() }
  })
})

describe('isMediumLocked', () => {
  it('recognises both spellings SQLite uses for contention', () => {
    expect(isMediumLocked({ message: 'database is locked' })).toBe(true)
    // The exclusive lock can block the handshake itself, and SQLite then
    // reports an empty error string. Observed live while trying to back up
    // Pet's database with the Host running.
    expect(isMediumLocked({ message: 'not an error' })).toBe(true)
    expect(isMediumLocked({ message: 'no such table: tasks' })).toBe(false)
    expect(isMediumLocked(undefined)).toBe(false)
  })
})
