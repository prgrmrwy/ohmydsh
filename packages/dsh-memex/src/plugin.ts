import type { Context } from '@deepseek-ai/cordis'
import { registerMemexSettings } from './scope/settings.js'
import { ScopeRuntime } from './scope/runtime.js'

export interface MemexRuntime {
  readonly scopes: ScopeRuntime
}

/**
 * Register settings and return the live runtime. Tool/lifecycle registration is
 * deliberately performed by the caller inside the same injected fiber so that
 * all contributions unwind together when the settings service reloads.
 */
export function createMemexRuntime(ctx: Context): MemexRuntime {
  const settings = registerMemexSettings(ctx)
  const scopes = new ScopeRuntime(settings.get())
  const dispose = settings.watch(next => { scopes.replace(next) })
  ctx.effect(() => dispose, 'dsh-memex.settings.watch()')
  return { scopes }
}
