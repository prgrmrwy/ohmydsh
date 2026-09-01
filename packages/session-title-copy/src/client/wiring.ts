/**
 * Wiring + feedback engine: what happens to the located current-title button.
 *
 * Split from `index.ts` so the behaviour is testable without a browser DOM:
 * `wireTitle` / `reconcile` operate over minimal structural interfaces and an
 * injectable clipboard/hint hook; only `showCopiedHint` (the default hint
 * implementation) and `writeClipboard` (the default clipboard transport) touch
 * real `navigator` / `document`.
 *
 * Why `disabled` must be removed and the click intercepted:
 * - A `disabled` button suppresses the whole event cascade (no click reaches
 *   an ancestor either), so a plain listener never fires.
 * - After removal the official React onClick (`open(summary.id)` — the crumb
 *   is rendered with `disabled: last` but its onClick is unconditional) WOULD
 *   fire and re-open the current session. React 18 delegates its listener to
 *   the container root (capture + bubble), so a native capture listener
 *   registered directly on the button runs first and `stopPropagation()`
 *   blocks the delegated click entirely.
 *
 * @module dsh-session-title-copy/client/wiring
 */
import type { ElementLike } from './title-locator.js'

/** Self-owned marker attribute set on wired buttons (collision-free). */
export const WIRED_MARKER = 'data-dsh-session-title-copy'
/** Self-owned marker attribute on the transient hint element. */
export const HINT_MARKER = 'data-dsh-session-title-copy-hint'
/** Hint label. */
export const HINT_TEXT = '会话 ID 已复制'
/** How long the hint stays fully visible. */
export const HINT_LIFETIME_MS = 1200
/** Fade-out duration before the hint is removed. */
export const HINT_FADE_MS = 200
/** Tooltip on the title button. */
export const TITLE_TOOLTIP = '点击复制会话 ID'

/** Minimal style surface (real `CSSStyleDeclaration` satisfies it). */
export interface StyleLike {
  cursor?: string
}

/** Minimal title-button surface. */
export interface WiredButtonLike extends ElementLike {
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
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
  showHint(anchor: WiredButtonLike): void
}

/**
 * Wire ONE title button: marker it, enable it (remove `disabled`, re-applied
 * by the observer when React re-creates/re-renders the crumb), register the
 * capture-phase click handler and the pointer cursor.
 * Idempotent: a button already carrying the marker is left untouched.
 * @param button - the located current-title button.
 * @param ctx - id source.
 * @param hooks - clipboard + hint transport.
 */
export function wireTitle(button: WiredButtonLike, ctx: CopyContext, hooks: CopyHooks): void {
  if (button.getAttribute(WIRED_MARKER) !== null) return
  button.setAttribute(WIRED_MARKER, '')
  button.setAttribute('title', TITLE_TOOLTIP)
  button.addEventListener('click', (event) => {
    // Block the delegated official onClick (would re-open the same session).
    event.stopPropagation()
    const id = ctx.currentSessionId()
    if (id === undefined) return
    hooks.writeClipboard(id)
      .then(() => hooks.showHint(button))
      .catch(() => {
        // Clipboard unavailable/denied: silent degrade, never disturb the page.
      })
  }, { capture: true })
}

/**
 * Reconcile one render pass: re-enable the button if the official `disabled`
 * attribute has come back (React re-render or remount), ensure wiring, and
 * keep the pointer cursor. Strict-failure safe: callers wrap in try/catch.
 * @param button - located current-title button, or null (structure unknown).
 * @param ctx - id source.
 * @param hooks - clipboard + hint transport.
 */
export function reconcile(button: WiredButtonLike | null, ctx: CopyContext, hooks: CopyHooks): void {
  if (button === null) return
  if (button.hasAttribute('disabled')) button.removeAttribute('disabled')
  wireTitle(button, ctx, hooks)
  if (button.style !== undefined) button.style.cursor = 'pointer'
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
  readonly style: { cssText: string; left?: string; top?: string; opacity?: string; transform?: string }
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
 * @param anchor - the title button that was clicked (used for positioning).
 * @param doc - document (injectable for tests).
 * @returns cleanup function.
 */
export function showCopiedHint(anchor: WiredButtonLike, doc?: HintDocumentLike): () => void {
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
    'background:var(--dsw-alias-bg-elevated, rgba(28,28,30,0.94))',
    'color:var(--dsw-alias-label-primary, #fff)',
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
