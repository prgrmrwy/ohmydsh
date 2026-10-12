/**
 * Host-issued continuation cursor for the caller-bound entrance read.
 *
 * The read tool must never hand the model a third-party pagination token: the
 * platform token is opaque but not bound to anything the Host cares about, so
 * replaying it across children, generations or entrances would reopen the
 * target-selection interface the tool deliberately removed. The Host therefore
 * issues its own cursor: the platform token travels INSIDE a signed envelope
 * that names the exact locus generation, entrance and window it belongs to.
 *
 * Verification is fail-closed: a malformed, truncated, foreign-signed or
 * mutated cursor reads as `undefined`, and the caller reports a deterministic
 * refusal. The signing key is per-process, so a cursor also stops working
 * after a Host restart — preferable to honouring a stale target binding.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** The exact read window a cursor was issued for. */
export interface LocusHistoryCursorPayload {
  readonly locusId: string
  readonly generation: number
  readonly chatId: string
  /** Present when the locus is bound to a topic; the read is scoped to it. */
  readonly threadId?: string
  readonly direction: 'older' | 'newer'
  readonly since?: string
  readonly before?: string
  /** Platform continuation token, never exposed on its own. */
  readonly page?: string
  /**
   * Messages already consumed from `page` (the page budget can cut a transport
   * page in half). Absent means zero.
   */
  readonly skip?: number
}

/** Issue and verify continuation cursors for one Host process. */
export interface LocusHistoryCursor {
  /**
   * Wrap one payload in a signed, URL-safe cursor.
   * @param payload - The exact binding the continuation must honour.
   * @returns the opaque cursor string.
   */
  readonly issue: (payload: LocusHistoryCursorPayload) => string
  /**
   * Verify a cursor and return its payload.
   * @param token - Candidate cursor from the model.
   * @returns the payload, or `undefined` when it is not a Host-issued cursor.
   */
  readonly read: (token: string) => LocusHistoryCursorPayload | undefined
}

const VERSION = 'lhc1'
const MAX_TOKEN_LENGTH = 4096

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function signature(secret: Buffer, body: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url')
}

function isPayload(value: unknown): value is LocusHistoryCursorPayload {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  const direction = record['direction']
  return typeof record['locusId'] === 'string' && record['locusId'] !== ''
    && typeof record['generation'] === 'number' && Number.isSafeInteger(record['generation'])
    && typeof record['chatId'] === 'string' && record['chatId'] !== ''
    && (direction === 'older' || direction === 'newer')
    && (record['threadId'] === undefined || typeof record['threadId'] === 'string')
    && (record['since'] === undefined || typeof record['since'] === 'string')
    && (record['before'] === undefined || typeof record['before'] === 'string')
    && (record['page'] === undefined || typeof record['page'] === 'string')
    && (record['skip'] === undefined
      || (typeof record['skip'] === 'number' && Number.isSafeInteger(record['skip']) && record['skip'] >= 0))
}

/**
 * Create the cursor codec.
 * @param secret - Signing key; omit for a fresh per-process random key.
 * @returns the codec.
 */
export function createLocusHistoryCursor(secret: Buffer = randomBytes(32)): LocusHistoryCursor {
  if (secret.length < 16) throw new Error('locus history cursor requires a secret of at least 16 bytes')
  return {
    issue(payload) {
      if (!isPayload(payload)) throw new Error('locus history cursor payload is invalid')
      const body = encode({ v: VERSION, ...payload })
      return `${body}.${signature(secret, body)}`
    },
    read(token) {
      if (typeof token !== 'string' || token === '' || token.length > MAX_TOKEN_LENGTH) return undefined
      const separator = token.indexOf('.')
      if (separator <= 0 || separator === token.length - 1) return undefined
      const body = token.slice(0, separator)
      const provided = token.slice(separator + 1)
      const expected = signature(secret, body)
      const providedBytes = Buffer.from(provided, 'utf8')
      const expectedBytes = Buffer.from(expected, 'utf8')
      if (providedBytes.length !== expectedBytes.length) return undefined
      if (!timingSafeEqual(providedBytes, expectedBytes)) return undefined
      let parsed: unknown
      try {
        parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
      } catch {
        return undefined
      }
      if (typeof parsed !== 'object' || parsed === null) return undefined
      const { v, ...payload } = parsed as Record<string, unknown>
      if (v !== VERSION) return undefined
      return isPayload(payload) ? payload : undefined
    },
  }
}
