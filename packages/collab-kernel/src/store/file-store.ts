import { promises as nodeFs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { CollabError, type CommitRecord } from '../model/index.js'
import type { CollabStore } from './interface.js'
import { decodeRecord, encodeRecord } from './canonical.js'

export interface FileStoreFs {
  mkdir: typeof nodeFs.mkdir
  open: typeof nodeFs.open
  readFile: typeof nodeFs.readFile
  readdir: typeof nodeFs.readdir
  unlink: typeof nodeFs.unlink
  stat: typeof nodeFs.stat
}
type Handle = Awaited<ReturnType<typeof nodeFs.open>>
type Space = { lockPath: string; logPath: string; lock: Handle; records: CommitRecord[]; failed: boolean; closed: boolean; logCreated: boolean; queue: Promise<void> }

function completeRecords(content: Buffer): { records: CommitRecord[]; completeBytes: number } {
  const completeBytes = content.lastIndexOf(0x0a) + 1
  const records: CommitRecord[] = []
  try {
    // Decode only committed bytes; an incomplete UTF-8 tail is recoverable.
    const complete = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content.subarray(0, completeBytes))
    // Remove only the split sentinel, never a complete empty line.
    for (const line of complete ? complete.slice(0, -1).split('\n') : []) {
      const record = decodeRecord(line)
      if (!Number.isSafeInteger(record.seq) || record.seq !== records.length + 1) throw new Error('corrupt')
      records.push(record as unknown as CommitRecord)
    }
  } catch { throw new CollabError('COLLAB_STORE_CORRUPT') }
  return { records, completeBytes }
}

