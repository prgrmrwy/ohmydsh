import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MemexResolveResult } from '../../src/contract.js'
import { createScopeResolver } from '../../src/scope/resolver.js'
import type { ScopeConfig, ScopeResolution } from '../../src/scope/types.js'
import { rowsFromSettings } from '../../src/client/settings-model.js'
import type { Env, Session } from '../../src/client/workspace-actions.js'

export const HOME = '/home/u'

/** The Host's answer for one directory, shaped like the `resolve` endpoint. */
export function hostRoute(resolution: ScopeResolution, path: string): MemexResolveResult {
  return {
    path,
    scope: resolution.scope,
    home: resolution.home,
    publish: resolution.publish,
    publishKnown: resolution.publishKnown,
    memory: resolution.memory,
    fallback: resolution.fallback,
    personal: resolution.personal,
    claim: resolution.claim,
    offBy: resolution.offBy,
    source: resolution.source,
    exists: false,
    local: resolution.source === 'local',
  }
}

/**
 * A saved configuration and a registry, answered by the real resolver: the page
 * session starts from it, and `env` carries the Host's current facts.
 */
export function scenario(
  config: Partial<ScopeConfig>,
  registry: readonly string[],
  options: { readonly known?: boolean; readonly remote?: (cwd: string) => string | undefined } = {},
): { session: Session; env: Env } {
  const resolver = createScopeResolver({
    homeDir: HOME,
    namespaceDir: mkdtempSync(join(tmpdir(), 'dsh-memex-env-')),
    gitRemote: options.remote ?? (() => undefined),
    gitRoot: () => undefined,
    config,
  })
  const draft = { rows: rowsFromSettings({ scopes: config.scopes ?? [] }), workspaces: [...(config.workspaces ?? [])] }
  const known = options.known ?? true
  return {
    session: { draft, intents: [] },
    env: {
      known,
      registry: known ? registry.map(path => ({ path, route: hostRoute(resolver.resolve(path), path) })) : [],
      bindings: config.bindings ?? [],
      homeDir: HOME,
      saved: draft,
    },
  }
}
