/**
 * Cleanup of Pet state written by the previous copy-and-digest Skill model.
 *
 * These tests drive a real SQLite file, because the cleanup deliberately runs
 * against the database rather than the domain: `storageDomain.open` validates
 * every stored record up front, so a cleanup layered on top of an opened
 * domain could never run on the state that needs it.
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { removeLegacyState } from '../src/host/migrate.js'
import { PET_DOMAIN_VERSION } from '../src/host/spec.js'

/** Build a database stamped as the previous domain version. */
async function legacyDatabase(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'pet-migrate-'))
  const file = path.join(dir, 'state.sqlite')
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE units (name TEXT PRIMARY KEY, version INTEGER)')
  db.prepare('INSERT INTO units VALUES (?, ?)').run('dsh_pet', 1)
  for (const table of ['skill_revisions', 'skill_selections', 'invocations', 'tasks']) {
    db.exec(`CREATE TABLE u_dsh_pet_${table} (key TEXT PRIMARY KEY, value TEXT)`)
  }
  db.prepare('INSERT INTO u_dsh_pet_skill_revisions VALUES (?, ?)').run(
    'demo@sha256:abc',
    JSON.stringify({ skillName: 'demo', digest: 'sha256:abc', description: 'demo' }),
  )
  db.prepare('INSERT INTO u_dsh_pet_skill_selections VALUES (?, ?)').run(
    'demo',
    JSON.stringify({ skillName: 'demo', enabledDigest: 'sha256:abc', showAsShortcut: true }),
  )
  db.prepare('INSERT INTO u_dsh_pet_invocations VALUES (?, ?)').run(
    'inv-1',
    JSON.stringify({ id: 'inv-1', skillName: 'demo', skillDigest: 'sha256:abc' }),
  )
  db.prepare('INSERT INTO u_dsh_pet_tasks VALUES (?, ?)').run(
    'task-1',
    JSON.stringify({ id: 'task-1', status: 'idle' }),
  )
  db.close()
  return file
}

describe('legacy Pet state is cleared before the domain opens', () => {
  it('drops rows that predate the registration model', async () => {
    const file = await legacyDatabase()

    const result = removeLegacyState(file)

    // Without this the domain rejects at open and Pet degrades on a Host that
    // was previously working, with no way to clear it from the UI.
    expect(result.removedRows).toBeGreaterThan(0)
    expect(result.clearedTables).toContain('skill_revisions')
    expect(result.clearedTables).toContain('invocations')
  })

  it('clears the whole work graph when an Invocation is dropped', async () => {
    const file = await legacyDatabase()

    removeLegacyState(file)

    // Keeping a Task whose Invocation is gone would strand work that can
    // never settle and never be archived.
    const db = new DatabaseSync(file, { readOnly: true })
    const tasks = db.prepare('SELECT COUNT(*) AS c FROM u_dsh_pet_tasks').get() as { c: number }
    db.close()
    expect(tasks.c).toBe(0)
  })

  it('restamps the medium only after the rows are gone', async () => {
    const file = await legacyDatabase()

    removeLegacyState(file)

    const db = new DatabaseSync(file, { readOnly: true })
    const unit = db.prepare('SELECT version FROM units WHERE name = ?').get('dsh_pet') as {
      version: number
    }
    db.close()
    expect(unit.version).toBe(PET_DOMAIN_VERSION)
  })

  it('is idempotent across repeated boots', async () => {
    const file = await legacyDatabase()
    removeLegacyState(file)

    expect(removeLegacyState(file)).toEqual({ removedRows: 0, clearedTables: [] })
  })

  it('tolerates a database that does not exist yet', () => {
    expect(removeLegacyState('/tmp/dsh-pet-does-not-exist/state.sqlite')).toEqual({
      removedRows: 0,
      clearedTables: [],
    })
  })
})

describe('cleanup never creates the database', () => {
  it('leaves an absent file absent', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pet-migrate-'))
    const file = path.join(dir, 'state.sqlite')

    removeLegacyState(file)

    // Creating it here would defeat the later ownership proof, which treats
    // "the file exists after a durable write" as evidence the write landed at
    // Pet's configured path rather than a foreign medium.
    const { existsSync } = await import('node:fs')
    expect(existsSync(file)).toBe(false)
  })
})
