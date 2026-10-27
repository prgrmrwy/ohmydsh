import { expect, test } from 'vitest'
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { MagpieAdapter } from '../src/host/adapter.js'
import { mapCatalog } from '../src/host/catalog.js'
import { MagpieRuntime } from '../src/host/runtime.js'
import { credentialsMock } from './support/credentials.js'

type DisplayModel = LlmResolvedModelInfo & { displayGroup?: { id: string; label: string } }
const fixture = (data: unknown[]) => {
  // No configured connection or credentials: exercise the real adapter without gateway I/O.
  const runtime = new MagpieRuntime(credentialsMock().service)
  runtime.current.catalog = mapCatalog({ data })
  return { runtime, adapter: new MagpieAdapter(runtime) }
}

// These assertions stop at plugin output; unpatched core normalization drops displayGroup.
test.each([
  { ownedBy: 'codex', group: { id: 'codex', label: 'Magpie (GPT)' } },
  { ownedBy: 'claude', group: { id: 'claude', label: 'Magpie (Claude)' } },
  { ownedBy: 'custom/provider', group: { id: 'owned-by:custom/provider', label: 'Magpie (custom/provider)' } },
  { ownedBy: 'other', group: { id: 'owned-by:other', label: 'Magpie (other)' } },
  { ownedBy: 'owned-by:other', group: { id: 'owned-by:owned-by:other', label: 'Magpie (owned-by:other)' } },
  { ownedBy: ' codex ', group: { id: 'owned-by: codex ', label: 'Magpie ( codex )' } },
  { ownedBy: ' ', group: { id: 'owned-by: ', label: 'Magpie ( )' } },
  ...[undefined, '', null, 42, false, {}, ['codex']].map(ownedBy => ({ ownedBy, group: { id: 'other', label: 'Magpie (Other)' } })),
])('direct resolve/prepare use raw owned_by=$ownedBy, not misleading id/name', async ({ ownedBy, group }) => {
  const id = 'custom/claude-looking-gpt'
  const { runtime, adapter } = fixture([{ id, display_name: 'Claude GPT', ...(ownedBy === undefined ? {} : { owned_by: ownedBy }) }])
  try {
    const resolved: DisplayModel = await adapter.resolveModel('dsh-magpie-connector', id)
    const prepared: DisplayModel = (await adapter.prepareCall('dsh-magpie-connector', id)).model
    for (const model of [resolved, prepared]) {
      expect(model).toMatchObject({ provider: 'dsh-magpie-connector', id, name: 'Claude GPT', displayGroup: group })
    }
    // Settings/visibility must keep the exact pre-AMD2 provider fallback and keys.
    expect(runtime.current.catalog[0]?.provider).toBe(typeof ownedBy === 'string' && ownedBy ? ownedBy : 'custom')
  } finally { await runtime.dispose() }
})

test('missing owned_by stays Other even when the existing settings fallback is codex', async () => {
  const { runtime, adapter } = fixture([{ id: 'codex/gpt-looking', display_name: 'GPT' }])
  try {
    const model: DisplayModel = await adapter.resolveModel('dsh-magpie-connector', 'codex/gpt-looking')
    expect(model.displayGroup).toEqual({ id: 'other', label: 'Magpie (Other)' })
    expect(runtime.current.catalog[0]?.provider).toBe('codex')
    runtime.store.value.visibleModels = { codex: [] }
    expect(await adapter.listModels()).toEqual([])
  } finally { await runtime.dispose() }
})

