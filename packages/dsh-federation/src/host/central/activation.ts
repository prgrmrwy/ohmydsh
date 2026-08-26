import type { HostFederationState } from '../../contract/index.js'

export interface RouteRegistration {
  readonly path: string
  register(): Promise<() => Promise<void>> | (() => Promise<void>)
}

export class ActivationConflictError extends Error {
  readonly code = 'ACTIVATION_CONFLICT'
  constructor(readonly path: string, cause?: unknown) {
    super(`federation route ${path} is already owned`)
    this.name = 'ActivationConflictError'
    this.cause = cause
  }
}

export interface ActivationPrerequisites {
  /** Stable Core, registry, local adapter and route inventory readiness. */
  prepare(): Promise<void>
}

/**
 * Process-wide Host activation. Routes are registered one at a time inside a
 * single scope; any conflict releases exactly the registrations this attempt
 * made, in reverse order, and no partial takeover is ever published.
 */
export class HostActivationCoordinator {
  #state: HostFederationState = 'HOST_DISABLED'
  #dispose: (() => Promise<void>) | undefined
  #diagnostic: string | undefined
  #applyCount = 0

  get state(): HostFederationState { return this.#state }
  get diagnostic(): string | undefined { return this.#diagnostic }
  get applyCount(): number { return this.#applyCount }

  async activate(prerequisites: ActivationPrerequisites, routes: readonly RouteRegistration[]): Promise<HostFederationState> {
    if (this.#state === 'HOST_READY') return this.#state
    this.#state = 'HOST_PREPARING'
    this.#applyCount++
    const disposers: (() => Promise<void>)[] = []
    try {
      await prerequisites.prepare()
      for (const route of routes) disposers.push(await route.register())
      this.#dispose = async () => {
        for (const dispose of disposers.reverse()) await dispose()
        this.#dispose = undefined
        this.#state = 'HOST_DISABLED'
      }
      this.#state = 'HOST_READY'
      this.#diagnostic = undefined
      return this.#state
    } catch (cause) {
      for (const dispose of disposers.reverse()) await dispose().catch(() => {})
      this.#diagnostic = cause instanceof Error ? cause.message : 'activation failed'
      this.#state = cause instanceof ActivationConflictError ? 'HOST_CONFLICT' : 'HOST_FAILED'
      return this.#state
    }
  }

  async deactivate(): Promise<void> {
    await this.#dispose?.()
  }
}
