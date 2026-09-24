/**
 * Client data layer: merge selector-observed selections over durable
 * last-request projections. Pure and DOM-free so it is unit-testable without
 * a browser; the row-locator consumes it to decide which rows get a logo.
 *
 * @module dsh-sidebar-session-provider-icon/client/provider-map
 */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ProviderProjection } from '../types.ts'

/** Live `sessionId → provider` map used by the sidebar renderer. */
export type ProviderBySession = ReadonlyMap<string, ProviderProjection>

/**
 * Build the effective provider map. The model selector's observed `current`
 * selection wins immediately; the durable last-request projection is only a
 * cold-session fallback for rows whose selector store has not been loaded in
 * this browser process.
 * @param list - sessions list snapshot (host rows + current).
 * @param selected - selections observed from `ctx.modelDirectories` stores.
 * @returns sessionId → effective provider/model for every known selection.
 */
export function providerBySession(
  list: SessionListState,
  selected: ReadonlyMap<string, ProviderProjection> = new Map(),
): ProviderBySession {
  const out = new Map<string, ProviderProjection>()
  for (const id of list.ids) {
    const summary = list.byId[id]
    if (summary === undefined) continue
    const current = selected.get(id)
    if (current !== undefined && current.provider !== '') {
      out.set(id, current)
      continue
    }
    const fallback = summary.projectionValues?.provider
    if (fallback !== undefined && fallback !== null && typeof fallback.provider === 'string' && fallback.provider !== '') {
      out.set(id, fallback)
    }
  }
  return out
}

/**
 * Index all session rows for reverse lookup by display title. Provider-bearing
 * filtering happens after row identity resolution: a blank session can have a
 * model-selector selection even though no request projection exists yet.
 * Keeps ids in list order so duplicate-title resolution is deterministic; the
 * caller advances through candidates with a per-pass used set.
 * @param list - the sessions list snapshot.
 * @returns display title → session ids in list order.
 */
export function providerTitleIndex(list: SessionListState): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, string[]>()
  for (const id of list.ids) {
    const summary = list.byId[id]
    if (summary === undefined) continue
    const text = summary.displayTitle
    if (text === '') continue
    const bucket = out.get(text)
    if (bucket === undefined) out.set(text, [id])
    else bucket.push(id)
  }
  return out
}
