import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defaultConvention } from '../../collab-kernel/src/convention/index.js'
import { CollabHost } from './host.js'
import { SessionAccess, SessionProvider } from './session-provider.js'
import { collabTools } from './tools.js'
import { admissionPolicy, checkCurrentLocation, type HostConfig } from './config.js'
import { Integrations } from './integration.js'

export type { DshCollabService, IntegrationHandle, IntegratorAdapter, ManagedTarget, SessionModeHandler } from './integration.js'
export type { Lookup, Subject } from './stamp.js'

export { salvage } from './salvage.js'
export const name = 'dsh-collab'
export const inject = ['tools', 'agents', 'sessions', 'sessionQuery', 'sessionController', 'workspaceRegistry']
export const Config = z.object({ dataDir: z.string(), admission: z.union(['invite', 'allowlist']).default('invite'), allowedSessionIds: z.array(z.string()).default([]), denySessionIds: z.array(z.string()).default([]), memberTrust: z.boolean().default(true), managedChannels: z.array(z.string()).default([]) })
export async function apply(ctx: Context, config: HostConfig) {
  const check = () => { if (host) checkCurrentLocation(host.config.dataDir, ctx.workspaceRegistry.list().map(workspace => workspace.path)) }
  // Reject invalid admission config before registering any tool or touching dataDir.
  const policy = admissionPolicy(config)
  const integrations = new Integrations(policy.managedChannels)
  const access = new SessionAccess(ctx, policy, check, integrations)
  const provider = new SessionProvider(access)
  integrations.access = access
  let host: CollabHost | undefined
  let ready = false
  let closing = false
  const current = () => ready && !closing ? host : undefined
  integrations.host = current
  const remove = collabTools(ctx, access, current)
  // Integrator service: provided unconditionally, consumed through an optional
  // inject, so integrators still load when dsh-collab is absent.
  ctx.provide('dshCollab', integrations.service)
  const started = CollabHost.create(config, ctx.workspaceRegistry.list().map(workspace => workspace.path), [provider, ...integrations.providers], value => {
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
    // Invalidate every integrator handle before anything else closes.
    integrations.close()
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
