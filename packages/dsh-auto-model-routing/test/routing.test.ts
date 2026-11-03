import { expect, it } from 'vitest'
import { chooseChildRoute, policyEffort, type ChildRouteInput } from '../src/routing.js'
import { autoSupportedModel } from '../src/support.js'
import { registry } from '../src/strategies/index.js'
import type { RoutingCatalog } from '../src/settings-contract.js'
import oracle from './fixtures/routing-oracle-0.4.2.json' with { type: 'json' }

type Entry = RoutingCatalog['models'][number]
const entry = (provider: string, model: string, reasoningEfforts = ['low', 'medium', 'high', 'xhigh'], defaultEffort?: string): Entry => ({ provider, model, name: model, reasoningEfforts, ...(defaultEffort ? { defaultEffort } : {}) })
const cat = (models: Entry[], allowed: Entry[] = models, status: RoutingCatalog['childAllowlist']['status'] = 'enabled'): RoutingCatalog => ({ models, childAllowlist: { status, allowedModels: allowed.map(m => ({ provider: m.provider, model: m.model })) } })
const route = (input: Partial<ChildRouteInput> & Pick<ChildRouteInput, 'provider' | 'catalog'>) => chooseChildRoute({ parent: {}, explicit: {}, capability: 'bounded', depth: 'baseline', cap: 'xhigh', ...input })

it('moves at most one supported step and never automatically uses max', () => {
  expect(policyEffort('claude-opus-5-5', 'higher', ['low','medium','xhigh','max'], 'xhigh')).toBe('xhigh')
  expect(policyEffort('gpt-6-luna', 'higher', ['low','medium','high','xhigh','max'], 'high')).toBe('high')
  expect(policyEffort('gpt-6-astra', 'lower', ['low','medium'], 'xhigh')).toBe('low')
  expect(policyEffort('codex/gpt-6.1-sol', 'higher', ['low','medium','high','xhigh','max'], 'high')).toBe('high')
  expect(policyEffort('gpt-6.1-sol', 'baseline', ['low','medium','high','xhigh'], 'medium')).toBe('medium')
  expect(() => policyEffort('unknown', 'baseline', ['low','high'], 'xhigh')).toThrow()
})

it('spec Scenario "支持范围判定只依据注册表"', () => {
  for (const model of ['claude-opus-5-5', 'gpt-6-astra', 'GPT-5.6-Sol', 'CLAUDE-fable-5-1', 'claude/claude-opus-5-5', 'codex/gpt-6.1-sol']) {
    expect(autoSupportedModel(model), model).toBe(true)
    expect(registry.familyOfMainModel(model), model).toBeDefined()
  }
  for (const model of ['deepseek-v4.1-flash', 'glm-5.3', 'kimi-k3', 'opencode-go/deepseek-v4.1-flash', '', undefined]) {
    expect(autoSupportedModel(model), String(model)).toBe(false)
    expect(registry.familyOfMainModel(model), String(model)).toBeUndefined()
  }
})

/** Intentional deviation from the frozen 0.4.2 oracle: Sol starts at high, one step above it. */
const solRaised = <T extends { model: string; reasoningEffort: string }>(r: T): T =>
  /(^|\/)gpt-6\.1-sol$/.test(r.model) ? { ...r, reasoningEffort: ({ low: 'medium', medium: 'high', high: 'xhigh' } as Record<string, string>)[r.reasoningEffort] ?? r.reasoningEffort } : r

it('spec Scenario "内置子路由与原行为一致"', () => {
  expect(oracle.childRoutes.length).toBe(54)
  const all = [...new Map(oracle.childRoutes.map(row => [`${row.value.provider} ${row.value.model}`, entry(row.value.provider, row.value.model)])).values()]
  const parentOf = (provider: string, family: string | null) => {
    const bare = (family ?? provider) === 'claude' ? 'claude-opus-5-5' : 'gpt-6.1-sol'
    return family ? `${family}/${bare}` : bare
  }
  for (const row of oracle.childRoutes) {
    const parentModel = parentOf(row.provider, row.family)
    const models = all.some(m => m.provider === row.provider && m.model === parentModel) ? all : [...all, entry(row.provider, parentModel)]
    expect(route({ provider: row.provider, parent: { model: parentModel }, capability: row.capability as never, depth: row.depth as never, catalog: cat(models) }), JSON.stringify(row)).toEqual({ route: solRaised(row.value) })
  }
})

it('spec Scenario "能力槽只在父 provider 内解析"', () => {
  const sol = entry('traex', 'GPT-5.6-Sol', ['low', 'medium', 'high', 'xhigh'], 'medium')
  const result = route({ provider: 'traex', parent: { model: 'GPT-5.6-Sol', reasoningEffort: 'medium' }, catalog: cat([entry('codex', 'gpt-6-luna'), sol]) })
  expect(result).toEqual({ route: { provider: 'traex', model: 'GPT-5.6-Sol', reasoningEffort: 'medium' } })
  expect(JSON.stringify(result)).not.toMatch(/codex|gpt-6-luna/)
})

it('spec Scenario "能力槽须与父模型前缀相同"', () => {
  const models = [entry('dsh-magpie-connect', 'opencode-go/gpt-6-luna'), entry('dsh-magpie-connect', 'codex/gpt-6.1-sol')]
  expect(route({ provider: 'dsh-magpie-connect', parent: { model: 'codex/gpt-6.1-sol' }, catalog: cat(models) }))
    .toEqual({ route: { provider: 'dsh-magpie-connect', model: 'codex/gpt-6.1-sol', reasoningEffort: 'high' } })
})

