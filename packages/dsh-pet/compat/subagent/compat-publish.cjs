const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
function entity(file, io) {
  try { return io.lstatSync(file) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
function assertPublicationState(launcher, io = fs) {
  const parent = path.dirname(launcher)
  const name = path.basename(launcher)
  const residuals = io.readdirSync(parent).filter(item => ['.previous-', '.next-', '.restore-'].some(suffix => item.startsWith(name + suffix)))
  if (residuals.length) throw new Error(`Publication recovery required; residual paths: ${residuals.map(item => path.join(parent, item)).join(', ')}`)
  const old = entity(launcher, io)
  let oldTarget
  if (old) {
    if (!old.isSymbolicLink()) throw new Error(`Unknown launcher entity; expected symbolic link: ${launcher}`)
    try { oldTarget = io.realpathSync(launcher) } catch { throw new Error(`Dangling or unknown launcher: ${launcher}`) }
  }
  return { old, oldTarget }
}
// Caller holds the compat lock. Never recursively remove a pointer or a generation.
function publishLauncher({ launcher, target, verify, platform = process.platform, io = fs }) {
  const { old, oldTarget } = assertPublicationState(launcher, io)
  if (!io.statSync(target).isDirectory()) throw new Error('Publication target must be a directory')
  const suffix = `${process.pid}-${randomUUID()}`
  const next = launcher + '.next-' + suffix
  const backup = launcher + '.previous-' + suffix
  const sameLink = (file, expected) => {
    const stat = entity(file, io)
    return stat?.isSymbolicLink() && io.realpathSync(file) === io.realpathSync(expected)
  }
  const sameIdentity = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino && a.birthtimeMs === b.birthtimeMs && a.ctimeMs === b.ctimeMs
  let nextIdentity
  let backupIdentity
  let publishedIdentity
  let movedOld = false
  let published = false
  let verified = false
  const assertBackup = () => {
    if (!sameLink(backup, oldTarget) || !sameIdentity(entity(backup, io), backupIdentity)) throw new Error('Backup pointer changed; recovery required')
  }
  try {
    io.symlinkSync(path.resolve(target), next, 'dir')
    nextIdentity = io.lstatSync(next)
    if (old) {
      if (platform === 'win32') io.renameSync(launcher, backup)
      else io.symlinkSync(oldTarget, backup, 'dir')
      movedOld = true
      backupIdentity = io.lstatSync(backup)
    }
    io.renameSync(next, launcher)
    published = true
    publishedIdentity = io.lstatSync(launcher)
    const result = verify()
    if (result === undefined || result === false) throw new Error('Published launcher verification failed')
    verified = true
    if (movedOld) { assertBackup(); io.unlinkSync(backup); movedOld = false }
    return result
  } catch (error) {
    if (verified) throw new Error(`Published but backup cleanup failed; recovery required at ${backup}: ${error.message}`, { cause: error })
    try {
      if (published) {
        if (!sameLink(launcher, target) || !sameIdentity(entity(launcher, io), publishedIdentity)) throw new Error('Published pointer changed; refusing rollback overwrite')
        if (oldTarget && platform !== 'win32') {
          assertBackup()
          io.renameSync(backup, launcher)
          movedOld = false
        } else io.unlinkSync(launcher)
      }
      if (movedOld) {
        assertBackup()
        if (entity(launcher, io)) throw new Error('Launcher occupied during restore')
        io.renameSync(backup, launcher)
        movedOld = false
      }
      if (entity(next, io)) {
        if (!sameLink(next, target) || !sameIdentity(entity(next, io), nextIdentity)) throw new Error('Unknown next pointer retained')
        io.unlinkSync(next)
      }
    } catch (restoreError) {
      throw new AggregateError([error, restoreError], `Publication failed and recovery failed; preserve ${backup}: ${error.message}; ${restoreError.message}`)
    }
    throw error
  }
}
module.exports = { publishLauncher, assertPublicationState }
