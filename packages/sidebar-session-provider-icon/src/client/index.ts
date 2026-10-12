/**
 * Web client entry for dsh-sidebar-session-provider-icon.
 *
 * Subscribes to the official model selector's per-session store while its
 * session is the open one (the durable projections answer otherwise), and
 * through a MutationObserver keeps a brand logo badge in front of each sidebar
 * session row's title. It NEVER
 * touches the official status `StateDot`, time, row menu, or drag cells —
 * the badge is an independent span inserted before the title, and rows
 * without a provider value get no badge at all.
 *
 * All DOM-structure knowledge is confined to `row-locator.js`; all logic
 * that decides "what badge does this row need" is in `provider-map.js` /
 * `logos.js`. This module only wires them to the live DOM.
 *
 * @module dsh-sidebar-session-provider-icon/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
// Type-only: ctx.sessions Context merge (0.1.2: dsh-api-session-controller).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { ProviderProjection } from '../types.ts'
import { providerBySession, providerTitleIndex } from './provider-map.js'
import { badgeInnerHTML, badgeTitle } from './logos.js'
import { BADGE_MARKER, isSessionRow, sessionIdOfNode, titleNodeOf } from './row-locator.js'
import { SelectionObservation } from './selection-binding.js'
import { mainSessionId } from './main-session.js'

export const inject = ['sessions', 'modelDirectories']

/** Debounce a reconcile through requestAnimationFrame (coalesce bursts). */
function scheduleReconcile(fn: () => void): () => void {
  let raf = 0
  return () => {
    if (raf !== 0) return
    raf = requestAnimationFrame(() => {
      raf = 0
      fn()
    })
  }
}

/** Bounded DOM scan for session rows inside the sidebar browsing region. */
function findSessionRows(): Element[] {
  const found: Element[] = []
  for (const node of document.querySelectorAll('[role="treeitem"]')) {
    if (isSessionRow(node)) found.push(node)
  }
  return found
}

/** Locate or create the row's badge element (before the title). */
function badgeOf(row: Element): HTMLSpanElement | null {
  return row.querySelector<HTMLSpanElement>(`span[${BADGE_MARKER}]`)
}

/** Remove a pre-existing badge from the row, if any. */
function removeBadge(row: Element): void {
  const existing = badgeOf(row)
  existing?.remove()
}

/** Reconcile one render pass: read list + selector state and sync every visible row. */
function reconcileList(ctx: ClientContext, selected: ReadonlyMap<string, ProviderProjection>): void {
  const list = ctx.sessions.list.getSnapshot()
  const bySession = providerBySession(list, selected)
  const index = providerTitleIndex(list)
  const used = new Set<string>()
  for (const row of findSessionRows()) {
    try {
      const title = titleNodeOf(row)
      const sessionId = sessionIdOfNode(row, index, used)
      if (sessionId === undefined) {
        // Unlocatable (no row key and no provider-bearing title match): safe no-badge.
        removeBadge(row)
        continue
      }
      const projection = bySession.get(sessionId)
      if (projection === undefined) {
        removeBadge(row)
        continue
      }
      const existing = badgeOf(row)
      if (existing !== null) {
        if (existing.dataset?.provider === projection.provider && existing.dataset?.model === projection.model && existing.title === badgeTitle(projection.provider, projection.model)) {
          continue // Already up to date — do not touch the row again.
        }
        existing.remove()
      }
      if (title === null) continue // no title slot → cannot anchor the badge
      const badge = document.createElement('span')
      badge.setAttribute(BADGE_MARKER, '')
      badge.dataset.provider = projection.provider
      badge.dataset.model = projection.model
      badge.title = badgeTitle(projection.provider, projection.model)
      badge.style.cssText = 'display:inline-flex;align-items:center;margin-left:4px;line-height:0;flex:none'
      badge.innerHTML = badgeInnerHTML(projection.provider, projection.model)
      title.insertAdjacentElement?.('beforebegin', badge)
    } catch {
      // Strict-failure path: never let a locator/render error break the page.
    }
  }
}

export function apply(ctx: ClientContext): void {
  const observed = new Set<Node>()
  const selected = new Map<string, ProviderProjection>()
  let observer: MutationObserver | null = null

  const reconcile = scheduleReconcile(() => reconcileList(ctx, selected))
  // The observation owns "which session's selector are we watching, and is that
  // value still the session's current one". It re-resolves the store on every
  // signal (client session generations replace it) and drops an observation it
  // can no longer verify, so a stale value never outranks the durable
  // projection (see selection-binding.ts).
  const observation = new SelectionObservation({
    openSessionId: () => mainSessionId(ctx.sessions.list.getSnapshot()) as SessionId | undefined,
    // The seam is id-shape-agnostic (plain string) so it stays testable
    // without minting brands; the official face takes a branded SessionId.
    resolve: (sessionId) => ctx.modelDirectories.directoryFor(sessionId as SessionId),
    observed: selected,
    reconcile,
  })
  const syncObservation = (): void => {
    observation.sync()
    reconcile()
  }
  const stop = (): void => {
    observer?.disconnect()
    observer = null
    observation.stop()
    observed.clear()
  }

  ctx.effect(() => {
    // Observe the sidebar browsing region once it exists; re-armed on each
    // reconnect to a fresh DOM if the shell remounts (belt-and-suspenders).
    const root = document.body
    observer = new MutationObserver(() => {
      syncObservation()
    })
    observer.observe(root, { childList: true, subtree: true })
    observed.add(root)
    syncObservation()
    return () => {
      stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, 'sidebar-provider-icon: badge sync')

  ctx.effect(() => ctx.sessions.list.subscribe(syncObservation), 'sidebar-provider-icon: list + selected model sync')
}
