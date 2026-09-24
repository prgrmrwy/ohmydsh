import type { HitRecord, RecallRecord } from './record.js'

/**
 * A record as it may appear on disk.
 *
 * Rows written before per-hit attribution have no `scope` on their hits, and a
 * crash can leave any field missing, so the reader accepts less than the
 * writer's type promises and decides what each gap means.
 */
export type StoredRecord = Omit<Partial<RecallRecord>, 'hits'> & {
  readonly hits?: readonly (Omit<HitRecord, 'scope'> & { readonly scope?: string })[]
}

export interface ReportInput {
  readonly records: readonly StoredRecord[]
  /** Lines that failed to parse; carried through so the report can say so. */
  readonly corruptLines: number
  /** The library whose dead weight is being measured. */
  readonly scope: string
  /** Slugs of every card in that library. */
  readonly cards: readonly string[]
  readonly days: number
  readonly now: Date
}

export interface CardCount {
  /** `<scope>/<slug>`, or `*\/<slug>` for hits that predate attribution. */
  readonly key: string
  readonly total: number
  readonly anchored: number
}

export interface Report {
  readonly days: number
  readonly recalls: number
  readonly empty: number
  readonly unanchoredOnly: number
  readonly distinctCards: number
  readonly corruptLines: number
  /** Hits written before per-hit scope: counted as reached, owned by nobody. */
  readonly unattributedHits: number
  readonly han: { readonly total: number; readonly empty: number }
  readonly scope: string
  readonly cardCount: number
  readonly neverRecalled: readonly string[]
  readonly mostReturned: readonly CardCount[]
}

const UNATTRIBUTED = '*'
const DAY_MS = 86_400_000

/**
 * Turn raw recall records into the answers a library cannot give about itself.
 *
 * Pure: no filesystem, no clock beyond `now`. The CLI owns every read.
 */
export function buildReport(input: ReportInput): Report {
  const cutoff = input.now.getTime() - input.days * DAY_MS
  const records = input.records.filter(r => {
    const at = typeof r.at === 'string' ? Date.parse(r.at) : Number.NaN
    return Number.isFinite(at) && at >= cutoff
  })

  const counts = new Map<string, { total: number; anchored: number }>()
  let unanchoredOnly = 0
  let unattributedHits = 0
  for (const record of records) {
    const hits = record.hits ?? []
    if (hits.length > 0 && hits.every(h => !h.anchored)) unanchoredOnly += 1
    for (const hit of hits) {
      // Falling back to the recall's own scope would be wrong: search fans out,
      // so the caller routinely is not the library a card came from.
      const owner = hit.scope ?? UNATTRIBUTED
      if (hit.scope === undefined) unattributedHits += 1
      const key = `${owner}/${hit.slug}`
      const entry = counts.get(key) ?? { total: 0, anchored: 0 }
      entry.total += 1
      if (hit.anchored) entry.anchored += 1
      counts.set(key, entry)
    }
  }

  // A card counts as recalled only through a hit owned by this library, or
  // through an unattributed legacy hit. A same-named card recalled from some
  // other library says nothing about this one.
  const neverRecalled = input.cards.filter(
    slug => !counts.has(`${input.scope}/${slug}`) && !counts.has(`${UNATTRIBUTED}/${slug}`),
  )

  const han = records.filter(r => r.query?.han === true)
  const mostReturned = [...counts.entries()]
    .map(([key, e]) => ({ key, total: e.total, anchored: e.anchored }))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
    .slice(0, 10)

  return {
    days: input.days,
    recalls: records.length,
    empty: records.filter(r => r.hitCount === 0).length,
    unanchoredOnly,
    distinctCards: counts.size,
    corruptLines: input.corruptLines,
    unattributedHits,
    han: { total: han.length, empty: han.filter(r => r.hitCount === 0).length },
    scope: input.scope,
    cardCount: input.cards.length,
    neverRecalled,
    mostReturned,
  }
}

/**
 * Parse NDJSON text, skipping lines that do not parse.
 *
 * An append-only log can be truncated mid-line by a crash; one bad tail must
 * never hide a month of history.
 */
export function parseRecords(text: string): { records: StoredRecord[]; corrupt: number } {
  const records: StoredRecord[] = []
  let corrupt = 0
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      const value: unknown = JSON.parse(line)
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) records.push(value as StoredRecord)
      else corrupt += 1
    } catch {
      corrupt += 1
    }
  }
  return { records, corrupt }
}

const pct = (n: number, of: number) => `${of === 0 ? 0 : Math.round((n / of) * 100)}%`

export function renderReport(report: Report, libPath: string): string {
  const out: string[] = []
  out.push(`RECALL TELEMETRY — last ${report.days} days`, '')
  out.push(`  recalls              ${report.recalls}`)
  out.push(`  empty results        ${report.empty} (${pct(report.empty, report.recalls)})   <- false-negative candidates`)
  out.push(
    `  only unanchored hits ${report.unanchoredOnly} (${pct(report.unanchoredOnly, report.recalls)})   <- returned, but likely noise`,
  )
  out.push(`  distinct cards seen  ${report.distinctCards}`)
  if (report.corruptLines > 0) out.push(`  skipped bad lines    ${report.corruptLines}`)
  if (report.unattributedHits > 0) {
    out.push(
      `  hits without a scope ${report.unattributedHits}   <- written before per-hit scope; counted, but not attributed to a library`,
    )
  }
  if (report.han.total > 0) {
    out.push('', `  Chinese queries      ${report.han.total}, of which empty ${report.han.empty} (${pct(report.han.empty, report.han.total)})`)
  }

  out.push('', `NEVER RECALLED  ${report.neverRecalled.length}/${report.cardCount} cards in ${libPath} (scope ${report.scope})`)
  out.push('  (a card nothing ever retrieves is either unneeded, or titled so it cannot be found)')
  for (const slug of report.neverRecalled.slice(0, 25)) out.push(`    ${slug}`)
  if (report.neverRecalled.length > 25) out.push(`    ... and ${report.neverRecalled.length - 25} more`)

  out.push('', 'MOST RETURNED  (high count with low anchored share = a card crowding results by accident)')
  for (const c of report.mostReturned) {
    out.push(`  ${String(c.total).padStart(3)}x  anchored ${c.anchored}/${c.total}  ${c.key}`)
  }

  out.push(
    '',
    'Note: "returned" is not "used". Whether a recall changed what you did is not',
    'observable here — that judgment stays with you, which is why a false negative',
    'is best captured when you write the retro card and already know the answer.',
  )
  return `${out.join('\n')}\n`
}
