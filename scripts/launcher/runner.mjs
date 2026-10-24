import { spawn, spawnSync } from 'node:child_process'
import packageManager from '../lib/package-manager.cjs'

export function run(command, args, { cwd = process.cwd(), env = process.env, capture = false, timeoutMs, ...options } = {}) {
  const resolved = packageManager.resolveExecutable(command, args, { env })
  return new Promise(resolve => {
    let stdout = ''; let stderr = ''; let error; let timedOut = false
    const bounded = Number.isFinite(timeoutMs) && timeoutMs > 0
    const child = spawn(resolved.command, resolved.args, { cwd, env, shell: false, windowsHide: true, detached: bounded && process.platform !== 'win32', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', ...options })
    child.stdout?.on('data', chunk => { stdout += chunk })
    child.stderr?.on('data', chunk => { stderr += chunk })
    const timer = bounded ? setTimeout(() => {
      timedOut = true
      // Only this call's still-live child/group is eligible. Interactive CLI,
      // build and confirmation prompts have no implicit deadline.
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) return
      if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { env, shell: false, windowsHide: true, timeout: 5000, stdio: 'ignore' })
      else try { process.kill(-child.pid, 'SIGKILL') } catch (value) { if (value.code !== 'ESRCH') error = value }
    }, timeoutMs) : undefined
    child.once('error', value => { error = value })
    child.once('close', (status, signal) => { clearTimeout(timer); resolve({ status: timedOut ? 124 : error ? 127 : status ?? 1, signal, stdout, stderr, error }) })
  })
}
