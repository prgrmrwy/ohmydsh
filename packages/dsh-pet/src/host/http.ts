/**
 * Narrow Pet management HTTP surface.
 *
 * Deliberately NOT a generic RPC bridge: every route is an exact path with a
 * strict body schema. There is no `callDshRpc`, no arbitrary prompt, no
 * arbitrary filesystem path outside the dedicated validated import operation,
 * and no channel destination pass-through.
 *
 * Trust model mirrors the audited Worktree Session seam: loopback host plus a
 * same-origin check, both failing closed.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { PetError, statusOf, toErrorBody } from './errors.js'
import { MAX_REQUEST_BODY_BYTES } from '../wire.js'

/** One exact route registration. */
export interface RouteRegistration {
  readonly path: string
  readonly handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/**
 * Write a JSON response with caching disabled.
 * @param res - Server response.
 * @param status - HTTP status.
 * @param body - Serializable body.
 */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(encoded),
  })
  res.end(encoded)
}

/**
 * Prove the request came from this machine's own DSH page.
 *
 * Both checks must pass: a loopback `Host` and, when present, a matching
 * `Origin`. A cross-origin page therefore cannot drive Pet mutations.
 * @param req - Incoming request.
 * @returns whether the request is trusted.
 */
export function isTrustedRequest(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? '').toLowerCase()
  const hostname = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : (host.split(':')[0] ?? '')
  const loopback = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
  if (!loopback) return false

  const origin = req.headers.origin
  if (origin === undefined || origin === 'null') return true
  try {
    const originHost = new URL(origin).hostname.toLowerCase()
    if (originHost === hostname) return true
    const loopbackNames = new Set(['127.0.0.1', 'localhost', '::1'])
    return loopbackNames.has(originHost) && loopbackNames.has(hostname)
  } catch {
    return false
  }
}

/**
 * Read and parse a bounded JSON request body.
 * @param req - Incoming request.
 * @returns the parsed body.
 * @throws PetError when the body is too large or not valid JSON.
 */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BODY_BYTES) {
    throw new PetError('INVALID_REQUEST', 'Request body is too large')
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_REQUEST_BODY_BYTES) {
        reject(new PetError('INVALID_REQUEST', 'Request body is too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.trim() === '') {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new PetError('INVALID_REQUEST', 'Request body must be valid JSON'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Validate a body object against an exact key allowlist.
 *
 * Unknown fields are REJECTED rather than ignored, so a client cannot smuggle
 * an unsupported parameter past a future handler change.
 * @param body - Parsed body.
 * @param allowed - Permitted keys.
 * @returns the body as a record.
 * @throws PetError on a non-object body or an unknown key.
 */
export function strictBody(
  body: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new PetError('INVALID_REQUEST', 'Request body must be a JSON object')
  }
  const record = body as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new PetError('INVALID_REQUEST', `Unknown request field '${key}'`)
    }
  }
  return record
}

/**
 * Read a required string field.
 * @param record - Validated body.
 * @param key - Field name.
 * @returns the trimmed value.
 * @throws PetError when absent or empty.
 */
export function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PetError('INVALID_REQUEST', `Field '${key}' must be a non-empty string`, {
      [key]: 'required',
    })
  }
  return value
}

/**
 * Read an optional string field.
 * @param record - Validated body.
 * @param key - Field name.
 * @returns the value, or `undefined`.
 */
export function optionalString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new PetError('INVALID_REQUEST', `Field '${key}' must be a string`, { [key]: 'invalid' })
  }
  return value
}

/** Keys whose values must never be echoed back to a client. */
const SECRET_KEY_PATTERN = /(token|secret|password|credential|apikey|api_key|authorization)/i

/**
 * Recursively redact secret-looking fields from a response payload.
 *
 * A defence in depth: Pet never stores provider credentials in the first
 * place, so a hit here indicates a bug rather than normal operation.
 * @param value - Payload to redact.
 * @returns the redacted payload.
 */
export function redactSecrets<T>(value: T): T {
  return redactWithin(value, new WeakSet<object>(), 0)
}

/** Maximum object depth walked while redacting a response. */
const MAX_REDACTION_DEPTH = 64

/**
 * Recurse with cycle and depth guards.
 *
 * Redaction is a security boundary that runs on every successful response, so
 * it must terminate on any input. A cycle or a pathologically deep structure
 * collapses to a marker instead of overflowing the stack; Pet's own records
 * are bounded and never reach either guard.
 * @param value - Value being redacted.
 * @param seen - Objects already on the current path.
 * @param depth - Current recursion depth.
 * @returns the redacted value.
 */
function redactWithin<T>(value: T, seen: WeakSet<object>, depth: number): T {
  if (typeof value !== 'object' || value === null) return value
  if (depth >= MAX_REDACTION_DEPTH) return '[truncated]' as unknown as T
  if (seen.has(value as object)) return '[circular]' as unknown as T

  seen.add(value as object)
  try {
    if (Array.isArray(value)) {
      return value.map(item => redactWithin(item, seen, depth + 1)) as unknown as T
    }
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SECRET_KEY_PATTERN.test(key)
        ? '[redacted]'
        : redactWithin(item, seen, depth + 1)
    }
    return result as unknown as T
  } finally {
    // Sibling branches may legitimately share a reference; only a cycle on the
    // CURRENT path is a problem.
    seen.delete(value as object)
  }
}

/** Handler body for one Pet route. */
export type PetRouteHandler = (input: {
  readonly body: unknown
  readonly req: IncomingMessage
}) => Promise<unknown>

/**
 * Wrap a Pet handler with trust, body limits, redaction and error mapping.
 * @param path - Exact route path.
 * @param handler - The route implementation.
 * @returns the route registration.
 */
export function petRoute(path: string, handler: PetRouteHandler): RouteRegistration {
  return {
    path,
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!isTrustedRequest(req)) {
        // Fail closed without revealing whether the route exists.
        sendJson(res, 403, {
          error: 'INVALID_REQUEST',
          message: 'Pet management is restricted to same-origin loopback requests',
        })
        return
      }
      try {
        const body = req.method === 'GET' ? {} : await readJsonBody(req)
        const result = await handler({ body, req })
        sendJson(res, 200, redactSecrets({ ok: true, data: result }))
      } catch (error) {
        const errorBody = toErrorBody(error)
        sendJson(res, statusOf(errorBody.error), { ok: false, ...errorBody })
      }
    },
  }
}
