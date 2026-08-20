import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { WsError } from './errors.js'

export async function pathExists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory() } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function atomicWrite(path: string, contents: string, mode?: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${path.split('/').pop() ?? 'file'}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  try {
    await writeFile(temporary, contents, { flag: 'wx', ...(mode === undefined ? {} : { mode }) })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function atomicJson(path: string, value: unknown): Promise<void> {
  await atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`)
}

export async function withMkdirLock<T>(lockPath: string, action: () => Promise<T>, options: {
  timeoutMs?: number
  staleMs?: number
} = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30_000
  const staleMs = options.staleMs ?? 5 * 60_000
  const deadline = Date.now() + timeoutMs
  await mkdir(dirname(lockPath), { recursive: true })
  for (;;) {
    try {
      await mkdir(lockPath)
      await writeFile(join(lockPath, 'owner.json'), JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }))
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        const age = Date.now() - (await stat(lockPath)).mtimeMs
        if (age > staleMs) {
          await rm(lockPath, { recursive: true, force: true })
          continue
        }
      } catch (checkError) {
        if ((checkError as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw checkError
      }
      if (Date.now() >= deadline) throw new WsError('OPERATION_CONFLICT', `Timed out waiting for lock ${lockPath}`, { retryable: true })
      await new Promise(resolvePromise => setTimeout(resolvePromise, 25))
    }
  }
  try { return await action() } finally { await rm(lockPath, { recursive: true, force: true }) }
}

export async function touchExclusive(path: string): Promise<() => Promise<void>> {
  const handle = await open(path, 'wx')
  await handle.close()
  return async () => { await rm(path, { force: true }) }
}
