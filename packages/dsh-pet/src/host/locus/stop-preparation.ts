/** Authenticated shutdown preparation; discovery files never authorize stopping a Host. */
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { PetError } from '../errors.js'

export const PET_PREPARE_STOP_ROUTE = '/dsh-pet/api/prepare-stop'
/** Maximum lifetime of one client request and its prepared acknowledgement. */
export const STOP_REQUEST_LIFETIME_MS = 60_000

export interface StopIdentity { readonly hostPid: number; readonly bootId: string }
export interface StopRequest {
  readonly v: 1
  readonly action: 'prepare' | 'status' | 'resume'
  readonly nonce: string
  readonly expectedHostPid: number
  readonly expectedBootId: string
  readonly deadlineAt: number
}
export interface StopResponse extends StopIdentity {
  readonly v: 1
  readonly nonce: string
  readonly phase: 'active' | 'preparing' | 'prepared' | 'failed' | 'resuming'
  /** `null` when no operation exists, so clients can tell absent from omitted. */
  readonly operationNonce?: string | null
  readonly preparedAt?: number
  readonly expiresAt?: number
}
export interface StopPreparationPorts {
  /** Freeze acquisitions and wait for operations already admitted to reach a safe point. */
  freeze(): Promise<void>
  /** Await exact owned native children and Pet's durable settlement. */
  drain(): Promise<void>
  /** Restore dispatch only after the native operation has settled. */
  resume(): Promise<void>
  readonly now?: () => number
}
interface Preparation {
  readonly nonce: string
  phase: 'preparing' | 'prepared' | 'failed' | 'resuming'
  readonly done: Promise<void>
  preparedAt?: number
  /** Deadline of the latest prepared acknowledgement issued for this operation. */
  expiresAt?: number
}

function reject(message: string): never { throw new PetError('INVALID_REQUEST', message) }
function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(value)
}

/** Parse only the narrow wire operation; caller identity comes from Connection. */
export function parseStopRequest(body: unknown, identity: StopIdentity, now: number): StopRequest {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) reject('Invalid stop preparation request')
  const record = body as Record<string, unknown>
  const allowed = ['v', 'action', 'nonce', 'expectedHostPid', 'expectedBootId', 'deadlineAt']
  if (Object.keys(record).length !== allowed.length || Object.keys(record).some(key => !allowed.includes(key))) reject('Unexpected stop preparation fields')
  if (record.v !== 1 || (record.action !== 'prepare' && record.action !== 'status' && record.action !== 'resume') || !identifier(record.nonce)) reject('Invalid stop preparation operation')
  if (record.expectedHostPid !== identity.hostPid || record.expectedBootId !== identity.bootId) reject('Stop preparation Host identity changed')
  if (typeof record.deadlineAt !== 'number' || !Number.isSafeInteger(record.deadlineAt) || record.deadlineAt <= now || record.deadlineAt - now > STOP_REQUEST_LIFETIME_MS) reject('Stop preparation deadline is invalid or expired')
  return { v: 1, action: record.action, nonce: record.nonce, expectedHostPid: identity.hostPid, expectedBootId: identity.bootId, deadlineAt: record.deadlineAt }
}

/** One operation owns freezing, draining, failure and explicit recovery. */
export class StopPreparation {
  private operation: Preparation | undefined
  private closed = false
  private readonly now: () => number
  constructor(readonly identity: StopIdentity, private readonly ports: StopPreparationPorts) {
    this.now = ports.now ?? Date.now
  }

