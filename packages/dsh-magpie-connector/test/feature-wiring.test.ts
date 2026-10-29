import { expect, test } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.js'
import { credentialsMock } from './support/credentials.js'
import { createGateway, json, sse } from './support/gateway.js'
import { chatText, responseText } from './support/wire.js'

test('host registers three resources, projects preferences and emits real priority wire bodies, then disposes without deleting settings', async () => {
  const gateway = await createGateway()
  const models = [
    { id: 'codex/responses', owned_by: 'codex', reasoning_levels: ['none', 'high'], native_endpoints: ['/v1/responses'], service_tiers: [{ id: 'priority' }] },
    { id: 'codex/chat', owned_by: 'codex', reasoning_levels: ['high'], service_tiers: [{ id: 'priority' }] },
  ]
  gateway.handlers.set('GET /v1/models', json({ data: models }))
  gateway.handlers.set('GET /v1/magpie/quotas/cards', json({ data: [{ provider: 'codex', user: 'example', readAt: 'T0' }] }))
  gateway.handlers.set('POST /v1/responses', sse(responseText()))
  gateway.handlers.set('POST /v1/chat/completions', sse(chatText()))
  const credentials = credentialsMock()
  const routes = new Map<string, ConnectionFetchRoute>()
  const effects: (() => unknown)[] = []
  const registration = Object.assign(() => {}, { replace: () => {} })
  const ctx = {
    credentials: credentials.service,
    llm: { registerAdapter: () => registration }, get: () => undefined,
    on: () => () => {},
    effect: (f: () => unknown) => { const dispose = f(); if (typeof dispose === 'function') effects.push(dispose as () => unknown) },
    inject: (_deps: string[], f: (ctx: unknown) => unknown) => f(ctx),
    connection: { fetch: { register: (route: ConnectionFetchRoute) => {
      routes.set(route.path, route)
      return () => { routes.delete(route.path) }
    } } },
  }
  const home = mkdtempSync(join(tmpdir(), 'magpie-feature-'))
  const { runtime, adapter } = apply(ctx as unknown as Context, { home })
  const call = (resource: string, body?: unknown) => {
    const route = routes.get(`/api/dsh-magpie-connector/${resource}`)
    expect(route, `resource ${resource} registered`).toBeDefined()
    return route!.fetch(new Request(`http://localhost/api/dsh-magpie-connector/${resource}${body === undefined && resource === 'speed' ? '?session=S' : ''}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }))
  }
  try {
    expect((await call('settings', { lines: [{ baseUrl: gateway.baseUrl, accessMode: 'direct', key: 'test-key' }] })).status).toBe(200)
    expect((await call('cards')).status).toBe(200)
    expect((await call('settings', { visibleModels: { codex: ['codex/responses'] }, defaultEffort: { model: 'codex/responses', effort: 'high' } })).status).toBe(200)
    expect((await adapter.listModels('dsh-magpie-connector-codex')).map(m => m.id)).toEqual(['codex/responses'])
    expect((await adapter.resolveModel('dsh-magpie-connector-codex', 'codex/responses')).reasoning?.defaultEffort).toBe('high')
    expect((await adapter.prepareCall('dsh-magpie-connector-codex', 'codex/responses')).model.reasoning?.defaultEffort).toBe('high')
    expect((await call('settings', { visibleModels: {} })).status).toBe(200)
    expect((await call('speed', { session: 'S', tier: 'fast' })).status).toBe(200)
    for (const model of ['codex/responses', 'codex/chat']) {
      for await (const _chunk of adapter.stream({ provider: 'dsh-magpie-connector', model, sessionId: 'S' as never, messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })) { /* drain */ }
    }
    const generated = gateway.requests.filter(r => r.method === 'POST' && ['/v1/responses', '/v1/chat/completions'].includes(r.path))
    expect(generated).toHaveLength(2)
    for (const request of generated) expect(request.body).toMatchObject({ service_tier: 'priority' })
    const path = join(home, 'plugins/dsh-magpie-connector/settings.json')
    const saved = readFileSync(path, 'utf8')
    for (const dispose of effects.splice(0).reverse()) await dispose()
    expect(routes.size).toBe(0)
    expect(readFileSync(path, 'utf8')).toBe(saved)
  } finally {
    for (const dispose of effects.splice(0).reverse()) await dispose()
    await runtime.dispose()
    await gateway.close()
  }
})
