import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { KernelError, type KernelResult, type KernelRunOptions } from './types.js'
import { resolveMemexInstallation } from './installation.js'

const DEFAULT_TIMEOUT_MS = 30_000

export function installedKernelVersion(): string | undefined {
  try { return resolveMemexInstallation().version } catch { return undefined }
}

export async function runKernel(args: readonly string[], options: KernelRunOptions): Promise<KernelResult> {
  if (!existsSync(join(options.home, 'cards'))) {
    throw new KernelError('missing', `Memex library is missing cards/: ${options.home}`)
  }

  let executable: string
  try { executable = options.executable ?? resolveMemexInstallation().cli } catch (error) {
    throw new KernelError('missing', error instanceof Error ? error.message : 'Pinned memex installation not found')
  }

  return await new Promise<KernelResult>((resolve, reject) => {
    const child = spawn(executable, [...args], {
      env: { ...process.env, MEMEX_HOME: options.home },
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: options.signal,
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', error => {
      clearTimeout(timer)
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new KernelError('missing', 'memex CLI not found in PATH. Install @touchskyer/memex.'))
      } else reject(error)
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (timedOut) return reject(new KernelError('timeout', `memex timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`))
      const result: KernelResult = { ok: code === 0, exitCode: code ?? 1, stdout, stderr }
      resolve(result)
    })

    if (options.stdin !== undefined) child.stdin.end(options.stdin)
    else child.stdin.end()
  })
}
