/**
 * The launcher: a same-origin page that turns a click into a browse tab.
 *
 * It exists because of one browser rule. Resolving an address needs the Host
 * (start the service, learn the bound port) and possibly a registrant (translate
 * that port for this machine) — both asynchronous. A click handler that awaits
 * loses its user activation, so `window.open` afterwards is blocked. The button
 * therefore opens THIS page synchronously, and all the waiting happens here,
 * where there is also room to explain a failure instead of a blocked popup.
 *
 * It also cannot be a server redirect: the address may have to be resolved by a
 * registrant that only exists in the browser, and the Host cannot run it.
 *
 * @module dsh-memex/client/launcher
 */
import { MEMEX_BROWSE_ENDPOINT, MEMEX_CHANNEL, type MemexBrowseResult } from '../contract.js'
import type { MemexBrowseAddressRegistry } from './browse-address.js'

/** Hash route this page answers on, e.g. `#/dsh-memex/browse/personal`. */
export const MEMEX_LAUNCHER_ROUTE = '#/dsh-memex/browse/'

/** Build the same-origin URL a click opens synchronously. */
export function launcherUrl(scope: string): string {
  return `${window.location.origin}${window.location.pathname}${MEMEX_LAUNCHER_ROUTE}${encodeURIComponent(scope)}`
}

/** Read the target library out of a launcher URL, if this is one. */
export function launcherScope(hash: string): string | undefined {
  if (!hash.startsWith(MEMEX_LAUNCHER_ROUTE)) return undefined
  const raw = hash.slice(MEMEX_LAUNCHER_ROUTE.length)
  if (raw === '') return undefined
  try {
    return decodeURIComponent(raw)
  } catch {
    return undefined
  }
}

export interface LauncherOutcome {
  readonly status: 'ready' | 'failed'
  /** Address to navigate to; present only when ready. */
  readonly address?: string
  /** Why it failed, already phrased for a human. */
  readonly message?: string
}

export interface LauncherDeps {
  /** Calls the Host's `/dsh-memex` channel and unwraps its result envelope. */
  readonly request: (endpoint: string, params?: unknown) => Promise<unknown>
  readonly addresses: MemexBrowseAddressRegistry
}

/** The `{ ok, value, error }` envelope every `/dsh-memex` endpoint answers with. */
interface ChannelEnvelope {
  readonly ok?: boolean
  readonly value?: unknown
  readonly error?: { readonly message?: string }
}

/**
 * Ensure the service, then resolve the address for THIS browser.
 *
 * Never returns a local address on a registrant failure: doing so would hand
 * back something that resolves on the user's own machine and quietly opens
 * whatever happens to listen there.
 */
export async function runLauncher(scope: string, deps: LauncherDeps): Promise<LauncherOutcome> {
  let result: MemexBrowseResult
  try {
    result = await deps.request(MEMEX_BROWSE_ENDPOINT, { scope }) as MemexBrowseResult
  } catch (error) {
    return { status: 'failed', message: describe(error, 'Could not reach the memory host.') }
  }

  if (result === undefined || result === null || typeof result !== 'object' || !('status' in result)) {
    return { status: 'failed', message: 'The memory host returned an unexpected answer.' }
  }
  if (result.status === 'refused') {
    return { status: 'failed', message: result.message }
  }

  try {
    const address = await deps.addresses.resolve({ scope, port: result.port })
    return { status: 'ready', address }
  } catch (error) {
    return {
      status: 'failed',
      message: describe(error, 'The card browser is running on another machine and no route to it is available from here.'),
    }
  }
}

function describe(error: unknown, fallback: string): string {
  const text = error instanceof Error ? error.message.trim() : String(error ?? '').trim()
  return text === '' ? fallback : text
}

/** Bind the registry to the Connection RPC face, unwrapping its envelope. */
export function createLauncherDeps(
  rpc: { call(channel: string, endpoint: string, params?: unknown): Promise<unknown> },
  addresses: MemexBrowseAddressRegistry,
): LauncherDeps {
  return {
    request: async (endpoint, params) => {
      const envelope = (await rpc.call(MEMEX_CHANNEL, endpoint, params)) as ChannelEnvelope
      // A transport-level failure is not a refusal: surfacing the host's own
      // message keeps "channel unreachable" distinguishable from "this library
      // cannot be browsed".
      if (envelope?.ok !== true) throw new Error(envelope?.error?.message ?? 'The memory host rejected the request.')
      return envelope.value
    },
    addresses,
  }
}
