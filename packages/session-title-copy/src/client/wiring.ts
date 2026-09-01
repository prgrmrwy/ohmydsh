/**
 * Badge wiring + feedback engine: the session-id short-identifier badge that
 * sits right of the current session title.
 *
 * Split from `index.ts` so the behaviour is testable without a browser DOM:
 * `sessionSnippet` / `wireBadge` / `updateBadge` / `styleBadge` operate over
 * minimal structural interfaces and an injectable clipboard/hint hook; only
 * `showCopiedHint` (the default hint implementation) and `writeClipboard`
 * (the default clipboard transport) touch real `navigator` / `document`.
 *
 * The badge is entirely plugin-owned (self-namespaced marker attribute), so
 * unlike the v0.1.0 title wiring there is NO official handler to intercept:
 * the official title crumb is left untouched (disabled, cursor default) and
 * the click handler lives on our own element.
 *
 * @module dsh-session-title-copy/client/wiring
 */
import type { ElementLike } from './title-locator.js'

/** Self-owned marker attribute set on the badge element (collision-free). */
export const BADGE_MARKER = 'data-dsh-session-title-copy-badge'
/** Self-owned marker attribute on the transient hint element. */
export const HINT_MARKER = 'data-dsh-session-title-copy-hint'
/** Hint label. */
export const HINT_TEXT = '会话 ID 已复制'
/** How long the hint stays fully visible. */
export const HINT_LIFETIME_MS = 1200
/** Fade-out duration before the hint is removed. */
export const HINT_FADE_MS = 200
/** Session id prefix stripped before taking the visible snippet. */
const SESSION_ID_PREFIX = 'session-'
/** Length of the visible short identifier. */
export const SNIPPET_LENGTH = 6

/** Minimal style surface (real `CSSStyleDeclaration` satisfies it). */
export interface StyleLike {
  cssText?: string
  left?: string
  top?: string
  opacity?: string
  transform?: string
  cursor?: string
}

/** Minimal badge surface. */
export interface BadgeElementLike extends ElementLike {
  setAttribute(name: string, value: string): void
  textContent: string | null
  addEventListener(
    type: string,
    listener: (event: { stopPropagation(): void }) => void,
    options?: { capture?: boolean },
  ): void
  style?: StyleLike
  getBoundingClientRect?(): { left: number; bottom: number }
}

/** The id truth source (production: `ctx.sessions.list.getSnapshot().current`). */
export interface CopyContext {
  currentSessionId(): string | undefined
}

/** Injectable transport, so tests do not need a real clipboard or DOM. */
export interface CopyHooks {
  writeClipboard(text: string): Promise<void>
  showHint(anchor: BadgeElementLike): void
}

/**
 * Derive the visible short identifier: the first 6 characters after the
 * `session-` prefix. The full id is `session-9af69be9-…`; taking the raw
 * first 6 characters would render "sessio", which cannot identify anything.
 * @param id - full session id.
 * @returns the 6-character snippet.
 */
export function sessionSnippet(id: string): string {
  const stripped = id.startsWith(SESSION_ID_PREFIX) ? id.slice(SESSION_ID_PREFIX.length) : id
  return stripped.slice(0, SNIPPET_LENGTH)
}

/**
 * Apply the own-branded look to a badge element. Everything is inline so the
 * plugin never depends on official CSS-module classes; official design tokens
 * are used with fallbacks only.
 * @param badge - the badge element (production: `<button type="button">`).
 */
export function styleBadge(badge: BadgeElementLike): void {
  if (badge.style === undefined) return
  badge.style.cssText = [
    'font-family:var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
    'font-size:11px',
    'line-height:16px',
    'padding:2px 6px',
    'border-radius:6px',
    'border:none',
    'margin:0',
    'cursor:pointer',
    'flex:none',
    'user-select:text',
    'background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.14))',
    'color:var(--dsw-alias-label-secondary, rgba(255,255,255,0.70))',
  ].join(';')
}

/**
 * Wire ONE badge: marker it and register the click handler that copies the
 * FULL current session id. Idempotent: a badge already carrying the marker is
 * left untouched. The badge is plugin-owned, so no propagation blocking is
 * needed against official handlers — `stopPropagation` is kept defensively so
 * no ancestor listener (including any future official one) sees the click.
 * @param badge - the badge element.
 * @param ctx - id source.
 * @param hooks - clipboard + hint transport.
 */
