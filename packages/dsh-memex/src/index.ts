/**
 * dsh-memex — the DSH-native equivalent of memex's Pi extension, plus scope.
 *
 * @module dsh-memex
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ScopeResolution } from './scope/types.js'
import { createMemexRuntime } from './plugin.js'
import { registerMemexTools } from './tools/index.js'
import { registerMemexLifecycle } from './lifecycle/index.js'
import { registerMemexSkills } from './lifecycle/skills.js'
import { registerMemexChannel } from './host/channel.js'
import { createBrowseRegistry } from './run/browse-registry.js'
import { parseOrgProfile, type OrgProfileInput } from './org.js'
import { Config, guardConfigCandidates, parseConfig, readScopeConfig, validateMemexSettings } from './scope/settings.js'

export const name = 'dsh-memex'
// Do not export a static `inject`: optional Host services belong in the dynamic
// ctx.inject() fiber below. A static declaration would turn them into loader
// hard dependencies and can make this plugin silently never activate.

export { Config }

/**
 * Mount the plugin. Since DSH 0.2.0 the scope table is this plugin's own
 * Config (volatile fields, edited by the settings form into the profile patch)
 * and the organization keys are ordinary fields of the same row.
 */
export function apply(ctx: Context, config: Config = parseConfig({})): void {
  // Cross-field rules (duplicate scopes, shared libraries, bindings) are not
  // expressible in the schema: check the mounted value, and every later candidate.
  validateMemexSettings(readScopeConfig(config))
  guardConfigCandidates(ctx)
  // Ordinary row config: which hosts are internal is a deployment fact supplied
  // by a private overlay, never by the public repo.
  const org = parseOrgProfile(config as OrgProfileInput)
  for (const problem of org.problems) ctx.logger('dsh-memex').warn('Ignored organization config: %s', problem)
  // On the plugin's own fiber: `loader/volatile-update` is delivered only to
  // listeners of the instance whose Config changed, not to child fibers.
  const runtime = createMemexRuntime(ctx, config, org)
  ctx.inject(['tools', 'skills'], child => {
    // Tools keep this stable proxy while valid live Config edits atomically replace
    // the underlying resolver (and discard its cwd cache).
    const scopes = {
      resolve: (cwd: string) => runtime.scopes.current.resolve(cwd),
      list: () => runtime.scopes.current.list(),
      resolveByName: (scope: string) => runtime.scopes.current.resolveByName(scope),
      ensure: (scope: ScopeResolution) => runtime.scopes.current.ensure(scope),
      bindingFor: (scope: string) => runtime.scopes.current.bindingFor(scope),
      accessFor: (scope: string) => runtime.scopes.current.accessFor(scope),
    }
    const lifecycle = registerMemexLifecycle(child, scopes)
    registerMemexSkills(child)
    child.effect(
      () => registerMemexTools(child, scopes, { onToolSuccess: lifecycle.mark, org }),
      'dsh-memex.tools.register()',
    )
    // The settings page's read/write surface. It receives the same live proxy
    // minus `ensure`, so no endpoint can create a library as a side effect of a
    // page load.
    // Browse services start on demand and are all stopped with this fiber, so
    // no kernel process can outlive the plugin that spawned it.
    const browse = createBrowseRegistry()
    child.effect(() => () => { void browse.stopAll() }, 'dsh-memex: stop browse services')
    registerMemexChannel(child, {
      scopes: {
        resolve: scopes.resolve,
        list: scopes.list,
        resolveByName: scopes.resolveByName,
        bindingFor: scopes.bindingFor,
        accessFor: scopes.accessFor,
      },
      browse,
      config: runtime.config,
      // The workspace registry is an optional peer: its absence is reported, not
      // thrown, so the page degrades to the configuration-only shape.
      onWarn: (message: string) => { child.logger('dsh-memex').warn(message) },
    })
  })
}

export { registerMemexTools } from './tools/index.js'
export { registerMemexChannel } from './host/channel.js'
export { MEMEX_CHANNEL } from './contract.js'
