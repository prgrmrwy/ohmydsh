/**
 * Shape of one recall telemetry record.
 *
 * Two memory failures are invisible today: a card that should have been
 * recalled but was not, and a recall that returned cards carrying nothing
 * useful. The first cannot be detected automatically — deciding it requires
 * knowing the right answer, which is the reason the search happened. So this
 * module does not try. It records the facts a human needs in order to decide
 * later, typically while writing a retro card, when the answer is finally known.
 *
 * Nothing here stores the query text or any card body. Both can carry sensitive
 * material, and none of the questions this data answers needs them:
 *
 *   which cards are dead weight      → the set of slugs ever returned
 *   how often recall comes up empty  → whether hitCount was 0
 *   which recalls were noise         → whether any hit was anchored
 */

/** Characters the kernel folds into a single CJK token. */
const HAN_RE = /\p{Unified_Ideograph}/u

/** Separators the kernel splits slugs and titles on before comparing segments. */
const SEGMENT_RE = /[-_/\s.]+/

/**
 * Privacy-preserving description of a query.
 *
 * Deliberately lossy: enough to tell "Chinese natural-language question" apart
 * from "exact code-token lookup" when reading aggregates, not enough to
 * reconstruct what was asked.
 */
export interface QueryShape {
  /** Whitespace-delimited token count. */
  readonly tokens: number
  /** Whether the query contained Han characters. */
  readonly han: boolean
  /** Whether CJK segmentation rewrote the query before it reached the kernel. */
  readonly segmented: boolean
  /** Whether this went through the semantic path instead of keyword search. */
  readonly semantic: boolean
}

/** Kernel field names, in the kernel's own scoring order. */
export type CardField = 'slug' | 'title' | 'tags' | 'category' | 'headings' | 'wikilinks' | 'body'

/**
 * Field weights of `@touchskyer/memex@0.4.1` (`src/lib/scoring.ts`
 * `FIELD_WEIGHTS`). Copied, not imported: the kernel exports no library API.
 */
const FIELD_WEIGHTS: Readonly<Record<CardField, number>> = {
  slug: 5, title: 5, tags: 4, category: 3, headings: 3, wikilinks: 2, body: 1,
}
const FIELD_ORDER: readonly CardField[] = ['slug', 'title', 'tags', 'category', 'headings', 'wikilinks', 'body']

/**
 * Which field one query token matched in, identified by the token's POSITION
 * in the query the kernel received — never by the token itself.
 */
export interface FieldMatch {
  /** Zero-based index into the kernel query's whitespace tokens. */
  readonly t: number
  readonly f: CardField
  /** That field's kernel weight. */
  readonly w: number
}

/** One returned card, reduced to what analysis needs. */
export interface HitRecord {
  readonly slug: string
  /**
   * The library this card actually came from.
   *
   * Not the caller's scope: search fans out across bound scopes, so a recall
   * issued from one workspace routinely returns cards owned by another. Keying
   * "which cards were never recalled" on the caller would blame the wrong
   * library and report live cards as dead weight.
   */
  readonly scope: string
  /**
   * Whether a query token appears in this card's slug or title.
   *
   * Those are the kernel's weight-5 fields and the ones that grant its
   * high-signal threshold exemption, so an unanchored hit is one that only
   * cleared the coverage bar through body text — the signature of noise.
   */
  readonly anchored: boolean
  /** 1-based position in what the caller received. */
  readonly rank?: number
  /** First 16 hex chars of the card file's sha256 at query time: which version was seen. */
  readonly hash?: string
  /** The card's frontmatter `modified`, when it has one. */
  readonly modified?: string
  /** Per matched token, its best field — an approximation of the kernel's scoring. */
  readonly explain?: readonly FieldMatch[]
}

/** The state of one searched library at query time, so its contents can be restored later. */
export interface LibrarySnapshot {
  readonly scope: string
  /** HEAD commit, or `unknown` when the library is not a readable git repository. */
  readonly commit: string
  /** Whether the worktree had uncommitted changes; absent when the commit is unknown. */
  readonly dirty?: boolean
}

/** What the caller declared the recall was for, before seeing results. */
export type RecallIntent = 'gap' | 'background' | 'by-name' | 'dedupe' | 'verify'
export const RECALL_INTENTS: readonly RecallIntent[] = ['gap', 'background', 'by-name', 'dedupe', 'verify']

