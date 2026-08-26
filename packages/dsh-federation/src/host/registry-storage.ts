import { randomUUID } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { NodeRegistryModel, parseNodeId, type NodeRegistrySnapshot, type NodeRecord } from '../core/index.js'

const FILE_MODE = 0o600
const DIRECTORY_MODE = 0o700
const TEMP_PREFIX = '.nodes.json.dsh-federation-tmp-'
/** Cross-process commit lock; `O_EXCL` create is the atomic primitive. */
const LOCK_NAME = '.nodes.json.dsh-federation-lock'
const LOCK_STALE_MS = 30_000
const TEMP_PATTERN = /^\.nodes\.json\.dsh-federation-tmp-([0-9]+)-([A-Za-z0-9_-]+)$/

export class RegistryStorageError extends Error {
  constructor(readonly code: 'UNSAFE_PATH' | 'PERMISSION' | 'CORRUPT' | 'UNKNOWN_VERSION' | 'CONFLICT' | 'IO', message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'RegistryStorageError'
  }
}

export interface RegistryLoadResult {
  readonly status: 'missing' | 'loaded'
  readonly snapshot?: NodeRegistrySnapshot
}

export interface RegistryStoreOptions {
  readonly beforeRename?: (tempPath: string) => void | Promise<void>
}

function modeBits(mode: number): number {
  return mode & 0o777
}

function validateNode(value: unknown): NodeRecord {
  if (typeof value !== 'object' || value === null) throw new RegistryStorageError('CORRUPT', 'registry node is not an object')
  const candidate = value as Record<string, unknown>
  const nodeId = parseNodeId(String(candidate.nodeId ?? ''))
  if (candidate.kind === 'local') {
    if (candidate.enabled !== true || candidate.order !== 0 || typeof candidate.displayName !== 'string') throw new RegistryStorageError('CORRUPT', 'invalid local node record')
    return { nodeId, kind: 'local', displayName: candidate.displayName, enabled: true, order: 0 }
  }
  if (candidate.kind !== 'remote' || typeof candidate.displayName !== 'string' || typeof candidate.sshAlias !== 'string'
    || typeof candidate.remoteDshPort !== 'number' || typeof candidate.enabled !== 'boolean' || typeof candidate.order !== 'number') {
    throw new RegistryStorageError('CORRUPT', 'invalid remote node record')
  }
  return {
    nodeId,
    kind: 'remote',
    displayName: candidate.displayName,
    sshAlias: candidate.sshAlias,
    remoteDshPort: candidate.remoteDshPort,
    enabled: candidate.enabled,
    order: candidate.order,
  }
}

export function parseRegistry(bytes: string): NodeRegistrySnapshot {
  let value: unknown
  try {
    value = JSON.parse(bytes)
  } catch (cause) {
    throw new RegistryStorageError('CORRUPT', 'registry JSON is truncated or malformed', cause)
  }
  if (typeof value !== 'object' || value === null) throw new RegistryStorageError('CORRUPT', 'registry root is not an object')
  const root = value as Record<string, unknown>
  if (root.version !== 1) throw new RegistryStorageError('UNKNOWN_VERSION', `unsupported registry version ${String(root.version)}`)
  if (!Number.isSafeInteger(root.generation) || (root.generation as number) < 0 || !Array.isArray(root.nodes)) {
    throw new RegistryStorageError('CORRUPT', 'invalid registry generation or nodes')
  }
  try {
    return new NodeRegistryModel({
      version: 1,
      generation: root.generation as number,
      localNodeId: parseNodeId(String(root.localNodeId ?? '')),
      nodes: root.nodes.map(validateNode),
    }).snapshot
  } catch (cause) {
    if (cause instanceof RegistryStorageError) throw cause
    throw new RegistryStorageError('CORRUPT', cause instanceof Error ? cause.message : 'invalid registry model', cause)
  }
}

export class NodeRegistryStorage {
  readonly directory: string
  readonly file: string
  #queue = Promise.resolve()

  constructor(dshHome: string) {
    if (!path.isAbsolute(dshHome) || dshHome.includes('\0')) throw new RegistryStorageError('UNSAFE_PATH', 'DSH_HOME must be an absolute path')
    this.directory = path.join(dshHome, 'plugins/dsh-federation')
    this.file = path.join(this.directory, 'nodes.json')
  }

