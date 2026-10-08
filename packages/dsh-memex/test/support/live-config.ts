/**
 * Mount a plugin behind a real Cordis Loader and edit its raw config through
 * `entry.update`, the same path DSH 0.2.0 profile reconciliation takes.
 * Adapted from upstream deepseek-harness packages/settings/settings/tests/live-config.ts
 * (tag dsh-v0.2.0-rc.2).
 */
import { resolveConfig, type Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'

export async function liveConfig(ctx: Context, plugin: Plugin, initial: object = {}) {
  if (ctx.get('loader') === undefined) await ctx.plugin(Loader)
  const name = `live-${Object.keys(ctx.loader.builtins).length}`
  ctx.loader.builtins[name] = plugin
  const id = await ctx.loader.create({ id: plugin.name ?? name, name: `cordis:${name}`, config: initial })
  const entry = ctx.loader.resolve(id)
  await entry.fiber!.await()
  return {
    entry,
    /** Replace the raw config; a candidate the plugin rejects throws before the update, like a settings write. */
    async replace(next: Record<string, unknown>): Promise<void> {
      const fiber = entry.fiber!
      resolveConfig(fiber.runtime!, fiber.ctx.waterfall(fiber, 'internal/config', next, () => next))
      await entry.update({ config: next })
      await entry.fiber!.await()
    },
    /** Write the raw config without pre-validation, as a hand-edited patch would. */
    async force(next: Record<string, unknown>): Promise<void> {
      await entry.update({ config: next })
      await entry.fiber!.await()
    },
  }
}
