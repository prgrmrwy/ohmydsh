/**
 * Client data layer: merge selector-observed selections over the durable
 * session projections. Pure and DOM-free so it is unit-testable without a
 * browser; the row-locator consumes it to decide which rows get a logo.
 *
 * @module dsh-sidebar-session-provider-icon/client/provider-map
 */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection/types'
import type { ProviderProjection } from '../types.ts'

/**
 * Durable selection of one row, most specific first:
 *
 * 1. The official `modelSelection` projection's `next` — the selection the
 *    session will use for its next request. It also carries a model the user
 *    picked but has not sent with yet, so a row keeps the right logo once the
 *    client stops observing its selector store (the view moved on, or the
 *    session's scope was retired).
 * 2. This plugin's `provider` projection — the route of the last real request.
 *    It is the cold-history fallback that also works for a session whose
 *    `modelSelection` value this client never received.
 * @param values - the row's projection values, when the client holds any.
 * @returns provider/model to render, or `undefined` for "no badge".
 */
function durableSelection(values: Readonly<Partial<SessionProjectionMap>> | undefined): ProviderProjection | undefined {
  const intent = values?.modelSelection?.next
  if (intent !== null && intent !== undefined && intent.provider !== '' && intent.model !== '') {
    return { provider: intent.provider, model: intent.model }
  }
  const lastRequest = values?.provider
  if (lastRequest !== null && lastRequest !== undefined && lastRequest.provider !== '') return lastRequest
  return undefined
}

/** Live `sessionId → provider` map used by the sidebar renderer. */
export type ProviderBySession = ReadonlyMap<string, ProviderProjection>

/**
 * Build the effective provider map. A live observation of the selector wins; it
 * only exists while the client can verify it (see `selection-binding.ts`).
 * Everything else falls back to the durable projections.
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
    const durable = durableSelection(summary.projectionValues)
    if (durable !== undefined) out.set(id, durable)
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
