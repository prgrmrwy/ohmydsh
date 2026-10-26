import childProcess from 'node:child_process'

// Background Hosts have no console to inherit on Windows. Keep Node's overloads
// and process behavior, but hide newly allocated consoles by default.
export function spawn(command, args, options) {
  if (!Array.isArray(args)) return childProcess.spawn(command, { windowsHide: true, ...args })
  return childProcess.spawn(command, args, { windowsHide: true, ...options })
}

export function spawnSync(command, args, options) {
  if (!Array.isArray(args)) return childProcess.spawnSync(command, { windowsHide: true, ...args })
  return childProcess.spawnSync(command, args, { windowsHide: true, ...options })
}

export function execFile(file, args, options, callback) {
  if (!Array.isArray(args)) {
    callback = typeof args === 'function' ? args : options
    options = typeof args === 'function' ? undefined : args
    args = []
  } else if (typeof options === 'function') {
    callback = options
    options = undefined
  }
  return childProcess.execFile(file, args, { windowsHide: true, ...options }, callback)
}
