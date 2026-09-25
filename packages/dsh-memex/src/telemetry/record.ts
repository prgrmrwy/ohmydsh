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
}

export interface RecallRecord {
  readonly at: string
  /** The scope the recall was issued from; each hit carries its own owner. */
  readonly scope: string
  readonly query: QueryShape
  readonly hitCount: number
  readonly hits: readonly HitRecord[]
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
}): RecallRecord {
  return {
    at: input.at.toISOString(),
    scope: input.scope,
    query: input.query,
    hitCount: input.hits.length,
    hits: input.hits,
  }
}
