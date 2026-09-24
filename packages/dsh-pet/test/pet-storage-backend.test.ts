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
function fakeDomain() {
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
        put: async (key: string, value: unknown) => { rows.set(key, value) },
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
