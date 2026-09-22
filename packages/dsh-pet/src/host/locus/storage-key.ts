/**
 * The one separator every module composing a durable Domain-table row key
 * must use, and the one validator every module accepting an id destined for
 * such a key must call.
 *
 * `\u0000` (NUL) was the separator until this module existed. `node:sqlite`
 * binds TEXT parameters as C strings and truncates at the first NUL byte, so
 * every row key built with it silently lost everything from the first
 * separator onward — `endpoint:<chatId>\u0000<threadId>` was stored as
 * `endpoint:<chatId>`. Two topic-scoped locus index rows under the same chat
 * collided onto one SQL row and `INSERT ... ON CONFLICT DO UPDATE` silently
 * discarded all but the last write; a later startup consistency check (row
 * key vs. the full key recorded inside the JSON value) is what actually
 * surfaces the damage, as "Locus index table key ... does not match ...".
 *
 * `\x1f` (Unit Separator, US) has the same "cannot occur in a legitimate
 * platform id" property NUL was chosen for, but every storage backend in this
 * codebase's supported chain — SQLite TEXT columns, JSON strings, the file
 * Domain fallback — carries it through unmodified.
 */
export const STORAGE_KEY_SEPARATOR = '\x1f'

/**
 * Whether an id is safe to place inside a `STORAGE_KEY_SEPARATOR`-joined row
 * key. Reused by every schema/admission check that used to test for NUL
 * alone; an id containing the separator character itself would let a crafted
 * platform id manufacture a collision with a different id pair.
 */
export function containsStorageKeySeparator(value: string): boolean {
  return value.includes(STORAGE_KEY_SEPARATOR)
}
