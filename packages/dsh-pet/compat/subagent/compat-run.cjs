const { spawnSync } = require('node:child_process')
const { resolve } = require('node:path')

const root = resolve(__dirname, '../../../..')
const supervisor = resolve(root, 'scripts/lib/run-bounded.mjs')
const DEFAULT_TIMEOUT_MS = 600_000
const KILL_GRACE_MS = 2_000

/** Run one compat build command with the repository's process-group timeout. */
function runCompatCommand(command, args, cwd, { capture = false, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const request = JSON.stringify({ command, args, cwd, timeoutMs, killGraceMs: KILL_GRACE_MS })
  const result = spawnSync(process.execPath, [supervisor], {
    cwd,
    env: process.env,
    input: request,
    encoding: 'utf8',
    stdio: ['pipe', capture ? 'pipe' : 'inherit', 'inherit'],
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    const reason = result.status === 124 ? `timed out after ${timeoutMs}ms` : `exited ${String(result.status)}`
    throw new Error(`${command} ${args.join(' ')} ${reason}`)
  }
  return capture ? String(result.stdout ?? '') : ''
}

module.exports = { runCompatCommand }
