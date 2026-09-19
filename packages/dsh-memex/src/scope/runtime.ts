import type { ScopeConfig, ScopeService } from './types.js'
import { createScopeResolver } from './resolver.js'

/** Mutable indirection replaced atomically whenever live settings commit. */
export class ScopeRuntime {
  #resolver: ScopeService
  readonly #service: ScopeService

  constructor(config: ScopeConfig) {
    this.#resolver = createScopeResolver({ config })
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
    this.#resolver = createScopeResolver({ config })
  }

  get current(): ScopeService {
    return this.#service
  }
}