it('explicit dimensions are kept; unusable explicit values fall back without substitution', () => {
  const models = [entry('claude', 'claude-haiku-5-5'), entry('claude', 'claude-sonnet-5-5'), entry('claude', 'claude-opus-5-5', ['low', 'medium'])]
  const base = { provider: 'claude', parent: { model: 'claude-opus-5-5', reasoningEffort: 'medium' }, catalog: cat(models) }
  expect(route({ ...base, depth: 'higher', explicit: { model: 'claude-sonnet-5-5', reasoningEffort: 'low' } })).toEqual({ route: { provider: 'claude', model: 'claude-sonnet-5-5', reasoningEffort: 'low' } })
  for (const explicit of [{ model: 'claude-haiku-5-5', reasoningEffort: 'xhigh' }, { reasoningEffort: 'xhigh' }, { reasoningEffort: 'turbo' }, { model: 'unknown' }])
    expect(route({ ...base, cap: 'high', explicit }), JSON.stringify(explicit)).toEqual({ fallback: 'explicit-unavailable' })
  expect(route({ ...base, catalog: cat(models, models, 'unavailable') })).toEqual({ fallback: 'no-usable-route' })
})

it('unregistered family models keep the model and only validate effort', () => {
  const m = entry('dsh-magpie-connect', 'opencode-go/kimi-k3', ['low', 'high'], 'high')
  const { defaultEffort: _unused, ...noDefault } = m
  const parent = { model: 'codex/gpt-6.1-sol', reasoningEffort: 'medium' }
  expect(route({ provider: m.provider, parent, explicit: { model: m.model }, catalog: cat([m]) })).toEqual({ route: { provider: m.provider, model: m.model, reasoningEffort: 'high' } })
  expect(route({ provider: m.provider, parent, explicit: { model: m.model }, catalog: cat([noDefault]) })).toEqual({ fallback: 'explicit-unavailable' })
  expect(route({ provider: m.provider, parent, explicit: { model: m.model, reasoningEffort: 'low' }, catalog: cat([noDefault]) })).toEqual({ route: { provider: m.provider, model: m.model, reasoningEffort: 'low' } })
  expect(route({ provider: m.provider, parent, explicit: { model: '../kimi-k3', reasoningEffort: 'low' }, catalog: cat([m]) })).toEqual({ fallback: 'explicit-unavailable' })
})

it('spec Scenario "能力槽可用时按能力选模"', () => {
  expect(route({ provider: 'codex', parent: { model: 'gpt-6.1-sol', reasoningEffort: 'medium' }, catalog: cat([entry('codex', 'gpt-6-luna'), entry('codex', 'gpt-6.1-sol')]) }))
    .toEqual({ route: { provider: 'codex', model: 'gpt-6-luna', reasoningEffort: 'high' } })
})
it('spec Scenario "provider 没有能力槽模型时保持父模型"', () => {
  const sol = entry('traex', 'GPT-5.6-Sol', ['low', 'medium', 'high', 'xhigh'], 'medium')
  const result = route({ provider: 'traex', parent: { model: 'GPT-5.6-Sol', reasoningEffort: 'medium' }, depth: 'higher', catalog: cat([sol]) })
  expect(result).toEqual({ route: { provider: 'traex', model: 'GPT-5.6-Sol', reasoningEffort: 'high' } })
})
it('spec Scenario "depth effort 不可得时用父会话 effort"', () => {
  const sol = entry('traex', 'GPT-5.6-Sol')
  expect(route({ provider: 'traex', parent: { model: 'GPT-5.6-Sol', reasoningEffort: 'medium' }, depth: 'higher', catalog: cat([sol]) }))
    .toEqual({ route: { provider: 'traex', model: 'GPT-5.6-Sol', reasoningEffort: 'medium' } })
})
it('spec Scenario "父会话 effort 也不可用时不改写并告警"', () => {
  const sol = entry('traex', 'GPT-5.6-Sol', ['max'])
  expect(route({ provider: 'traex', parent: { model: 'GPT-5.6-Sol', reasoningEffort: 'max' }, catalog: cat([sol]) })).toEqual({ fallback: 'no-usable-route' })
})
it('spec Scenario "显式维度不可用时不替换"', () => {
  const models = [entry('claude', 'claude-haiku-5-5'), entry('claude', 'claude-opus-5-5', ['low', 'medium'])]
  const base = { provider: 'claude', parent: { model: 'claude-opus-5-5', reasoningEffort: 'medium' }, cap: 'high' as const, catalog: cat(models) }
  for (const explicit of [{ model: 'claude-haiku-5-5', reasoningEffort: 'xhigh' }, { reasoningEffort: 'xhigh' }, { reasoningEffort: 'turbo' }])
    expect(route({ ...base, explicit }), JSON.stringify(explicit)).toEqual({ fallback: 'explicit-unavailable' })
})
it('spec Scenario "只显式 effort 时能力槽须支持该 effort"', () => {
  const models = [entry('claude', 'claude-haiku-5-5', ['low', 'medium']), entry('claude', 'claude-opus-5-5')]
  expect(route({ provider: 'claude', parent: { model: 'claude-opus-5-5', reasoningEffort: 'medium' }, explicit: { reasoningEffort: 'high' }, catalog: cat(models) }))
    .toEqual({ route: { provider: 'claude', model: 'claude-opus-5-5', reasoningEffort: 'high' } })
})
