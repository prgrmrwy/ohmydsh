/**
 * Per-session binding lifetimes for the composer guard.
 *
 * The guard is only as live as the store it listens to. Client Session scopes
 * come and go: the runtime materializes a scope when something retains the
 * session (the main view retains the one it shows) and retires it when the last
 * reference is released, and `ctx.modelDirectories.directoryFor(id)` caches each
 * session's `ModelDirectory` — the store the composer model seat renders from —
 * on that scope's binding object, disposed with it. Coming back to a session
 * therefore hands out a NEW directory/store for the SAME session id, while the
 * official seat re-resolves it on every composer mount
 * (`ui-model-selection` injects `directoryFor(sessionId)` per render).
 *
 * A guard that resolves the directory once per session id and then keeps
 * listening to the retired store silently stops reacting: switching the model
 * no longer re-evaluates, so a block written while the session was
 * Claude-family stays until a page reload, and a later Claude selection is
 * never blocked. That is the defect this registry exists for. It re-resolves on
 * every reconcile, re-subscribes when the store identity changed, and re-decides
 * against the current store either way — so a missed signal heals on the next
 * session-list change instead of persisting until reload.
 *
 * Every dependency is injected (no cordis, no DOM), so these lifetime semantics
 * stay unit-testable offline.
 *
 * @module dsh-home-network-model-guard/client/bindings
 */

/** The bare observable face this guard needs from a model-directory store. */
export interface GuardStore {
  /** Subscribe store changes; returns the disposer. */
  subscribe(listener: () => void): () => void
}

/** What one reconcile did, for diagnostics and tests. */
export type BindingOutcome =
  /** First subscription for this session. */
  | 'bound'
  /** The runtime replaced the session's store; the binding was re-targeted. */
  | 'rebound'
  /** Same store as before; the guard was re-evaluated against it. */
  | 'unchanged'
  /** No retained client scope for this session (yet). */
  | 'unavailable'

/** Everything the registry needs from the cordis wiring layer. */
export interface SessionBindingDeps {
  /**
   * The session's CURRENT model-directory store. Throws when the session has no
   * retained client scope right now.
   */
  storeFor(sessionId: string): GuardStore
  /** Subscribe one store; returns the disposer. */
  subscribeStore(store: GuardStore, onChange: () => void): () => void
  /** Subscribe the session's composer-block slot; returns the disposer. */
  subscribeBlocks(sessionId: string): () => void
  /** Recompute and apply the guard for one session. */
  evaluate(sessionId: string): void
  /**
   * Session teardown: drop the guard's per-session state (clearing the block it
   * wrote, and only that one).
   */
  dispose(sessionId: string): void
}

interface SessionRecord {
  /** The store this binding currently listens to. */
  store: GuardStore
  stopStore: () => void
  /** Absent while the block-slot subscription could not be established yet. */
  stopBlocks: (() => void) | undefined
}

/**
 * Owns one live subscription per session id, re-targeted whenever the runtime
 * replaces that session's model directory.
 */
export class SessionBindings {
  private readonly records = new Map<string, SessionRecord>()

  /**
   * @param deps - injected wiring layer.
   */
  public constructor(private readonly deps: SessionBindingDeps) {}

  /**
   * Reconcile every live session id: bind the new ones, re-target the ones whose
   * store was replaced, re-evaluate all of them, and release the rest.
   * @param liveIds - session ids currently present in the client session list.
   */
  public sync(liveIds: Iterable<string>): void {
    const live = new Set<string>()
    for (const id of liveIds) {
      live.add(id)
      this.reconsider(id)
    }
    for (const id of [...this.records.keys()]) {
      if (!live.has(id)) this.release(id)
    }
  }

  /**
   * Bind (or re-bind) one session against its current store and re-evaluate the
   * guard. Cheap and idempotent: an unchanged store costs one resolution and one
   * decision, never a second subscription.
   * @param sessionId - the session to reconcile.
   * @returns what this reconcile did.
   */
  public reconsider(sessionId: string): BindingOutcome {
    const record = this.records.get(sessionId)
    let store: GuardStore
    try {
      store = this.deps.storeFor(sessionId)
    } catch {
      // No retained client scope right now. Keep an existing record: the guard
      // may still own a block for this session, and dropping the claim here
      // would strand it. Nothing to evaluate either — the guard reads through
      // the same resolver and already no-ops without a scope.
      return 'unavailable'
    }
    if (record !== undefined && record.store === store) {
      this.deps.evaluate(sessionId)
      return 'unchanged'
    }
    let stopStore: () => void
    try {
      // Establish the new subscription before retiring the old one, so a
      // throwing subscribe leaves the previous generation's binding intact.
      stopStore = this.deps.subscribeStore(store, () => this.deps.evaluate(sessionId))
    } catch {
      return 'unavailable'
    }
    record?.stopStore()
    const stopBlocks = record?.stopBlocks ?? this.subscribeBlocks(sessionId)
    this.records.set(sessionId, { store, stopStore, stopBlocks })
    this.deps.evaluate(sessionId)
    return record === undefined ? 'bound' : 'rebound'
  }

  /**
   * Re-evaluate every bound session against its current facts, without touching
   * subscriptions. Used when the session list cannot be read but the guard still
   * has live bindings that must not go stale.
   */
  public reverify(): void {
    for (const id of this.records.keys()) this.deps.evaluate(id)
  }

  /**
   * Release one session: stop both subscriptions and drop the guard state.
   * @param sessionId - the session leaving the client session list.
   */
  public release(sessionId: string): void {
    const record = this.records.get(sessionId)
    if (record === undefined) return
    this.records.delete(sessionId)
    record.stopStore()
    record.stopBlocks?.()
    this.deps.dispose(sessionId)
  }

  /** Bound session ids, in bind order. */
  public ids(): string[] {
    return [...this.records.keys()]
  }

  /** Release every binding (plugin teardown). */
  public stop(): void {
    for (const id of this.ids()) this.release(id)
  }

  private subscribeBlocks(sessionId: string): (() => void) | undefined {
    try {
      return this.deps.subscribeBlocks(sessionId)
    } catch {
      // The slot is not materialized yet; retried on the next reconcile.
      return undefined
    }
  }
}
