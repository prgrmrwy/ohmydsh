import type { Context } from '@deepseek-ai/cordis'

/** Stable contracts owned by the two independent endpoint plugins. */
export const COCKPIT_PORT_FORWARD_SERVICE = 'cockpitBridge.portForward'
export const MEMEX_BROWSE_ADDRESS_SERVICE = 'dshMemex.browseAddress'

interface PortForwardHandle {
  readonly url: string
}

interface CockpitPortForwardService {
  register(channelId: string, devicePort: number): Promise<void>
  publish(channelId: string): Promise<PortForwardHandle>
}

interface BrowseTarget {
  readonly scope: string
  readonly port: number
}

interface MemexBrowseAddressRegistry {
  register(resolver: (target: BrowseTarget) => Promise<string>): () => void
}

type ServiceContext = Context & {
  get(name: string): unknown
}

/**
 * Deployment-specific coupling point. Endpoint plugins never import each
 * other; this adapter observes their public services and connects them when
 * both are live. No top-level inject is allowed because either side is
 * optional and unresolved injects make a client plugin silently not load.
 */
export const inject: string[] = []

/**
 * Channel id for one library's browse service.
 *
 * Derived from the library name so each library gets its own forward: the
 * kernel serves exactly one library per process, so sharing a channel across
 * libraries would publish the wrong one. Characters outside the cockpit's
 * accepted channel shape are replaced rather than dropped, so two distinct
 * library names cannot collapse into the same channel.
 */
export function browseChannelId(scope: string): string {
  const safe = scope.replace(/[^A-Za-z0-9._-]/g, '-')
  return `memex-browse-${safe}`.slice(0, 64)
}

export function apply(ctx: ServiceContext): void {
  let unregister: (() => void) | undefined
  let boundRegistry: MemexBrowseAddressRegistry | undefined
  let boundForward: CockpitPortForwardService | undefined

  const readRegistry = (): MemexBrowseAddressRegistry | undefined =>
    ctx.get(MEMEX_BROWSE_ADDRESS_SERVICE) as MemexBrowseAddressRegistry | undefined

  const readForward = (): CockpitPortForwardService | undefined =>
    // Keep the full dotted name in one ctx.get(). Reading the parent service
    // first and then a child property is not equivalent: Cordis reroutes dotted
    // properties through its context proxy and enforces inject, turning this
    // optional seam into an uncaught "without inject" rejection.
    ctx.get(COCKPIT_PORT_FORWARD_SERVICE) as CockpitPortForwardService | undefined

  const detach = (): void => {
    unregister?.()
    unregister = undefined
    boundRegistry = undefined
    boundForward = undefined
  }

  const reconcile = (): void => {
    const registry = readRegistry()
    const forward = readForward()
    if (registry === boundRegistry && forward === boundForward) return
    detach()
    if (registry === undefined || forward === undefined) return

    boundRegistry = registry
    boundForward = forward
    unregister = registry.register(async ({ scope, port }) => {
      // Resolve on every call: if the bridge fiber unloads after registration,
      // this throws and dsh-memex reports the failure instead of handing back
      // an address that would resolve on the wrong machine.
      const current = readForward()
      if (current === undefined) throw new Error('cockpit port-forward service unavailable')
      const channelId = browseChannelId(scope)
      // Declaring the port is what makes it publishable; the cockpit refuses
      // anything not registered, and registering the same channel again simply
      // reuses the existing forward.
      await current.register(channelId, port)
      const handle = await current.publish(channelId)
      return handle.url
    })
  }

  const stopListening = ctx.on('internal/service', (name) => {
    if (name === MEMEX_BROWSE_ADDRESS_SERVICE || name === COCKPIT_PORT_FORWARD_SERVICE) reconcile()
  }, { global: true })

  reconcile()
  ctx.effect(() => () => {
    stopListening()
    detach()
  }, 'cockpit-memex-browse-shim: bridge service adapter')
}
