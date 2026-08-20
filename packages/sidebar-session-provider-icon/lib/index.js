import { providerProjectionDefinition } from './provider.js';
export const name = 'sidebar-session-provider-icon';
/** The projection registry is this plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections'];
export function apply(ctx) {
    ctx.sessionProjections.register(providerProjectionDefinition);
}
export * from './types.js';
export { applyProviderEvent, viewProviderProjection, providerSchema, providerProjectionDefinition } from './provider.js';
