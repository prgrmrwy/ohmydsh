/**
 * dsh-memex's own extension point for turning a browse port into an address.
 *
 * The name and the contract belong to dsh-memex. Nothing here references, names
 * or assumes any particular registrant — a registrant is simply "some plugin in
 * this page that knows how to reach a Host-side port from this browser". Even a
 * conventional service name owned by a provider would be too much knowledge:
 * dsh-memex is a general memory plugin and must not carry a concept it cannot
 * define on its own.
 *
 * Why the contract is async: a registrant may have to talk to something outside
 * the page before it can answer. That is exactly why the open action cannot
 * await it inline — see the launcher, which exists because a click handler that
 * awaits would lose its user-activation and get the new tab blocked.
 *
 * @module dsh-memex/client/browse-address
 */

/** Stable service name. Changing it is a breaking change for registrants. */
export const MEMEX_BROWSE_ADDRESS_SERVICE = 'dshMemex.browseAddress' as const

/** What a registrant is asked to resolve. */
export interface MemexBrowseTarget {
  /** Library whose browse service is running; lets a registrant key its work. */
  readonly scope: string
  /** Port the Host reported the kernel had actually bound. */
  readonly port: number
}

/** Resolve a Host-side browse port into an address this browser can open. */
export type MemexBrowseAddressResolver = (target: MemexBrowseTarget) => Promise<string>

export interface MemexBrowseAddressRegistry {
  /** Install a resolver; call the returned disposer to remove it. */
  register(resolver: MemexBrowseAddressResolver): () => void
  /**
   * Resolve an address for one target.
   *
   * With no registrant this returns the local address, which is correct
   * precisely when the Host and the browser are the same machine. With a
   * registrant, its failure is propagated — it MUST NOT fall back to the local
   * address, because in the cross-machine case that address resolves on the
   * *user's* machine, which is the very failure a registrant exists to remove.
   */
  resolve(target: MemexBrowseTarget): Promise<string>
}

/** The address used when nothing is registered: the Host is this machine. */
export function localBrowseAddress(port: number): string {
  return `http://localhost:${port}`
}

export function createBrowseAddressRegistry(): MemexBrowseAddressRegistry {
  let current: MemexBrowseAddressResolver | undefined

  return {
    register(resolver: MemexBrowseAddressResolver): () => void {
      current = resolver
      return () => {
        // Only retract our own registration: a later registrant may already
        // have replaced it, and dropping theirs would silently disable them.
        if (current === resolver) current = undefined
      }
    },

    async resolve(target: MemexBrowseTarget): Promise<string> {
      // Read at call time, never cached: a registrant may appear or disappear
      // between the page loading and the user clicking.
      const resolver = current
      if (resolver === undefined) return localBrowseAddress(target.port)
      const address = await resolver(target)
      if (typeof address !== 'string' || address === '') {
        throw new Error('The card browser address could not be resolved for this machine.')
      }
      return address
    },
  }
}
