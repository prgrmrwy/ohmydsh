/**
 * Pet change feed.
 *
 * The Web client must not poll. Pet publishes a monotonic generation that
 * increments on every durable change; the client refreshes when the
 * generation it holds differs from the Host's.
 *
 * A generation is deliberately NOT an incremental patch: after a reconnect
 * the client reloads a complete snapshot and adopts the current generation,
 * so it can never apply an increment on top of partial state.
 */

/** A change notification carrying the new generation. */
export type ChangeListener = (generation: number) => void

/** Monotonic change counter with subscription. */
export class PetChangeFeed {
  private current = 1
  private readonly listeners = new Set<ChangeListener>()

  /** The current generation. */
  get generation(): number {
    return this.current
  }

  /**
   * Subscribe to change notifications.
   * @param listener - Called with each new generation.
   * @returns a disposer removing the listener.
   */
  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Publish a change, advancing the generation.
   *
   * A throwing listener never prevents other listeners from running or the
   * generation from advancing.
   * @returns the new generation.
   */
  publish(): number {
    this.current += 1
    for (const listener of this.listeners) {
      try {
        listener(this.current)
      } catch {
        // A misbehaving listener must not stall the feed.
      }
    }
    return this.current
  }

  /**
   * Whether a client holding `seen` is behind the Host.
   * @param seen - Generation the client last applied.
   * @returns whether a refresh is required.
   */
  isStale(seen: number): boolean {
    return seen !== this.current
  }
}
