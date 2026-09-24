/**
 * Query preprocessing for the storage kernel's **keyword** search.
 *
 * The kernel tokenizes with two regexes and nothing else:
 *
 *   CJK_RE         = /\p{Unified_Ideograph}+/gu
 *   ASCII_TOKEN_RE = /[a-zA-Z0-9_\-./]+/g
 *
 * A run of Han characters therefore becomes **one literal token** matched by
 * substring. ASCII is split by whitespace and punctuation for free, so English
 * queries work; a Chinese question like `子进程能不能用上代理` becomes a single
 * ten-character token that exists nowhere in the corpus and returns nothing.
 *
 * Measured on a real 116-card library with a 34-case symptom-phrased gold set:
 * passing queries through unchanged scores 44% top-1 with 17 empty results;
 * segmenting Han runs into overlapping bigrams scores 65% top-1 with 8.
 *
 * Rewriting cards does not help — the failure is on the query side. A control
 * run that appended symptom keywords to five missed cards moved top-1 by zero
 * points, because an unsplittable query token cannot match any card text.
 *
 * Bigrams rather than a dictionary segmenter: no dependency, no state, and no
 * failure mode on the out-of-vocabulary terms this corpus is full of (product
 * names, abbreviations, code mixed into prose). The cost is recall traded for
 * precision — more cards clear the kernel's MIN_SCORE floor.
 */

/**
 * True for characters the kernel's `CJK_RE` would absorb into one token.
 *
 * Must stay in lockstep with the kernel: it uses `\p{Unified_Ideograph}`, which
 * covers Han ideographs only.
 *
 * Kana and Hangul are deliberately excluded because the kernel matches *neither*
 * regex on them — verified: `ひらがな`, `カタカナ` and `한글` each yield zero tokens,
 * so the kernel drops them entirely. Segmenting them here would invent tokens
 * the kernel never indexed, producing queries that cannot match by construction.
 * Fixing that is an indexing-side problem and out of scope for query rewriting.
 */
const HAN_RE = /\p{Unified_Ideograph}/u

/** Split into alternating Han / non-Han runs, preserving order. */
function splitRuns(query: string): string[] {
  const runs: string[] = []
  let current = ''
  let currentIsHan: boolean | undefined
  for (const char of query) {
    const isHan = HAN_RE.test(char)
    if (isHan !== currentIsHan) {
      if (current) runs.push(current)
      current = char
      currentIsHan = isHan
      continue
    }
    current += char
  }
  if (current) runs.push(current)
  return runs
}

/**
 * Overlapping bigrams of a Han run: `代理配置` → `代理 理配 配置`.
 *
 * Runs of one or two characters are returned as-is. Splitting a 2-char run into
 * bigrams would reproduce it exactly, and a 1-char run cannot be split at all.
 */
function bigrams(run: string): string {
  const chars = [...run]
  if (chars.length <= 2) return run
  const out: string[] = []
  for (let i = 0; i < chars.length - 1; i += 1) out.push(chars[i]! + chars[i + 1]!)
  return out.join(' ')
}

/**
 * Prepare a query for the kernel's keyword search.
 *
 * Han runs are segmented; everything else is preserved verbatim. A query with
 * no Han characters is returned byte-for-byte unchanged, so ASCII identifiers,
 * paths and version strings reach the kernel exactly as the caller wrote them.
 *
 * MUST NOT be applied to semantic search: that path embeds the query, and
 * shredding it into bigrams destroys the meaning the embedding depends on.
 */
export function segmentQuery(query: string): string {
  if (!HAN_RE.test(query)) return query
  const parts: string[] = []
  for (const run of splitRuns(query)) {
    if (HAN_RE.test(run[0]!)) {
      parts.push(bigrams(run))
      continue
    }
    // Non-Han runs carry the whitespace that separated them from their
    // neighbours; that spacing is redundant once runs are joined by a space.
    const trimmed = run.trim()
    if (trimmed) parts.push(trimmed)
  }
  return parts.join(' ')
}
