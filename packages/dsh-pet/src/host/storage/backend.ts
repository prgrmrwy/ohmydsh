/**
 * Pet's own SQLite `StorageBackend`.
 *
 * WHY PET REGISTERS A BACKEND INSTEAD OF PATCHING ONE
 *
 * Pet needs two guarantees the official `sqlite` backend does not offer:
 *
 * 1. **Atomic multi-table commits.** A locus publication, an inquiry ledger
 *    row, an outbox row and a collaboration context must land completely or
 *    not at all — a half-written pair means two continuations for one
 *    question, or a published locus with no delivery.
 * 2. **Single-writer ownership of the medium.** Two Host processes must never
 *    both process the same durable work.
 *
 * These used to be added by patching four upstream packages (`storage`,
 * `storage-domain`, `storage-json`, `storage-sqlite`), which put all four
 * permanently inside Pet's compatibility overlay and forced 32 hunks to be
 * re-derived on every DSH version bump.
 *
 * That was never necessary. `@deepseek-ai/dsh-storage` exports the backend
 * contract (`StorageBackend`, `KvFacet`, `KvUnit`) and a public registry, and
 * documents routing as the CONSUMER's choice:
 *
 * > Multiple backends stay mounted side by side; which backend serves which
 * > consumer is the consumer's configuration (e.g. the domain layer's route
 * > table), never a hub-global choice.
 *
 * So Pet registers its own backend under its own name and routes only the
 * `dsh_pet` domain to it. Upstream is untouched, and everything above the
 * backend — schema validation, domain versioning and migration, the in-memory
 * view, the write queue, `domain/changed` emission — stays with the official
 * `storage-domain` layer.
 *
 * WHY THE CONNECTION HAS TO LIVE HERE
 *
 * SQLite's exclusive lock is held per CONNECTION. An earlier attempt kept the
 * official backend and opened a second connection beside it purely to own the
 * lock; the two connections then contended with each other and deadlocked the
 * Host on any path that needed both. Owning the connection is therefore not an
 * implementation detail but the reason this file exists: the transaction and
 * the lock must be the same handle the records are written through.
 *
 * @module dsh-pet/host/storage/backend
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

/** One staged write inside an atomic batch. */
export type StagedWrite =
  | { readonly kind: 'put'; readonly table: string; readonly key: string; readonly value: unknown }
  | { readonly kind: 'delete'; readonly table: string; readonly key: string }
  | { readonly kind: 'global'; readonly value: unknown }

/**
 * Whether a thrown medium error means another process owns the database.
 *
 * SQLite reports contention as a plain `ERR_SQLITE_ERROR` whose message is
 * either `database is locked` or — when the exclusive lock blocks even the
 * handshake — the notoriously unhelpful `not an error`. Both mean the same
 * thing to a caller: this process is not the writer. Classifying them here
 * keeps that string knowledge in one place instead of at every call site.
 * @param error - a thrown value from a medium operation.
 * @returns whether it means another process holds the medium.
 */
export function isMediumLocked(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message ?? '').toLowerCase()
  return message.includes('database is locked')
    || message.includes('database table is locked')
    || message === 'not an error'
}

/** Medium schema version for Pet's own unit bookkeeping. */
export const PET_MEDIUM_SCHEMA_VERSION = 1

/** Backend name Pet routes its domain to. Must match `cordis.patch.yml`. */
export const PET_BACKEND_NAME = 'pet-sqlite'

/** Same name rule upstream enforces: safe as a file name and a SQL identifier. */
const UNIT_NAME_RE = /^[a-zA-Z0-9_]+$/

/** Physical record-table name for one logical table inside one unit. */
function recordTableName(unit: string, table: string): string {
  return `u_${unit}_${table}`
}

/** The `KvUnitDescriptor` shape this backend consumes. */
export interface PetUnitDescriptor {
  readonly name: string
  readonly version: number
  readonly tables: readonly string[]
  readonly hasGlobal: boolean
}

/** Structured failure, mirroring upstream's `StorageError` codes. */
export class PetStorageError extends Error {
  constructor(readonly code: 'closed' | 'version-mismatch' | 'malformed-medium' | 'medium-locked', message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'PetStorageError'
  }
}

/**
 * Open the medium and claim it exclusively.
 *
 * `PRAGMA locking_mode = EXCLUSIVE` alone is lazy — SQLite defers the lock
 * until the first write. Forcing a trivial write transaction takes it now, so
 * a second Host fails at startup rather than midway through publishing a
 * locus. The lock is held by the OS for the life of the process, so an
 * ungraceful kill releases it with no lease, PID file or operator cleanup.
 */
