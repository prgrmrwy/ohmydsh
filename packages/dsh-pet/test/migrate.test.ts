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

describe('a healthy v2 medium upgrades to v3 without losing anything', () => {
  /** Build a database stamped v2 whose rows are already in the current shape. */
  async function v2Database(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'pet-migrate-'))
    const file = path.join(dir, 'state.sqlite')
    const db = new DatabaseSync(file)
    db.exec('CREATE TABLE units (name TEXT PRIMARY KEY, version INTEGER)')
    db.prepare('INSERT INTO units VALUES (?, ?)').run('dsh_pet', 2)
    for (const table of ['skill_revisions', 'skill_selections', 'invocations', 'tasks']) {
      db.exec(`CREATE TABLE u_dsh_pet_${table} (key TEXT PRIMARY KEY, value TEXT)`)
    }
    // A v2 row carries `sourcePath` (so it is NOT legacy) plus the `pet` block
    // v3 drops.
    db.prepare('INSERT INTO u_dsh_pet_skill_revisions VALUES (?, ?)').run(
      'ws',
      JSON.stringify({
        skillName: 'ws',
        sourcePath: '/tmp/ws',
        description: 'Worktree Session operations',
        pet: { label: 'WS', icon: '🧹', context: 'session-required' },
        provenance: { kind: 'local-link', sourcePath: '/tmp/ws', installedAt: 1 },
        fileCount: 1,
        totalBytes: 32,
      }),
    )
    db.prepare('INSERT INTO u_dsh_pet_tasks VALUES (?, ?)').run(
      'task-1',
      JSON.stringify({ id: 'task-1', status: 'idle' }),
    )
    db.close()
    return file
  }

  it('restamps the version even though there is nothing to clean', async () => {
    const file = await v2Database()

    const result = removeLegacyState(file)

    // Nothing is incompatible, so nothing is removed...
    expect(result).toEqual({ removedRows: 0, clearedTables: [] })

    // ...but the stamp MUST still advance. Leaving it at 2 makes
    // `storageDomain.open` reject the medium on the next boot and degrades a
    // Host that was working perfectly well.
    const db = new DatabaseSync(file)
    try {
      const stamped = db.prepare('SELECT version FROM units WHERE name = ?').get('dsh_pet') as {
        version: number
      }
      expect(stamped.version).toBe(PET_DOMAIN_VERSION)
    } finally {
      db.close()
    }
  })

  it('keeps every existing row, including Tasks and registered Skills', async () => {
    const file = await v2Database()

    removeLegacyState(file)

    const db = new DatabaseSync(file)
    try {
      const skills = db.prepare('SELECT key, value FROM u_dsh_pet_skill_revisions').all() as {
        key: string
        value: string
      }[]
      const tasks = db.prepare('SELECT COUNT(*) AS c FROM u_dsh_pet_tasks').get() as { c: number }

      expect(skills).toHaveLength(1)
      expect(tasks.c).toBe(1)
      // The dropped `pet` key may still sit in the stored JSON; zod strips it
      // on read, so the row loads and simply loses the declaration.
      expect(JSON.parse(skills[0]!.value)).toMatchObject({ skillName: 'ws', sourcePath: '/tmp/ws' })
    } finally {
      db.close()
    }
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
