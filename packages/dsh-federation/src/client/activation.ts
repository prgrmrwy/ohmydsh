import type { ClientFederationState } from '../contract/index.js'

/** Minimal rc.2 slot seam this package depends on. */
export interface SlotHandle {
  register(descriptor: { readonly name: string; readonly priority: number; readonly registrant: string }, component: unknown): () => void
  onEntryError?(listener: (key: string, component: unknown, error: unknown, info: { readonly abdicated: boolean }) => void): () => void
}

export interface ClientContribution {
  readonly slot: string
  /** Federation shadows official entries with a lower (earlier) priority number. */
  readonly priority: number
  readonly component: unknown
}

export interface ClientActivationOptions {
  readonly clientId: string
  readonly slots: SlotHandle
  readonly contributions: readonly ClientContribution[]
  /** True only while the process-wide Host federation is READY. */
  isHostReady(): boolean
  /** Bridge, Node Shell, Workspace Embed and Picker readiness for this browser. */
  prepare(): Promise<void>
  readonly timeoutMs?: number
}

export interface ClientActivationResult {
  readonly state: ClientFederationState
  readonly diagnostic?: string
}

/**
 * Per-browser UI activation. A client only shadows the official slots after its
 * own readiness completes; a timeout, a preparation failure or a later entry
 * crash disposes exactly this client's contributions and leaves the official
 * entries as the winner. It never touches Host routes or another browser.
 */
export class ClientActivationController {
  #state: ClientFederationState = 'CLIENT_OFFICIAL'
  #diagnostic: string | undefined
  #disposers: (() => void)[] = []
  #stopEntryErrors: (() => void) | undefined
  #generation = 0
  readonly #options: ClientActivationOptions

  constructor(options: ClientActivationOptions) {
    this.#options = options
  }

  get state(): ClientFederationState { return this.#state }
  get diagnostic(): string | undefined { return this.#diagnostic }
  get generation(): number { return this.#generation }

  async activate(): Promise<ClientActivationResult> {
    if (this.#state === 'CLIENT_FEDERATED') return this.#result()
    this.#state = 'CLIENT_PREPARING'
    const generation = ++this.#generation
    try {
      if (!this.#options.isHostReady()) throw new Error('host federation is not ready')
      await this.#withTimeout(this.#options.prepare())
      if (generation !== this.#generation) return this.#result()
      this.#registerContributions(generation)
      this.#state = 'CLIENT_FEDERATED'
      this.#diagnostic = undefined
    } catch (cause) {
      this.#fallback(cause instanceof Error ? cause.message : 'client activation failed')
    }
    return this.#result()
  }

  /** A refresh replaces only this client's generation; the Host is never reapplied. */
  async refresh(): Promise<ClientActivationResult> {
    this.#disposeContributions()
    this.#state = 'CLIENT_OFFICIAL'
    return this.activate()
  }

  dispose(): void {
    this.#disposeContributions()
    this.#stopEntryErrors?.()
    this.#stopEntryErrors = undefined
    this.#state = 'CLIENT_OFFICIAL'
  }

  #registerContributions(generation: number): void {
    const registrant = `federation:${this.#options.clientId}:${generation}`
    const owned = new Set<unknown>()
    const pending: (() => void)[] = []
    try {
      for (const contribution of this.#options.contributions) {
        pending.push(this.#options.slots.register({ name: contribution.slot, priority: contribution.priority, registrant }, contribution.component))
        owned.add(contribution.component)
      }
    } catch (cause) {
      for (const dispose of pending.reverse()) dispose()
      throw cause
    }
    this.#disposers = pending
    this.#stopEntryErrors?.()
    this.#stopEntryErrors = this.#options.slots.onEntryError?.((_key, component, error, info) => {
      if (!info.abdicated || this.#state !== 'CLIENT_FEDERATED' || !owned.has(component)) return
      this.#fallback(error instanceof Error ? `entry crashed: ${error.message}` : 'entry crashed')
    })
  }

  #fallback(diagnostic: string): void {
    this.#disposeContributions()
    this.#diagnostic = diagnostic
    this.#state = 'CLIENT_FALLBACK'
  }

  #disposeContributions(): void {
    for (const dispose of this.#disposers.reverse()) dispose()
    this.#disposers = []
  }

  async #withTimeout(work: Promise<void>): Promise<void> {
    const timeoutMs = this.#options.timeoutMs
    if (timeoutMs === undefined) return work
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('client readiness timed out')), timeoutMs) }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  #result(): ClientActivationResult {
    return this.#diagnostic === undefined ? { state: this.#state } : { state: this.#state, diagnostic: this.#diagnostic }
  }
}
