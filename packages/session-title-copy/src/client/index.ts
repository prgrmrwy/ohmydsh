/**
 * Web client entry for dsh-session-title-copy.
 *
 * Subscribes to the official sessions list store (the current-session id
 * truth source, same seam as dsh-cockpit-bridge), locates the official
 * conversation-header breadcrumb, and keeps a small self-owned badge right of
 * the current session title showing the first 6 characters of the session id
 * (`session-` prefix stripped). Clicking the badge copies the FULL current
 * session id; hovering shows a tooltip with the full id and a pointer cursor.
 *
 * The official title crumb is NEVER touched (it stays disabled, cursor
 * default): the interaction moves entirely to our own badge element.
 *
 * DOM-structure knowledge is confined to `title-locator.ts`; badge wiring and
 * feedback lives in `wiring.ts`. This module only wires them to the live
 * document with a strict-failure boundary: any locator/wiring error is
 * swallowed so the official page is never disturbed.
 *
 * @module dsh-session-title-copy/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: brings the ctx.sessions Context merge (0.1.2: dsh-api-session-controller).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { BadgeElementLike, CopyContext, CopyHooks } from './wiring.js'
import { BADGE_MARKER, sessionSnippet, showCopiedHint, styleBadge, updateBadge, wireBadge, writeClipboard } from './wiring.js'
import { findCrumbNav } from './title-locator.js'

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

/** Remove every plugin-owned badge (stale header / plugin cleanup). */
function clearBadges(root: { querySelectorAll(selector: string): NodeListOf<Element> }): void {
  for (const el of root.querySelectorAll(`[${BADGE_MARKER}]`)) el.remove()
}

/** Locate an already-inserted badge inside the title zone. */
function badgeIn(zone: Element): Element | null {
  return zone.querySelector(`[${BADGE_MARKER}]`)
}

export function apply(ctx: ClientContext): void {
  let observer: MutationObserver | null = null
  let cleanupHint: (() => void) | null = null

  const copyContext: CopyContext = {
    currentSessionId: (): string | undefined => ctx.sessions.list.getSnapshot().current,
  }
  const hooks: CopyHooks = {
    writeClipboard,
    showHint: (anchor: BadgeElementLike): void => {
      cleanupHint?.()
      cleanupHint = showCopiedHint(anchor)
    },
  }
  const reconcileNow = scheduleReconcile(() => {
    try {
      const nav = findCrumbNav(document)
      if (nav === null || !('parentElement' in nav && nav.parentElement !== null && nav.parentElement !== undefined)) {
        // No session title (hero/blank or structure unknown): drop any stale badge.
        clearBadges(document)
        return
      }
      const zoneEl = nav.parentElement as Element
      let badge = badgeIn(zoneEl) as BadgeElementLike | null
      if (badge === null) {
        const created = document.createElement('button') as unknown as BadgeElementLike
        created.setAttribute('type', 'button')
        styleBadge(created)
        // Insert right after the breadcrumb nav, inside the official title cluster.
        zoneEl.insertBefore(created as unknown as Node, (nav as Element).nextSibling)
        badge = created
      }
      wireBadge(badge, copyContext, hooks)
      // Equality guard: textContent/title writes trigger our own MutationObserver,
      // so an unconditional update would loop (mutation -> reconcile -> mutation).
      const id = copyContext.currentSessionId()
      if (id !== undefined && (badge.textContent !== sessionSnippet(id) || badge.getAttribute('title') !== id)) {
        updateBadge(badge, id)
      }
    } catch {
      // Strict-failure path: never let a locator/wiring error break the page.
    }
  })

  ctx.effect(() => {
    // Observe the official header chrome once it exists; the childList filter
    // catches title-area rebuilds (session switch / title generation), the
    // session subscription covers store-driven changes.
    observer = new MutationObserver(reconcileNow)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    })
    const unsubscribe = ctx.sessions.list.subscribe(reconcileNow)
    reconcileNow()
    return () => {
      observer?.disconnect()
      observer = null
      unsubscribe()
      cleanupHint?.()
      cleanupHint = null
      clearBadges(document)
    }
  }, 'session-title-copy: session id badge sync')
}
