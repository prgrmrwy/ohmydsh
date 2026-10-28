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
export { MagpieRuntime, lineCredentialRefs, lineIdOfCredentialRef } from './host/runtime.js'
export { MagpieAdapter, mapUsage } from './host/adapter.js'
export { SettingsStore } from './host/settings.js'
export { GatewayTransport } from './host/transport.js'
export const name = 'dsh-magpie-connector'
export const inject = ['llm', 'credentials']
export interface Config { home?: string }
export function apply(ctx: Context, config: Config = {}) {
  const home = config.home ?? process.env.DSH_HOME ?? resolve(homedir(), '.dsh')
  let registration: ReturnType<typeof ctx.llm.registerAdapter> | undefined
  const runtime = new MagpieRuntime(ctx.credentials, new SettingsStore(resolve(home, 'plugins/dsh-magpie-connector/settings.json')), () => registration?.replace(['dsh-magpie-connector']))
  const speed = new SpeedController()
  const adapter = new MagpieAdapter(runtime, ctx.get('attachments'), session => speed.get(session).tier === 'fast')
  registration = ctx.llm.registerAdapter(['dsh-magpie-connector'], adapter)
  ctx.on('credentials/reference-updated', ref => runtime.invalidateCredential(ref))
  ctx.inject(['connection'], child => {
    child.effect(() => registerRoutes(child.connection.fetch, runtime, speed).dispose)
  })
  ctx.effect(() => async () => { registration?.(); registration = undefined; await runtime.dispose() })
  void runtime.start().catch(() => {})
  return { runtime, adapter }
}