  async load(): Promise<RegistryLoadResult> {
    await this.#ensureDirectory(false)
    let info
    try {
      info = await lstat(this.file)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' }
      throw new RegistryStorageError('IO', 'cannot inspect registry file', cause)
    }
    if (!info.isFile() || info.isSymbolicLink()) throw new RegistryStorageError('UNSAFE_PATH', 'registry must be a regular non-symlink file')
    if (modeBits(info.mode) !== FILE_MODE) throw new RegistryStorageError('PERMISSION', 'registry file mode must be 0600')
    let handle
    try {
      handle = await open(this.file, constants.O_RDONLY | constants.O_NOFOLLOW)
      const opened = await handle.stat()
      if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) throw new RegistryStorageError('UNSAFE_PATH', 'registry identity changed during open')
      return { status: 'loaded', snapshot: parseRegistry(await handle.readFile('utf8')) }
    } catch (cause) {
      if (cause instanceof RegistryStorageError) throw cause
      throw new RegistryStorageError('IO', 'cannot read registry file', cause)
    } finally {
      await handle?.close().catch(() => {})
    }
  }

  save(snapshot: NodeRegistrySnapshot, expectedGeneration: number | 'missing', options: RegistryStoreOptions = {}): Promise<NodeRegistrySnapshot> {
    const operation = this.#queue.then(() => this.#save(snapshot, expectedGeneration, options))
    this.#queue = operation.then(() => undefined, () => undefined)
    return operation
  }

  async cleanupOwnedTemps(): Promise<number> {
    await this.#ensureDirectory(false)
    const names = await readdir(this.directory).catch(cause => {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw cause
    })
    let cleaned = 0
    for (const name of names) {
      if (!TEMP_PATTERN.test(name)) continue
      const target = path.join(this.directory, name)
      const info = await lstat(target).catch(() => undefined)
      if (info?.isFile() && !info.isSymbolicLink()) {
        await rm(target)
        cleaned++
      }
    }
    if (cleaned > 0) await this.#fsyncDirectory()
    return cleaned
  }

  async #save(snapshot: NodeRegistrySnapshot, expectedGeneration: number | 'missing', options: RegistryStoreOptions): Promise<NodeRegistrySnapshot> {
    // Validation happens before any temp/write action.
    const validated = new NodeRegistryModel(snapshot).snapshot
    await this.#ensureDirectory(true)
    const current = await this.load()
    const actualGeneration = current.status === 'missing' ? 'missing' : current.snapshot!.generation
    if (actualGeneration !== expectedGeneration) throw new RegistryStorageError('CONFLICT', `registry generation conflict: expected ${expectedGeneration}, found ${actualGeneration}`)
    if (expectedGeneration === 'missing' ? validated.generation !== 0 : validated.generation !== expectedGeneration + 1) {
      throw new RegistryStorageError('CONFLICT', 'next registry generation is not exactly one greater')
    }
    const tempPath = path.join(this.directory, `${TEMP_PREFIX}${process.pid}-${randomUUID().replaceAll('-', '')}`)
    let handle
    try {
      handle = await open(tempPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, FILE_MODE)
      await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`, 'utf8')
      await handle.sync()
      await handle.close()
      handle = undefined
      await options.beforeRename?.(tempPath)
      // The CAS re-check below and the rename must be ONE critical section
      // across processes: without a lock both writers can pass the check and
      // then rename in turn, silently losing the first update.
      const unlock = await this.#acquireCommitLock()
      try {
        const latest = await this.load()
        const latestGeneration = latest.status === 'missing' ? 'missing' : latest.snapshot!.generation
        if (latestGeneration !== expectedGeneration) throw new RegistryStorageError('CONFLICT', 'registry changed before atomic commit')
        await rename(tempPath, this.file)
        await this.#fsyncDirectory()
      } finally {
        await unlock()
      }
      return validated
    } catch (cause) {
      await handle?.close().catch(() => {})
      await rm(tempPath, { force: true }).catch(() => {})
      if (cause instanceof RegistryStorageError) throw cause
      throw new RegistryStorageError('IO', 'registry atomic write failed', cause)
    }
  }

  async #ensureDirectory(create: boolean): Promise<void> {
    if (create) await mkdir(this.directory, { recursive: true, mode: DIRECTORY_MODE })
    let info
    try {
      info = await lstat(this.directory)
    } catch (cause) {
      if (!create && (cause as NodeJS.ErrnoException).code === 'ENOENT') return
      throw new RegistryStorageError('IO', 'cannot inspect registry directory', cause)
    }
    if (!info.isDirectory() || info.isSymbolicLink()) throw new RegistryStorageError('UNSAFE_PATH', 'registry parent must be a real directory')
    if (modeBits(info.mode) !== DIRECTORY_MODE) throw new RegistryStorageError('PERMISSION', 'registry directory mode must be 0700')
  }

  /**
   * Acquires the cross-process commit lock.
   *
   * `O_CREAT | O_EXCL` is atomic on POSIX and on the network filesystems DSH
   * supports, so exactly one writer holds it. A lock older than
   * `LOCK_STALE_MS` is treated as abandoned (crash or SIGKILL) and reclaimed,
   * because a permanently stuck lock would be worse than a rare double-commit.
   */
  async #acquireCommitLock(): Promise<() => Promise<void>> {
    const lockPath = path.join(this.directory, LOCK_NAME)
    const deadline = Date.now() + LOCK_STALE_MS
    for (;;) {
      try {
        const handle = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, FILE_MODE)
        await handle.writeFile(`${process.pid}\n`, 'utf8')
        await handle.close()
        return async () => { await rm(lockPath, { force: true }).catch(() => {}) }
      } catch (cause) {
        if ((cause as { code?: string }).code !== 'EEXIST') {
          throw new RegistryStorageError('IO', 'registry commit lock failed', cause)
        }
        // Reclaim a lock left behind by a crashed writer.
        const age = await lstat(lockPath).then((info: Stats) => Date.now() - info.mtimeMs).catch(() => 0)
        if (age > LOCK_STALE_MS) {
          await rm(lockPath, { force: true }).catch(() => {})
          continue
        }
        if (Date.now() > deadline) {
          throw new RegistryStorageError('CONFLICT', 'registry commit lock is held by another writer')
        }
        await new Promise(resolve => setTimeout(resolve, 5))
      }
    }
  }

  async #fsyncDirectory(): Promise<void> {
    const handle = await open(this.directory, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }
}
