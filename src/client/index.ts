import type { Context } from '@deepseek-ai/cordis'

export const COCKPIT_FORWARDS_SERVICE = 'cockpitBridge.forwards'
export const MEMEX_BROWSE_ADDRESS_SERVICE = 'dshMemex.browseAddress'
export const FORWARD_READY_TIMEOUT_MS = 15_000

interface ForwardHandle {
  readonly state: 'starting' | 'ready' | 'retrying' | 'paused' | 'removed'
  readonly address?: { readonly url: string }
  onChange(listener: () => void): () => void
}
interface CockpitForwardsService {
  acquire(devicePort: number, holder: string): Promise<ForwardHandle>
  release(handle: ForwardHandle): Promise<void>
}
interface MemexBrowseAddressRegistry {
  register(resolver: (target: { scope: string; port: number }) => Promise<string>): () => void
}
type ServiceContext = Context & { get(name: string): unknown }

export const inject: string[] = []

function unavailable(): Error {
  return new Error('cockpit forwards service unavailable or binding ended')
}

function isLocalDevice(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && (error as { name?: unknown }).name === 'CockpitForwardsError'
    && (error as { code?: unknown }).code === 'local-device'
}

/** The port, not the scope label, identifies the bridge's shared forward. */
export function browseHolder(port: number, bindingId: string): string {
  return `memex-browse-${port}-${bindingId}`
}

/** Cancel a click immediately, even if acquire is still in flight. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(unavailable())
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

function readyAddress(handle: ForwardHandle, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let done = false
    let stop: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: Error, url?: string) => {
      if (done) return
      done = true
      stop?.()
      if (timer !== undefined) clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (error !== undefined) reject(error)
      else resolve(url!)
    }
    const abort = () => finish(unavailable())
    const check = () => {
      if (signal.aborted) return abort()
      if (handle.state === 'removed') return finish(new Error('cockpit forward removed'))
      if (handle.state === 'ready' && handle.address !== undefined) finish(undefined, handle.address.url)
    }
    signal.addEventListener('abort', abort, { once: true })
    stop = handle.onChange(check)
    // Also handle a notification during subscription itself.
    if (done) stop()
    else {
      timer = setTimeout(() => finish(new Error('cockpit forward readiness timed out')), FORWARD_READY_TIMEOUT_MS)
      check()
    }
  })
}

export function apply(ctx: ServiceContext): void {
  let seenBridge = false
  let unregister: (() => void) | undefined
  let boundRegistry: MemexBrowseAddressRegistry | undefined
  let boundForward: CockpitForwardsService | undefined
  let controller: AbortController | undefined
  let handles = new Map<number, Promise<ForwardHandle>>()

  // Cordis dotted properties must be read in a single inject-free lookup.
  const readRegistry = () => ctx.get(MEMEX_BROWSE_ADDRESS_SERVICE) as MemexBrowseAddressRegistry | undefined
  const readForward = () => ctx.get(COCKPIT_FORWARDS_SERVICE) as CockpitForwardsService | undefined

  const detach = () => {
    controller?.abort()
    const service = boundForward
    if (service !== undefined) {
      for (const pending of handles.values()) {
        // Keep the original producer for late completion; never release through its replacement.
        void pending.then(handle => service.release(handle)).catch(() => {
          // The bridge also reclaims holders on page-instance termination.
        })
      }
    }
    handles = new Map()
    unregister?.()
    unregister = undefined
    boundRegistry = undefined
    boundForward = undefined
    controller = undefined
  }

  const reconcile = () => {
    const registry = readRegistry()
    const service = readForward()
    if (service !== undefined) seenBridge = true
    if (registry === boundRegistry && service === boundForward) return
    detach()
    // Never discovering a bridge preserves memex-only deployments. Once seen,
    // its disappearance must not re-enable the registry's default localhost.
    if (registry === undefined || !seenBridge) return
    boundRegistry = registry
    boundForward = service
    const signal = (controller = new AbortController()).signal
    const owned = handles
    const acquired = new Map<number, ForwardHandle>()
    // Distinct bindings cannot release a replacement's idempotent bridge record.
    // getRandomValues also works on plain-HTTP device pages; randomUUID does not.
    const bindingId = Array.from(crypto.getRandomValues(new Uint8Array(16)),
      byte => byte.toString(16).padStart(2, '0')).join('')
    unregister = registry.register(async ({ port }) => {
      if (signal.aborted || service === undefined || readForward() !== service) throw unavailable()
      if (acquired.get(port)?.state === 'removed') {
        owned.delete(port)
        acquired.delete(port)
      }
      let pending = owned.get(port)
      if (pending === undefined) {
        // Capture synchronous bridge failures too (unavailable may throw synchronously).
        pending = Promise.resolve().then(() => {
          if (signal.aborted) throw unavailable()
          return service.acquire(port, browseHolder(port, bindingId))
        })
        owned.set(port, pending)
        void pending.then(handle => { acquired.set(port, handle) }, () => {
          if (owned.get(port) === pending) owned.delete(port)
        })
      }
      let handle: ForwardHandle
      try {
        handle = await abortable(pending, signal)
      } catch (error) {
        if (signal.aborted || readForward() !== service) throw unavailable()
        if (isLocalDevice(error)) return `http://localhost:${port}`
        throw error
      }
      if (signal.aborted || readForward() !== service) throw unavailable()
      try {
        return await readyAddress(handle, signal)
      } finally {
        // No automatic reacquisition. A subsequent explicit click may ask anew.
        if (handle.state === 'removed' && owned.get(port) === pending) {
          owned.delete(port)
          if (acquired.get(port) === handle) acquired.delete(port)
        }
      }
    })
  }

  const stopListening = ctx.on('internal/service', name => {
    if (name === MEMEX_BROWSE_ADDRESS_SERVICE || name === COCKPIT_FORWARDS_SERVICE) reconcile()
  }, { global: true })
  reconcile()
  ctx.effect(() => () => {
    stopListening()
    detach()
  }, 'cockpit-memex-browse-shim: forwards lifecycle adapter')
}
