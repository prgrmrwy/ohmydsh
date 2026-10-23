import { join } from 'node:path'
import { vi } from 'vitest'
import { CollabHost } from '../../src/host.js'
import { bytes, call, ops, settle, start, type Host, type WorldOptions } from './world.js'

/** A controllable Promise: `wait()` suspends until `release()`. */
export function gate() {
  let open!: () => void
  let entered!: () => void
  const reached = new Promise<void>(resolve => { entered = resolve })
  const released = new Promise<void>(resolve => { open = resolve })
  return { wait: async () => { entered(); await released }, release: () => open(), reached }
}

/**
 * Scripted integrator adapter. Bindings are keyed by Agent object, as a real
 * integrator would keep an in-memory projection of verified bindings.
 */
export function scriptedAdapter() {
  const bound = new Map<unknown, string>()
  const held = new Set<string>()
  const presence = new Map<string, string>()
  const calls = { resolveCaller: 0, claim: 0, presence: 0, deliver: 0 }
  const deliveries: { target: { name: string; address: string }; pointer: any }[] = []
  const hooks: { claim?: (address: string) => boolean | Promise<boolean>; presence?: (address: string) => Promise<void> } = {}
  const adapter = {
    modes: [] as string[],
    async claim(address: string) { calls.claim++; if (hooks.claim) return hooks.claim(address); return held.has(address) },
    async presence(target: { address: string }) { calls.presence++; await hooks.presence?.(target.address); return presence.get(target.address) ?? 'reachable' },
    async deliver(target: { name: string; address: string }, pointer: any) { calls.deliver++; deliveries.push({ target, pointer }) },
    resolveCaller(agent: unknown) { calls.resolveCaller++; return bound.get(agent) },
    holds(address: string) { return held.has(address) },
  }
  return {
    adapter, bound, held, presence, calls, deliveries, hooks,
    bind(agent: unknown, address: string) { bound.set(agent, address); held.add(address) },
    unbind(agent: unknown) { const address = bound.get(agent); bound.delete(agent); if (address) held.delete(address) },
  }
}
export type Scripted = ReturnType<typeof scriptedAdapter>

export const ledger = (host: Host, spaceId: string) => join(host.root, 'data', `${spaceId}.jsonl`)
export const records = async (host: Host, spaceId: string) => ((await bytes(ledger(host, spaceId)))?.toString() ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
export const events = async (host: Host, spaceId: string) => (await records(host, spaceId)).flatMap((r: any) => r.events)
/** Error code of a resolved `{error}` value, a thrown CollabError, or 'OK'. */
export const codeOf = async (run: Promise<any> | (() => any)) => {
  try { const value = await (typeof run === 'function' ? run() : run); return value?.error?.code ?? 'OK' } catch (error: any) { return error?.code ?? 'THROWN' }
}

/** Capture the CollabHost that the real `apply()` creates, to reach its store or service. */
export function captureHost() {
  const original = CollabHost.create.bind(CollabHost)
  const seen: { host?: CollabHost; providers?: any[] } = {}
  const spy = vi.spyOn(CollabHost, 'create').mockImplementation(async (config, workspaces, providers, onCreated, options) => {
    seen.providers = providers
    const created = await original(config, workspaces, providers, onCreated, options)
    seen.host = created
    return created
  })
  return { seen, restore: () => spy.mockRestore() }
}

/** The service the plugin published under `dshCollab`. */
export const service = (host: Host) => {
  const value = host.services.get('dshCollab')
  if (!value) throw new Error('dshCollab service was not provided')
  return value
}

export const SUBAGENT = { origin: 'subagent', delegationDepth: 1, parentSession: 'session-a' }

/**
 * Ordinary Leader `aily` (session-a) creates space `s`, grants `pet-locus`,
 * the integrator attaches and admits `locus-a` at `loc:1`, bound to subagent
 * session-l. Everything goes through the real apply(), tools and handle.
 */
export async function managedSpace(host: Host, options: WorldOptions & { admit?: boolean } = {}) {
  host.session('session-a', { live: true })
  host.session('session-l', { live: true, header: SUBAGENT })
  const { admit = true, ...world } = options
  await start(host, { ...world, extra: { managedChannels: ['pet-locus'], ...world.extra } })
  const scripted = scriptedAdapter()
  const handle = service(host).attach('pet-locus', scripted.adapter)
  const op = ops(host)
  const created = await op.create('session-a', 's', 'aily')
  if (created.error) throw new Error(`create failed: ${JSON.stringify(created)}`)
  const allowed = await call(host, 'session-a', 'collab_space', { action: 'allow_manager', spaceId: 's', cmdId: 'allow-1', channel: 'pet-locus' })
  if (allowed.error) throw new Error(`allow_manager failed: ${JSON.stringify(allowed)}`)
  const L = host.live.get('session-l')
  scripted.bind(L, 'loc:1')
  if (admit) {
    const admitted = await handle.admit('s', 'adm-1', { name: 'locus-a', address: 'loc:1' })
    if (admitted.error) throw new Error(`admit failed: ${JSON.stringify(admitted)}`)
  }
  await settle()
  return { scripted, handle, op, L }
}
