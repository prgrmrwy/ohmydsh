/**
 * Web client entry for dsh-sidebar-session-provider-icon.
 *
 * Subscribes to the official model selector's per-session store (with the
 * durable last-request projection as a cold-history fallback), and through a
 * MutationObserver keeps a brand logo badge in front of each sidebar session
 * row's title. It NEVER
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
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ProviderProjection } from '../types.ts'
import { providerBySession, providerTitleIndex } from './provider-map.js'
import { badgeInnerHTML, badgeTitle } from './logos.js'
import { BADGE_MARKER, isSessionRow, sessionIdOfRow, titleNodeOf } from './row-locator.js'
import { bindSelectionDirectory } from './selection-binding.js'

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
  let selectedSessionId: string | undefined
  let stopDirectory: (() => void) | undefined

  const reconcile = scheduleReconcile(() => reconcileList(ctx, selected))
  const syncCurrentDirectory = (): void => {
    const id = ctx.sessions.list.getSnapshot().current
    if (id === selectedSessionId) return
    stopDirectory?.()
    stopDirectory = undefined
    selectedSessionId = undefined
    if (id === undefined) {
      reconcile()
      return
    }
    try {
      stopDirectory = bindSelectionDirectory(
        id,
        (sessionId) => ctx.modelDirectories.directoryFor(sessionId),
        selected,
        reconcile,
      )
      // Record only after resolve + subscription succeeds. A transient startup
      // failure remains retryable on the next list/DOM signal for the same id.
      selectedSessionId = id
    } catch {
      // Addressed/temporarily unavailable sessions retain fallback and retry.
      reconcile()
    }
  }
  const stop = (): void => {
    observer?.disconnect()
    observer = null
    stopDirectory?.()
    stopDirectory = undefined
    selectedSessionId = undefined
    observed.clear()
  }

  ctx.effect(() => {
    // Observe the sidebar browsing region once it exists; re-armed on each
    // reconnect to a fresh DOM if the shell remounts (belt-and-suspenders).
    const root = document.body
    observer = new MutationObserver(() => {
      syncCurrentDirectory()
      reconcile()
    })
    observer.observe(root, { childList: true, subtree: true })
    observed.add(root)
    syncCurrentDirectory()
    reconcile()
    return () => {
      stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, 'sidebar-provider-icon: badge sync')

  ctx.effect(() => ctx.sessions.list.subscribe(() => {
    syncCurrentDirectory()
    reconcile()
  }), 'sidebar-provider-icon: list + selected model sync')
}
