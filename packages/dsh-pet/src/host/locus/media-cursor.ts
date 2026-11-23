/**
 * In-process continuation snapshot table (change `locus-read-referenced-chats`, design D7).
 *
 * A media `cursor` is a random opaque id pointing at an immutable read plan held
 * in Host memory. Nothing about the plan is encoded in the id, so there is no
 * signature to forge and no format to version; a Host restart empties the table
 * and every earlier id becomes `cursor-invalid` (expected).
 *
 * Accepted trade-off (design D7): a continuation reads only the snapshot, so an
 * edit, recall or permission change between two pages is not detected.
 */

import { randomBytes } from 'node:crypto'

/** Entries live this long after they were issued. */
export const LOCUS_CURSOR_TTL_MS = 30 * 60 * 1000
/** 128 random bits as base64url (no padding). */
const CURSOR_ID_BYTES = 16
/** Characters the page packer reserves for one cursor; every issued id is shorter. */
export const LOCUS_CURSOR_RESERVED_CHARS = 32

export type CursorKind = 'single' | 'merge' | 'topic'

/** What one continuation needs; `units` is the append-only read plan. */
export interface CursorSnapshot {
  /** Session and entrance that issued it. */
  readonly caller: string
  /** The `messageId` parameter the read started from. */
  readonly containerId: string
  readonly linkIndex?: number
  readonly kind: CursorKind
  readonly units: readonly unknown[]
  /** Index of the next unit to deliver. */
  readonly position: number
  /** In-unit progress of that unit (a video's next whole second); default 0. */
  readonly progress?: number
  /** Failed attempts at `position`, 0..2. */
  readonly attempt: number
  /** Cumulative terminal failures so far; `complete` needs it to be 0. */
  readonly failedCount: number
  /** Link-read facts a continuation reports again: how many links the message has and the source chat. */
  readonly link?: { readonly linkCount: number; readonly source: { readonly chatId: string; readonly name?: string } }
  /** Topic list progress; opaque to this table. */
  readonly topic?: unknown
}

export interface CursorRequest {
  readonly caller: string
  readonly messageId: string
  readonly linkIndex?: number
}

export type CursorResolution =
  | { readonly kind: 'ok'; readonly snapshot: CursorSnapshot }
  | { readonly kind: 'failed'; readonly reason: 'cursor-invalid' | 'cursor-mismatch' }

export interface CursorStore {
  /** Store an immutable copy under a fresh random id. Expired entries are purged first. */
  issue(snapshot: CursorSnapshot): string
  /** Validate and fetch; never touches the platform. */
  resolve(id: string, request: CursorRequest): CursorResolution
  size(): number
}

function freezeSnapshot(snapshot: CursorSnapshot): CursorSnapshot {
  return Object.freeze({ ...snapshot, units: Object.freeze([...snapshot.units]) })
}

export function createCursorStore(options: { readonly now?: () => number; readonly ttlMs?: number } = {}): CursorStore {
  const now = options.now ?? Date.now
  const ttlMs = options.ttlMs ?? LOCUS_CURSOR_TTL_MS
  const entries = new Map<string, { readonly snapshot: CursorSnapshot; readonly expiresAt: number }>()

  const purge = (): void => {
    const at = now()
    for (const [id, entry] of entries) if (entry.expiresAt <= at) entries.delete(id)
  }

  return {
    issue(snapshot) {
      purge()
      let id: string
      do id = randomBytes(CURSOR_ID_BYTES).toString('base64url'); while (entries.has(id))
      entries.set(id, { snapshot: freezeSnapshot(snapshot), expiresAt: now() + ttlMs })
      return id
    },
    resolve(id, request) {
      const entry = entries.get(id)
      if (entry === undefined || entry.expiresAt <= now()) {
        entries.delete(id)
        return { kind: 'failed', reason: 'cursor-invalid' }
      }
      const { snapshot } = entry
      if (
        snapshot.caller !== request.caller
        || snapshot.containerId !== request.messageId
        || (request.linkIndex !== undefined && request.linkIndex !== snapshot.linkIndex)
      ) return { kind: 'failed', reason: 'cursor-mismatch' }
      return { kind: 'ok', snapshot }
    },
    size() {
      purge()
      return entries.size
    },
  }
}
