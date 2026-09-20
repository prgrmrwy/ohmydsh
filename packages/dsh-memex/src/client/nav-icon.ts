/**
 * Paint the book glyph on Memory's own row in the DSH settings navigation.
 *
 * DSH 0.1.x projects only `id`, `order` and `label` from a `settings.section`
 * registration and then chooses the row icon inside the settings shell from a
 * closed list of built-in ids, so a third-party section renders the fallback
 * gear. Until that public contract grows an icon field, a plugin can only
 * identify its OWN row after the dialog mounts — the same bounded adaptation
 * `dsh-pet` and `dsh-better-sidebar` ship.
 *
 * Scope discipline: the marker is written only onto the button whose visible
 * text equals our current label, every marker is removed on disposal, and the
 * paired CSS selects nothing but that marker — this owns no shell structure and
 * cannot restyle another plugin's row. Failure to locate the row is silent: the
 * official gear stays, and the page is unaffected.
 *
 * @module dsh-memex/client/nav-icon
 */
import { NAV_MARKER } from './styles.js'

/**
 * Keep the marker on the settings-nav button showing this section's label.
 * @param label - resolver for the section's current display label.
 * @returns disposer that stops observing and removes every owned marker.
 */
export function registerMemexSettingsNavIcon(label: () => string): () => void {
  const doc = globalThis.document
  if (doc === undefined) return () => {}

  let disposed = false
  const sync = (): void => {
    if (disposed) return
    const current = label().trim()
    if (current.length === 0) return
    for (const button of doc.querySelectorAll('[role="dialog"] nav button')) {
      // The shell exposes no stable per-row id, so the visible text is the only
      // handle — and it is enough, because we match our own label exactly.
      if (button.textContent?.trim() === current) button.setAttribute(NAV_MARKER, '')
      else button.removeAttribute(NAV_MARKER)
    }
  }

  sync()
  const observer = new MutationObserver(sync)
  observer.observe(doc.body, { childList: true, subtree: true, characterData: true })

  return () => {
    disposed = true
    observer.disconnect()
    for (const marked of doc.querySelectorAll(`[${NAV_MARKER}]`)) marked.removeAttribute(NAV_MARKER)
  }
}
