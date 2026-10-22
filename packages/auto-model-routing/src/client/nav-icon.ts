const LABEL = '自动模型路由'
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="black" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3C7.1 2.1 5.2 2.2 4.5 3.6C3.1 3.7 2.2 5 2.6 6.3C1.7 7.1 1.7 8.9 2.7 9.7C2.4 11.1 3.3 12.3 4.7 12.4C5.2 13.8 7.1 14.1 8 13.2Z"/><path d="M5.2 6.4C6 6.4 6.6 5.9 6.7 5.1M5.3 9.7C6.1 9.6 6.7 10.1 6.8 10.9M8 8H10M10 8C11.3 8 11.4 4.4 13.1 4.4M10 8C11.3 8 11.4 11.6 13.1 11.6M10 8H13.1"/><g fill="black" stroke="none"><circle cx="14" cy="4.4" r=".9"/><circle cx="14" cy="8" r=".9"/><circle cx="14" cy="11.6" r=".9"/></g></svg>'
/** Bounded adapter for the settings slot, whose navigation API has no icon field. */
export function installRoutingNavIcon(doc: Document): () => void {
  const style = doc.createElement('style')
  style.dataset.amrNavStyle = ''
  style.textContent = `[data-amr-nav] svg{display:none!important}[data-amr-nav]::before{content:"";display:block;flex:none;width:16px;height:16px;background:currentColor;mask:url("data:image/svg+xml,${encodeURIComponent(SVG)}") center/contain no-repeat}`
  doc.head.append(style)
  const update = () => {
    const matches = new Set(Array.from(doc.querySelectorAll<HTMLElement>('[role="dialog"] nav button')).filter(button => button.textContent?.trim() === LABEL))
    for (const button of Array.from(doc.querySelectorAll('[data-amr-nav]'))) if (!matches.has(button as HTMLElement)) button.removeAttribute('data-amr-nav')
    for (const button of matches) if (!button.hasAttribute('data-amr-nav')) button.setAttribute('data-amr-nav', '')
  }
  update()
  const observer = new MutationObserver(update)
  observer.observe(doc.body, { childList: true, subtree: true, characterData: true })
  return () => { observer.disconnect(); style.remove(); for (const button of Array.from(doc.querySelectorAll('[data-amr-nav]'))) button.removeAttribute('data-amr-nav') }
}
