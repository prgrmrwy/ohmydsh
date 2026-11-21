import { afterEach, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mountRealHost, until } from './support/host.js'
import { createGateway, json } from './support/gateway.js'
import { LINE_ID, lineCredentials } from './support/line.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const route = (key: string) => `dsh-magpie-connector-${key}`
const file = (home: string) => join(home, 'plugins/dsh-magpie-connector/settings.json')
const data = [
  { id: 'opencode-go/kimi-k3', owned_by: 'opencode-go' },
  { id: 'group/ds', owned_by: 'opencode-go' }, { id: 'group/hidden', owned_by: 'opencode-go' },
  { id: 'auto/glm-5', owned_by: 'claude' },
]
async function mount(visibleModels: Record<string, string[]>, extra: Record<string, unknown> = {}, waitRouting = true) {
  const gateway = await createGateway()
  gateway.handlers.set('GET /v1/models', json({ data }))
  const host = await mountRealHost({ credentials: lineCredentials('mk-mig'), settings: { lines: [{ id: LINE_ID, baseUrl: gateway.baseUrl, accessMode: 'direct' }], visibleModels, ...extra } })
  cleanup.push(gateway.close, () => host.dispose())
  if (waitRouting) await until(() => host.ownRoutes().includes(route('routing')), 'routing route')
  return host
}

test('pre-0.7 vendor-key visibility of routing entries moves to the routing key', async () => {
  // opencode-go had a whitelist (group/ds shown, group/hidden hidden); claude followed the gateway (auto/glm-5 shown).
  const host = await mount({ 'opencode-go': ['opencode-go/kimi-k3', 'group/ds'] })
  await until(() => (JSON.parse(readFileSync(file(host.home), 'utf8')).visibleModels.routing), 'migrated')
  const saved = JSON.parse(readFileSync(file(host.home), 'utf8')).visibleModels
  expect(saved).toEqual({ 'opencode-go': ['opencode-go/kimi-k3'], routing: ['group/ds', 'auto/glm-5'] })
  expect((await host.llm.listModels(route('routing'))).map(m => m.id)).toEqual(['group/ds', 'auto/glm-5'])
})

test('nothing to migrate: settings stay as they are, and a routing key already saved is never overwritten', async () => {
  const host = await mount({ 'opencode-go': ['opencode-go/kimi-k3'] })
  await until(async () => (await host.llm.listModels(route('routing'))).length === 3, 'catalog')
  expect(JSON.parse(readFileSync(file(host.home), 'utf8')).visibleModels).toEqual({ 'opencode-go': ['opencode-go/kimi-k3'] })
  const again = await mount({ 'opencode-go': ['group/ds'], routing: ['auto/glm-5'] })
  await until(async () => (await again.llm.listModels(route('routing'))).length === 1, 'catalog')
  expect(JSON.parse(readFileSync(file(again.home), 'utf8')).visibleModels).toEqual({ 'opencode-go': ['group/ds'], routing: ['auto/glm-5'] })
})

const saved = (home: string) => JSON.parse(readFileSync(file(home), 'utf8')).visibleModels

test('a failed migration write leaves settings unchanged and the next sync migrates', async () => {
  const before = { 'opencode-go': ['opencode-go/kimi-k3', 'group/ds'] }
  const gateway = await createGateway()
  gateway.handlers.set('GET /v1/models', json({ data }))
  const host = await mountRealHost({ credentials: lineCredentials('mk-mig'), settings: { lines: [{ id: LINE_ID, baseUrl: gateway.baseUrl, accessMode: 'direct' }], visibleModels: before, knownOwners: ['routing', 'opencode-go', 'claude'] } })
  cleanup.push(gateway.close, () => host.dispose())
  const store = host.plugin.runtime.store, save = store.save.bind(store)
  let fail = true
  store.save = value => { if (fail) throw new Error('disk full'); save(value) }
  await host.call('settings', { resync: true })
  expect(saved(host.home)).toEqual(before)
  expect(store.value.visibleModels).toEqual(before)
  fail = false
  await host.call('settings', { resync: true })
  expect(saved(host.home)).toEqual({ 'opencode-go': ['opencode-go/kimi-k3'], routing: ['group/ds', 'auto/glm-5'] })
})

test('migration also applies while routing is not admitted (owner cap full)', async () => {
  const full = [...Array.from({ length: 30 }, (_, i) => `o${String(i).padStart(2, '0')}`), 'opencode-go', 'claude']
  const host = await mount({ 'opencode-go': ['opencode-go/kimi-k3', 'group/ds'] }, { knownOwners: full }, false)
  await until(() => saved(host.home).routing, 'migrated')
  expect(host.ownRoutes()).not.toContain(route('routing'))
  expect(saved(host.home)).toEqual({ 'opencode-go': ['opencode-go/kimi-k3'], routing: ['group/ds', 'auto/glm-5'] })
  await until(async () => (await host.llm.listModels(route('opencode-go'))).some(m => m.id === 'group/ds'), 'fallback listing')
  expect((await host.llm.listModels(route('opencode-go'))).map(m => m.id)).not.toContain('group/hidden')
})
