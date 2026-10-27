import { birdSvg } from './bird-svg.js'

export const MAGPIE_SETTINGS_NAV_MARKER = 'data-dsh-magpie-connector-settings-nav'
const marker = MAGPIE_SETTINGS_NAV_MARKER
export const MAGPIE_SETTINGS_NAV_CSS = `
[${marker}] > svg:first-child{display:none}
[${marker}]::before{content:'';flex:none;width:16px;height:16px;background-color:currentColor;
-webkit-mask-image:url("data:image/svg+xml,${encodeURIComponent(birdSvg)}");mask-image:url("data:image/svg+xml,${encodeURIComponent(birdSvg)}");
-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;-webkit-mask-size:contain;mask-size:contain}
`

/** Bounded Pet/Memex-style adaptation until settings.section exposes an icon. */
export function registerMagpieSettingsNavIcon(label: () => string): () => void {
  const doc = globalThis.document
  if (!doc?.body || !doc.head) return () => {}
  const style = doc.createElement('style')
  style.setAttribute('data-dsh-magpie-connector-settings-nav-style', '')
  style.textContent = MAGPIE_SETTINGS_NAV_CSS
  doc.head.append(style)
  let disposed = false
  const sync = (): void => {
    if (disposed) return
    const current = label().trim()
    const matches = [...doc.querySelectorAll('[role="dialog"] nav button')]
      .filter(button => current !== '' && button.textContent?.trim() === current)
    // Connect uses the same English label, but its own marker is never ours.
    const own = matches.length === 1 && !matches[0]!.hasAttribute('data-dsh-magpie-connector-nav-icon') ? matches[0] : undefined
    for (const marked of doc.querySelectorAll(`[${marker}]`)) {
      if (marked !== own) marked.removeAttribute(marker)
    }
    own?.setAttribute(marker, '')
  }
  sync()
  const observer = new MutationObserver(sync)
  observer.observe(doc.body, { childList: true, subtree: true, characterData: true })
  return () => {
    disposed = true
    observer.disconnect()
    for (const marked of doc.querySelectorAll(`[${marker}]`)) marked.removeAttribute(marker)
    style.remove()
  }
}
