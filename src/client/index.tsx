/**
 * Client entry for dsh-host-browsing: registers the「本地服务」tab in the
 * dsh-better-sidebar workbench. Nothing is registered unless betterSidebar exists (inject).
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { BetterSidebarService } from './better-sidebar.js'
import { Tab } from './Tab.jsx'
import { TAB_ID } from '../contract.js'
import { NS, bindLocale, en, resetLocale, t, zh, type LocaleKey } from './locales.js'
import { browserPlatform } from './platform.js'

export const name = 'sidebar-local-service-browser'

export const inject = ['betterSidebar']

function GlobeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.8 8h12.4M8 1.8c2 2 2 10.4 0 12.4M8 1.8c-2 2-2 10.4 0 12.4" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}

interface LocaleService {
  register(ns: string, dictionaries: Record<string, Record<string, string>>): () => void
  bind(ns: string): (key: LocaleKey) => string
}

export function apply(ctx: ClientContext & { betterSidebar: BetterSidebarService }): void {
  // Locale is optional: without the service the tab keeps its Chinese default copy.
  const locale = (ctx as unknown as { get(name: string): unknown }).get('locale') as LocaleService | undefined
  if (locale !== undefined) {
    ctx.effect(() => locale.register(NS, { zh, en }), 'sidebar-local-service-browser: dictionaries')
    bindLocale(locale.bind(NS))
    ctx.effect(() => resetLocale, 'sidebar-local-service-browser: locale')
  }
  const disposeTab = ctx.betterSidebar.registerTab({
    id: TAB_ID,
    title: () => t('tabTitle'),
    icon: (size: number) => <GlobeIcon size={size} />,
    order: 46,
    single: true,
    component: () => <Tab />,
  })
  ctx.effect(() => disposeTab)
  ctx.effect(() => () => { document.querySelector('style[data-dshls-style]')?.remove() })
  // Unloading the plugin also unregisters its Service Worker (spec: 可独立启停与卸载清理).
  ctx.effect(() => () => { void browserPlatform.unregisterServiceWorker().catch(() => undefined) })
}

export { Tab } from './Tab.jsx'
