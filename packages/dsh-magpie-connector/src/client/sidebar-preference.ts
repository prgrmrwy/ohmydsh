/**
 * Shared client state of the sidebar quota preference.
 *
 * The value lives in host settings (`sidebarUsage`), but the sidebar and the
 * settings section are separate slot entries in one client bundle: this small
 * store lets the settings toggle update the sidebar immediately, and lets both
 * surfaces share one hydration read instead of one per mount.
 *
 * @module dsh-magpie-connector/client/sidebar-preference
 */
import { isOk, type Api } from './api.js'

let preference: boolean | undefined
let hydration: Promise<void> | undefined
const listeners = new Set<(value: boolean | undefined) => void>()

export const readSidebarPreference = (): boolean | undefined => preference

export function setSidebarPreference(value: boolean): void {
  if (preference === value) return
  preference = value
  for (const listener of listeners) listener(value)
}

export function subscribeSidebarPreference(listener: (value: boolean | undefined) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Read `sidebarUsage` once per page; a failed read stays retryable. */
export function hydrateSidebarPreference(api: Api | undefined): Promise<void> {
  if (api === undefined) return Promise.resolve()
  if (preference !== undefined) return Promise.resolve()
  if (hydration !== undefined) return hydration
  hydration = (async () => {
    try {
      const response = await api({ method: 'GET', path: 'settings' })
      if (isOk(response)) setSidebarPreference((response.body as { sidebarUsage?: unknown } | null)?.sidebarUsage === true)
      else hydration = undefined
    } catch {
      hydration = undefined
    }
  })()
  return hydration
}

/** Test seam: drop the hydrated value and subscribers between cases. */
export function resetSidebarPreference(): void {
  preference = undefined
  hydration = undefined
  listeners.clear()
}