  async request(body: unknown): Promise<StopResponse> {
    if (this.closed) reject('Stop preparation is closed')
    const request = parseStopRequest(body, this.identity, this.now())
    const base = { v: 1 as const, nonce: request.nonce, ...this.identity }
    if (request.action === 'status') {
      const current = this.operation
      if (current === undefined) return { ...base, phase: 'active', operationNonce: null }
      return {
        ...base, phase: current.phase, operationNonce: current.nonce,
        ...(current.phase === 'prepared' && current.preparedAt !== undefined && current.expiresAt !== undefined
          ? { preparedAt: current.preparedAt, expiresAt: current.expiresAt } : {}),
      }
    }
    if (request.action === 'resume') {
      // Any authenticated caller may recover a SETTLED operation: a launcher
      // that lost its nonce (timeout, crash) must not leave the Host frozen.
      // An unsettled drain is never resumed, whoever asks.
      const operation = this.operation
      if (operation?.phase === 'preparing' || operation?.phase === 'resuming') reject('Native shutdown preparation has not settled; dispatch remains frozen')
      if (operation !== undefined) {
        operation.phase = 'resuming'
        try {
          await this.ports.resume()
          if (this.closed || this.operation !== operation) reject('Stop preparation changed while resuming')
          this.operation = undefined
        } catch (error) { operation.phase = 'failed'; throw error }
      }
      return { ...base, phase: 'active', operationNonce: null }
    }
    if (this.operation !== undefined && this.operation.nonce !== request.nonce) reject('Another stop preparation is active')
    if (this.operation?.phase === 'resuming' || this.operation?.phase === 'failed') reject('Stop preparation must finish recovery before preparing again')
    if (this.operation === undefined) {
      const operation: Preparation = {
        nonce: request.nonce,
        phase: 'preparing',
        done: Promise.resolve().then(async () => {
          try {
            await this.ports.freeze()
            await this.ports.drain()
            if (this.closed) reject('Stop preparation was disposed')
            operation.preparedAt = this.now()
            operation.phase = 'prepared'
          } catch (error) {
            operation.phase = 'failed'
            throw error
          }
        }),
      }
      this.operation = operation
    }
    const operation = this.operation
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        operation.done,
        new Promise<never>((_resolve, rejectPromise) => {
          timer = setTimeout(() => rejectPromise(new PetError('INVALID_REQUEST', 'Stop preparation timed out; no prepared acknowledgement')), Math.max(1, request.deadlineAt - this.now()))
          timer.unref?.()
        }),
      ])
      const now = this.now()
      if (now >= request.deadlineAt || this.closed || operation.phase !== 'prepared') reject('Stop preparation acknowledgement expired')
      operation.expiresAt = request.deadlineAt
      return { ...base, phase: 'prepared', preparedAt: operation.preparedAt!, expiresAt: request.deadlineAt }
    } finally { if (timer !== undefined) clearTimeout(timer) }
  }

  /** Invalidates tickets without claiming an unfinished native drain succeeded. */
  dispose(): void { this.closed = true }
}

export interface StopDescriptor {
  readonly v: 1
  readonly pid: number
  readonly bootId: string
  readonly profile: string
  readonly origin: string
  readonly authenticatedUrl: string
}

/** Publish a private discovery cache. Consumers must authenticate and recheck live identity. */
export async function publishStopDescriptor(home: string, port: number, descriptor: StopDescriptor): Promise<void> {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) reject('Invalid stop descriptor port')
  const origin = new URL(descriptor.origin)
  const authenticated = new URL(descriptor.authenticatedUrl)
  if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || Number(origin.port) !== port || authenticated.origin !== origin.origin || origin.username || origin.password) reject('Invalid stop descriptor origin')
  const root = await realpath(home)
  const run = join(root, 'run')
  await mkdir(run, { recursive: true, mode: 0o700 })
  const runStat = await lstat(run)
  if (!runStat.isDirectory() || runStat.isSymbolicLink()) reject('Unsafe stop descriptor parent')
  const directory = join(run, 'dsh-pet-stop')
  await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error })
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) reject('Unsafe stop descriptor directory')
  const target = resolve(directory, `${port}.json`)
  if (dirname(target) !== directory) reject('Stop descriptor path escaped its directory')
  try {
    const existing = await lstat(target)
    if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1 || (process.getuid !== undefined && existing.uid !== process.getuid())) reject('Unsafe existing stop descriptor')
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const temporary = join(directory, `${port}-${randomUUID()}.tmp`)
  const file = await open(temporary, 'wx', 0o600)
  try { await file.writeFile(`${JSON.stringify(descriptor)}\n`); await file.sync() } finally { await file.close() }
  // Both absolute names are constrained to the verified owner-only directory.
  if (dirname(temporary) !== directory || dirname(target) !== directory) reject('Unsafe stop descriptor replacement')
  await rename(temporary, target)
}

/** Remove this boot's descriptor only; a replacement boot's file is left alone. */
export async function releaseStopDescriptor(home: string, port: number, bootId: string): Promise<void> {
  try {
    const directory = join(await realpath(home), 'run', 'dsh-pet-stop')
    const target = join(directory, `${port}.json`)
    const stat = await lstat(target)
    if (!stat.isFile() || stat.isSymbolicLink()) return
    const file = await open(target, 'r')
    let current: unknown
    try { current = JSON.parse(await file.readFile('utf8')) } finally { await file.close() }
    if ((current as { bootId?: unknown } | null)?.bootId !== bootId) return
    await unlink(target)
  } catch { /* best effort: consumers re-verify live identity anyway */ }
}
