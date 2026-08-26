import type { FederatedSessionId, NodeId } from '../../core/index.js'

export interface ProviderSelection {
  readonly provider: string
  readonly model: string
}

export interface ProviderIconSources {
  /** Live selector value for a session, when its model directory is bound. */
  selected(sessionId: FederatedSessionId): ProviderSelection | undefined
  /** Host projection fallback for sessions never opened in this browser. */
  projected(sessionId: FederatedSessionId): ProviderSelection | undefined
}

export interface ProviderBadge {
  readonly sessionId: FederatedSessionId
  readonly nodeId: NodeId
  readonly provider: string
  readonly model: string
  readonly source: 'selector' | 'projection'
}

/**
 * Resolves one federated session's provider badge with the plugin's own
 * precedence: the live selector value wins, the host projection is the fallback
 * for sessions this browser never opened, and an unknown pair yields no badge.
 */
export function resolveProviderBadge(
  sessionId: FederatedSessionId,
  nodeId: NodeId,
  sources: ProviderIconSources,
): ProviderBadge | undefined {
  const selected = sources.selected(sessionId)
  if (selected !== undefined) return Object.freeze({ sessionId, nodeId, ...selected, source: 'selector' })
  const projected = sources.projected(sessionId)
  if (projected !== undefined) return Object.freeze({ sessionId, nodeId, ...projected, source: 'projection' })
  return undefined
}

/**
 * Coordinates the provider-icon plugin's two rendering paths.
 *
 * While federation owns the sidebar, the federated Session row renders the badge
 * directly and the plugin's DOM MutationObserver must stay off, otherwise both
 * would insert a logo. Falling back to the official sidebar re-enables the
 * observer, so the native single-machine behaviour is preserved.
 */
export class ProviderIconCoordinator {
  #federated = false
  #observerRunning = false
  #starts = 0
  #stops = 0

  constructor(private readonly control: { start(): void; stop(): void }) {}

  get domObserverRunning(): boolean { return this.#observerRunning }
  get startCount(): number { return this.#starts }
  get stopCount(): number { return this.#stops }
  /** True while the federated Session row owns badge rendering. */
  get rowRendererActive(): boolean { return this.#federated }

  /** Called whenever this browser's federation activation state settles. */
  setFederated(federated: boolean): void {
    this.#federated = federated
    if (federated) this.#stopObserver()
    else this.#startObserver()
  }

  dispose(): void {
    this.#stopObserver()
  }

  #startObserver(): void {
    if (this.#observerRunning) return
    this.#observerRunning = true
    this.#starts++
    this.control.start()
  }

  #stopObserver(): void {
    if (!this.#observerRunning) return
    this.#observerRunning = false
    this.#stops++
    this.control.stop()
  }
}
