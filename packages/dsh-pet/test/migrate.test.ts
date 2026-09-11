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

describe('a healthy older medium upgrades additively without losing anything', () => {
  /** Build a database stamped v3 whose rows are already in the current shape. */
  async function v3Database(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'pet-migrate-'))
    const file = path.join(dir, 'state.sqlite')
    const db = new DatabaseSync(file)
    db.exec('CREATE TABLE units (name TEXT PRIMARY KEY, version INTEGER)')
    db.prepare('INSERT INTO units VALUES (?, ?)').run('dsh_pet', 3)
    for (const table of [
      'skill_revisions',
      'skill_selections',
      'invocations',
      'tasks',
      'workspace_env',
    ]) {
      db.exec(`CREATE TABLE u_dsh_pet_${table} (key TEXT PRIMARY KEY, value TEXT)`)
    }
    db.prepare('INSERT INTO u_dsh_pet_skill_revisions VALUES (?, ?)').run(
      'ws',
      JSON.stringify({
        skillName: 'ws',
        sourcePath: '/tmp/ws',
        description: 'Worktree Session operations',
        provenance: { kind: 'local-link', sourcePath: '/tmp/ws', installedAt: 1 },
        fileCount: 1,
        totalBytes: 32,
      }),
    )
    // A v3 Task carries no `residentWorkspaceId`: every pre-channel Task ran
    // in the dedicated Pet workspace. The field is optional precisely so these
    // rows keep validating.
    db.prepare('INSERT INTO u_dsh_pet_tasks VALUES (?, ?)').run(
      'task-1',
      JSON.stringify({ id: 'task-1', status: 'idle', sourceKind: 'session' }),
    )
    db.prepare('INSERT INTO u_dsh_pet_workspace_env VALUES (?, ?)').run(
      'global\u0000CR_GROUP',
      JSON.stringify({ scope: 'global', key: 'CR_GROUP', value: 'oc_x', updatedAt: 1 }),
    )
    db.close()
    return file
  }

  it('restamps v3 straight to the current version with nothing to clean', async () => {
    const file = await v3Database()

    const result = removeLegacyState(file)

    // The channel and QA bumps only ADD tables and optional fields, so no
    // existing row is incompatible.
    expect(result).toEqual({ removedRows: 0, clearedTables: [] })

    const db = new DatabaseSync(file)
    try {
      const stamped = db.prepare('SELECT version FROM units WHERE name = ?').get('dsh_pet') as {
        version: number
      }
      // Restamped to the CURRENT version rather than the next one: every bump
      // since v3 has been additive, so the medium is readable at the current
      // schema without a row being touched. Asserted against the constant, so
      // a later additive bump needs no edit here — a hardcoded number would
      // only re-fail on every bump without proving anything extra.
      expect(stamped.version).toBe(PET_DOMAIN_VERSION)
    } finally {
      db.close()
    }
  })

  it('keeps Tasks, Skills and environment entries across the channel bump', async () => {
    const file = await v3Database()

    removeLegacyState(file)

    const db = new DatabaseSync(file)
    try {
      const tasks = db.prepare('SELECT COUNT(*) AS c FROM u_dsh_pet_tasks').get() as { c: number }
      const skills = db.prepare('SELECT COUNT(*) AS c FROM u_dsh_pet_skill_revisions').get() as {
        c: number
      }
      const env = db.prepare('SELECT COUNT(*) AS c FROM u_dsh_pet_workspace_env').get() as {
        c: number
      }

      expect(tasks.c).toBe(1)
      expect(skills.c).toBe(1)
      expect(env.c).toBe(1)
    } finally {
      db.close()
    }
  })

  it('is idempotent when run twice', async () => {
    const file = await v3Database()

    removeLegacyState(file)
    const second = removeLegacyState(file)

    expect(second).toEqual({ removedRows: 0, clearedTables: [] })
    const db = new DatabaseSync(file)
    try {
      const stamped = db.prepare('SELECT version FROM units WHERE name = ?').get('dsh_pet') as {
        version: number
      }
      expect(stamped.version).toBe(PET_DOMAIN_VERSION)
      const tasks = db.prepare('SELECT COUNT(*) AS c FROM u_dsh_pet_tasks').get() as { c: number }
      expect(tasks.c).toBe(1)
    } finally {
      db.close()
    }
  })
})

