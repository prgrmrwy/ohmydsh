/**
 * Title-zone locator: the ONE place in this package that knows the official
 * conversation-header breadcrumb DOM. Everything the client engine needs
 * about "where the session title area lives" lives here, so a DSH upgrade
 * that changes the structure requires editing only this file.
 *
 * Official structure (`@deepseek-ai/dsh-client-ui-conversation`
 * `ConversationSessionHeader`, rc.2 — see openspec change
 * `session-title-id-badge` design):
 *
 *   header                                          ← conversation chrome
 *     div .titleRow
 *       div .titleCluster                           ← OUR insertion zone
 *         nav[aria-label=session.hierarchy]          ← breadcrumb nav (anchored)
 *           span .crumbSeg [key=sessionId]
 *             button .crumb[.crumbSubagent][.crumbCurrent]
 *                   (disabled only on the LAST / current session title)
 *             span .crumbSep "/"
 *         div .headerActions ...
 *       div .headerUtilities ...
 *
 * CSS Modules keep the local class name as the suffix of the emitted class
 * (`<hash>__crumb` in nextjs-style, `wSkVaW_crumb` here), so we match by
 * suffix instead of any full hashed token. The title area exists whenever a
 * crumb nav is present (the header is hidden while a session is blank ⇒ no
 * nav).
 *
 * The locator only READS the DOM; wiring/mutation lives in `wiring.ts`.
 *
 * @module dsh-session-title-copy/client/title-locator
 */

/** Minimal node surface the locator needs (structural so it is testable without a browser DOM). */
export interface ElementLike {
  getAttribute(name: string): string | null
  querySelector?(selector: string): ElementLike | null
  querySelectorAll?(selector: string): ArrayLike<ElementLike>
  parentElement?: ElementLike | null
}

/** Minimal container surface (document or a parent element). */
export interface ContainerLike {
  querySelectorAll(selector: string): ArrayLike<ElementLike>
}

/** Whether a DOM class token is the official crumb local class (suffix match). */
const CRUMB_CLASS_SUFFIX = 'crumb'

/**
 * Identify whether a node is an official breadcrumb title button (crumb local
 * class). The current crumb carries the extra `.crumbCurrent` token which does
 * NOT end with `crumb`, so only the base class matches — the same token is
 * always present on every crumb button.
 * @param node - candidate node from the header nav.
 * @returns true for a crumb button.
 */
export function isCrumbButton(node: ElementLike): boolean {
  const cls = node.getAttribute('class')
  if (cls === null) return false
  return cls.split(/\s+/).some((token) => token !== '' && token.endsWith(CRUMB_CLASS_SUFFIX))
}

/**
 * Locate the breadcrumb nav inside the first conversation header that
 * actually contains crumb buttons (the session title exists). The session
 * header is hidden while the session is blank, so an unrecognizable layout
 * returns null — callers treat that as "insert nothing".
 * @param root - document or a container holding the conversation layout.
 * @returns the crumb nav node, or null.
 */
export function findCrumbNav(root: ContainerLike): ElementLike | null {
  const headers = root.querySelectorAll('header')
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]
    if (header === undefined) continue
    const nav = header.querySelector?.('nav')
    if (nav === undefined || nav === null) continue
    const buttons = nav.querySelectorAll?.('button') ?? []
    for (let j = 0; j < buttons.length; j++) {
      const button = buttons[j]
      if (button !== undefined && isCrumbButton(button)) return nav
    }
  }
  return null
}

/**
 * Resolve the insertion zone for the badge: the crumb nav's parent (the
 * official title cluster). Returns null when the layout is unrecognizable.
 * @param nav - the crumb nav located by {@link findCrumbNav}.
 * @returns the zone node, or null.
 */
export function titleZoneOf(nav: ElementLike): ElementLike | null {
  return nav.parentElement ?? null
}
