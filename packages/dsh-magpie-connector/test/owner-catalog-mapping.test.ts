import { expect, test } from 'vitest'
import { MagpieRuntime } from '../src/host/runtime.js'
import { MagpieAdapter } from '../src/host/adapter.js'
import { mapCatalog, routeOf } from '../src/host/catalog.js'
import { lineCredentials, memoryStore, line } from './support/line.js'
import { createGateway, json } from './support/gateway.js'

const FIELD_BODY = { data: [
  { id: 'claude/claude-haiku-5-5', owned_by: 'claude', display_name: 'Claude Haiku 5.5', reasoning_levels: ['low', 'high'], modalities: { input: ['text', 'image'] }, context_window: 1000000, max_output_tokens: 100 },
  { id: 'opencode-go/kimi-k3', owned_by: 'opencode-go', reasoning_levels: ['max'] },
  { id: 'deepseek/deepseek-v4-pro', owned_by: 'deepseek', display_name: '', modalities: { input: ['text'] } },
] }

test('test_owner_catalog_mapping_01 spec Scenario "字段映射" (through owner routes)', async () => {
  const mapped = mapCatalog(FIELD_BODY)
  expect(mapped.map(m => m.owner)).toEqual(['claude', 'opencode-go', 'deepseek'])
  expect(mapped[0]).not.toHaveProperty('displayGroup')
  const gateway = await createGateway()
  gateway.handlers.set('GET /v1/models', json(FIELD_BODY))
  const runtime = new MagpieRuntime(lineCredentials('K1').service, memoryStore([line(gateway.baseUrl)]))
  try {
    await runtime.start()
    const adapter = new MagpieAdapter(runtime)
    const claude = routeOf('claude'), kimi = routeOf('opencode-go'), deepseek = routeOf('deepseek')
    const [haiku] = await adapter.listModels(claude)
    expect(haiku).toMatchObject({ provider: claude, name: 'Claude Haiku 5.5', context: { contextWindow: 1000000 }, defaultMaxTokens: 100, inputModalities: ['text', 'image'], reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } })
    const [k3] = await adapter.listModels(kimi)
    expect(k3).toMatchObject({ provider: kimi, name: 'opencode-go/kimi-k3', reasoning: { efforts: [{ id: 'max' }] } })
    const [ds] = await adapter.listModels(deepseek)
    expect(ds).toMatchObject({ provider: deepseek, name: 'deepseek/deepseek-v4-pro', inputModalities: ['text'] })
    // a model only appears on its own owner route
    expect(await adapter.listModels(routeOf('codex'))).toEqual([])
    expect(await adapter.listModels('dsh-magpie-connector')).toEqual([]) // retired single route lists nothing
  } finally { await runtime.dispose(); await gateway.close() }
})

test('test_owner_catalog_mapping_02 spec Scenario "畸形条目被丢弃" (through owner routes)', async () => {
  const gateway = await createGateway()
  gateway.handlers.set('GET /v1/models', json({ data: [{ name: 'bad', owned_by: 'codex' }, { id: 'codex/a', owned_by: 'codex' }, { id: 'codex/b', owned_by: 'codex' }] }))
  const runtime = new MagpieRuntime(lineCredentials('K1').service, memoryStore([line(gateway.baseUrl)]))
  try {
    await runtime.start()
    expect(runtime.current.lastSyncError).toBeUndefined()
    expect(runtime.current.lastSyncAt).toBeTruthy()
    const listed = await new MagpieAdapter(runtime).listModels(routeOf('codex'))
    expect(listed.map(m => m.id)).toEqual(['codex/a', 'codex/b'])
  } finally { await runtime.dispose(); await gateway.close() }
})

test('test_owner_catalog_mapping_03 spec Scenario "非法容量值视为缺失" (through owner routes)', async () => {
  const gateway = await createGateway()
  gateway.handlers.set('GET /v1/models', json({ data: [0, -1, 2.5, '1000', 9007199254740992].map((v, i) => ({ id: `m${i}`, owned_by: 'codex', context_window: v, max_output_tokens: v })) }))
  const runtime = new MagpieRuntime(lineCredentials('K1').service, memoryStore([line(gateway.baseUrl)]))
  try {
    await runtime.start()
    const route = routeOf('codex')
    const listed = await new MagpieAdapter(runtime).listModels(route)
    expect(listed.map(m => m.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4'])
    for (const model of listed) { expect(model.provider).toBe(route); expect(model).not.toHaveProperty('context'); expect(model).not.toHaveProperty('defaultMaxTokens') }
  } finally { await runtime.dispose(); await gateway.close() }
})
