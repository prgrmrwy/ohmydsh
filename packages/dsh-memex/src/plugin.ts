import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { readScopeConfig, type Config } from './scope/settings.js'
import { ScopeRuntime } from './scope/runtime.js'
import type { ScopeConfig } from './scope/types.js'
import { EMPTY_ORG_PROFILE, type OrgProfile } from './org.js'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { normalizePath } from './scope/resolver.js'
import { migratePrimarySwitches } from './scope/primary-migration.js'

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
export function createMemexRuntime(
  ctx: Context,
  config: Config,
  org: OrgProfile = EMPTY_ORG_PROFILE,
  options: { readonly namespaceDir?: string; readonly homeDir?: string } = {},
): MemexRuntime {
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
  const scopes = new ScopeRuntime(current, { org, ...options })
  ctx.on('loader/volatile-update', () => {
    const next = effective()
    // Cards travel with the primary entry: an edit that switches a workspace's
    // primary first moves the old library's cards into the new one. The loader
    // has already committed the references here but the resolver still serves the
    // previous routing, so a failed merge keeps the old primary in place — the
    // next edit retries — rather than leaving that workspace's cards unreachable.
    let migrations: ReturnType<typeof migratePrimarySwitches>
    try {
      migrations = migratePrimarySwitches(current, next, {
        ...options,
        // The resolver still serves the previous routing here, so it can name the
        // library a so-far unclaimed workspace was derived into.
        servedBefore: workspace => {
          try {
            const served = scopes.current.resolve(workspace)
            return served.source === 'derived' || served.source === 'local' ? { name: served.scope, home: served.home } : undefined
          } catch { return undefined }
        },
      })
    } catch (error) {
      ctx.logger('dsh-memex').warn(
        'primary switch not applied, keeping the current routing: %s',
        error instanceof Error ? error.message : String(error),
      )
      return
    }
    for (const migration of migrations) {
      if (migration.report.copied.length === 0 && migration.report.skipped.length === 0) continue
      ctx.logger('dsh-memex').info(
        'primary switch %s: %s -> %s, copied %d card(s), kept %d target copy/copies',
        migration.workspace,
        migration.from,
        migration.to,
        migration.report.copied.length,
        migration.report.skipped.length,
      )
    }
    current = next
    scopes.replace(current)
  })
  return { scopes, config: () => current }
}
