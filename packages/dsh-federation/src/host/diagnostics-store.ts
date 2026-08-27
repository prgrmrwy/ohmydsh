import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, rename, rm, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { NodeId } from '../core/index.js'

const FILE_NAME = 'retained-diagnostics.json'
const DIR_MODE = 0o700
const FILE_MODE = 0o600

/** One retained, already-redacted delivery diagnostic. */
export interface RetainedDiagnostic {
  readonly operationId: string
  readonly nodeId: NodeId
  readonly kind: string
  readonly state: 'OUTCOME_UNKNOWN'
  /** Display name captured at deletion time; the node record is gone. */
  readonly nodeDisplayName?: string
  readonly retainedAt: string
}

function sanitize(value: unknown): RetainedDiagnostic | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  if (
    typeof row.operationId !== 'string'
    || typeof row.nodeId !== 'string'
    || typeof row.kind !== 'string'
    || row.state !== 'OUTCOME_UNKNOWN'
    || typeof row.retainedAt !== 'string'
  ) return undefined
  return Object.freeze({
    operationId: row.operationId,
    nodeId: row.nodeId as NodeId,
    kind: row.kind,
    state: 'OUTCOME_UNKNOWN',
    ...(typeof row.nodeDisplayName === 'string' ? { nodeDisplayName: row.nodeDisplayName } : {}),
    retainedAt: row.retainedAt,
  })
}

/**
 * Durable store for delivery diagnostics that outlive their node.
 *
 * Deleting a node destroys every rebuildable projection, so without this the
 * evidence that a write's outcome was never proven disappears — and a deleted
 * node would be silently misread as "the operation did not run". Entries are
 * therefore persisted until the operator explicitly clears them, and only
 * already-redacted fields are stored: never rpcId, sessionId or prompt content.
 */
export class RetainedDiagnosticsStore {
  readonly file: string
  readonly #directory: string
  #queue: Promise<unknown> = Promise.resolve()

  constructor(dshHome: string) {
    if (!path.isAbsolute(dshHome) || dshHome.includes('\0')) throw new Error('DSH_HOME must be an absolute path')
    this.#directory = path.join(dshHome, 'plugins/dsh-federation')
    this.file = path.join(this.#directory, FILE_NAME)
  }

  async list(): Promise<readonly RetainedDiagnostic[]> {
    try {
      // Symlink-following would let a swapped path redirect operator-visible
      // evidence, so the target must be a regular file, mirroring the registry.
      const info = await lstat(this.file)
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('retained diagnostics must be a regular non-symlink file')
      const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (!Array.isArray(parsed)) return []
      return parsed.map(sanitize).filter((entry): entry is RetainedDiagnostic => entry !== undefined)
    } catch (cause) {
      // A missing file means nothing was retained. A damaged file must not be
      // reported as "nothing to review", so it is surfaced instead of swallowed.
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw cause
    }
  }

  /** Appends entries, de-duplicating by operation id. */
  async retain(entries: readonly Omit<RetainedDiagnostic, 'retainedAt'>[]): Promise<readonly RetainedDiagnostic[]> {
    if (entries.length === 0) return this.list()
    return this.#serialize(async () => {
      const existing = await this.list()
      // De-duplicate by owning node AND operation, never by the display digest
      // alone: two nodes can share a digest, and dropping the second entry would
      // silently discard real evidence.
      const known = new Set(existing.map(entry => `${entry.nodeId}\u0000${entry.operationId}`))
      const retainedAt = new Date().toISOString()
      const added = entries
        .filter(entry => !known.has(`${entry.nodeId}\u0000${entry.operationId}`))
        .map(entry => sanitize({ ...entry, retainedAt }))
        .filter((entry): entry is RetainedDiagnostic => entry !== undefined)
      if (added.length === 0) return existing
      const next = [...existing, ...added]
      await this.#write(next)
      return next
    })
  }

  /** Explicit operator clear; omitting ids clears everything. */
  async clear(operationIds?: readonly string[]): Promise<readonly RetainedDiagnostic[]> {
    return this.#serialize(async () => {
      if (operationIds === undefined) {
        await rm(this.file, { force: true })
        return []
      }
      const remaining = (await this.list()).filter(entry => !operationIds.includes(entry.operationId))
      if (remaining.length === 0) await rm(this.file, { force: true })
      else await this.#write(remaining)
      return remaining
    })
  }

  async #write(entries: readonly RetainedDiagnostic[]): Promise<void> {
    await mkdir(this.#directory, { recursive: true, mode: DIR_MODE })
    // The suffix must be unique per attempt. A pid-only name plus O_EXCL means
    // one failed write leaves a temp file that makes every later attempt in this
    // process fail with EEXIST, permanently disabling retention.
    const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    try {
      const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, FILE_MODE)
      try {
        await handle.writeFile(`${JSON.stringify(entries, null, 2)}\n`, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temp, this.file)
    } catch (cause) {
      // Any failure must clean up after itself, including a partial write.
      await unlink(temp).catch(() => {})
      throw cause
    }
  }

  #serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(action, action)
    this.#queue = next.then(() => undefined, () => undefined)
    return next
  }
}