describe('v6 upgrades additively to the switch-notice schema', () => {
  it('restamps a v6 medium and keeps its locus rows intact', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pet-migrate-'))
    const file = path.join(dir, 'state.sqlite')
    const db = new DatabaseSync(file)
    db.exec('CREATE TABLE units (name TEXT PRIMARY KEY, version INTEGER)')
    db.prepare('INSERT INTO units VALUES (?, ?)').run('dsh_pet', 6)
    // A medium already carrying unified locus data: the new notice table is
    // additive, so none of this may be touched.
    for (const table of ['loci', 'locus_indexes', 'locus_deliveries', 'tasks']) {
      db.exec(`CREATE TABLE u_dsh_pet_${table} (key TEXT PRIMARY KEY, value TEXT)`)
    }
    db.prepare('INSERT INTO u_dsh_pet_loci VALUES (?, ?)').run(
      'locus-1',
      JSON.stringify({ id: 'locus-1', generation: 1, state: 'active' }),
    )
    db.prepare('INSERT INTO u_dsh_pet_tasks VALUES (?, ?)').run('task-1', JSON.stringify({ id: 'task-1' }))
    db.close()

    expect(removeLegacyState(file)).toEqual({ removedRows: 0, clearedTables: [] })

    const after = new DatabaseSync(file, { readOnly: true })
    try {
      expect(after.prepare('SELECT version FROM units WHERE name = ?').get('dsh_pet'))
        .toEqual({ version: PET_DOMAIN_VERSION })
      // Both the locus row and the ordinary Pet row survive verbatim.
      expect(after.prepare('SELECT COUNT(*) AS c FROM u_dsh_pet_loci').get()).toEqual({ c: 1 })
      expect(after.prepare('SELECT COUNT(*) AS c FROM u_dsh_pet_tasks').get()).toEqual({ c: 1 })
    } finally {
      after.close()
    }
  })
})

describe('every additive locus version upgrades without data loss', () => {
  it.each([6, 7, 8])('restamps a v%s medium and keeps its rows intact', async (from) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pet-migrate-'))
    const file = path.join(dir, 'state.sqlite')
    const db = new DatabaseSync(file)
    db.exec('CREATE TABLE units (name TEXT PRIMARY KEY, version INTEGER)')
    db.prepare('INSERT INTO units VALUES (?, ?)').run('dsh_pet', from)
    for (const table of ['loci', 'locus_switch_notices', 'tasks']) {
      db.exec(`CREATE TABLE u_dsh_pet_${table} (key TEXT PRIMARY KEY, value TEXT)`)
    }
    db.prepare('INSERT INTO u_dsh_pet_loci VALUES (?, ?)').run('locus-1', JSON.stringify({ id: 'locus-1' }))
    db.prepare('INSERT INTO u_dsh_pet_tasks VALUES (?, ?)').run('task-1', JSON.stringify({ id: 'task-1' }))
    db.close()

    expect(removeLegacyState(file)).toEqual({ removedRows: 0, clearedTables: [] })

    const after = new DatabaseSync(file, { readOnly: true })
    try {
      expect(after.prepare('SELECT version FROM units WHERE name = ?').get('dsh_pet'))
        .toEqual({ version: PET_DOMAIN_VERSION })
      // Locus data and ordinary Pet data both survive an additive bump.
      expect(after.prepare('SELECT COUNT(*) AS c FROM u_dsh_pet_loci').get()).toEqual({ c: 1 })
      expect(after.prepare('SELECT COUNT(*) AS c FROM u_dsh_pet_tasks').get()).toEqual({ c: 1 })
    } finally {
      after.close()
    }
  })
})

describe('migration version fence protects retained history', () => {
  it.each([0, -1, 99])('rejects unsupported version %s before deleting or restamping', async version => {
    const file = await legacyDatabase()
    const before = new DatabaseSync(file)
    before.prepare('UPDATE units SET version = ? WHERE name = ?').run(version, 'dsh_pet')
    const rows = before.prepare('SELECT * FROM u_dsh_pet_invocations').all()
    before.close()

    expect(() => removeLegacyState(file)).toThrow(/Unsupported Pet storage version/)

    const after = new DatabaseSync(file, { readOnly: true })
    try {
      expect(after.prepare('SELECT version FROM units WHERE name = ?').get('dsh_pet')).toEqual({ version })
      expect(after.prepare('SELECT * FROM u_dsh_pet_invocations').all()).toEqual(rows)
      expect(after.prepare('SELECT COUNT(*) AS c FROM u_dsh_pet_tasks').get()).toEqual({ c: 1 })
    } finally {
      after.close()
    }
  })

  it.each([2, 3, 4, 5, PET_DOMAIN_VERSION])('never runs destructive v1 cleanup for version %s', async version => {
    // Even a row with old/malformed shape must be retained in a newer medium.
    // Domain validation may reject it, but upgrade is not deletion authority.
    const file = await legacyDatabase()
    const before = new DatabaseSync(file)
    before.prepare('UPDATE units SET version = ? WHERE name = ?').run(version, 'dsh_pet')
    const rows = before.prepare('SELECT * FROM u_dsh_pet_invocations').all()
    before.close()

    expect(removeLegacyState(file)).toEqual({ removedRows: 0, clearedTables: [] })

    const after = new DatabaseSync(file, { readOnly: true })
    try {
      expect(after.prepare('SELECT version FROM units WHERE name = ?').get('dsh_pet')).toEqual({ version: PET_DOMAIN_VERSION })
      expect(after.prepare('SELECT * FROM u_dsh_pet_invocations').all()).toEqual(rows)
      expect(after.prepare('SELECT COUNT(*) AS c FROM u_dsh_pet_tasks').get()).toEqual({ c: 1 })
    } finally {
      after.close()
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
