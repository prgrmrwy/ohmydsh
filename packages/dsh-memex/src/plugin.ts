import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { readScopeConfig, type Config } from './scope/settings.js'
import { ScopeRuntime } from './scope/runtime.js'
import type { ScopeConfig } from './scope/types.js'
import { EMPTY_ORG_PROFILE, type OrgProfile } from './org.js'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { normalizePath } from './scope/resolver.js'

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
  const effective = (): ScopeConfig => {
    const value = readScopeConfig(config)
    if (!config.evalSelftest) return value
    const root = join(homedir(), '.dsh-memex-eval-runs')
    const workspaces = [...(value.workspaces ?? [])]
    for (const declaration of [{ path: root, fallback: false as const }, { path: join(root, 'nomem'), memory: false as const, fallback: false as const }, { path: join(root, 'judge'), memory: false as const, fallback: false as const }]) {
      const index = workspaces.findIndex(entry => normalizePath(entry.path) === declaration.path)
      if (index < 0) workspaces.push(declaration)
      else workspaces[index] = { ...workspaces[index]!, ...declaration }
    }
    return { ...value, workspaces }
  }
  let current = effective()
  const scopes = new ScopeRuntime(current, { org })
  ctx.on('loader/volatile-update', () => {
    current = effective()
    scopes.replace(current)
  })
  return { scopes, config: () => current }
}
