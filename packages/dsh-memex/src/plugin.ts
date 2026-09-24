import type { Context } from '@deepseek-ai/cordis'
import { registerMemexSettings } from './scope/settings.js'
import { ScopeRuntime } from './scope/runtime.js'
import type { ScopeConfig } from './scope/types.js'

export interface MemexRuntime {
  readonly scopes: ScopeRuntime
  /**
   * Latest validated settings section.
   *
   * Read per call rather than captured: live edits replace the resolver, and a
   * surface that reported the configured paths must report the new ones too.
   * Only ever holds a value the settings provider accepted (invalid live edits
   * are rejected by the provider, which keeps the previous section).
   */
  config(): ScopeConfig
}

/**
 * Register settings and return the live runtime. Tool/lifecycle registration is
 * deliberately performed by the caller inside the same injected fiber so that
 * all contributions unwind together when the settings service reloads.
 */
export function createMemexRuntime(ctx: Context): MemexRuntime {
  const settings = registerMemexSettings(ctx)
  let current = settings.get()
  const scopes = new ScopeRuntime(current)
  const dispose = settings.watch(next => {
    current = next
    scopes.replace(next)
  })
  ctx.effect(() => dispose, 'dsh-memex.settings.watch()')
  return { scopes, config: () => current }
}