async function openMedium(file: string): Promise<DatabaseSync> {
  await mkdir(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  try {
    // WAL is incompatible with an exclusive lock held across transactions;
    // `delete` keeps the single-file medium that backup tooling expects.
    db.exec('PRAGMA journal_mode = delete')
    db.exec('PRAGMA locking_mode = EXCLUSIVE')
    db.exec('BEGIN IMMEDIATE')
    db.exec('COMMIT')
  } catch (error: unknown) {
    db.close()
    if (isMediumLocked(error)) {
      throw new PetStorageError('medium-locked', `another process owns Pet storage at ${file}; refusing to start a second writer`, { cause: error })
    }
    throw error
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS units (name TEXT PRIMARY KEY, version INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS unit_globals (unit TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
  `)
  return db
}

/** One open unit on Pet's medium. */
export class PetKvUnit {
  private closed = false
  private readonly tables = new Map<string, { upsert: ReturnType<DatabaseSync['prepare']>; remove: ReturnType<DatabaseSync['prepare']>; selectAll: ReturnType<DatabaseSync['prepare']> }>()
  private readonly globalUpsert?: ReturnType<DatabaseSync['prepare']>
  private readonly globalSelect?: ReturnType<DatabaseSync['prepare']>

  constructor(
    private readonly db: DatabaseSync,
    private readonly descriptor: PetUnitDescriptor,
    private readonly onClose: () => void,
  ) {
    for (const table of descriptor.tables) {
      const physical = recordTableName(descriptor.name, table)
      this.tables.set(table, {
        upsert: db.prepare(`INSERT INTO "${physical}" (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`),
        remove: db.prepare(`DELETE FROM "${physical}" WHERE key = ?`),
        selectAll: db.prepare(`SELECT key, value FROM "${physical}"`),
      })
    }
    if (descriptor.hasGlobal) {
      this.globalUpsert = db.prepare('INSERT INTO unit_globals (unit, value) VALUES (?, ?) ON CONFLICT(unit) DO UPDATE SET value = excluded.value')
      this.globalSelect = db.prepare('SELECT value FROM unit_globals WHERE unit = ?')
    }
  }

  loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    return this.settle(() => {
      const tables: Record<string, Record<string, unknown>> = {}
      for (const [name, statements] of this.tables) {
        const records: Record<string, unknown> = Object.create(null)
        for (const row of statements.selectAll.all() as { key: string; value: string }[]) {
          records[row.key] = this.parseValue(row.value, `table '${name}' key '${row.key}'`)
        }
        tables[name] = records
      }
      let global: unknown = null
      if (this.globalSelect !== undefined) {
        const row = this.globalSelect.get(this.descriptor.name) as { value: string } | undefined
        if (row !== undefined) global = this.parseValue(row.value, 'global slot')
      }
      return { tables, global }
    })
  }

  putRecord(table: string, key: string, value: unknown): Promise<void> {
    return this.settle(() => { this.statementsFor(table).upsert.run(key, JSON.stringify(value)) })
  }

  deleteRecord(table: string, key: string): Promise<void> {
    return this.settle(() => { this.statementsFor(table).remove.run(key) })
  }

  setGlobal(value: unknown): Promise<void> {
    return this.settle(() => {
      if (this.globalUpsert === undefined) throw new Error(`kv unit '${this.descriptor.name}' declared no global slot`)
      this.globalUpsert.run(this.descriptor.name, JSON.stringify(value))
    })
  }

  /**
   * Commit several writes as ONE medium transaction.
   *
   * This is the member the whole backend exists for. `BEGIN IMMEDIATE` — not a
   * deferred `BEGIN` — makes contention surface here rather than at COMMIT,
   * when half the statements have already run. Any failure rolls the whole
   * batch back, so callers can throw from inside a batch body to veto it.
   */
  applyBatch(writes: readonly StagedWrite[]): Promise<void> {
    return this.settle(() => {
      if (writes.length === 0) return
      this.db.exec('BEGIN IMMEDIATE')
      try {
        for (const write of writes) {
          if (write.kind === 'global') {
            if (this.globalUpsert === undefined) throw new Error(`kv unit '${this.descriptor.name}' declared no global slot`)
            this.globalUpsert.run(this.descriptor.name, JSON.stringify(write.value))
          } else if (write.kind === 'put') {
            this.statementsFor(write.table).upsert.run(write.key, JSON.stringify(write.value))
          } else {
            this.statementsFor(write.table).remove.run(write.key)
          }
        }
        this.db.exec('COMMIT')
      } catch (error: unknown) {
        try { this.db.exec('ROLLBACK') } catch { /* the transaction is already gone */ }
        throw error
      }
    })
  }

  close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      this.onClose()
    }
    return Promise.resolve()
  }

  private parseValue(text: string, slot: string): unknown {
    try {
      return JSON.parse(text)
    } catch (error: unknown) {
      throw new PetStorageError('malformed-medium', `kv unit '${this.descriptor.name}' holds unparsable JSON at ${slot}`, { cause: error })
    }
  }

  private settle<T>(operation: () => T): Promise<T> {
    try {
      if (this.closed) throw new PetStorageError('closed', `kv unit '${this.descriptor.name}' is closed`)
      return Promise.resolve(operation())
    } catch (error: unknown) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private statementsFor(table: string) {
    const statements = this.tables.get(table)
    if (statements === undefined) throw new Error(`kv unit '${this.descriptor.name}' declared no table '${table}'`)
    return statements
  }
}

/**
 * Pet's `StorageBackend`: one database file, one exclusive connection, every
 * routed unit stored document-per-row.
 */
export class PetStorageBackend {
  readonly kv = { open: (descriptor: PetUnitDescriptor) => this.openUnit(descriptor) }
  private readonly ready: Promise<DatabaseSync>
  private readonly units = new Map<string, Promise<PetKvUnit>>()
  private closing?: Promise<void>

  constructor(file: string) {
    this.ready = openMedium(file)
    this.ready.catch(() => {})
  }

  /** Resolves once the medium is open and exclusively owned, or rejects. */
  whenReady(): Promise<unknown> {
    return this.ready
  }

  /**
   * The open unit for one domain name.
   *
   * The domain layer opens units through `kv.open` and keeps the handle to
   * itself, but Pet's atomic writes need the SAME unit — committing through a
   * second handle would mean a second connection, which is exactly the
   * contention this design exists to avoid. Reaching the unit by name keeps
   * the transaction on the one connection that owns the lock.
   *
   * @param name - the domain/unit name, e.g. `dsh_pet`.
   * @returns the open unit, or undefined when that name is not open.
   */
  unitFor(name: string): Promise<PetKvUnit | undefined> {
    const pending = this.units.get(name)
    if (pending === undefined) return Promise.resolve(undefined)
    return pending.catch(() => undefined)
  }

  private openUnit(descriptor: PetUnitDescriptor): Promise<PetKvUnit> {
    if (this.closing !== undefined) return Promise.reject(new PetStorageError('closed', 'Pet storage backend is closed'))
    if (!UNIT_NAME_RE.test(descriptor.name)) return Promise.reject(new Error(`kv unit name '${descriptor.name}' violates ${UNIT_NAME_RE}`))
    for (const table of descriptor.tables) {
      if (!UNIT_NAME_RE.test(table)) return Promise.reject(new Error(`kv table name '${table}' in unit '${descriptor.name}' violates ${UNIT_NAME_RE}`))
    }
    if (this.units.has(descriptor.name)) {
      return Promise.reject(new Error(`kv unit '${descriptor.name}' is already open (double-open is a caller bug)`))
    }
    const pending = this.materializeUnit(descriptor)
    this.units.set(descriptor.name, pending)
    pending.catch(() => this.units.delete(descriptor.name))
    return pending
  }

  private async materializeUnit(descriptor: PetUnitDescriptor): Promise<PetKvUnit> {
    const db = await this.ready
    const row = db.prepare('SELECT version FROM units WHERE name = ?').get(descriptor.name) as { version: number } | undefined
    if (row === undefined) {
      db.prepare('INSERT INTO units (name, version) VALUES (?, ?)').run(descriptor.name, descriptor.version)
    } else if (row.version !== descriptor.version) {
      // Same contract upstream states: the medium stamp is authoritative, and
      // a mismatch is a migration question rather than something to overwrite.
      throw new PetStorageError(
        'version-mismatch',
        `kv unit '${descriptor.name}' is stamped version ${row.version} on the medium, incompatible with descriptor version ${descriptor.version}`,
      )
    }
    for (const table of descriptor.tables) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS "${recordTableName(descriptor.name, table)}" (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        ) STRICT
      `)
    }
    return new PetKvUnit(db, descriptor, () => { this.units.delete(descriptor.name) })
  }

  close(): Promise<void> {
    this.closing ??= this.doClose()
    return this.closing
  }

  private async doClose(): Promise<void> {
    let db: DatabaseSync
    try {
      db = await this.ready
    } catch {
      return
    }
    for (const pending of [...this.units.values()]) await (await pending.catch(() => undefined))?.close()
    db.close()
  }
}
