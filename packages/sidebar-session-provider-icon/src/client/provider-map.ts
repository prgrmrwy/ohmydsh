/**
 * Client data layer: derive the `sessionId → provider` map from the sessions
 * list snapshot. Pure and DOM-free so it is unit-testable without a browser;
 * the row-locator consumes it to decide which rows get a logo.
 *
 * @module dsh-sidebar-session-provider-icon/client/provider-map
 */
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { ProviderProjection } from '../types.ts'

/** Live `sessionId → provider` projection map for the current list snapshot. */
export type ProviderBySession = ReadonlyMap<string, ProviderProjection>

/**
 * Build the provider map from a sessions list snapshot. Rows without a
 * non-null `projectionValues.provider` (blank sessions, no-request sessions,
 * or assemblies where the unit is absent) are omitted.
 * @param list - sessions list snapshot (host rows + current).
 * @returns sessionId → provider projection for every known provider.
 */
export function providerBySession(list: SessionListState): ProviderBySession {
  const out = new Map<string, ProviderProjection>()
  for (const id of list.ids) {
    const summary = list.byId[id]
    if (summary === undefined) continue
    const p = summary.projectionValues?.provider
    if (p !== undefined && p !== null && typeof p.provider === 'string' && p.provider !== '') {
      out.set(id, p)
    }
  }
  return out
}

/**
 * Index session rows for reverse lookup by display title, limited to sessions
 * that have a provider (the only rows that render a badge). Keeps ids in list
 * order so duplicate-title resolution is deterministic; the caller advances
 * through candidates with a per-pass used set.
 * @param list - the sessions list snapshot.
 * @returns display title → session ids (list order), provider-bearing sessions only.
 */
export function providerTitleIndex(list: SessionListState): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, string[]>()
  for (const id of list.ids) {
    const summary = list.byId[id]
    if (summary === undefined) continue
    const p = summary.projectionValues?.provider
    if (p === undefined || p === null) continue
    const text = summary.displayTitle
    if (text === '') continue
    const bucket = out.get(text)
    if (bucket === undefined) out.set(text, [id])
    else bucket.push(id)
  }
  return out
}
