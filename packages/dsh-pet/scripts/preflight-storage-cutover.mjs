#!/usr/bin/env node
/**
 * Pre-flight for the Pet storage cutover: back up the live database and prove
 * it is compatible with Pet's own backend BEFORE the Host restarts on it.
 *
 * WHY A CHECK AND NOT A MIGRATION
 *
 * Pet now serves its `dsh_pet` domain from its own registered storage backend
 * instead of the patched official one. That is a change of OWNER, not of
 * FORMAT: both write `u_<unit>_<table>` record tables, the same `units`
 * version stamp and the same `unit_globals` slot, so the existing file is read
 * as-is and no data has to be rewritten.
 *
 * The one runtime difference is the journal mode. The official backend uses
 * WAL; Pet's backend needs `delete`, because WAL is incompatible with holding
 * an exclusive lock across transactions. SQLite converts that in place on
 * open, losing nothing — this script proves the conversion works on a COPY
 * first, so a surprise is found here rather than during startup.
 *
 * Run this while the Host is still stopped. It never touches the live file.
 *
 * Usage:
 *   node scripts/preflight-storage-cutover.mjs            # back up + verify
 *   node scripts/preflight-storage-cutover.mjs --database <path> --output <path>
 */
import { constants } from 'node:fs'
import { access, copyFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'

function arg(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

const home = process.env.DSH_HOME ?? path.join(homedir(), '.dsh')
const source = path.resolve(arg('--database') ?? path.join(home, 'plugins', 'dsh-pet', 'state.sqlite'))
const stamp = new Date().toISOString().replaceAll(':', '-')
const destination = path.resolve(arg('--output') ?? `${source}.pre-storage-cutover-${stamp}.bak`)
const temporary = `${destination}.partial-${process.pid}`
const probe = `${destination}.probe-${process.pid}`

/** Report a fatal condition and stop: every failure here is a reason not to cut over. */
function fail(message, hint) {
  console.error(`\n✗ ${message}`)
  if (hint !== undefined) console.error(`  ${hint}`)
  process.exitCode = 1
}

/**
 * Whether a thrown SQLite error means the medium is held by another process.
 *
 * A live Host holds it under `locking_mode = EXCLUSIVE`, and SQLite reports
 * that as either `database is locked` or the singularly unhelpful
 * `not an error` — the latter when the lock blocks the handshake itself.
 */
function isLocked(error) {
  const message = String(error?.message ?? '').toLowerCase()
  return message.includes('locked') || message === 'not an error'
}

function human(bytes) {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

try {
  await access(source, constants.R_OK)

  // The Host must be stopped. A live Host holds the medium under
  // `locking_mode = EXCLUSIVE`, and `backup()` then fails with SQLite's
  // singularly unhelpful `not an error`. Detect it here and say what it means.
  let live
  try {
    live = new DatabaseSync(source, { readOnly: true })
  } catch (error) {
    if (isLocked(error)) {
      fail(
        'Pet 数据库正被占用,无法读取。',
        '说明 DSH Host 仍在运行。请先停止 Host(`dsh stop`),确认进程已退出后重试。',
      )
      process.exit(1)
    }
    throw error
  }

  console.log(`源库  : ${source}`)
  console.log(`备份至: ${destination}\n`)

  await mkdir(path.dirname(destination), { recursive: true })
  await rm(temporary, { force: true })
  try {
    await backup(live, temporary)
  } catch (error) {
    // The read-only handle can open while `backup()` still loses to the
    // exclusive lock, so this path needs the same diagnosis as the open above.
    if (isLocked(error)) {
      live.close()
      await rm(temporary, { force: true }).catch(() => undefined)
      fail(
        'Pet 数据库正被占用,无法生成快照。',
        '说明 DSH Host 仍在运行。请先停止 Host(`dsh stop`),确认进程已退出后重试。',
      )
      process.exit(1)
    }
    throw error
  } finally {
    live.close()
  }

  // Integrity of the SNAPSHOT, not the source: a backup that cannot be read
  // back is not a backup.
  const snapshot = new DatabaseSync(temporary, { readOnly: true })
  let rows = 0
  let unitVersion
  try {
    const integrity = snapshot.prepare('PRAGMA integrity_check').all()
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
      throw new Error(`快照完整性检查未通过: ${JSON.stringify(integrity)}`)
    }
    unitVersion = snapshot.prepare("SELECT version FROM units WHERE name = 'dsh_pet'").get()?.version
    for (const row of snapshot.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'u\\_dsh\\_pet\\_%' ESCAPE '\\'",
    ).all()) {
      rows += snapshot.prepare(`SELECT count(*) AS c FROM "${row.name}"`).get().c
    }
  } finally {
    snapshot.close()
  }
  await rename(temporary, destination)

  console.log('✓ 备份完成,完整性检查通过')
  console.log(`  大小: ${human((await stat(destination)).size)}`)
  console.log(`  域版本: dsh_pet v${unitVersion ?? '(未标记)'}`)
  console.log(`  记录数: ${rows}\n`)

  // Compatibility proof on a COPY: open it exactly the way Pet's backend does
  // (WAL → delete, then take the exclusive lock eagerly) and confirm the data
  // survives. Doing this on a copy means a bad surprise costs nothing.
  await copyFile(destination, probe)
  const check = new DatabaseSync(probe)
  let after = 0
  try {
    check.exec('PRAGMA journal_mode = delete')
    check.exec('PRAGMA locking_mode = EXCLUSIVE')
    check.exec('BEGIN IMMEDIATE')
    check.exec('COMMIT')
    const mode = check.prepare('PRAGMA journal_mode').get()?.journal_mode
    if (mode !== 'delete') throw new Error(`journal_mode 未能切换到 delete(实际 ${mode})`)
    for (const row of check.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'u\\_dsh\\_pet\\_%' ESCAPE '\\'",
    ).all()) {
      after += check.prepare(`SELECT count(*) AS c FROM "${row.name}"`).get().c
    }
  } finally {
    check.close()
    await rm(probe, { force: true })
  }
  if (after !== rows) throw new Error(`切换演练后记录数变化: ${rows} → ${after}`)

  console.log('✓ 兼容性演练通过(在副本上)')
  console.log('  journal_mode: wal → delete,记录数不变')
  console.log('  独占锁: 可获取\n')
  console.log('可以重启 Host。若需回滚:')
  console.log(`  cp "${destination}" "${source}"`)
} catch (error) {
  await rm(temporary, { force: true }).catch(() => undefined)
  await rm(probe, { force: true }).catch(() => undefined)
  fail(`预检失败: ${error instanceof Error ? error.message : String(error)}`, '未做任何改动,可安全重试。')
  process.exit(1)
}
