/**
 * Endpoint identity and the locus main preset (openspec pet-locus-isomorphic-entries).
 *
 * The v19 locus aggregate (generations, records, transitions) is gone: the
 * persisted v20 rows live in contract-v20.ts and persistence-v20.ts. What remains
 * here is the normalized Lark endpoint, its storage key, and the preset constant
 * every locus main composes from.
 */

import { LOCUS_BASE_PRESET } from './preset.js'
import { STORAGE_KEY_SEPARATOR, containsStorageKeySeparator } from './storage-key.js'

/**
 * The preset Pet mounts on a locus main session it creates.
 *
 * The locus main and its children compose from the same neutral whitelist
 * preset (see `preset.ts`); the preset of a user's work session never matters
 * to a child, because a child's parent is always the locus main.
 */
export const LOCUS_MAIN_PRESET = LOCUS_BASE_PRESET

/** The normalized address of a Lark chat or a thread inside that chat. */
export interface LocusEndpoint {
  readonly chatId: string
  readonly threadId?: string
}

/** A normalized endpoint and its stable in-memory/index key. */
export interface NormalizedEndpoint {
  readonly endpoint: LocusEndpoint
  readonly key: string
}

/** Error codes the endpoint helpers can raise. */
export type LocusErrorCode = 'INVALID_ENDPOINT'

/** Stable, dependency-free error for deterministic repository callers. */
export class LocusError extends Error {
  readonly code: LocusErrorCode

  constructor(code: LocusErrorCode, message: string) {
    super(message)
    this.name = 'LocusError'
    this.code = code
  }
}

/**
 * Normalize a Lark endpoint.  IDs are opaque platform identifiers: trim outer
 * whitespace but never lowercase or otherwise rewrite their case.  Empty
 * thread IDs mean the chat-level endpoint and are omitted from the result.
 */
export function normalizeLocusEndpoint(endpoint: LocusEndpoint): NormalizedEndpoint {
  if (endpoint === null || typeof endpoint !== 'object') {
    throw new LocusError('INVALID_ENDPOINT', 'A locus endpoint must be an object')
  }

  const chatId = typeof endpoint.chatId === 'string' ? endpoint.chatId.trim() : ''
  const rawThreadId = endpoint.threadId
  if (rawThreadId !== undefined && typeof rawThreadId !== 'string') {
    throw new LocusError('INVALID_ENDPOINT', 'threadId must be a string when provided')
  }
  const threadId = rawThreadId === undefined ? undefined : rawThreadId.trim()

  if (chatId.length === 0) {
    throw new LocusError('INVALID_ENDPOINT', 'A locus endpoint requires a non-empty chatId')
  }
  if (containsStorageKeySeparator(chatId) || (threadId !== undefined && containsStorageKeySeparator(threadId))) {
    throw new LocusError('INVALID_ENDPOINT', 'Locus endpoint identifiers may not contain the storage key separator')
  }

  const endpointValue: LocusEndpoint =
    threadId === undefined || threadId.length === 0 ? { chatId } : { chatId, threadId }
  return {
    endpoint: endpointValue,
    key: endpointKeyOf(endpointValue),
  }
}

/**
 * Stable endpoint key.  Chat-only endpoints use the chat id itself; a topic
 * appends {@link STORAGE_KEY_SEPARATOR}.  Lark IDs do not contain it, so this
 * is reversible and keeps the familiar `chat<sep>thread` form used by the
 * channel seam.
 *
 * The separator MUST NOT be NUL: every row this key becomes a SQLite TEXT
 * PRIMARY KEY for goes through `node:sqlite`, which binds strings as C
 * strings and truncates at the first NUL byte — every topic-scoped endpoint
 * under the same chat would collide onto that chat's own row.
 */
export function endpointKeyOf(endpoint: LocusEndpoint): string {
  const normalized = endpoint === undefined ? undefined : normalizeWithoutKey(endpoint)
  if (normalized === undefined) {
    throw new LocusError('INVALID_ENDPOINT', 'A locus endpoint is required')
  }
  return normalized.threadId === undefined
    ? normalized.chatId
    : `${normalized.chatId}${STORAGE_KEY_SEPARATOR}${normalized.threadId}`
}

/** Parse a stable endpoint key created by {@link endpointKeyOf}. */
export function endpointFromKey(key: string): LocusEndpoint {
  if (typeof key !== 'string' || key.length === 0) {
    throw new LocusError('INVALID_ENDPOINT', 'An endpoint key must be non-empty')
  }
  const separator = key.indexOf(STORAGE_KEY_SEPARATOR)
  if (separator < 0) return normalizeLocusEndpoint({ chatId: key }).endpoint
  const chatId = key.slice(0, separator)
  const threadId = key.slice(separator + 1)
  return normalizeLocusEndpoint({ chatId, threadId }).endpoint
}

function normalizeWithoutKey(endpoint: LocusEndpoint): LocusEndpoint {
  if (endpoint === null || typeof endpoint !== 'object') {
    throw new LocusError('INVALID_ENDPOINT', 'A locus endpoint must be an object')
  }
  const chatId = typeof endpoint.chatId === 'string' ? endpoint.chatId.trim() : ''
  const rawThreadId = endpoint.threadId
  if (rawThreadId !== undefined && typeof rawThreadId !== 'string') {
    throw new LocusError('INVALID_ENDPOINT', 'threadId must be a string when provided')
  }
  const threadId = rawThreadId === undefined ? undefined : rawThreadId.trim()
  if (chatId.length === 0) {
    throw new LocusError('INVALID_ENDPOINT', 'A locus endpoint requires a non-empty chatId')
  }
  if (containsStorageKeySeparator(chatId) || (threadId !== undefined && containsStorageKeySeparator(threadId))) {
    throw new LocusError('INVALID_ENDPOINT', 'Locus endpoint identifiers may not contain the storage key separator')
  }
  return threadId === undefined || threadId.length === 0 ? { chatId } : { chatId, threadId }
}
