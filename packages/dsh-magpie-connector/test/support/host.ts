import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, inject } from '../../src/index.js'
import { credentialsMock } from './credentials.js'

/** The real stock DSH LLM registry type (dsh-llm 0.2.0-rc.2). */
export type HostLlm = InstanceType<typeof LlmRuntime>

export interface RealHostOptions {
  /** Pre-existing settings.json content (object is JSON-serialised). */
  settings?: unknown
  /** Credentials double; defaults to an empty writable mock. */
  credentials?: ReturnType<typeof credentialsMock>
  /** Route ids that a foreign adapter registers BEFORE the plugin mounts. */
  foreignRoutes?: string[]
  /** Add an `llm/adapters-updated` listener that throws `{code:'INVARIANT'}` while `invariant.on` is true. */
  invariantListener?: boolean
  home?: string
}

/**
 * Mount the real plugin `apply()` against the REAL Cordis Context + stock `LlmRuntime`,
 * so host validation (INVALID_CATALOG / INVALID_MODEL_INFO / NO_ADAPTER / DUPLICATE_ADAPTER /
 * INVARIANT) is produced by the actual host, not a mock.
 * `connection.fetch` and `credentials` are injected as doubles because they are not under test.
 */
export async function mountRealHost(options: RealHostOptions = {}) {
  const ctx = new Context()
  ;(ctx as unknown as { plugin(p: unknown): unknown }).plugin(LlmRuntime)
  await new Promise(resolve => setTimeout(resolve, 0))
  const llm = (ctx as unknown as { llm: HostLlm }).llm
  const invariant = { on: false }
  if (options.invariantListener) {
    ctx.on('llm/adapters-updated' as never, (() => {
      if (invariant.on) throw Object.assign(new Error('test invariant listener'), { code: 'INVARIANT' })
    }) as never)
  }
  const foreign: (() => void)[] = []
  if (options.foreignRoutes?.length) {
    class Foreign extends LlmAdapter {
      override providerInfo(provider: string) { return { id: provider, name: `Foreign ${provider}` } }
      // eslint-disable-next-line require-yield
      override async *stream(): AsyncIterable<never> { throw new Error('foreign adapter stream not used') }
    }
    foreign.push(llm.registerAdapter(options.foreignRoutes, new Foreign()) as unknown as () => void)
  }
  const home = options.home ?? mkdtempSync(join(tmpdir(), 'magpie-host-'))
  if (options.settings !== undefined) {
    mkdirSync(join(home, 'plugins/dsh-magpie-connector'), { recursive: true })
    writeFileSync(join(home, 'plugins/dsh-magpie-connector/settings.json'), JSON.stringify(options.settings))
  }
  const credentials = options.credentials ?? credentialsMock()
  const routes = new Map<string, ConnectionFetchRoute>()
  const anyCtx = ctx as unknown as { provide(name: string): unknown; set(name: string, value: unknown): void }
  anyCtx.provide('credentials'); anyCtx.set('credentials', credentials.service)
  anyCtx.provide('connection'); anyCtx.set('connection', { fetch: { register: (route: ConnectionFetchRoute) => {
    routes.set(route.path, route)
    return () => { routes.delete(route.path) }
  } } })
  const result: { value?: ReturnType<typeof apply> } = {}
  const fiber = (ctx as unknown as { plugin(p: unknown): unknown }).plugin({ name: 'dsh-magpie-connector-under-test', inject, apply: (child: Context) => { result.value = apply(child, { home }) } })
  for (let i = 0; i < 50 && (!result.value || !routes.size); i++) await new Promise(resolve => setTimeout(resolve, 2))
  if (!result.value) throw new Error('plugin did not apply')
  const call = async (resource: 'settings' | 'cards' | 'speed', body?: unknown, query = '') => {
    const route = routes.get(`/api/dsh-magpie-connector/${resource}`)
    if (!route) throw new Error(`resource ${resource} not registered`)
    return route.fetch(new Request(`http://localhost/api/dsh-magpie-connector/${resource}${query}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }))
  }
  return {
    ctx, llm, home, credentials, routes, invariant, call,
    get plugin() { return result.value! },
    /** Provider ids currently registered that start with the plugin prefix. */
    ownRoutes: () => llm.listProviders().map(p => p.id).filter(id => id.startsWith('dsh-magpie-connector')),
    dispose: async () => { await (fiber as { dispose(): unknown }).dispose() },
    disposeForeign: () => { for (const f of foreign) f() },
  }
}

/** Poll until `check` is truthy (real timers); throws with `label` on timeout. */
export async function until<T>(check: () => T | Promise<T>, label = 'condition', timeoutMs = 3000): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value as NonNullable<T>
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

/** Drain an async iterable into an array (ES2024 `Array.fromAsync` is not in the TS lib target). */
export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of iterable) out.push(item)
  return out
}
