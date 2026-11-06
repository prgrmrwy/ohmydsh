/**
 * Read a session title out of a DSH projection-cache block without trusting its
 * exact shape. The declared wire type is `string | null`, but the cache serves
 * whatever `viewCheckpoint` produced; a value this code cannot parse must make
 * the peek say "title not answered" so the caller falls back to a full inspect,
 * instead of reporting a titled session as untitled.
 */
export interface PeekedTitle {
  /** Whether the cache answered the title question in a form we understand (null counts). */
  readonly titleKnown: boolean
  readonly title?: string
}

export function peekTitleFromProjection(values: Record<string, unknown> | undefined): PeekedTitle {
  if (values === undefined || !Object.hasOwn(values, 'title')) return { titleKnown: false }
  const value = values['title']
  if (value === null) return { titleKnown: true }
  if (typeof value === 'string') return { titleKnown: true, title: value }
  if (typeof value === 'object' && !Array.isArray(value) && typeof (value as { title?: unknown }).title === 'string') {
    return { titleKnown: true, title: (value as { title: string }).title }
  }
  return { titleKnown: false }
}
