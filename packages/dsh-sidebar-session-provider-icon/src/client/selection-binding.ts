/**
 * Observation lifecycle for the selector store.
 *
 * The per-session `ModelDirectory.store` belongs to a client Session *scope*,
 * not to the bare session id: retiring the scope and materializing it again
 * hands out a NEW directory (and store) for the SAME id, and the retired store
 * never publishes again. A binding remembered by session id therefore freezes
 * on whatever value it saw first, and a value the client can no longer verify
 * keeps outranking the durable projection — the session row then shows a model
 * the session has already left (observed live: a session switched from
 * `claude/*` to `codex/gpt-6.1-sol` while the host projection already said
 * `codex`, yet the badge still showed Anthropic).
 *
 * Two rules replace that:
 *
 * - **Re-resolve, never trust an id.** Every {@link SelectionObservation.sync}
 *   re-resolves the open session's directory and re-subscribes when the store
 *   identity changed, then re-publishes the current snapshot — so a missed
 *   publish heals on the next signal instead of persisting.
 * - **An observation lives only while its session is open.** Once the view
 *   moves on (or the directory cannot be resolved any more), the entry is
 *   dropped and the durable projection answers instead of an unverifiable
 *   value.
 *
 * All dependencies are injected (no cordis, no DOM), so the semantics stay
 * unit-testable offline.
 *
 * @module dsh-sidebar-session-provider-icon/client/selection-binding
 */
import type { ProviderProjection } from '../types.ts'

/** Minimal selector-store shape used by the observation lifecycle. */
export interface SelectionStore {
  getSnapshot(): { current: ProviderProjection | null }
  subscribe(listener: () => void): () => void
}

/** One session's selector directory (store + lazy load). */
export interface SelectionDirectory {
  store: SelectionStore
  load(): Promise<unknown>
}

/** Everything the lifecycle needs from the client wiring layer. */
export interface ObservationDeps {
  /** The session shown in the main view right now (`mainSessionId`), if any. */
  openSessionId(): string | undefined
  /**
   * Resolve a session's current selector directory. Throws when the session has
   * no retained client scope, i.e. when nothing can be observed for it.
   */
  resolve(sessionId: string): SelectionDirectory
  /** sessionId → live observation; the map `providerBySession` consumes. */
  observed: Map<string, ProviderProjection>
  /** Schedule one badge reconcile. */
  reconcile(): void
}

/** One live binding: the open session plus the store generation it observes. */
interface OpenBinding {
  sessionId: string
  store: SelectionStore
  stop: () => void
}

/**
 * Owns which session is being observed and whether that observation is still
 * trustworthy. Call {@link sync} on every session-list and DOM signal.
 */
export class SelectionObservation {
  private open: OpenBinding | undefined

  /**
   * @param deps - injected wiring layer.
   */
  public constructor(private readonly deps: ObservationDeps) {}

  /**
   * Re-target the open session's binding and refresh its observation, dropping
   * an observation that can no longer be verified.
   */
  public sync(): void {
    const id = this.deps.openSessionId()
    if (id === undefined) {
      this.release()
      this.deps.reconcile()
      return
    }
    let directory: SelectionDirectory
    try {
      directory = this.deps.resolve(id)
    } catch {
      // No retained scope: the previous value can no longer be verified, so the
      // durable projection must answer for this row.
      this.release()
      this.deps.reconcile()
      return
    }
    if (this.open !== undefined && this.open.sessionId === id && this.open.store === directory.store) {
      this.publish()
      return
    }
    this.release()
    const store = directory.store
    const stop = store.subscribe(() => this.publishValue(id, store))
    this.open = { sessionId: id, store, stop }
    this.publish()
    if (store.getSnapshot().current === null) directory.load().catch(() => undefined)
  }

  /** Drop the binding and its observation (plugin teardown). */
  public stop(): void {
    this.release()
  }

  private publish(): void {
    const open = this.open
    if (open === undefined) return
    this.publishValue(open.sessionId, open.store)
  }

  private publishValue(sessionId: string, store: SelectionStore): void {
    const current = store.getSnapshot().current
    if (current === null) this.deps.observed.delete(sessionId)
    else this.deps.observed.set(sessionId, { provider: current.provider, model: current.model })
    this.deps.reconcile()
  }

  private release(): void {
    const open = this.open
    if (open === undefined) return
    this.open = undefined
    open.stop()
    this.deps.observed.delete(open.sessionId)
  }
}
