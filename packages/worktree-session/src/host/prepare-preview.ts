import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import type { OperationRecord, PreviewResult } from '../wire.js'
import { WsError, messageOf } from './errors.js'
import { type GitClient } from './git.js'

export type PreviewHook = 'prepare-preview' | 'teardown-preview'
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

/** Prove the exact operation-owned path, including its ancestors, before writes or deletion. */
export async function isolatedHomePath(operation: OperationRecord): Promise<string> {
  const common = await realpath(operation.gitCommonDir)
  const expected = join(common, 'ws', 'dsh-home', operation.operationId)
  if (resolve(operation.dshHome) !== expected || basename(expected) !== operation.operationId || /[/\\]|\.\./.test(operation.operationId)) {
    throw new WsError('ENVIRONMENT_FAILED', 'Isolated home does not match the operation-owned path')
  }
  for (const path of [join(common, 'ws'), dirname(expected), expected]) {
    try {
      const stat = await lstat(path)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new WsError('ENVIRONMENT_FAILED', 'Isolated home or ancestor is not a regular directory')
      if (await realpath(path) !== path) throw new WsError('ENVIRONMENT_FAILED', 'Isolated home escapes its managed root')
    } catch (error) { if (!missing(error)) throw error }
  }
  return expected
}

export async function ensureIsolatedHome(operation: OperationRecord): Promise<void> {
  await mkdir(await isolatedHomePath(operation), { recursive: true, mode: 0o700 })
}

export async function removeIsolatedHome(operation: OperationRecord): Promise<string> {
  const path = await isolatedHomePath(operation)
  await rm(path, { recursive: true, force: true })
  return path
}

export async function runPreviewHook(operation: OperationRecord, hook: PreviewHook, git: GitClient, options: {
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
} = {}): Promise<PreviewResult> {
  const result = (status: PreviewResult['status'], outputTail: string, exitCode: number | null = null): PreviewResult => ({ status, outputTail, exitCode, at: new Date().toISOString() })
  const relative = `.ws/${hook}`
  const path = join(operation.worktreePath, relative)
  try {
    // Checking only the final file would allow a symlinked .ws directory to escape.
    for (const candidate of [dirname(path), path]) {
      const stat = await lstat(candidate)
      if (stat.isSymbolicLink()) return result('failed', `${relative}: symbolic links are not allowed`)
    }
    const stat = await lstat(path)
    if (!stat.isFile() || (stat.mode & 0o111) === 0) return result('failed', `${relative}: expected an executable regular file`)
    const tracked = await git.runner('git', ['ls-files', '--error-unmatch', '--', relative], { cwd: operation.worktreePath })
    if (tracked.code !== 0) return result('failed', `${relative}: hook must be tracked by Git`)
  } catch (error) {
    return missing(error) ? result('skipped', `${relative}: repository has not declared this hook`) : result('failed', messageOf(error))
  }
  const env = options.env ?? process.env
  return new Promise(resolvePromise => {
    let output = Buffer.alloc(0)
    let timedOut = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const append = (chunk: Buffer) => { output = Buffer.concat([output, chunk]).subarray(-4096) }
    const child = spawn(path, [], {
      cwd: operation.worktreePath, shell: false, detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...env, WS_SOURCE_REPO: operation.repoRoot, WS_WORKTREE: operation.worktreePath,
        WS_GIT_COMMON_DIR: operation.gitCommonDir, WS_OPERATION_ID: operation.operationId,
        WS_DSH_HOME: operation.dshHome, WS_SOURCE_DSH_HOME: env.DSH_HOME || join(homedir(), '.dsh'),
        WS_HOOK: hook, DSH_HOME: operation.dshHome,
      },
    })
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    const signal = (kind: NodeJS.Signals) => {
      try {
        if (child.pid === undefined) return
        if (process.platform === 'win32') {
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' })
          killer.on('error', error => append(Buffer.from(messageOf(error))))
        } else process.kill(-child.pid, kind)
      } catch (error) { if (!missing(error) && (error as NodeJS.ErrnoException).code !== 'ESRCH') append(Buffer.from(messageOf(error))) }
    }
    const timer = setTimeout(() => {
      timedOut = true
      signal('SIGTERM')
      killTimer = setTimeout(() => signal('SIGKILL'), 100)
    }, Math.min(options.timeoutMs ?? Infinity, hook === 'prepare-preview' ? 300_000 : 29_800))
    child.once('error', error => append(Buffer.from(messageOf(error))))
    child.once('close', code => {
      clearTimeout(timer)
      // A parent may exit on TERM while its descendants keep running.
      if (timedOut) signal('SIGKILL')
      if (killTimer !== undefined) clearTimeout(killTimer)
      resolvePromise(result(code === 0 && !timedOut ? 'ok' : 'failed', `${timedOut ? 'Hook timed out; process group terminated.\n' : ''}${output.toString('utf8')}`.slice(-4096), code))
    })
  })
}

/** Acquired under repo.lock; only a provably dead owner can be replaced. */
export async function acquirePreviewLock(operation: OperationRecord): Promise<() => Promise<void>> {
  const path = join(operation.gitCommonDir, 'ws', 'locks', `preview-${operation.operationId}.lock`)
  await mkdir(dirname(path), { recursive: true })
  try {
    const old = JSON.parse(await readFile(path, 'utf8')) as { pid: number }
    if (!Number.isSafeInteger(old.pid) || old.pid <= 0) throw new WsError('OPERATION_CONFLICT', 'Unreadable preview lock; refusing takeover')
    try { process.kill(old.pid, 0); throw new WsError('OPERATION_CONFLICT', 'prepare-preview is already running for this worktree') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
    await rm(path)
  } catch (error) { if (!missing(error)) throw error }
  const token = randomUUID()
  const handle = await open(path, 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, token })) } finally { await handle.close() }
  return async () => {
    try {
      const current = JSON.parse(await readFile(path, 'utf8')) as { token?: string }
      if (current.token === token) await rm(path)
    } catch (error) { if (!missing(error)) throw error }
  }
}
