#!/usr/bin/env node
/**
 * Verify the Pet storage cutover AFTER the Host restarted on the new backend.
 *
 * Answers one question: is the running Host serving Pet's domain from Pet's
 * own backend, with the data intact? Everything it checks is read from disk
 * and from the startup log, so it needs no access to the running process.
 *
 * Run this with the Host UP. It never writes.
 *
 * Usage:
 *   node scripts/verify-storage-cutover.mjs [--baseline <backup path>]
 */
import { constants } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

function arg(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

const home = process.env.DSH_HOME ?? path.join(homedir(), '.dsh')
const database = path.join(home, 'plugins', 'dsh-pet', 'state.sqlite')
const profileModules = path.join(home, 'profiles', 'web', 'node_modules', '@deepseek-ai')

let failures = 0
function check(ok, label, detail) {
  console.log(`${ok ? '✓' : '✗'} ${label}`)
  if (detail !== undefined) console.log(`  ${detail}`)
  if (!ok) failures += 1
}

/** Count every Pet record table, so a silent data loss cannot hide. */
function countRows(file) {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    let total = 0
    for (const row of db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'u\\_dsh\\_pet\\_%' ESCAPE '\\'",
    ).all()) {
      total += db.prepare(`SELECT count(*) AS c FROM "${row.name}"`).get().c
    }
    return total
  } finally {
    db.close()
  }
}

console.log('Pet storage cutover — 重启后验证\n')

// 1. The medium must be held exclusively: that is the single-writer guarantee.
//    A readable database means the Host did NOT take it, which is a failure.
//
//    `new DatabaseSync()` is LAZY — it does not touch the file until the first
//    statement runs, so opening and closing always "succeeds" even against a
//    database another process holds exclusively. The probe therefore has to
//    READ something. (Measured: open+close succeeds while the very next
//    `PRAGMA journal_mode` on the same handle is refused with
//    `database is locked`.)
let held = false
try {
  const probe = new DatabaseSync(database, { readOnly: true })
  try {
    probe.prepare('PRAGMA journal_mode').get()
  } finally {
    probe.close()
  }
} catch (error) {
  const message = String(error?.message ?? '').toLowerCase()
  held = message.includes('locked') || message === 'not an error'
}
check(
  held,
  '介质被 Host 独占',
  held
    ? '第二个 writer 无法进入,单写者保证成立'
    : '数据库可被外部打开 —— Host 可能未启动,或未取得独占锁',
)

// 2. The official storage packages must be back: compat overlays are retired.
for (const name of ['dsh-storage', 'dsh-storage-domain', 'dsh-storage-sqlite']) {
  const manifest = path.join(profileModules, name, 'package.json')
  try {
    await access(manifest, constants.R_OK)
    const pkg = JSON.parse(await readFile(manifest, 'utf8'))
    check(
      pkg.dsh_compat === undefined,
      `${name} 为官方原版`,
      pkg.dsh_compat === undefined
        ? `v${pkg.version}`
        : `v${pkg.version} 仍带 dsh_compat(upstreamBase ${String(pkg.dsh_compat.upstreamBase).slice(0, 8)})`,
    )
  } catch {
    // Absent is fine: only packages the profile actually installs are checked.
    console.log(`· ${name} 未安装在 profile(正常)`)
  }
}

// 3. The startup log must show the Host picked the compat runtime, and which.
try {
  const log = await readFile(path.join(home, 'dsh-startup.log'), 'utf8')
  const lines = log.trimEnd().split('\n')
  const last = lines[lines.length - 1] ?? ''
  const fingerprint = /fingerprint=([a-f0-9]+)/.exec(last)?.[1]
  check(
    last.includes('runtime=customization-host-runtime') && last.includes('owner=dsh-pet'),
    'Host runtime 身份正确',
    last.slice(0, 120),
  )
  if (fingerprint !== undefined) console.log(`  fingerprint: ${fingerprint.slice(0, 16)}…`)
} catch {
  check(false, '读取 dsh-startup.log', '找不到启动日志')
}

// 4. Data must survive. Compared against the pre-cutover backup when given.
const baseline = arg('--baseline')
if (baseline !== undefined) {
  try {
    const before = countRows(path.resolve(baseline))
    // The live file is locked, so the count has to come from the backup side
    // only; report it for the operator to compare against the preflight output.
    check(true, '备份可读,基线记录数', String(before))
    console.log('  提示: 与预检输出的「记录数」核对应一致')
  } catch (error) {
    check(false, '读取基线备份', error instanceof Error ? error.message : String(error))
  }
} else {
  const dir = path.dirname(database)
  const backups = (await readdir(dir)).filter(f => f.includes('pre-storage-cutover'))
  if (backups.length > 0) {
    console.log(`· 发现备份 ${backups.length} 份,最新: ${backups.sort().pop()}`)
    console.log('  传 --baseline <路径> 可读出其记录数用于核对')
  }
}

// 5. The Pet management surface answers, which proves the plugin actually
//    loaded rather than degrading on a storage failure.
const port = process.env.DSH_PORT ?? '3080'
try {
  const response = await fetch(`http://127.0.0.1:${port}/dsh-pet/api/status`, {
    signal: AbortSignal.timeout(5000),
  })
  check(
    response.status !== 404 && response.status < 500,
    'Pet 管理面响应',
    `HTTP ${response.status}${response.status === 401 || response.status === 403 ? '(需认证,属正常)' : ''}`,
  )
} catch (error) {
  check(false, 'Pet 管理面响应', `无法连接 127.0.0.1:${port} — ${error instanceof Error ? error.message : String(error)}`)
}

console.log(failures === 0 ? '\n全部通过。' : `\n${failures} 项未通过 —— 回滚见手册第 6 步。`)
process.exitCode = failures === 0 ? 0 : 1