export function wireBadge(badge: BadgeElementLike, ctx: CopyContext, hooks: CopyHooks): void {
  if (badge.getAttribute(BADGE_MARKER) !== null) return
  badge.setAttribute(BADGE_MARKER, '')
  badge.addEventListener('click', (event) => {
    event.stopPropagation()
    const id = ctx.currentSessionId()
    if (id === undefined) return
    hooks.writeClipboard(id)
      .then(() => hooks.showHint(badge))
      .catch(() => {
        // Clipboard unavailable/denied: silent degrade, never disturb the page.
      })
  }, { capture: true })
}

/**
 * Refresh the badge content for the current session: visible 6-char snippet
 * plus a tooltip carrying the FULL id.
 * @param badge - the badge element.
 * @param fullId - current session id.
 */
export function updateBadge(badge: BadgeElementLike, fullId: string): void {
  badge.textContent = sessionSnippet(fullId)
  badge.setAttribute('title', fullId)
}

/**
 * Default clipboard transport: the async clipboard API (127.0.0.1 is a secure
 * context, and the cockpit embeds the same origin). Rejects when unavailable —
 * the click path swallows the rejection.
 * @param text - text to copy.
 * @returns a promise resolved when the copy completes.
 */
export function writeClipboard(text: string): Promise<void> {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
  if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
    return Promise.reject(new Error('clipboard unavailable'))
  }
  return clipboard.writeText(text)
}

/** Minimal hint element surface. */
export interface HintElementLike {
  setAttribute(name: string, value: string): void
  remove(): void
  readonly style: StyleLike
  textContent: string | null
}

/** Minimal document surface the hint needs. */
export interface HintDocumentLike {
  body: { appendChild(node: HintElementLike): void }
  createElement(tag: string): HintElementLike
}

/**
 * Show the transient "已复制" hint below the anchor, auto-removed after a
 * short lifetime. Returns a cleanup function (also removes a hint that is
 * mid-fade). Never affects layout: `position: fixed` + `pointer-events: none`.
 * @param anchor - the badge that was clicked (used for positioning).
 * @param doc - document (injectable for tests).
 * @returns cleanup function.
 */
export function showCopiedHint(anchor: BadgeElementLike, doc?: HintDocumentLike): () => void {
  const documentLike = doc ?? (document as unknown as HintDocumentLike)
  const el = documentLike.createElement('div')
  el.setAttribute(HINT_MARKER, '')
  el.textContent = HINT_TEXT
  el.style.cssText = [
    'position:fixed',
    'z-index:2147483000',
    'pointer-events:none',
    'white-space:nowrap',
    'padding:4px 10px',
    'border-radius:8px',
    'font-size:12px',
    'line-height:18px',
    'font-family:inherit',
    // Both colors are official theme tokens (theme-adaptive together):
    // bg-overlay = elevated surface (light gray in light mode, dark in dark
    // mode), label-primary = primary text of the same theme. Mixing a
    // hardcoded background with theme tokens broke contrast in light mode
    // (dark-on-dark), so never pair them with a fixed color.
    'background:var(--dsw-alias-bg-overlay, rgba(28,28,30,0.94))',
    'color:var(--dsw-alias-label-primary, #fff)',
    'border:1px solid var(--dsw-alias-border-l2, transparent)',
    'box-shadow:0 2px 8px rgba(0,0,0,0.28)',
    'transition:opacity 200ms ease',
  ].join(';')
  const rect = anchor.getBoundingClientRect?.()
  if (rect !== undefined && typeof rect.left === 'number' && typeof rect.bottom === 'number') {
    el.style.left = `${Math.round(rect.left)}px`
    el.style.top = `${Math.round(rect.bottom + 6)}px`
  } else {
    el.style.left = '50%'
    el.style.transform = 'translateX(-50%)'
    el.style.top = '16px'
  }
  documentLike.body.appendChild(el)
  let removed = false
  const cleanup = (): void => {
    if (removed) return
    removed = true
    el.remove()
  }
  globalThis.setTimeout(() => {
    el.style.opacity = '0'
    globalThis.setTimeout(cleanup, HINT_FADE_MS)
  }, HINT_LIFETIME_MS)
  return cleanup
}
