/**
 * Web client entry for dsh-sidebar-session-provider-icon.
 *
 * Subscribes to the sessions list, and through a MutationObserver keeps a
 * provider logo badge in front of each sidebar session row's title, updated
 * as sessions gain/switch providers and as rows mount/unmount. It NEVER
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
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { providerBySession, providerTitleIndex } from './provider-map.js'
import { badgeInnerHTML, badgeTitle } from './logos.js'
import { BADGE_MARKER, isSessionRow, sessionIdOfRow, titleNodeOf } from './row-locator.js'

export const inject = ['sessions']

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

/** Reconcile one render pass: read list state and sync every visible row. */
function reconcileList(ctx: ClientContext): void {
  const list = ctx.sessions.list.getSnapshot()
  const bySession = providerBySession(list)
  const index = providerTitleIndex(list)
  const used = new Set<string>()
  for (const row of findSessionRows()) {
    try {
      const title = titleNodeOf(row)
      const sessionId = sessionIdOfRow(title, index, used)
      if (sessionId === undefined) {
        // Unlocatable (no provider-bearing title match): safe no-badge.
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
      badge.style.cssText = 'display:inline-flex;align-items:center;margin-right:4px;line-height:0;flex:none'
      badge.innerHTML = badgeInnerHTML(projection.provider, projection.model)
      title.insertAdjacentElement?.('beforebegin', badge)
    } catch {
      // Strict-failure path: never let a locator/render error break the page.
    }
  }
}

export function apply(ctx: ClientContext): void {
  const observed = new Set<Node>()
  let observer: MutationObserver | null = null

  const reconcile = scheduleReconcile(() => reconcileList(ctx))
  const stop = (): void => {
    observer?.disconnect()
    observer = null
    observed.clear()
  }

  ctx.effect(() => {
    // Observe the sidebar browsing region once it exists; re-armed on each
    // reconnect to a fresh DOM if the shell remounts (belt-and-suspenders).
    const root = document.body
    observer = new MutationObserver(() => reconcile())
    observer.observe(root, { childList: true, subtree: true })
    observed.add(root)
    reconcile()
    return () => {
      stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, 'sidebar-provider-icon: badge sync')

  ctx.effect(() => ctx.sessions.list.subscribe(() => reconcile()), 'sidebar-provider-icon: list sync')
}
