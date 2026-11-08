/**
 * Display-only lookup cache for the management panel (chat names, doc metadata).
 * The panel refreshes often; a hit is kept 10 minutes, a failed or empty lookup
 * is retried after 1 minute. Never throws: a missing name only degrades display.
 */
export function createDisplayCache<T>(
  fetch: (key: string) => Promise<T | undefined>,
  now: () => number = Date.now,
): { get: (key: string) => Promise<T | undefined> } {
  const entries = new Map<string, { readonly at: number; readonly value: T | undefined }>()
  return {
    get: async key => {
      const at = now()
      const hit = entries.get(key)
      if (hit !== undefined && at - hit.at < (hit.value !== undefined ? 10 * 60_000 : 60_000)) return hit.value
      const value = await fetch(key).catch(() => undefined)
      entries.set(key, { at, value })
      return value
    },
  }
}
