import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-attachment'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { MagpieRuntime } from './host/runtime.js'
import { MagpieAdapter } from './host/adapter.js'
import { SettingsStore } from './host/settings.js'
import { registerRoutes } from './host/routes.js'
import { SpeedController } from './host/speed.js'
import { createDisposer } from './host/dispose.js'
import { createRouteRegistrar, type RouteRegistrar } from './host/registrar.js'
export { MagpieRuntime, lineCredentialRefs, lineIdOfCredentialRef } from './host/runtime.js'
export { MagpieAdapter, mapUsage } from './host/adapter.js'
export { SettingsStore } from './host/settings.js'
export { GatewayTransport } from './host/transport.js'
export { createRouteRegistrar, type RouteRegistrar, type PublishResult } from './host/registrar.js'
export { TRANSPORT_ID, ownerKey, ownerLabel, routeOf, isMagpieRoute } from './host/catalog.js'
export const name = 'dsh-magpie-connector'
export const inject = ['llm', 'credentials']
export interface Config { home?: string }
export function apply(ctx: Context, config: Config = {}) {
  const home = config.home ?? process.env.DSH_HOME ?? resolve(homedir(), '.dsh')
  // Declared first, assigned below: the runtime's publish callback and the adapter reference each other.
  let adapter!: MagpieAdapter
  let registrar!: RouteRegistrar
  const runtime = new MagpieRuntime(ctx.credentials, new SettingsStore(resolve(home, 'plugins/dsh-magpie-connector/settings.json')), routes => registrar.publish(routes ?? runtime.routeSet()))
  const speed = new SpeedController()
  adapter = new MagpieAdapter(runtime, ctx.get('attachments'), session => speed.get(session).tier === 'fast')
  registrar = createRouteRegistrar(ctx.llm, adapter)
  ctx.on('credentials/reference-updated', ref => runtime.invalidateCredential(ref))
  ctx.inject(['connection'], child => {
    child.effect(() => registerRoutes(child.connection.fetch, runtime, speed).dispose)
  })
  const dispose = createDisposer(runtime, [() => registrar.dispose()])
  ctx.effect(() => dispose)
  void runtime.start().catch(() => {})
  return { runtime, adapter, routes: registrar }
}
