/**
 * Title locator: the ONE place in this package that knows the official
 * conversation-header breadcrumb DOM. Everything the client engine needs
 * about "what the current session title looks like" lives here, so a DSH
 * upgrade that changes the structure requires editing only this file.
 *
 * Official structure (`@deepseek-ai/dsh-client-ui-conversation`
 * `ConversationSessionHeader`, rc.2 line — see openspec change
 * `session-title-copy` design):
 *
 *   header                                          ← conversation chrome
 *     div .titleRow
 *       div .titleCluster
 *         nav[aria-label=session.hierarchy]          ← breadcrumb nav
 *           span .crumbSeg [key=sessionId]
 *             button .crumb[.crumbSubagent][.crumbCurrent]
 *                   (disabled only on the LAST / current session title)
 *             span .crumbSep "/"
 *         div .headerActions ...
 *       div .headerUtilities ...
 *
 * CSS Modules keep the local class name as the suffix of the emitted class
 * (`<hash>__crumb` in nextjs-style, `wSkVaW_crumb` here), so we match by
 * suffix instead of any full hashed token. The current session title is the
 * crumb button carrying the `disabled` attribute (official: `disabled: last`);
 * ancestor crumbs stay enabled and keep their official click-to-open behavior.
 *
 * The locator only READS the DOM; wiring/mutation lives in `wiring.ts`.
 *
 * @module dsh-session-title-copy/client/title-locator
 */

/** Minimal node surface the locator needs (structural so it is testable without a browser DOM). */
export interface ElementLike {
  getAttribute(name: string): string | null
  hasAttribute(name: string): boolean
  querySelector?(selector: string): ElementLike | null
  querySelectorAll?(selector: string): ArrayLike<ElementLike>
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
 * Locate the current session title button: the disabled crumb inside the
 * first conversation header's breadcrumb nav. Returns null when the structure
 * is unrecognizable — callers treat that as "do not inject anything".
 * @param root - document or a container holding the conversation layout.
 * @returns the current-title button node, or null.
 */
export function findCurrentTitleButton(root: ContainerLike): ElementLike | null {
  const headers = root.querySelectorAll('header')
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]
    if (header === undefined) continue
    const nav = header.querySelector?.('nav')
    if (nav === undefined || nav === null) continue
    const buttons = nav.querySelectorAll?.('button') ?? []
    for (let j = 0; j < buttons.length; j++) {
      const button = buttons[j]
      if (button === undefined) continue
      if (!isCrumbButton(button)) continue
      if (button.hasAttribute('disabled')) return button
    }
  }
  return null
}
