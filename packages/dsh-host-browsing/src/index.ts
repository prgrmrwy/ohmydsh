/**
 * Host entry for dsh-host-browsing.
 *
 * Mounts, on DSH's own web server and only when the official `connection`
 * service exists: the `/dsh-local-service` prefix route (HTTP proxy to the
 * Host machine's loopback + plugin Service Worker script), the exact
 * `/dsh-local-service/ws` upgrade route, and the index guard tap.
 * Everything is removed again when the plugin is disposed. The plugin has no
 * user-facing configuration.
 *
 * `ctx.inject()` callbacks run asynchronously, so nothing here asserts on state
 * set inside them right after registering
 * (docs/architecture/dsh-plugin-integration-pitfalls.md, "ctx.inject() 的回调是异步的").
 *
 * @module dsh-host-browsing
 */
import type { Context } from '@deepseek-ai/cordis'
import { installHost } from './host/install.js'

export const name = 'sidebar-local-service-browser'

/** Headless-safe: `connection` / `webServer` are resolved lazily via ctx.inject. */
export const inject: string[] = []

export function apply(ctx: Context): void {
  installHost(ctx)
}
