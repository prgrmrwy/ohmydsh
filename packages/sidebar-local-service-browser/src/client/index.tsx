/**
 * Client entry for dsh-sidebar-local-service-browser: registers the「本地服务」tab in the
 * dsh-better-sidebar workbench. Nothing is registered unless betterSidebar exists (inject).
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { BetterSidebarService } from './better-sidebar.js'
import { Tab } from './Tab.jsx'
import { TAB_ID } from '../contract.js'
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

export function apply(ctx: ClientContext & { betterSidebar: BetterSidebarService }): void {
  const disposeTab = ctx.betterSidebar.registerTab({
    id: TAB_ID,
    title: () => '本地服务',
    icon: (size: number) => <GlobeIcon size={size} />,
    order: 46,
    single: true,
    component: () => <Tab />,
  })
  ctx.effect(() => disposeTab)
  // Unloading the plugin also unregisters its Service Worker (spec: 可独立启停与卸载清理).
  ctx.effect(() => () => { void browserPlatform.unregisterServiceWorker().catch(() => undefined) })
}

export { Tab } from './Tab.jsx'
