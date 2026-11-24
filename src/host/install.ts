/**
 * Host installation, separated from the plugin entry so internal knobs are
 * injectable by tests without becoming part of the plugin's public Config
 * (the row config a user writes in dsh.yaml is never read).
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: bring the `connection` / `webServer` Context merges.
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import swSource from 'virtual:dshls/sw'
import { ROUTE_PREFIX, WS_ROUTE } from '../contract.js'
import { insertGuard } from './guard.js'
import { DEFAULT_CONNECT_TIMEOUT_MS, createHttpHandler } from './proxy.js'
import type { Listener } from './services.js'
import { createUpgradeHandler } from './ws.js'

export interface HostInternalOptions {
  /** Upstream connect timeout in ms (default 10000). Test seam only. */
  connectTimeoutMs?: number
  /** Service discovery seams (tests): listener enumeration, per-probe timeout, total budget. */
  listListeners?: (signal: AbortSignal) => Promise<Listener[]>
  probeTimeoutMs?: number
  servicesDeadlineMs?: number
}

export function installHost(ctx: Context, options: HostInternalOptions = {}): void {
  ctx.inject(['connection', 'webServer'], (child) => {
    const connection = child.get('connection')
    const webServer = child.get('webServer')
    if (connection === undefined || webServer === undefined) return

    const inflight = new Set<{ destroy(): unknown }>()
    const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    const webServerPort = (): number | undefined => child.get('webServer')?.port
    const handler = createHttpHandler({
      fence: connection,
      webServerPort,
      swSource,
      connectTimeoutMs,
      inflight,
      services: {
        ...(options.listListeners === undefined ? {} : { listListeners: options.listListeners }),
        ...(options.probeTimeoutMs === undefined ? {} : { probeTimeoutMs: options.probeTimeoutMs }),
        ...(options.servicesDeadlineMs === undefined ? {} : { deadlineMs: options.servicesDeadlineMs }),
      },
    })
    const upgrade = createUpgradeHandler({ fence: connection, webServerPort, connectTimeoutMs, inflight })

    child.effect(() => webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }), 'sidebar-local-service-browser: prefix route')
    child.effect(() => webServer.registerUpgrade({ path: WS_ROUTE, handler: upgrade }), 'sidebar-local-service-browser: upgrade route')
    child.effect(() => webServer.tapIndex(insertGuard), 'sidebar-local-service-browser: index guard')
    child.effect(() => () => {
      for (const item of inflight) item.destroy()
      inflight.clear()
    }, 'sidebar-local-service-browser: in-flight cleanup')
  })
}
