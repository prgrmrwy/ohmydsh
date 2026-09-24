import { execFile } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'

const exec = promisify(execFile)
let root: string | undefined
afterEach(async () => { if (root !== undefined) await rm(root, { recursive: true, force: true }) })

describe('unified locus cutover backup', () => {
  it('creates an integrity-checked SQLite snapshot without mutating the source', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pet-cutover-'))
    const source = path.join(root, 'state.sqlite')
    const output = path.join(root, 'snapshot.sqlite')
    const db = new DatabaseSync(source)
    db.exec("CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES ('preserved')")
    db.close()

    const result = await exec(process.execPath, [
      path.resolve('scripts/cutover-backup.mjs'), '--database', source, '--output', output,
    ])
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, integrity: 'ok', snapshot: output })
    const snapshot = new DatabaseSync(output, { readOnly: true })
    expect(snapshot.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
    expect(snapshot.prepare('SELECT value FROM proof').get()).toEqual({ value: 'preserved' })
    snapshot.close()
    expect(await readFile(source)).not.toHaveLength(0)
  })

  it('rehearses an offline rollback without down-migrating v9 or deleting external resources', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pet-rollback-'))
    const live = path.join(root, 'state.sqlite')
    const preCutover = path.join(root, 'pre-cutover.sqlite')
    const preservedV9 = path.join(root, 'state.v9.preserved.sqlite')
    const sessionLog = path.join(root, 'session-child.log')
    const externalResource = path.join(root, 'feishu-group.resource')
    const stoppedProof = path.join(root, 'consumer.stopped')

    // The rehearsal starts only after the consumer stop gate is explicit. The
    // backup utility intentionally cannot manufacture this operational proof.
    await writeFile(stoppedProof, 'stopped-before-snapshot\n')
    const old = new DatabaseSync(live)
    old.exec(`
      CREATE TABLE units(name TEXT PRIMARY KEY, version INTEGER);
      INSERT INTO units VALUES ('dsh_pet', 8);
      CREATE TABLE u_dsh_pet_tasks(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE u_dsh_pet_chat_bindings(key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO u_dsh_pet_tasks VALUES ('ordinary-task', '{"kind":"wheel"}');
      INSERT INTO u_dsh_pet_chat_bindings VALUES ('legacy-chat', '{"chatId":"legacy"}');
    `)
    old.close()
    await exec(process.execPath, [
      path.resolve('scripts/cutover-backup.mjs'), '--database', live, '--output', preCutover,
    ])

    // Model post-cutover state and resources. Rollback must preserve this v9
    // database for forward resume and must not treat groups/sessions as rows to
    // be destructively projected back into the old schema.
    const current = new DatabaseSync(live)
    current.exec(`
      UPDATE units SET version = 9 WHERE name = 'dsh_pet';
      CREATE TABLE u_dsh_pet_loci(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE u_dsh_pet_locus_deliveries(key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO u_dsh_pet_loci VALUES ('locus-new', '{"generation":1}');
      INSERT INTO u_dsh_pet_locus_deliveries VALUES ('delivery-new', '{"status":"queued"}');
    `)
    current.close()
    await writeFile(sessionLog, 'durable child history\n')
    await writeFile(externalResource, 'existing Feishu group\n')

    // Exact runbook move: stop is already proven, preserve v9 byte-for-byte,
    // then restore the compatible snapshot as the active old-version medium.
    await rename(live, preservedV9)
    await copyFile(preCutover, live)

    const restored = new DatabaseSync(live, { readOnly: true })
    expect(restored.prepare('SELECT version FROM units WHERE name = ?').get('dsh_pet'))
      .toEqual({ version: 8 })
    expect(restored.prepare('SELECT key FROM u_dsh_pet_tasks').all())
      .toEqual([{ key: 'ordinary-task' }])
    expect(restored.prepare('SELECT key FROM u_dsh_pet_chat_bindings').all())
      .toEqual([{ key: 'legacy-chat' }])
    expect(restored.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%locus%'").all())
      .toEqual([])
    restored.close()

    const forward = new DatabaseSync(preservedV9, { readOnly: true })
    expect(forward.prepare('SELECT version FROM units WHERE name = ?').get('dsh_pet'))
      .toEqual({ version: 9 })
    expect(forward.prepare('SELECT key FROM u_dsh_pet_loci').all())
      .toEqual([{ key: 'locus-new' }])
    expect(forward.prepare('SELECT key FROM u_dsh_pet_locus_deliveries').all())
      .toEqual([{ key: 'delivery-new' }])
    forward.close()

    expect(await readFile(stoppedProof, 'utf8')).toContain('stopped-before-snapshot')
    expect(await readFile(sessionLog, 'utf8')).toContain('durable child history')
    expect(await readFile(externalResource, 'utf8')).toContain('existing Feishu group')
  })
})