export class FileStore implements CollabStore {
  readonly instanceId: string
  private readonly fs: FileStoreFs
  private readonly spaces = new Map<string, Space>()
  private readonly openings = new Map<string, Promise<void>>()
  private readonly closings = new Map<string, Promise<void>>()
  constructor(private readonly rootDir: string, options: { instanceId?: string; fs?: Partial<FileStoreFs> } = {}) {
    this.instanceId = options.instanceId ?? randomUUID()
    this.fs = { ...nodeFs, ...options.fs }
  }
  private paths(spaceId: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(spaceId) || spaceId === '.' || spaceId === '..') throw new CollabError('COLLAB_BAD_SPACE_ID')
    return { logPath: path.join(this.rootDir, `${spaceId}.jsonl`), lockPath: path.join(this.rootDir, `${spaceId}.lock`) }
  }
  private async lockDetails(lockPath: string): Promise<never> {
    let lock = ''
    try { lock = await this.fs.readFile(lockPath, 'utf8') as string } catch {}
    const details: CollabError['details'] = { lockPath }
    try {
      const value = JSON.parse(lock)
      if (typeof value?.instanceId === 'string' && typeof value.pid === 'number' && Number.isSafeInteger(value.pid)) {
        details.lock = { instanceId: value.instanceId, pid: value.pid }
      }
    } catch {}
    throw Object.assign(new CollabError('COLLAB_STORE_LOCKED', details), { lockPath, lock })
  }
  private async removeOwnedLock(lockPath: string, handle: Handle): Promise<void> {
    try {
      const held = await handle.stat(), current = await this.fs.stat(lockPath)
      if (held.dev !== current.dev || held.ino !== current.ino) return
      const lock = JSON.parse(await this.fs.readFile(lockPath, 'utf8') as string)
      if (lock.instanceId === this.instanceId) await this.fs.unlink(lockPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  async open(spaceId: string): Promise<void> {
    if (this.spaces.has(spaceId) || this.openings.has(spaceId) || this.closings.has(spaceId)) throw new CollabError('COLLAB_STORE_FAILED')
    const paths = this.paths(spaceId)
    const opening = this.load(spaceId, paths)
    this.openings.set(spaceId, opening)
    try { await opening } finally { this.openings.delete(spaceId) }
  }
  private async load(spaceId: string, { lockPath, logPath }: { lockPath: string; logPath: string }): Promise<void> {
    await this.fs.mkdir(this.rootDir, { recursive: true })
    let lock: Handle
    try { lock = await this.fs.open(lockPath, 'wx', 0o600) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return this.lockDetails(lockPath); throw error }
    try {
      await lock.writeFile(JSON.stringify({ instanceId: this.instanceId, pid: process.pid }))
      await lock.sync()
      let content: Buffer = Buffer.alloc(0), logCreated = true
      try { content = await this.fs.readFile(logPath) as Buffer }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; logCreated = false }
      const { records, completeBytes } = completeRecords(content)
      // Validate every committed line before performing any recovery mutation.
      if (completeBytes !== content.length) {
        const file = await this.fs.open(logPath, 'r+')
        try { await file.truncate(completeBytes); await file.sync() } finally { await file.close() }
      }
      this.spaces.set(spaceId, { lockPath, logPath, lock, records, failed: false, closed: this.closings.has(spaceId), logCreated, queue: Promise.resolve() })
    } catch (error) {
      await this.removeOwnedLock(lockPath, lock).catch(() => {})
      await lock.close().catch(() => {})
      throw error
    }
  }
  close(spaceId: string): Promise<void> {
    const existing = this.closings.get(spaceId)
    if (existing) return existing
    const space = this.spaces.get(spaceId)
    if (space) space.closed = true
    const closing = this.drainAndClose(spaceId)
    this.closings.set(spaceId, closing)
    return closing.finally(() => { this.closings.delete(spaceId) })
  }
  private async drainAndClose(spaceId: string): Promise<void> {
    await this.openings.get(spaceId)?.catch(() => {})
    const space = this.spaces.get(spaceId)
    if (!space) return
    space.closed = true
    await space.queue
    try { await this.removeOwnedLock(space.lockPath, space.lock) }
    finally {
      try { await space.lock.close() } finally { this.spaces.delete(spaceId) }
    }
  }
  async breakLock(spaceId: string, expectedInstanceId: string): Promise<void> {
    const { lockPath } = this.paths(spaceId)
    let lock: { instanceId?: unknown }
    try { lock = JSON.parse(await this.fs.readFile(lockPath, 'utf8') as string) }
    catch (error) {
      if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return this.lockDetails(lockPath)
      throw error
    }
    if (lock?.instanceId !== expectedInstanceId) return this.lockDetails(lockPath)
    await this.fs.unlink(lockPath)
  }
  async commit(spaceId: string, record: CommitRecord, expectedLastSeq: number): Promise<void> {
    const space = this.spaces.get(spaceId)
    if (!space || space.closed || space.failed || this.closings.has(spaceId)) throw new CollabError('COLLAB_STORE_FAILED')
    // Snapshot at admission so caller mutation cannot change a queued commit.
    let bytes: Buffer
    try { bytes = Buffer.from(encodeRecord(record as unknown as Record<string, unknown>)) }
    catch { space.failed = true; throw new CollabError('COLLAB_STORE_FAILED') }
    let release!: () => void
    const prior = space.queue
    space.queue = new Promise<void>(resolve => { release = resolve })
    await prior
    try {
      if (space.closed || space.failed) throw new CollabError('COLLAB_STORE_FAILED')
      let content: Buffer = Buffer.alloc(0)
      try { content = await this.fs.readFile(space.logPath) as Buffer }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const { records, completeBytes } = completeRecords(content)
      if (completeBytes !== content.length) throw new CollabError('COLLAB_STORE_CORRUPT')
      const next = decodeRecord(bytes.toString('utf8')) as unknown as CommitRecord
      const lastSeq = records.at(-1)?.seq ?? 0
      if (!Number.isSafeInteger(expectedLastSeq) || expectedLastSeq < 0 || lastSeq !== expectedLastSeq || next.seq !== expectedLastSeq + 1 || !Number.isSafeInteger(next.seq)) throw new CollabError('COLLAB_STORE_CONFLICT')
      const file = await this.fs.open(space.logPath, 'a')
      try {
        let offset = 0
        while (offset < bytes.length) {
          const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset)
          if (!Number.isInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > bytes.length - offset) throw new Error('invalid write progress')
          offset += bytesWritten
        }
        await file.sync()
        if (!space.logCreated) {
          const dir = await this.fs.open(this.rootDir, 'r')
          try { await dir.sync() } finally { await dir.close() }
          space.logCreated = true
        }
      } finally { await file.close() }
      space.records = [...records, next]
    } catch (error) {
      space.failed = true
      if (error instanceof CollabError) throw error
      throw new CollabError('COLLAB_STORE_FAILED')
    } finally { release() }
  }
  async read(spaceId: string, fromSeq: number): Promise<CommitRecord[]> {
    const space = this.spaces.get(spaceId)
    if (!space || space.closed || space.failed || this.closings.has(spaceId)) throw new CollabError('COLLAB_STORE_FAILED')
    return structuredClone(space.records.filter(record => record.seq >= fromSeq))
  }
  async list(): Promise<string[]> {
    await this.fs.mkdir(this.rootDir, { recursive: true })
    return [...new Set((await this.fs.readdir(this.rootDir)).filter(name => name.endsWith('.jsonl')).map(name => name.slice(0, -6)))].sort()
  }
}
