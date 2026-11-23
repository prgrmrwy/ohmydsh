/**
 * Per-frame history identity table (design D7 step 3): navigation entry key → { fam, port, rest },
 * kept in the NATIVE sessionStorage under `__dshls.entries.<frameId>`.
 */
import { ENTRIES_KEY_PREFIX, ENTRIES_MAX, FAMILIES, type EntryIdentity, type Family } from '../contract.js'
import type { NavigationLike } from './types.js'

export class IdentityTableError extends Error {}

export function isEntryIdentity(value: unknown): value is EntryIdentity {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.fam === 'string' && (FAMILIES as readonly string[]).includes(v.fam)
    && typeof v.port === 'string' && /^\d+$/.test(v.port)
    && typeof v.rest === 'string' && v.rest.startsWith('/')
}

export function readTable(storage: Storage, frameId: string): Record<string, EntryIdentity> {
  const raw = storage.getItem(`${ENTRIES_KEY_PREFIX}${frameId}`)
  if (raw === null) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new IdentityTableError('身份表不是合法 JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new IdentityTableError('身份表结构不符')
  for (const value of Object.values(parsed)) if (!isEntryIdentity(value)) throw new IdentityTableError('身份表记录结构不符')
  return parsed as Record<string, EntryIdentity>
}

/**
 * Record `identity` for the current navigation entry: read + validate the existing table (merging
 * what earlier documents of this frame wrote), prune keys no longer in `navigation.entries()`, cap
 * at ENTRIES_MAX (oldest-written first), write back. Any failure throws IdentityTableError.
 */
export function recordCurrent(storage: Storage, navigation: NavigationLike, frameId: string, identity: EntryIdentity): void {
  try {
    const table = readTable(storage, frameId)
    const current = navigation.currentEntry
    if (current === null) throw new IdentityTableError('当前历史条目不可用')
    const alive = new Set(navigation.entries().map((entry) => entry.key))
    const next = new Map<string, EntryIdentity>()
    for (const [key, value] of Object.entries(table)) if (alive.has(key) && key !== current.key) next.set(key, value)
    next.set(current.key, identity) // re-inserted last: newest-written
    while (next.size > ENTRIES_MAX) next.delete(next.keys().next().value as string)
    storage.setItem(`${ENTRIES_KEY_PREFIX}${frameId}`, JSON.stringify(Object.fromEntries(next)))
  } catch (error) {
    if (error instanceof IdentityTableError) throw error
    throw new IdentityTableError(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
  }
}

export type { Family }
