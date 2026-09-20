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

export const name = 'dsh-memex'
// Do not export a static `inject`: optional Host services belong in the dynamic
// ctx.inject() fiber below. A static declaration would turn them into loader
// hard dependencies and can make this plugin silently never activate.

/** Mount all settings-dependent contributions in one injected fiber. */
export function apply(ctx: Context): void {
  ctx.inject(['settings', 'tools', 'skills'], child => {
    const runtime = createMemexRuntime(child)
    // Tools keep this stable proxy while valid live settings atomically replace
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
      () => registerMemexTools(child, scopes, { onToolSuccess: lifecycle.mark }),
      'dsh-memex.tools.register()',
    )
    // The settings page's read/write surface. It receives the same live proxy
    // minus `ensure`, so no endpoint can create a library as a side effect of a
    // page load.
    registerMemexChannel(child, {
      scopes: {
        resolve: scopes.resolve,
        list: scopes.list,
        resolveByName: scopes.resolveByName,
        bindingFor: scopes.bindingFor,
        accessFor: scopes.accessFor,
      },
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
