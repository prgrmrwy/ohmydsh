// Controlled fs seam for the exact copied production module; no real builds.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const modulePath = fs.realpathSync(process.argv[2])
const lockDir = path.join(path.dirname(modulePath), '.compat-build.lock')
const ownerPath = path.join(lockDir, 'owner.json')
const original = { statSync: fs.statSync, readFileSync: fs.readFileSync }
fs.mkdirSync(lockDir)
fs.writeFileSync(ownerPath, JSON.stringify({ pid: 99999999, token: 'dead' }))
const old = new Date(Date.now() - 10_000)
fs.utimesSync(lockDir, old, old)
let swapped = false
let thief = false
// Inject the other waiter's removal and a new creator's mkdir AFTER this
// waiter stat'ed the stale directory but BEFORE its second owner read. Leave
// the new directory unpublished, as allowed between mkdir and owner.json.
fs.statSync = function (file, ...args) {
  const result = original.statSync(file, ...args)
  if (file === lockDir && !swapped) {
    swapped = true
    fs.rmSync(lockDir, { recursive: true })
    fs.mkdirSync(lockDir)
  }
  return result
}
try {
  const { acquireCompatBuildLock } = require(modulePath)
  try {
    const lock = acquireCompatBuildLock({ waitMs: 0, staleAfterMs: 2_000 })
    thief = true
    lock.release()
  } catch (error) {
    assert.match(error.message, /timed out waiting/)
  }
  assert.equal(swapped, true, 'race seam must execute')
  assert.equal(thief, false, 'stale proof must not delete a new unpublished creator directory')
} finally {
  fs.statSync = original.statSync
}
