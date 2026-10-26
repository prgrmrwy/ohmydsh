import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { createScope } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '#model-source/client/ui-model-selection/src/client/index.ts'
import { filterOptions } from '#model-source/client/ui-commands/src/client/popup.ts'

it('actual /model registration shares buckets, aliases and exact selection with the composer directory', async () => {
  const ctx = new Context()
  const sessionId = 'display-popup'
  const scope = createScope(ctx, sessionId)
  const projection = createSnapshotStore({ lastUsed: null, next: { provider: 'gateway', model: 'family/model', reasoningEffort: 'high' } })
  const selections: unknown[] = []
  const sessionRemote = {
    modelCatalog: async () => ({ ok: true, value: {
      default: { provider: 'gateway', model: 'family/model' }, routableProviders: ['gateway', 'ordinary'], failures: [],
      groups: [{ id: 'gateway', name: 'Gateway', models: [
        { id: 'family/model', name: 'Model', displayGroup: { id: 'family', label: 'Gateway · Family' } },
        { id: 'other/choice', name: 'Choice', displayGroup: { id: 'other', label: 'Gateway · Other' }, reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' } },
      ] }, { id: 'ordinary', name: 'Ordinary', models: [{ id: 'plain', name: 'Plain' }] }],
    } }),
    selectModel: async payload => { selections.push(payload); return { ok: true, value: undefined } },
  }
  Object.assign(new TestRemote(ctx), { session: sessionRemote })
  ctx.reflect.provide('remote.session', sessionRemote)
  let popup
  ctx.provide('commandUi', { register: contribution => { popup = contribution.ui; return () => {} } })
  ctx.provide('slots', { inject: (_name, callback) => callback(), register: () => () => {} })
  const locale = new LocaleRuntime(ctx); locale.setLocale('en'); ctx.provide('locale', locale)
  const binding = { sessionId, ctx: scope.ctx, session: { sessionId, getSnapshot: () => ({ blank: false }), projections: { faceOf: () => projection } } }
  ctx.provide('sessions', { scope: () => scope.ctx, binding: () => binding, subagentAddress: () => undefined })
  try {
    await ctx.plugin({ inject, apply }).await()
    await ctx.plugin(function settle() {}).await()
    const options = await popup.options({ sessionId }, new AbortController().signal)
    expect(options.map(row => row.label)).toEqual(['Model', 'Choice', 'Plain'])
    expect(options.map(row => row.group)).toEqual([
      { name: JSON.stringify(['gateway', 'family']), label: 'Gateway · Family' },
      { name: JSON.stringify(['gateway', 'other']), label: 'Gateway · Other' },
      { name: 'ordinary', label: 'Ordinary' },
    ])
    expect(options[0].active).toBe(true)
    const filtered = filterOptions(options, 'other/choice', 'fuzzy-label')
    expect(filtered).toEqual([options[1]])
    await popup.onSelect(filtered[0], { sessionId })
    expect(selections).toEqual([{ sessionId, provider: 'gateway', model: 'other/choice', reasoningEffort: 'low' }])
    expect(ctx.modelDirectories.directoryFor(sessionId).store.getSnapshot().current).toEqual(projection.getSnapshot().next)
  } finally { await scope.fiber.dispose(); await ctx.fiber.dispose() }
})
