import type { ScopeConfig, ScopeResolverOptions, ScopeService } from './types.js'
import { createScopeResolver } from './resolver.js'

/** Mutable indirection replaced atomically whenever live settings commit. */
export class ScopeRuntime {
  #resolver: ScopeService
  readonly #service: ScopeService
  readonly #options: Omit<ScopeResolverOptions, 'config'>

  /**
   * @param config - the initial last-good settings section.
   * @param options - resolver environment (home, git probes); tests isolate it,
   *   production leaves it to the real home directory and git.
   */
  constructor(config: ScopeConfig, options: Omit<ScopeResolverOptions, 'config'> = {}) {
    this.#options = options
    this.#resolver = createScopeResolver({ ...options, config })
    // Contributions such as registered tools retain this stable facade. Each
    // operation delegates to the latest last-good resolver after live updates.
    this.#service = {
      resolve: cwd => this.#resolver.resolve(cwd),
      list: () => this.#resolver.list(),
      resolveByName: scope => this.#resolver.resolveByName(scope),
      ensure: scope => this.#resolver.ensure(scope),
      bindingFor: scope => this.#resolver.bindingFor(scope),
      accessFor: scope => this.#resolver.accessFor(scope),
    }
  }

  replace(config: ScopeConfig): void {
    // A fresh resolver intentionally discards every cached cwd/config decision.
    this.#resolver = createScopeResolver({ ...this.#options, config })
  }

  get current(): ScopeService {
    return this.#service
  }
}
