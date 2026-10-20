import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defaultConvention } from '../../collab-kernel/src/convention/index.js'
import { CollabHost } from './host.js'
import { SessionAccess, SessionProvider } from './session-provider.js'
import { collabTools } from './tools.js'
import { admissionPolicy, checkCurrentLocation, type HostConfig } from './config.js'

export { salvage } from './salvage.js'
export const name = 'dsh-collab'
export const inject = ['tools', 'agents', 'sessions', 'sessionQuery', 'sessionController', 'workspaceRegistry']
export const Config = z.object({ dataDir: z.string().required(), admission: z.union(['invite', 'allowlist']).default('invite'), allowedSessionIds: z.array(z.string()).default([]), denySessionIds: z.array(z.string()).default([]) })
export async function apply(ctx: Context, config: HostConfig) {
  const check = () => { if (host) checkCurrentLocation(host.config.dataDir, ctx.workspaceRegistry.list().map(workspace => workspace.path)) }
  // Reject invalid admission config before registering any tool or touching dataDir.
  const policy = admissionPolicy(config)
  const access = new SessionAccess(ctx, policy, check)
  const provider = new SessionProvider(access)
  let host: CollabHost | undefined
  let ready = false
  let closing = false
  const remove = collabTools(ctx, access, () => ready && !closing ? host : undefined)
  const started = CollabHost.create(config, ctx.workspaceRegistry.list().map(workspace => workspace.path), [provider], value => {
    host = value
    host.admissionCheck = check
    if (closing) void value.close().catch(() => {})
  }, { logger: ctx.logger('dsh-collab') }).then(async value => {
    if (closing) await value.close()
    else ready = true
  })
  let stopping: Promise<void> | undefined
  const stop = () => {
    if (stopping) return stopping
    closing = true
    remove()
    provider.close()
    const closingHost = host?.close()
    return stopping = Promise.allSettled([started, closingHost]).then(results => {
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failure) throw failure.reason
    })
  }
  // Cordis waits for an in-flight async apply before unloading its effects.
  // The removal event fences admission immediately, even during startup replay.
  ctx.on('internal/plugin', fiber => { if (fiber === ctx.fiber && fiber.uid === null) void stop().catch(() => {}) })
  ctx.effect(() => stop)
  return started
}

/** Used by artifact verification and the Host's convention read adapter. */
export function readBundledConvention() {
  return { ...defaultConvention }
}
