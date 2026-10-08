// Cross-process writer lock for the DSH profile package.json.
//
// DSH 0.2.0 serializes every profile package.json writer (plugin manager, config
// editor, compatibility file) through `withFileLock` from
// @deepseek-ai/dsh-atomic-write. sync is one more writer of that file, so it
// takes the same lock. This module re-implements the on-disk protocol only, so
// sync does not import a runtime package: a `wx`-created sibling
// `<file>.lock` holding `<pid>\n`; contention backs off; a lock whose recorded
// PID no longer exists is taken over through a `<lock>.takeover-<hash>` claim,
// and any other lock is waited for and never deleted.
import { createHash } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'

const RETRY_INITIAL_MS = 20
const RETRY_MAX_MS = 200
// sync holds the lock across a pnpm install, so the wait must outlast one.
const DEFAULT_WAIT_MS = 120_000

async function readRecord(lockPath) {
  try { return await readFile(lockPath, 'utf8') } catch { return undefined }
}

/** True only when the record is a complete `<pid>\n` whose process is proven gone. */
function holderExited(record) {
  if (!/^\d+\n$/.test(record)) return false
  const pid = Number(record.trim())
  if (pid === 0 || pid > 0x7fffffff || pid === process.pid) return false
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return error?.code === 'ESRCH'
  }
}

async function takeOverExited(lockPath) {
  const record = await readRecord(lockPath)
  if (record === undefined || !holderExited(record)) return false
  const claim = `${lockPath}.takeover-${createHash('sha256').update(record).digest('hex').slice(0, 16)}`
  try {
    await writeFile(claim, `${process.pid}\n`, { mode: 0o600, flag: 'wx' })
  } catch (error) {
    if (error?.code === 'EEXIST' || error?.code === 'EPERM') return false
    throw error
  }
  try {
    if ((await readRecord(lockPath)) !== record || !holderExited(record)) return false
    await rm(lockPath, { force: true })
    return true
  } finally {
    await rm(claim, { force: true })
  }
}

/**
 * Run `operation` while holding the writer lock for `filename`.
 *
 * @param {string} filename - the file whose writers are serialized (its directory must exist).
 * @param {() => Promise<T>} operation - the read-modify-write cycle.
 * @param {{ waitMs?: number }} [options]
 * @returns {Promise<T>}
 * @template T
 */
export async function withProfileLock(filename, operation, { waitMs = DEFAULT_WAIT_MS } = {}) {
  const lockPath = `${filename}.lock`
  const deadline = Date.now() + waitMs
  let delay = RETRY_INITIAL_MS
  for (;;) {
    try {
      await writeFile(lockPath, `${process.pid}\n`, { mode: 0o600, flag: 'wx' })
      break
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      if (await takeOverExited(lockPath)) continue
    }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for the writer lock at ${lockPath} (another DSH process is writing the profile)`)
    await new Promise((resolve) => setTimeout(resolve, delay))
    delay = Math.min(delay * 2, RETRY_MAX_MS)
  }
  try {
    return await operation()
  } finally {
    await rm(lockPath, { force: true })
  }
}