/** Normalize a caller-supplied intent: a known value verbatim, anything else `unknown`, absence stays absent. */
export function normalizeIntent(value: unknown): RecallIntent | 'unknown' | undefined {
  if (value === undefined) return undefined
  return typeof value === 'string' && (RECALL_INTENTS as readonly string[]).includes(value) ? value as RecallIntent : 'unknown'
}

export interface RecallRecord {
  readonly at: string
  /** The scope the recall was issued from; each hit carries its own owner. */
  readonly scope: string
  readonly query: QueryShape
  readonly hitCount: number
  readonly hits: readonly HitRecord[]
  readonly libraries?: readonly LibrarySnapshot[]
  /** One-way hash of the calling session id, for joining with the session log. */
  readonly session?: string
  /** The tool call id, as it appears in the session log. */
  readonly call?: string
  readonly intent?: RecallIntent | 'unknown'
}

/** One successful card write, recorded without title or body. */
export interface WriteEvent {
  readonly at: string
  /** The library actually written. */
  readonly scope: string
  readonly slug: string
  readonly kind: 'created' | 'overwritten'
  readonly hash?: string
  readonly session?: string
  readonly call?: string
  /** `provider/model` of the request that wrote the card, when known. */
  readonly model?: string
}

interface CardFields {
  readonly slug: string
  readonly title: string
  readonly tags: readonly string[]
  readonly category: string
  readonly headings: readonly string[]
  readonly wikilinks: readonly string[]
  readonly body: string
}

/** Unquote a single-line YAML scalar the simple way kernels write them. */
function scalar(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && (trimmed[0] === '"' || trimmed[0] === "'") && trimmed.at(-1) === trimmed[0]) {
    if (trimmed[0] === '"') {
      try { return JSON.parse(trimmed) as string } catch { /* fall through */ }
    }
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * Read the frontmatter keys this module needs. Deliberately not a YAML parser:
 * cards come from the kernel's own simple writer, and a card this misreads only
 * costs accuracy in an analysis record, never a search result.
 */
export function frontmatter(content: string): { readonly data: Readonly<Record<string, string | readonly string[]>>; readonly body: string } {
  if (!content.startsWith('---\n')) return { data: {}, body: content }
  const end = content.indexOf('\n---', 4)
  if (end < 0) return { data: {}, body: content }
  const data: Record<string, string | readonly string[]> = {}
  let listKey: string | undefined
  for (const line of content.slice(4, end).split('\n')) {
    const item = /^\s+-\s+(.*)$/.exec(line)
    if (item && listKey !== undefined) {
      const existing = data[listKey]
      data[listKey] = [...(Array.isArray(existing) ? existing : []), scalar(item[1]!)]
      continue
    }
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!pair) { listKey = undefined; continue }
    const key = pair[1]!
    const raw = pair[2]!
    if (raw === '') { listKey = key; data[key] = []; continue }
    listKey = undefined
    const inline = /^\[(.*)\]$/.exec(raw.trim())
    data[key] = inline ? inline[1]!.split(',').map(scalar).filter(Boolean) : scalar(raw)
  }
  const afterClose = content.indexOf('\n', end + 4)
  return { data, body: afterClose < 0 ? '' : content.slice(afterClose + 1) }
}