test('visibility and default effort preserve display groups and real route/model identity', async () => {
  const { runtime, adapter } = fixture([
    { id: 'custom/claude-looking', owned_by: 'codex', reasoning_levels: ['low', 'high'] },
    { id: 'codex/hidden', owned_by: 'codex', reasoning_levels: ['high'] },
    { id: 'custom/gpt-looking', owned_by: 'claude', reasoning_levels: ['high'] },
    { id: 'codex/missing', reasoning_levels: ['high'] },
  ])
  runtime.store.value.visibleModels = { codex: ['custom/claude-looking', 'codex/missing'] }
  runtime.store.value.defaultEfforts = { 'custom/claude-looking': 'high', 'codex/missing': 'high' }
  try {
    const listed = await adapter.listModels()
    expect(listed.map(model => model.id)).toEqual(['custom/claude-looking', 'custom/gpt-looking', 'codex/missing'])
    for (const id of ['custom/claude-looking', 'codex/missing']) {
      const models: DisplayModel[] = [
        listed.find(model => model.id === id)!,
        await adapter.resolveModel('dsh-magpie-connector', id),
        (await adapter.prepareCall('dsh-magpie-connector', id)).model,
      ]
      for (const model of models) {
        expect(model).toMatchObject({ provider: 'dsh-magpie-connector', id, reasoning: { defaultEffort: 'high' } })
        expect(model.displayGroup).toEqual(id === 'codex/missing' ? { id: 'other', label: 'Magpie (Other)' } : { id: 'codex', label: 'Magpie (GPT)' })
      }
    }
    expect(runtime.current.catalog[0]?.info.reasoning).not.toHaveProperty('defaultEffort')
  } finally { await runtime.dispose() }
})

test('raw gateway data is detached from mapped metadata and adapter snapshots', async () => {
  const raw = { id: 'custom/model', owned_by: 'codex', display_name: 'Original', reasoning_levels: ['high'], modalities: { input: ['text', 'image'] }, service_tiers: [{ id: 'priority' }] }
  const { runtime, adapter } = fixture([raw])
  try {
    raw.id = 'changed'; raw.owned_by = 'claude'; raw.display_name = 'Changed'
    raw.reasoning_levels.push('low'); raw.modalities.input.pop(); raw.service_tiers[0]!.id = 'changed'
    const model: DisplayModel = await adapter.resolveModel('dsh-magpie-connector', 'custom/model')
    expect(model).toMatchObject({ provider: 'dsh-magpie-connector', id: 'custom/model', name: 'Original', displayGroup: { id: 'codex', label: 'Magpie (GPT)' }, inputModalities: ['text', 'image'], reasoning: { efforts: [{ id: 'high', name: 'high' }] } })
    expect(runtime.current.catalog[0]?.serviceTiers).toEqual(['priority'])
    expect(runtime.current.catalog[0]?.efforts).toEqual(['high'])
  } finally { await runtime.dispose() }
})

test('list/resolve/prepare display groups are detached from each other and the catalog', async () => {
  const { runtime, adapter } = fixture([{ id: 'custom/model', owned_by: 'codex', reasoning_levels: ['high'] }])
  runtime.store.value.defaultEfforts = { 'custom/model': 'high' }
  try {
    const listed: DisplayModel = (await adapter.listModels())[0]!
    const resolved: DisplayModel = await adapter.resolveModel('dsh-magpie-connector', 'custom/model')
    const prepared: DisplayModel = (await adapter.prepareCall('dsh-magpie-connector', 'custom/model')).model
    expect(listed.displayGroup).toEqual({ id: 'codex', label: 'Magpie (GPT)' })
    listed.displayGroup!.label = 'mutated list'
    resolved.displayGroup!.id = 'mutated resolve'
    prepared.displayGroup!.label = 'mutated prepare'
    for (const model of [runtime.current.catalog[0]!.info, await adapter.resolveModel('dsh-magpie-connector', 'custom/model'), (await adapter.prepareCall('dsh-magpie-connector', 'custom/model')).model] as DisplayModel[]) {
      expect(model.displayGroup).toEqual({ id: 'codex', label: 'Magpie (GPT)' })
    }
    expect(resolved.displayGroup!.label).toBe('Magpie (GPT)')
    expect(prepared.displayGroup!.id).toBe('codex')
  } finally { await runtime.dispose() }
})
