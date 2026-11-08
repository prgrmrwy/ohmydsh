/** Authenticated shutdown preparation; discovery files never authorize stopping a Host. */
import { randomUUID } from 'node:crypto'
import { type Stats } from 'node:fs'
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { PetError } from '../errors.js'
import { assertPrivateFile, PRIVATE_FILE_MAX_BYTES, PRIVATE_READ_FLAGS, samePrivateIdentity, secureCreatedPrivateFile, stopPrivateBoundary, verifyPrivateBoundary, verifyPrivateBoundaryIdentity, type PrivateBoundary } from './private-files.js'

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

function descriptorTarget(boundary: PrivateBoundary, port: number): string {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) reject('Invalid stop descriptor port')
  const target = resolve(boundary.directory, `${port}.json`)
  if (dirname(target) !== boundary.directory) reject('Stop descriptor path escaped its directory')
  return target
}
async function existingDescriptor(boundary: PrivateBoundary, target: string, additionalFiles: readonly string[] = []): Promise<Stats | undefined> {
  await verifyPrivateBoundaryIdentity(boundary)
  let stat: Stats
  try { stat = await lstat(target) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    if (additionalFiles.length > 0) await verifyPrivateBoundary(boundary, additionalFiles)
    return undefined
  }
  assertPrivateFile(stat)
  await verifyPrivateBoundary(boundary, [...additionalFiles, target])
  const checked = await lstat(target)
  assertPrivateFile(checked)
  if (!samePrivateIdentity(stat, checked)) reject('Stop descriptor changed during validation')
  return checked
}

/** Publish a private discovery cache. Consumers must authenticate and recheck live identity. */
export async function publishStopDescriptor(home: string, port: number, descriptor: StopDescriptor): Promise<void> {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) reject('Invalid stop descriptor port')
  const origin = new URL(descriptor.origin)
  const authenticated = new URL(descriptor.authenticatedUrl)
  if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || Number(origin.port) !== port || authenticated.origin !== origin.origin || origin.username || origin.password) reject('Invalid stop descriptor origin')
  const body = `${JSON.stringify(descriptor)}\n`
  if (Buffer.byteLength(body) > PRIVATE_FILE_MAX_BYTES) reject('Stop descriptor is too large')
  const boundary = await stopPrivateBoundary(await realpath(home), true)
  const target = descriptorTarget(boundary, port)
  const existing = await existingDescriptor(boundary, target)
  const temporary = join(boundary.directory, `${port}-${randomUUID()}.tmp`)
  const file = await open(temporary, 'wx', 0o600)
  let created: Stats | undefined
  let published = false
  try {
    created = await file.stat()
    assertPrivateFile(created)
    await secureCreatedPrivateFile(boundary, temporary)
    if (!samePrivateIdentity(created, await lstat(temporary))) reject('Stop descriptor temporary file changed')
    await file.writeFile(body)
    await file.sync()
    assertPrivateFile(await file.stat())
    await file.close()
    const latest = await existingDescriptor(boundary, target, [temporary])
    if (!samePrivateIdentity(created, await lstat(temporary))) reject('Stop descriptor temporary file changed')
    if (existing === undefined ? latest !== undefined : latest === undefined || !samePrivateIdentity(existing, latest)) reject('Stop descriptor replacement changed')
    await rename(temporary, target)
    published = true
  } finally {
    await file.close()
    if (!published && created !== undefined) {
      try {
        await verifyPrivateBoundary(boundary, [temporary])
        if (samePrivateIdentity(created, await lstat(temporary))) await unlink(temporary)
      } catch { /* A changed boundary is never traversed for cleanup. */ }
    }
  }
}

/** Remove this boot's descriptor only; a replacement boot's file is left alone. */
export async function releaseStopDescriptor(home: string, port: number, bootId: string): Promise<void> {
  try {
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return
    const boundary = await stopPrivateBoundary(await realpath(home))
    const target = descriptorTarget(boundary, port)
    const before = await existingDescriptor(boundary, target)
    if (before === undefined) return
    const file = await open(target, PRIVATE_READ_FLAGS)
    let current: unknown
    let opened: Stats
    try {
      opened = await file.stat()
      assertPrivateFile(opened)
      if (!samePrivateIdentity(before, opened)) return
      // The filesystem boundary is verified before bootId or any credential is read.
      await verifyPrivateBoundaryIdentity(boundary, [target])
      if (!samePrivateIdentity(opened, await lstat(target))) return
      current = JSON.parse(await file.readFile('utf8'))
      const after = await file.stat()
      assertPrivateFile(after)
      if (!samePrivateIdentity(opened, after) || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) return
    } finally { await file.close() }
    if ((current as { bootId?: unknown } | null)?.bootId !== bootId) return
    const latest = await existingDescriptor(boundary, target)
    if (latest === undefined || !samePrivateIdentity(opened, latest) || latest.size !== opened.size || latest.mtimeMs !== opened.mtimeMs || latest.ctimeMs !== opened.ctimeMs) return
    await unlink(target)
  } catch { /* best effort: consumers re-verify live identity anyway */ }
}
