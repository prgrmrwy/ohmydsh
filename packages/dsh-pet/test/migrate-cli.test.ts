import { execFileSync, spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PET_DOMAIN_VERSION } from '../src/host/spec.js'

const SCRIPT = path.resolve('scripts/migrate-state-version.mjs')

function database(version: number): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'pet-migrate-cli-'))
  const file = path.join(dir, 'state.sqlite')
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE units (name TEXT PRIMARY KEY, version INTEGER)')
  db.prepare('INSERT INTO units VALUES (?, ?)').run('dsh_pet', version)
  db.exec('CREATE TABLE u_dsh_pet_tasks (key TEXT PRIMARY KEY, value TEXT)')
  db.prepare('INSERT INTO u_dsh_pet_tasks VALUES (?, ?)').run('task-1', '{"id":"task-1"}')
  db.close()
  return { dir, file }
}

function stamped(file: string): number {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    return (db.prepare('SELECT version FROM units WHERE name = ?').get('dsh_pet') as { version: number }).version
  } finally {
    db.close()
  }
}

describe('dsh-pet-migrate-state CLI', () => {
  it('checks an additive migration without writing in --dry-run mode', () => {
    const { dir, file } = database(5)
    const output = execFileSync(process.execPath, [SCRIPT, '--db', file, '--dry-run'], { encoding: 'utf8' })

    expect(output).toContain('[dry-run] Would restamp 5')
    expect(output).toContain('Re-run with --yes')
    expect(stamped(file)).toBe(5)
    expect(readdirSync(dir).filter(name => name.includes('.bak-'))).toEqual([])
  })

  it('refuses an unconfirmed write', () => {
    const { dir, file } = database(5)
    const result = spawnSync(process.execPath, [SCRIPT, '--db', file], { encoding: 'utf8' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('not confirmed')
    expect(result.stderr).toContain('No write was performed')
    expect(stamped(file)).toBe(5)
    expect(readdirSync(dir).filter(name => name.includes('.bak-'))).toEqual([])
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

  it('fails closed while a Host-like owner holds the database lock', () => {
    const { dir, file } = database(5)
    const owner = new DatabaseSync(file)
    owner.exec('PRAGMA locking_mode = EXCLUSIVE')
    owner.exec('BEGIN IMMEDIATE')
    try {
      const result = spawnSync(process.execPath, [SCRIPT, '--db', file, '--yes'], { encoding: 'utf8' })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('database is locked')
      expect(result.stderr).toContain('Stop DSH first')
      expect(readdirSync(dir).filter(name => name.includes('.bak-'))).toEqual([])
    } finally {
      owner.exec('ROLLBACK')
      owner.close()
    }
    expect(stamped(file)).toBe(5)
  })

  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10])('backs up v%s, restamps to the current version without changing history, and is idempotent', version => {
    const { dir, file } = database(version)
    const seed = new DatabaseSync(file)
    // Include opaque malformed history and local facts: restamping is not
    // permission to normalize rows, infer modes, or promote local anchors.
    const history = '{ "parentSessionId": "parent", "contextAnchor": {"projectResources":["local-only"]} }'
    for (const table of ['loci', 'chat_bindings', 'invocation_channel', 'locus_operations']) {
      seed.exec(`CREATE TABLE u_dsh_pet_${table} (key TEXT PRIMARY KEY, value TEXT)`)
      seed.prepare(`INSERT INTO u_dsh_pet_${table} VALUES (?, ?)`).run('retained', history)
    }
    seed.prepare('INSERT INTO units VALUES (?, ?)').run('other_domain', 77)
    const beforeTables = seed.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
    seed.close()
    const logFile = path.join(dir, 'session.jsonl')
    writeFileSync(logFile, 'old parent and child transcript\n')
    const logBefore = readFileSync(logFile)

    const first = execFileSync(process.execPath, [SCRIPT, '--db', file, '--yes'], { encoding: 'utf8' })
    expect(first).toContain(`Restamped ${version} → ${PET_DOMAIN_VERSION}`)
    expect(stamped(file)).toBe(PET_DOMAIN_VERSION)
    const backups = readdirSync(dir).filter(name => name.includes(`.v${version}.bak-`))
    expect(backups).toHaveLength(1)
    expect(stamped(path.join(dir, backups[0]!))).toBe(version)
    for (const target of [file, path.join(dir, backups[0]!)]) {
      const db = new DatabaseSync(target, { readOnly: true })
      try {
        expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()).toEqual(beforeTables)
        expect(db.prepare('SELECT value FROM u_dsh_pet_tasks').get()).toEqual({ value: '{"id":"task-1"}' })
        for (const table of ['loci', 'chat_bindings', 'invocation_channel', 'locus_operations']) {
          expect(db.prepare(`SELECT value FROM u_dsh_pet_${table}`).get()).toEqual({ value: history })
        }
        expect(db.prepare('SELECT version FROM units WHERE name = ?').get('other_domain')).toEqual({ version: 77 })
        expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
      } finally { db.close() }
    }
    expect(readFileSync(logFile)).toEqual(logBefore)

    const second = execFileSync(process.execPath, [SCRIPT, '--db', file, '--yes'], { encoding: 'utf8' })
    expect(second).toContain('Already at the target version')
    expect(readdirSync(dir).filter(name => name.includes('.bak-'))).toEqual(backups)
  })

  it.each([1, 0, -1, PET_DOMAIN_VERSION + 1, 999])('refuses unsupported v%s without backup or mutation', version => {
    const { dir, file } = database(version)
    const before = readFileSync(file)
    const result = spawnSync(process.execPath, [SCRIPT, '--db', file, '--yes'], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(version === 1 ? 'separate explicit legacy cleanup' : 'Unsupported Pet storage version')
    expect(readFileSync(file)).toEqual(before)
    expect(readdirSync(dir).filter(name => name.includes('.bak-'))).toEqual([])
  })
})
