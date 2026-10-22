import { expect, it } from 'vitest'
import { selectableModels, supportedAutomaticEfforts, supportedFamilyEfforts, validateFamilyMainEffort, validateChildRoute, validateMainRoute } from '../src/settings-validation.js'
import type { RoutingCatalog } from '../src/settings-contract.js'

export const catalog: RoutingCatalog = {
  models: [
    { provider: 'claude', model: 'opus', name: 'Opus', reasoningEfforts: ['low', 'medium', 'high', 'max'] },
    { provider: 'claude', model: 'fable', name: 'Fable', reasoningEfforts: ['medium', 'high'] },
    { provider: 'codex', model: 'sol', name: 'Sol', reasoningEfforts: ['low', 'medium', 'high', 'xhigh'] },
  ],
  childAllowlist: { status: 'enabled', allowedModels: [{ provider: 'claude', model: 'opus' }, { provider: 'codex', model: 'sol' }, { provider: 'claude', model: 'missing' }] },
}
it('filters exact available same-provider routes without restricting main models to child allowlist', () => {
  expect(selectableModels(catalog, 'claude', 'main').map(m => m.model)).toEqual(['opus', 'fable'])
  expect(selectableModels(catalog, 'claude', 'child').map(m => m.model)).toEqual(['opus'])
  expect(supportedAutomaticEfforts(catalog.models[0]!, 'medium')).toEqual(['low', 'medium'])
  expect(supportedAutomaticEfforts({ ...catalog.models[0]!, reasoningEfforts: ['high', 'max'] }, 'low')).toEqual([])
})
it('family efforts use intersection of all main models and never child allowlist',()=>{
 expect(supportedFamilyEfforts(catalog,'claude','xhigh')).toEqual(['medium','high'])
 expect(supportedFamilyEfforts(catalog,'claude','medium')).toEqual(['medium'])
 expect(supportedFamilyEfforts({...catalog,models:[]},'claude','xhigh')).toEqual([])
 expect(validateFamilyMainEffort(catalog,'claude','low','xhigh')[0]?.code).toBe('unsupported-effort')
 expect(validateFamilyMainEffort(catalog,'claude','high','medium')[0]?.code).toBe('effort-cap')
 expect(validateFamilyMainEffort(catalog,'claude','max','xhigh')[0]?.code).toBe('invalid-effort')
 expect(validateFamilyMainEffort(catalog,'claude','medium','xhigh')).toEqual([])
})
it('rejects unsupported, cross-provider, max and cap-breaking explicit values', () => {
  expect(validateMainRoute(catalog, 'claude', 'opus', 'medium', 'high')).toEqual([])
  for (const [provider, model, effort] of [['codex', 'opus', 'low'], ['claude', 'missing', 'low'], ['claude', 'opus', 'max'], ['claude', 'opus', 'xhigh'], ['claude', 'opus', 'high']]) {
    expect(validateMainRoute(catalog, provider!, model!, effort, 'medium')).not.toEqual([])
  }
  expect(validateChildRoute(catalog, 'claude', { model: 'fable', reasoningEffort: 'medium' }, 'high')[0]?.code).toBe('route-not-allowed')
  expect(validateChildRoute(catalog, 'claude', { model: 'sol', reasoningEffort: 'low' }, 'high')[0]?.code).toBe('model-unavailable')
  expect(validateChildRoute(catalog, 'claude', { model: 'opus' }, 'high')[0]?.code).toBe('invalid-route')
})
it.each(['disabled', 'unavailable'] as const)('fails closed for %s child allowlist', status => {
  const current = { ...catalog, childAllowlist: { ...catalog.childAllowlist, status } }
  expect(selectableModels(current, 'claude', 'child')).toEqual([])
  expect(validateChildRoute(current, 'claude', { model: 'opus', reasoningEffort: 'low' }, 'high')[0]?.code).toBe('allowlist-unavailable')
  expect(validateMainRoute(current, 'claude', 'opus', 'low', 'high')).toEqual([])
})
