/**
 * Data layer of the sidebar usage card: one 60s TTL cache and two reads.
 *
 * The host's `GET cards` performs a real gateway request every time (only
 * concurrent reads are coalesced), and the spec forbids timer polling, so the
 * cache lives here and the component only calls it on events (mount, manual
 * refresh, expanding, page visible again).
 *
 * @module dsh-magpie-connector/client/sidebar-api
 */
import { isOk, type Api } from './api.js'
import { parseCards, type CardsView } from './view-model.js'

/** How long a successful read is reused for event-driven mounts. */
export const SIDEBAR_TTL_MS = 60_000

interface Cache { at: number; view: CardsView }
let cache: Cache | undefined
let inflight: Promise<CardsView> | undefined

/** Test seam: forget the module-level cache between cases. */
export function resetSidebarCardsCache(): void {
  cache = undefined
  inflight = undefined
}

export interface ReadOptions { now?: () => number; force?: boolean }

/** Read the cards, reusing a read younger than {@link SIDEBAR_TTL_MS} unless forced. */
export async function loadCards(api: Api, options: ReadOptions = {}): Promise<CardsView> {
  const now = options.now ?? Date.now
  if (options.force !== true && cache !== undefined && now() - cache.at < SIDEBAR_TTL_MS) return cache.view
  if (inflight !== undefined) return inflight
  const request = (async () => {
    const response = await api({ method: 'GET', path: 'cards' })
    const view = parseCards(response.body, response.status)
    if (isOk(response)) cache = { at: now(), view }
    return view
  })()
  inflight = request
  try { return await request } finally { if (inflight === request) inflight = undefined }
}

export type RefreshResult =
  | { ok: true; view: CardsView; status: number }
  | { ok: false; status: number; error: string }

/** Full refresh (`{all:true}`); a failure keeps the previous cache untouched. */
export async function refreshCards(api: Api, options: { now?: () => number } = {}): Promise<RefreshResult> {
  const now = options.now ?? Date.now
  const response = await api({ method: 'POST', path: 'cards', body: { all: true } })
  const view = parseCards(response.body, response.status)
  if (!isOk(response)) {
    // A forbidden or unconfigured reading is an explainable state, not a failure:
    // hand it to the same status line instead of a bare command error.
    if (view.status === 'forbidden' || view.status === 'unconfigured') {
      cache = { at: now(), view }
      return { ok: true, view, status: response.status }
    }
    const reason = (response.body as { error?: unknown } | null)?.error
    return { ok: false, status: response.status, error: typeof reason === 'string' && reason !== '' ? reason : `HTTP ${response.status}` }
  }
  cache = { at: now(), view }
  return { ok: true, view, status: response.status }
}
