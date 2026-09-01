/**
 * Web client entry for dsh-session-title-copy.
 *
 * Subscribes to the official sessions list store (the current-session id
 * truth source, same seam as dsh-cockpit-bridge), locates the current session
 * title in the official conversation header, and makes it click-to-copy the
 * current session id — with a pointer cursor and a transient "已复制" hint.
 *
 * DOM-structure knowledge is confined to `title-locator.ts`; all button
 * wiring and feedback lives in `wiring.ts`. This module only wires them to
 * the live document with a strict-failure boundary: any locator/wiring error
 * is swallowed so the official page is never disturbed.
 *
 * @module dsh-session-title-copy/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { WiredButtonLike } from './wiring.js'
import { findCurrentTitleButton } from './title-locator.js'
import { reconcile, showCopiedHint, writeClipboard } from './wiring.js'

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

export function apply(ctx: ClientContext): void {
  let observer: MutationObserver | null = null
  let cleanupHint: (() => void) | null = null

  const copyContext = {
    currentSessionId: (): string | undefined => ctx.sessions.list.getSnapshot().current,
  }
  const hooks = {
    writeClipboard,
    showHint: (anchor: WiredButtonLike): void => {
      cleanupHint?.()
      cleanupHint = showCopiedHint(anchor)
    },
  }
  const reconcileNow = scheduleReconcile(() => {
    try {
      reconcile(findCurrentTitleButton(document) as WiredButtonLike | null, copyContext, hooks)
    } catch {
      // Strict-failure path: never let a locator/wiring error break the page.
    }
  })

  ctx.effect(() => {
    // Observe the official header chrome once it exists; the attribute filter
    // re-arms the button the moment React re-applies `disabled` (re-render or
    // remount), the session subscription covers store-driven title changes.
    observer = new MutationObserver(reconcileNow)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'class'],
    })
    const unsubscribe = ctx.sessions.list.subscribe(reconcileNow)
    reconcileNow()
    return () => {
      observer?.disconnect()
      observer = null
      unsubscribe()
      cleanupHint?.()
      cleanupHint = null
    }
  }, 'session-title-copy: current session title wire')
}
