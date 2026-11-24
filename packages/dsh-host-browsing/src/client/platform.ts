/**
 * Browser capabilities the tab needs (design D11). Injectable so jsdom tests can stand in for
 * Chromium; the real implementation is `browserPlatform`.
 */
import { SW_SCOPE, SW_SCRIPT } from '../contract.js'
import { t } from './locales.js'

export interface TabPlatform {
  hasServiceWorker(): boolean
  hasNavigation(): boolean
  /** Register the plugin Service Worker and resolve once it is active (≤ 5 s); reject with the reason. */
  registerServiceWorker(): Promise<void>
  /** Unregister Service Workers whose script URL starts with `/dsh-local-service/p` (design D8). */
  cleanupStaleRegistrations(): Promise<void>
  /** Unregister this plugin's own Service Worker (plugin unload). */
  unregisterServiceWorker(): Promise<void>
}

export const SW_ACTIVE_TIMEOUT_MS = 5000

export const browserPlatform: TabPlatform = {
  hasServiceWorker: () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker !== undefined,
  hasNavigation: () => typeof window !== 'undefined' && (window as { navigation?: unknown }).navigation !== undefined,
  registerServiceWorker() {
    // One budget for register() AND activation (spec 前置条件不满足时失败闭合; review M2).
    return new Promise<void>((resolve, reject) => {
      let settled = false
      let poll: ReturnType<typeof setTimeout> | undefined
      const finish = (outcome?: Error): void => {
        if (settled) return // a late register()/activation result must not act on a finished attempt
        settled = true
        clearTimeout(deadline)
        clearTimeout(poll)
        if (outcome === undefined) resolve()
        else reject(outcome)
      }
      const deadline = setTimeout(() => finish(new Error(t('errSwTimeout'))), SW_ACTIVE_TIMEOUT_MS)
      navigator.serviceWorker.register(SW_SCRIPT, { scope: SW_SCOPE }).then((reg) => {
        const check = (): void => {
          if (settled) return
          if (reg.active !== null) finish()
          else poll = setTimeout(check, 50)
        }
        check()
      }, (cause: unknown) => finish(cause instanceof Error ? cause : new Error(String(cause))))
    })
  },
  async unregisterServiceWorker() {
    if (!this.hasServiceWorker()) return
    const registration = await navigator.serviceWorker.getRegistration(SW_SCOPE)
    await registration?.unregister()
  },
  async cleanupStaleRegistrations() {
    if (!this.hasServiceWorker()) return
    const registrations = await navigator.serviceWorker.getRegistrations()
    const prefix = `${location.origin}/dsh-local-service/p`
    for (const reg of registrations) {
      const worker = reg.active ?? reg.waiting ?? reg.installing
      if (worker !== null && worker.scriptURL.startsWith(prefix)) await reg.unregister()
    }
  },
}
