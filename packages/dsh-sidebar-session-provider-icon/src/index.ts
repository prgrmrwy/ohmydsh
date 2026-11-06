/**
 * Host entry for dsh-sidebar-session-provider-icon: registers the `provider`
 * session-projection unit so every session's last-request provider/model
 * flows through the official session-projection channel (persisted cache +
 * list-frame projectionValues) to the Web client.
 *
 * The registration is an effect on this plugin's fiber; unloading removes the
 * key. Headless assemblies without the projection registry stay unaffected
 * (the seam's documented default).
 *
 * @module dsh-sidebar-session-provider-icon
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import { providerProjectionDefinition } from './provider.js'

export const name = 'sidebar-session-provider-icon'
/** The projection registry is this plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/**
 * DSH 0.2.2: `register()` installs the definition synchronously but resolves its
 * `ProjectionHandle` asynchronously, and rejects on a key/`stateVersion` conflict.
 * Awaiting it makes this fiber's start wait for (and fail with) the registration
 * instead of leaving a fire-and-forget promise whose rejection is only logged.
 * The registration belongs to this fiber: unloading releases it, so the handle
 * is awaited but not returned (an async plugin must resolve to `void`).
 * Older 0.2.x runtimes return a plain disposer; awaiting a non-thenable is a no-op.
 */
export async function apply(ctx: Context): Promise<void> {
  await ctx.sessionProjections.register(providerProjectionDefinition)
}

export * from './types.js'
export { applyProviderEvent, viewProviderProjection, providerSchema, providerProjectionDefinition } from './provider.js'
