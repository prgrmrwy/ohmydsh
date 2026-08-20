/**
 * Row locator: the ONE place in this package that knows the official
 * workspace-browser session-row DOM structure. Everything the client renderer
 * needs about "what a session row looks like" lives here, so a DSH upgrade
 * that changes the structure requires editing only this file.
 *
 * Structure (official `dsh-client-ui-workspace` `SessionNodeItem`, rc.7 and
 * master rc.8 — see openspec change `sidebar-session-provider-icon` design):
 *
 *   div[role="treeitem"] .__sessionRow        ← the row we target
 *     span .__slot                            ← official status StateDot (DO NOT touch)
 *     span .__title                           ← the row title text
 *     span .__time                            ← official relative time
 *     span .__rowActions                      ← official row menu
 *
 * CSS Modules keep the local class name as the suffix of the emitted class
 * (`<hash>__sessionRow` in nextjs-style, `YDXeBa_sessionRow` here), so we
 * match by suffix `sessionRow`/`title` instead of any full hashed token. If a
 * future build renames the local class entirely, the title-text reverse
 * lookup still anchors rows via the provider-title index, and strict
 * failures degrade to "no badge" (see spec scenario).
 *
 * @module dsh-sidebar-session-provider-icon/client/row-locator
 */

/** Minimal row interface the locator needs (kept structural so it is testable without a browser DOM). */
export interface SessionRowNode {
  getAttribute(name: string): string | null
  querySelector(selector: string): SessionTitleNode | null
}

/** Minimal title-node interface (title text plus a hook to measure the badge slot). */
export interface SessionTitleNode {
  textContent: string | null
  /** Insert a node immediately before this title (the badge seat). */
  insertAdjacentElement?(position: 'beforebegin', element: Element): Element | null
}

/** Whether a DOM class token is the official session-row local class (suffix match). */
const SESSION_ROW_SUFFIX = 'sessionRow'
/** Whether a DOM class token is the official title local class (suffix match). */
const TITLE_SUFFIX = 'title'
/** Badge marker attribute set on inserted logo spans (self-owned, collision-free). */
export const BADGE_MARKER = 'data-dsh-provider-logo'

/** Stable class-suffix matcher for a given element. */
function hasClassSuffix(node: { getAttribute(name: string): string | null }, suffix: string): boolean {
  const cls = node.getAttribute('class')
  if (cls === null) return false
  return cls.split(/\s+/).some((token) => token !== '' && token.endsWith(suffix))
}

/**
 * Identify whether a DOM node is an official session row (role treeitem with
 * the session-row local class). Workspace/project rows and search-result rows
 * do not match and are skipped by the renderer.
 * @param node - candidate node from the observed region.
 * @returns true for a session row.
 */
export function isSessionRow(node: SessionRowNode): boolean {
  return node.getAttribute('role') === 'treeitem' && hasClassSuffix(node, SESSION_ROW_SUFFIX)
}

/**
 * Extract a row's title element (the badge slot sits immediately before it).
 * Returns null when the row structure is unrecognizable — callers treat that
 * as an unlocatable row and skip insertion.
 * @param row - a node already identified as a session row.
 * @returns the title node, or null.
 */
export function titleNodeOf(row: SessionRowNode): SessionTitleNode | null {
  return row.querySelector(`span[class$="${TITLE_SUFFIX}"]`)
}

/**
 * Resolve a session row's id by its title text via a reverse index built by
 * the provider map (latest-launch semantics: blank rows have no provider and
 * are not indexed). Duplicate titles advance through the id list with a
 * per-pass `used` set; every resolution returns the first not-yet-used id so
 * a repeated title maps to distinct rows for the duration of one render pass.
 * @param titleNode - the row's title element.
 * @param index - display title → candidate session ids (provider-bearing only).
 * @param used - per-pass set of already-assigned session ids (mutated).
 * @returns the resolved session id, or undefined when unlocatable.
 */
export function sessionIdOfRow(
  titleNode: SessionTitleNode | null,
  index: ReadonlyMap<string, readonly string[]>,
  used: Set<string>,
): string | undefined {
  if (titleNode === null) return undefined
  const text = titleNode.textContent ?? ''
  const candidates = index.get(text)
  if (candidates === undefined) return undefined
  for (const id of candidates) {
    if (!used.has(id)) {
      used.add(id)
      return id
    }
  }
  return undefined
}
