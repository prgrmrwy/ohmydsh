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
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "sidebar-session-provider-icon";
/** The projection registry is this plugin's whole purpose; without it the fiber stays pending. */
export declare const inject: string[];
export declare function apply(ctx: Context): void;
export * from './types.js';
export { applyProviderEvent, viewProviderProjection, providerSchema, providerProjectionDefinition } from './provider.js';
