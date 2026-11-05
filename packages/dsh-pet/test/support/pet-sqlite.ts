/**
 * Raw Pet state databases for migration and persistence tests.
 *
 * Rows are written straight through the backend's unit, with NO schema
 * validation, so a test can plant exactly the bytes an older Host (or a hand
 * edit) would have left. Always point these at a temp directory: the live
 * `~/.dsh/plugins/dsh-pet/state.sqlite` must never be a target.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PetStorageBackend } from '../../src/host/storage/backend.js'
import { PET_DOMAIN_NAME, petDomainSpec } from '../../src/host/spec.js'

export type PetTableName = keyof typeof petDomainSpec.tables & string

/** `table -> key -> JSON value` for the rows to plant. */
export type RawRows = Partial<Record<PetTableName, Record<string, unknown>>>

export function allPetTables(): string[] {
  return Object.keys((petDomainSpec as unknown as { tables: Record<string, unknown> }).tables)
}

/** A fresh temp directory laid out like `<home>/plugins/dsh-pet/state.sqlite`. */
export function tempPetHome(prefix = 'pet-v19-'): { readonly home: string; readonly file: string } {
  const home = mkdtempSync(path.join(tmpdir(), prefix))
  const directory = path.join(home, 'plugins', 'dsh-pet')
  mkdirSync(directory, { recursive: true })
  return { home, file: path.join(directory, 'state.sqlite') }
}

/**
 * Materialize a Pet medium stamped at `version` and plant raw rows.
 * @param file - database path (must be inside a temp directory).
 * @param version - the version stamp to write; may be older than the code's.
 * @param rows - raw rows by table; unknown tables are rejected by the backend.
 */
export async function seedPetState(file: string, version: number, rows: RawRows = {}): Promise<void> {
  const backend = new PetStorageBackend(file)
  const unit = await backend.kv.open({ name: PET_DOMAIN_NAME, version, tables: allPetTables(), hasGlobal: true })
  try {
    for (const [table, records] of Object.entries(rows)) {
      for (const [key, value] of Object.entries(records ?? {})) await unit.putRecord(table, key, value)
    }
  } finally {
    await unit.close()
    await backend.close()
  }
}

/** Every physical `u_dsh_pet_*` table as `[{key, value}]` sorted by key, read-only. */
export function snapshotPetTables(file: string): Record<string, { key: string; value: string }[]> {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const out: Record<string, { key: string; value: string }[]> = {}
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ? ORDER BY name").all(`u_${PET_DOMAIN_NAME}_%`) as { name: string }[]
    for (const { name } of tables) {
      out[name.slice(`u_${PET_DOMAIN_NAME}_`.length)] = db.prepare(`SELECT key, value FROM "${name}" ORDER BY key`).all() as { key: string; value: string }[]
    }
    return out
  } finally {
    db.close()
  }
}

export function stampedVersion(file: string): number {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    return (db.prepare('SELECT version FROM units WHERE name = ?').get(PET_DOMAIN_NAME) as { version: number }).version
  } finally {
    db.close()
  }
}
