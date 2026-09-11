const { randomUUID } = require('node:crypto')
const { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const LOCK_DIR = join(__dirname, '.compat-build.lock')
const WAIT_MS = 620_000
const POLL_MS = 100

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function readOwner() {
  try {
    return JSON.parse(readFileSync(join(LOCK_DIR, 'owner.json'), 'utf8'))
  } catch {
    return undefined
  }
}

function ownerAlive(owner) {
  if (!Number.isSafeInteger(owner?.pid) || owner.pid < 1) return false
  try {
    process.kill(owner.pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function inheritedOwner() {
  const token = process.env.DSH_PET_COMPAT_BUILD_TOKEN
  if (!token || !existsSync(LOCK_DIR)) return undefined
  const owner = readOwner()
  return owner?.token === token && ownerAlive(owner) ? owner : undefined
}

function acquireCompatBuildLock(options = {}) {
  if (inheritedOwner() !== undefined) return { owned: false, release() {} }
  const waitMs = options.waitMs ?? WAIT_MS
  const staleAfterMs = options.staleAfterMs ?? 2_000
  const started = Date.now()
  const token = randomUUID()
  while (true) {
    try {
      mkdirSync(LOCK_DIR)
      writeFileSync(join(LOCK_DIR, 'owner.json'), JSON.stringify({ pid: process.pid, token, startedAt: Date.now() }))
      process.env.DSH_PET_COMPAT_BUILD_TOKEN = token
      let released = false
      return {
        owned: true,
        release() {
          if (released) return
          released = true
          if (readOwner()?.token === token) rmSync(LOCK_DIR, { recursive: true, force: true })
          delete process.env.DSH_PET_COMPAT_BUILD_TOKEN
        },
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
    let stale = false
    try {
      const owner = readOwner()
      // Give the creator a brief window to write owner.json; after that a dead
      // PID is sufficient proof that a killed build left a stale lock.
      stale = Date.now() - statSync(LOCK_DIR).mtimeMs > staleAfterMs && !ownerAlive(owner)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (stale) {
      // Multiple waiters may observe the same stale owner. Only one may claim
      // reclamation; losers loop and must not delete the winner's fresh lock.
      const observed = readOwner()
      const claim = `${LOCK_DIR}.reclaim-${String(observed?.token ?? 'unknown')}`
      try {
        const fd = openSync(claim, 'wx')
        closeSync(fd)
      } catch (error) {
        if (error?.code === 'EEXIST') {
          sleep(POLL_MS)
          continue
        }
        throw error
      }
      try {
        const current = readOwner()
        if (current?.token === observed?.token && !ownerAlive(current)) {
          rmSync(LOCK_DIR, { recursive: true, force: true })
        }
      } finally {
        rmSync(claim, { force: true })
      }
      continue
    }
    if (Date.now() - started >= waitMs) {
      throw new Error(`timed out waiting for Pet compatibility build lock: ${LOCK_DIR}`)
    }
    sleep(POLL_MS)
  }
}

module.exports = { LOCK_DIR, acquireCompatBuildLock }
