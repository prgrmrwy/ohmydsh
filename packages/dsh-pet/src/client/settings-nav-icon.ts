/**
 * Paint the 🐾 glyph on Pet's own row in the DSH settings navigation.
 *
 * DSH 0.1.x projects only `id`, `order` and `label` from a `settings.section`
 * registration and then chooses the row icon inside the settings shell from a
 * closed list of built-in ids, so a third-party section renders the fallback
 * gear. Until that public contract grows an icon field, a plugin can only
 * identify its OWN row after the dialog mounts. This is the same adaptation
 * `dsh-better-sidebar` ships for its Side card row.
 *
 * Scope discipline: the marker is written only onto the button whose visible
 * text equals Pet's current label, every marker is removed on disposal, and
 * the paired CSS selects nothing but that marker — so this owns no shell
 * structure and cannot restyle another plugin's row.
 */

/** Attribute marking Pet's settings-nav row; paired with the CSS below. */
export const PET_SETTINGS_NAV_MARKER = 'data-dsh-pet-settings-nav'

/**
 * CSS replacing the shell's fallback gear with the Pet glyph.
 *
 * The emoji is drawn as `::before` content rather than a masked SVG so it
 * matches the mascot exactly and needs no colour handling.
 */
export const PET_SETTINGS_NAV_CSS = `
[${PET_SETTINGS_NAV_MARKER}] > svg:first-child{display:none}
[${PET_SETTINGS_NAV_MARKER}]::before{content:'🐾';flex:none;width:16px;height:16px;
  font-size:14px;line-height:16px;text-align:center}
`

/**
 * Keep the marker on the settings-nav button showing Pet's label.
 *
 * The settings dialog mounts and re-renders on navigation and locale change,
 * so a one-shot query is not enough; a `MutationObserver` re-syncs the marker
 * whenever the dialog's subtree changes.
 * @param label - resolver for the section's current display label.
 * @returns disposer that stops observing and removes every owned marker.
 */
export function registerPetSettingsNavIcon(label: () => string): () => void {
  const doc = globalThis.document
  if (doc === undefined) return () => {}

  let disposed = false
  const sync = (): void => {
    if (disposed) return
    const current = label().trim()
    if (current.length === 0) return
    for (const button of doc.querySelectorAll('[role="dialog"] nav button')) {
      // Match on visible text: the shell exposes no stable per-row id.
      if (button.textContent?.trim() === current) {
        button.setAttribute(PET_SETTINGS_NAV_MARKER, '')
      } else {
        button.removeAttribute(PET_SETTINGS_NAV_MARKER)
      }
    }
  }

  sync()
  const observer = new MutationObserver(sync)
  observer.observe(doc.body, { childList: true, subtree: true, characterData: true })

  return () => {
    disposed = true
    observer.disconnect()
    for (const marked of doc.querySelectorAll(`[${PET_SETTINGS_NAV_MARKER}]`)) {
      marked.removeAttribute(PET_SETTINGS_NAV_MARKER)
    }
  }
}
