import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { readScopeConfig, type Config } from './scope/settings.js'
import { ScopeRuntime } from './scope/runtime.js'
import type { ScopeConfig } from './scope/types.js'
import { EMPTY_ORG_PROFILE, type OrgProfile } from './org.js'

export interface MemexRuntime {
  readonly scopes: ScopeRuntime
  /**
   * Latest validated scope table.
   *
   * Read per call rather than captured: live edits replace the resolver, and a
   * surface that reported the configured paths must report the new ones too.
   * Only ever holds a value the loader accepted: an invalid candidate is
   * rejected by the Config's validation and the running references keep the
   * previous (last-good) values.
   */
  config(): ScopeConfig
}

/**
 * Build the live runtime over the plugin's own Config (DSH 0.2.0).
 *
 * The scope table is volatile: the loader commits a validated edit into the
 * Config references without remounting and then emits `loader/volatile-update`
 * on this instance, which replaces the resolver (dropping its cwd cache).
 * Tool/lifecycle registration is performed by the caller in the same fiber.
 */
export function createMemexRuntime(ctx: Context, config: Config, org: OrgProfile = EMPTY_ORG_PROFILE): MemexRuntime {
  let current = readScopeConfig(config)
  const scopes = new ScopeRuntime(current, { org })
  ctx.on('loader/volatile-update', () => {
    current = readScopeConfig(config)
    scopes.replace(current)
  })
  return { scopes, config: () => current }
}
