/**
 * Opening a library's card browser from the settings page.
 *
 * The constraint that shapes this: resolving the address may need a registrant
 * (the deployment's cockpit shim), and that registrant only works INSIDE the
 * cockpit iframe — it learns the cockpit origin and its capability from a
 * parent-page `postMessage`, so a standalone tab can never reach it.
 *
 * A launcher page in the new tab therefore cannot do the resolving: by the time
 * it runs it has no parent, and the registrant is gone. The work has to happen
 * HERE, in the settings page, which is inside the iframe.
 *
 * But resolving is asynchronous, and `window.open` after an await loses the
 * user activation, so the tab gets blocked. The way out does both: open a blank
 * tab synchronously inside the click (allowed), resolve in this context, then
 * point that already-open tab at the result.
 *
 * @module dsh-memex/client/browse-open
 */
import { MEMEX_BROWSE_ENDPOINT, MEMEX_CHANNEL, type MemexBrowseResult } from '../contract.js'
import type { MemexBrowseAddressRegistry } from './browse-address.js'

/** The subset of a browser tab handle this module drives. */
export interface OpenedTab {
  readonly location: { replace(url: string): void }
  readonly closed: boolean
  readonly document?: Document | null
}

export interface BrowseOpenDeps {
  /** Calls one `/dsh-memex` endpoint and unwraps its envelope. */
  readonly request: (endpoint: string, params?: unknown) => Promise<unknown>
  readonly addresses: MemexBrowseAddressRegistry
  /** Opens the placeholder tab; must run synchronously inside the click. */
  readonly openTab: () => OpenedTab | null
  /** Localized strings for the placeholder and failures. */
  readonly t: (key: 'browseOpening' | 'browseUnavailable', params?: Record<string, string>) => string
}

export interface BrowseOpenOutcome {
  readonly status: 'opened' | 'blocked' | 'failed'
  readonly address?: string
  readonly message?: string
}

/**
 * Open one library's card browser.
 *
 * Call this directly from a click handler: the tab is opened before the first
 * await, so the browser still sees a user-initiated popup.
 */
export async function openBrowseTab(scope: string, deps: BrowseOpenDeps): Promise<BrowseOpenOutcome> {
  // Synchronous, inside the activation: everything after this may await.
  const tab = deps.openTab()
  if (tab === null) return { status: 'blocked', message: 'popup blocked' }
  paint(tab, deps.t('browseOpening', { scope }))

  const fail = (message: string): BrowseOpenOutcome => {
    // Report into the tab the user is already looking at, rather than back in
    // the settings page they have visually left.
    if (!tab.closed) paint(tab, `${deps.t('browseUnavailable', { scope })}\n\n${message}`)
    return { status: 'failed', message }
  }

  let result: MemexBrowseResult
  try {
    result = await deps.request(MEMEX_BROWSE_ENDPOINT, { scope }) as MemexBrowseResult
  } catch (error) {
    return fail(describe(error, 'Could not reach the memory host.'))
  }
  if (typeof result !== 'object' || result === null || !('status' in result)) {
    return fail('The memory host returned an unexpected answer.')
  }
  if (result.status === 'refused') return fail(result.message)

  let address: string
  try {
    address = await deps.addresses.resolve({ scope, port: result.port })
  } catch (error) {
    // Never fall back to the local address here: when a registrant exists the
    // host is usually another machine, and `localhost:<port>` would resolve on
    // the user's OWN machine — silently opening whatever listens there.
    return fail(describe(error, 'No route to the card browser from this browser.'))
  }

  if (tab.closed) return { status: 'failed', address, message: 'tab was closed' }
  tab.location.replace(address)
  return { status: 'opened', address }
}

/** Write a plain message into the placeholder tab, best-effort. */
function paint(tab: OpenedTab, text: string): void {
  try {
    const doc = tab.document
    if (doc === null || doc === undefined) return
    doc.body.style.cssText = [
      'margin:0', 'min-height:100vh',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:32px', 'text-align:center', 'white-space:pre-wrap',
      'font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'background:#111', 'color:#eee',
    ].join(';')
    doc.body.textContent = text
  } catch {
    // An already-navigated or cross-origin tab is not writable; the navigation
    // below is what matters, so this stays deliberately best-effort.
  }
}

function describe(error: unknown, fallback: string): string {
  const text = error instanceof Error ? error.message.trim() : String(error ?? '').trim()
  return text === '' ? fallback : text
}

/** Bind the registry and RPC face into the deps this module needs. */
export function createBrowseOpenDeps(
  rpc: { call(channel: string, endpoint: string, params?: unknown): Promise<unknown> },
  addresses: MemexBrowseAddressRegistry,
  t: BrowseOpenDeps['t'],
): BrowseOpenDeps {
  return {
    request: async (endpoint, params) => {
      const envelope = (await rpc.call(MEMEX_CHANNEL, endpoint, params)) as { ok?: boolean; value?: unknown; error?: { message?: string } }
      if (envelope?.ok !== true) throw new Error(envelope?.error?.message ?? 'The memory host rejected the request.')
      return envelope.value
    },
    addresses,
    // No `noopener`: it would detach the very handle this approach needs. The
    // tab is blank and opened by us, and we only ever navigate it.
    openTab: () => window.open('', '_blank') as OpenedTab | null,
    t,
  }
}
