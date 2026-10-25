import { expect, it } from 'vitest'
import { choosePolicyRoute, policyEffort, POLICY_MODELS } from '../src/policy-v2.js'
import type { RoutingCatalog } from '../src/settings-contract.js'
const models = Object.entries(POLICY_MODELS).flatMap(([provider, slots]) => Object.values(slots).map(model => ({ provider, model, name: model, reasoningEfforts: ['low','medium','high','xhigh','max'] })))
const catalog: RoutingCatalog = { models, childAllowlist: { status: 'enabled', allowedModels: models } }
it('preserves Magpie transport and selects only the requested capability family',()=>{
 const gateway=models.map(m=>({...m,provider:'dsh-magpie-connect',model:`${m.provider}/${m.model}`}))
 const cat:RoutingCatalog={models:gateway,childAllowlist:{status:'enabled',allowedModels:gateway}}
 expect(choosePolicyRoute('dsh-magpie-connect','bounded','baseline',cat,'xhigh',{},'codex')).toEqual({provider:'dsh-magpie-connect',model:'codex/gpt-6-luna',reasoningEffort:'high'})
 expect(choosePolicyRoute('dsh-magpie-connect','bounded','higher',cat,'xhigh',{model:'claude/claude-sonnet-5-5'})).toMatchObject({provider:'dsh-magpie-connect',model:'claude/claude-sonnet-5-5',reasoningEffort:'high'})
 expect(()=>choosePolicyRoute('dsh-magpie-connect','bounded','baseline',cat,'xhigh')).toThrow('unsupported')
})
it('other Magpie models require explicit model and verified default or explicit effort',()=>{
 const m={provider:'dsh-magpie-connect',model:'opencode-go/kimi-k3',name:'Kimi',reasoningEfforts:['low','high'],defaultEffort:'high'}
 const cat:RoutingCatalog={models:[m],childAllowlist:{status:'enabled',allowedModels:[m]}}
 expect(choosePolicyRoute('dsh-magpie-connect','bounded','baseline',cat,'xhigh',{model:m.model})).toMatchObject({model:m.model,reasoningEffort:'high'})
 expect(()=>choosePolicyRoute('dsh-magpie-connect','bounded','baseline',{...cat,models:[{...m,defaultEffort:undefined}] as never},'xhigh',{model:m.model})).toThrow()
 expect(choosePolicyRoute('dsh-magpie-connect','bounded','baseline',{...cat,models:[{...m,defaultEffort:undefined}] as never},'xhigh',{model:m.model,reasoningEffort:'low'})).toMatchObject({reasoningEffort:'low'})
 expect(()=>choosePolicyRoute('dsh-magpie-connect','bounded','baseline',cat,'xhigh',{model:'../kimi-k3',reasoningEffort:'low'})).toThrow()
})
it('separates capability from investment, bounded baseline is not lower', () => {
  expect(choosePolicyRoute('claude', 'bounded', 'baseline', catalog, 'xhigh')).toEqual({ provider: 'claude', model: 'claude-haiku-5-5', reasoningEffort: 'medium' })
  expect(choosePolicyRoute('codex', 'bounded', 'baseline', catalog, 'xhigh')).toMatchObject({ model: 'gpt-6-luna', reasoningEffort: 'high' })
  expect(choosePolicyRoute('claude', 'frontier', 'lower', catalog, 'xhigh')).toMatchObject({ model: 'claude-opus-5-5', reasoningEffort: 'low' })
})
it('moves at most one supported step and never automatically uses max', () => {
  expect(policyEffort('claude-opus-5-5', 'higher', ['low','medium','xhigh','max'], 'xhigh')).toBe('xhigh')
  expect(policyEffort('gpt-6-luna', 'higher', ['low','medium','high','xhigh','max'], 'high')).toBe('high')
  expect(policyEffort('gpt-6-astra', 'lower', ['low','medium'], 'xhigh')).toBe('low')
  expect(() => policyEffort('unknown', 'baseline', ['low','high'], 'xhigh')).toThrow()
})
it('preserves explicit dimensions and rejects unavailable or over-cap constraints', () => {
  expect(choosePolicyRoute('claude', 'bounded', 'higher', catalog, 'xhigh', { model: 'claude-sonnet-5-5', reasoningEffort: 'low' })).toMatchObject({ model: 'claude-sonnet-5-5', reasoningEffort: 'low' })
  expect(() => choosePolicyRoute('claude', 'bounded', 'baseline', catalog, 'medium', { reasoningEffort: 'high' })).toThrow()
  expect(() => choosePolicyRoute('claude', 'bounded', 'baseline', catalog, 'xhigh', { model: 'unknown' })).toThrow()
  expect(() => choosePolicyRoute('codex', 'bounded', 'baseline', { ...catalog, childAllowlist: { status: 'unavailable', allowedModels: [] } }, 'xhigh')).toThrow()
})
