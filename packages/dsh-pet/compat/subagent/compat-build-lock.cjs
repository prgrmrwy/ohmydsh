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
    let observed
    let observedStat
    let stale = false
    try {
      observed = readOwner()
      observedStat = statSync(LOCK_DIR)
      // An absent/malformed owner may be a creator paused after mkdir. Age is
      // not proof that this creator died: leave it for explicit recovery.
      stale = Number.isSafeInteger(observed?.pid) && observed.pid > 0
        && typeof observed.token === 'string' && /^[a-zA-Z0-9-]+$/.test(observed.token)
        && Date.now() - observedStat.mtimeMs > staleAfterMs && !ownerAlive(observed)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (stale) {
      // Multiple waiters may observe the same stale owner. Only one may claim
      // reclamation; losers loop and must not delete the winner's fresh lock.
      const claim = `${LOCK_DIR}.reclaim-${observed.token}`
      try {
        const fd = openSync(claim, 'wx')
        closeSync(fd)
      } catch (error) {
        if (error?.code === 'EEXIST') {
          if (Date.now() - started >= waitMs) {
            throw new Error(`timed out waiting for Pet compatibility build lock: ${LOCK_DIR}`)
          }
          sleep(POLL_MS)
          continue
        }
        throw error
      }
      try {
        const current = readOwner()
        const currentStat = statSync(LOCK_DIR)
        if (current?.token === observed.token && current.pid === observed.pid
          && currentStat.dev === observedStat.dev && currentStat.ino === observedStat.ino
          && !ownerAlive(current)) {
          rmSync(LOCK_DIR, { recursive: true, force: true })
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
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
