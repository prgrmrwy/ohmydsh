import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it } from 'vitest'
import Llm, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import Sessions from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import { buildModelCatalog } from '#model-source/api/session-controller/src/catalog.ts'
import { installModelSelectionProjection } from '#model-source/api/session-controller/src/model-selection-projection.ts'
import { ModelDirectory } from '#model-source/client/ui-model-selection/src/client/directory.ts'
import { ModelCatalogDirectory } from '#model-source/client/ui-model-selection/src/client/catalog.ts'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
async function harness(displayGroup: unknown = { id: 'codex', label: 'Magpie · Codex' }) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Llm)
  class Adapter extends LlmAdapter {
    override providerInfo(id: string) { return { id, name: 'Gateway' } }
    override async listModels(provider: string) { return [{ provider, id: 'codex/gpt', name: 'GPT' }] }
    override async resolveModel(provider: string, id: string) { return { provider, id, name: 'GPT', displayGroup } as never }
    override async *stream() { yield { type: 'finish' as const, reason: { kind: 'stop' as const } } }
  }
  ctx.llm.registerAdapter(['gateway'], new Adapter())
  return ctx
}

it('validates and deeply detaches display metadata through real LLM and Host catalog without changing routes', async () => {
  const source = Object.freeze({ id: 'codex', label: 'Magpie · Codex', extra: Object.freeze({ ignored: true }) })
  const ctx = await harness(source)
  const info = await ctx.llm.resolveModelInfo('gateway', 'codex/gpt')
  expect(info.displayGroup).toEqual({ id: 'codex', label: 'Magpie · Codex' })
  expect(info.displayGroup).not.toBe(source)
  const catalog = await buildModelCatalog(ctx, { provider: 'gateway', model: 'codex/gpt' })
  expect(catalog.routableProviders).toEqual(['gateway'])
  expect(catalog.groups[0]?.models[0]?.displayGroup).toEqual(info.displayGroup)
  expect(catalog.groups[0]?.models[0]?.displayGroup).not.toBe(info.displayGroup)
  Reflect.set(catalog.groups[0]!.models[0]!.displayGroup!, 'label', 'mutated catalog')
  expect(info.displayGroup!.label).toBe(source.label)
  info.displayGroup!.label = 'mutated output'
  expect(source.label).toBe('Magpie · Codex')
  expect((await ctx.llm.resolveModelInfo('gateway', 'codex/gpt')).displayGroup?.label).toBe(source.label)
})

it.each([null, [], 'codex', {}, { id: '', label: 'Codex' }, { id: 'x', label: '' }, { id: 'x', label: '  ' }, { id: '  ', label: 'x' }, { id: 1, label: 'x' }, { id: 'x', label: false }].map(value => [value]))('rejects invalid displayGroup %j with INVALID_MODEL_INFO', async (value) => {
  const ctx = await harness(value)
  await expect(ctx.llm.resolveModelInfo('gateway', 'codex/gpt')).rejects.toMatchObject({ code: 'INVALID_MODEL_INFO' })
})

it('keeps ungrouped model metadata unchanged', async () => {
  const ctx = await harness(undefined)
  // Explicitly omitted metadata is valid; use a provider without this optional field.
  ctx.llm.registerAdapter(['ordinary'], new class extends LlmAdapter {
    override async resolveModel(provider: string, id: string) { return { provider, id, name: 'Plain' } }
    override async *stream() {}
  }())
  expect(await ctx.llm.resolveModelInfo('ordinary', 'plain')).toEqual({ provider: 'ordinary', id: 'plain', name: 'Plain' })
})

it('directory keeps official current selection without a lastUsed display value', async () => {
  const ctx = await harness()
  await ctx.plugin(Sessions)
  await ctx.plugin(Projections)
  installModelSelectionProjection(ctx)
  const session = ctx.sessions.create()
  const next = { provider: 'gateway', model: 'codex/gpt', reasoningEffort: 'medium' }
  const actual = { ...next, reasoningEffort: 'high' }
  session.append('model/selection', next)
  session.append('request/header', { header: { config: actual }, reason: 'initial' })
  const projected = createSnapshotStore(ctx.sessionProjections.snapshot(session).values.modelSelection)
  expect(projected.getSnapshot()).toEqual({ lastUsed: actual, next })
  const catalog = new ModelCatalogDirectory({ remote: { session: { modelCatalog: async () => ({ ok: true, value: {
    default: next, routableProviders: ['gateway'], groups: [{ id: 'gateway', name: 'Gateway', models: [{ id: 'codex/gpt', name: 'GPT' }] }], failures: [],
  } }) } } } as never)
  await catalog.load()
  const selectModel = async () => { throw new Error('display must not write selection or global defaults') }
  const directory = new ModelDirectory({ selectModel }, session.id, () => true, catalog, projected, () => false)
  expect(directory.store.getSnapshot().current).toEqual(next)
  expect(directory.store.getSnapshot()).not.toHaveProperty('lastUsed')
  const newer = { ...next, reasoningEffort: 'low' }
  session.append('model/selection', newer)
  session.append('request/header', { header: { config: actual }, reason: 'initial' })
  projected.set(ctx.sessionProjections.snapshot(session).values.modelSelection)
  expect(directory.store.getSnapshot().current).toEqual(newer)
  expect(directory.store.getSnapshot()).not.toHaveProperty('lastUsed')
  expect(ctx.sessionProjections.snapshot(session).values.modelSelection).toEqual({ next: newer, lastUsed: actual })
  directory.dispose()
})