function cardFields(slug: string, content: string): CardFields {
  const { data, body } = frontmatter(content)
  const title = typeof data.title === 'string' && data.title !== '' ? data.title : slug
  const rawTags = data.tags ?? data.tag
  const tags = Array.isArray(rawTags) ? rawTags : typeof rawTags === 'string' ? rawTags.split(',').map(tag => tag.trim()).filter(Boolean) : []
  const category = typeof data.category === 'string' ? data.category : ''
  const headings = body.split('\n').filter(line => /^#{1,6}\s/.test(line)).map(line => line.replace(/^#{1,6}\s+/, '').trim())
  const wikilinks = [...body.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map(match => match[1]!.trim())
  return { slug, title, tags, category, headings, wikilinks, body }
}

const segmentsOf = (text: string, separator: RegExp) => text.toLowerCase().split(separator).filter(Boolean)
const wordIn = (needle: string, text: string) => new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)

/** Whether one lower-cased token matches one field, following the kernel's per-field comparison. */
function fieldMatches(token: string, field: CardField, fields: CardFields): boolean {
  const han = HAN_RE.test(token)
  switch (field) {
    case 'slug': return segmentsOf(fields.slug, /[-_/]/).includes(token)
    case 'title': return segmentsOf(fields.title, /[\s\-_]/).includes(token) || (han && fields.title.toLowerCase().includes(token))
    case 'tags': return fields.tags.some(tag => tag.toLowerCase() === token || segmentsOf(tag, /[-_]/).includes(token))
    case 'category': return fields.category.toLowerCase() === token || segmentsOf(fields.category, /[-_]/).includes(token)
    case 'headings': return fields.headings.some(heading => han ? heading.toLowerCase().includes(token) : wordIn(token, heading))
    case 'wikilinks': return fields.wikilinks.some(link => segmentsOf(link, /-/).includes(token))
    case 'body': return han ? fields.body.toLowerCase().includes(token) : wordIn(token, fields.body)
  }
}

/**
 * Explain one hit: for each query token, the highest-weight field it matched.
 *
 * Follows the kernel's field set, weights and per-field comparison rules, but
 * not its stopword, low-signal or code-token adjustments — the result answers
 * "why did this card come back", not "what exact score did it get". It is used
 * only for recording and never changes what a search returns.
 *
 * @param tokens - the kernel query split on whitespace, in order.
 * @param slug - the card slug.
 * @param content - the card file content.
 * @returns one entry per token that matched anything, identified by index.
 */
export function explainHit(tokens: readonly string[], slug: string, content: string): FieldMatch[] {
  const fields = cardFields(slug, content)
  const result: FieldMatch[] = []
  tokens.forEach((raw, index) => {
    const token = raw.toLowerCase()
    if (token === '') return
    const field = FIELD_ORDER.find(candidate => fieldMatches(token, candidate, fields))
    if (field !== undefined) result.push({ t: index, f: field, w: FIELD_WEIGHTS[field] })
  })
  return result
}

/**
 * Whether any query token lands in this card's slug or title.
 *
 * An approximation of the kernel's high-signal rule, not a reimplementation of
 * it: `tags`/`category` are ignored and the stopword and low-signal tables are
 * not reproduced. It is used for trend statistics only and never changes what
 * search returns, so drift from the kernel costs accuracy in a report rather
 * than correctness in a result.
 *
 * Note the kernel's own output cannot be used for this. Its `> 匹配行:` marker
 * means "the token also occurs in the body", not "the token only matched the
 * body" — a card matching in its slug still shows that marker when the word
 * appears in its text as well.
 */
export function anchored(queryTokens: readonly string[], slug: string, title: string): boolean {
  const haystack = `${slug} ${title}`.toLowerCase()
  const segments = new Set(haystack.split(SEGMENT_RE).filter(Boolean))
  return queryTokens.some(token => {
    const needle = token.toLowerCase()
    if (needle === '') return false
    // Han tokens are compared as substrings: the kernel does not split on word
    // boundaries for them, and neither can we.
    if (HAN_RE.test(needle)) return haystack.includes(needle)
    return segments.has(needle)
  })
}

/**
 * Reduce a query to its shape.
 *
 * Takes the tokens rather than the raw string so that no caller is tempted to
 * pass text this module would then have to be trusted to discard.
 */
export function queryShape(
  tokens: readonly string[],
  options: { readonly han: boolean; readonly segmented: boolean; readonly semantic: boolean },
): QueryShape {
  return { tokens: tokens.length, han: options.han, segmented: options.segmented, semantic: options.semantic }
}

/** Assemble one record. The caller supplies the clock so tests stay deterministic. */
export function buildRecord(input: {
  readonly at: Date
  readonly scope: string
  readonly query: QueryShape
  readonly hits: readonly HitRecord[]
  readonly libraries?: readonly LibrarySnapshot[]
  readonly session?: string
  readonly call?: string
  readonly intent?: RecallIntent | 'unknown'
}): RecallRecord {
  return {
    at: input.at.toISOString(),
    scope: input.scope,
    query: input.query,
    hitCount: input.hits.length,
    hits: input.hits,
    ...(input.libraries === undefined ? {} : { libraries: input.libraries }),
    ...(input.session === undefined ? {} : { session: input.session }),
    ...(input.call === undefined ? {} : { call: input.call }),
    ...(input.intent === undefined ? {} : { intent: input.intent }),
  }
}
