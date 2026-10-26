import { expect, it } from 'vitest'
import { choosePolicyRoute, policyEffort, POLICY_MODELS } from '../src/policy-v2.js'
import type { RoutingCatalog } from '../src/settings-contract.js'
const models = Object.entries(POLICY_MODELS).flatMap(([provider, slots]) => Object.values(slots).map(model => ({ provider, model, name: model, reasoningEfforts: ['low','medium','high','xhigh','max'] })))
const catalog: RoutingCatalog = { models, childAllowlist: { status: 'enabled', allowedModels: models } }
it.each(['dsh-magpie-connect','dsh-magpie'] as const)('preserves %s transport and selects only the requested capability family',(provider)=>{
 const gateway=models.map(m=>({...m,provider,model:`${m.provider}/${m.model}`}))
 const cat:RoutingCatalog={models:gateway,childAllowlist:{status:'enabled',allowedModels:gateway}}
 expect(choosePolicyRoute(provider,'bounded','baseline',cat,'xhigh',{},'codex')).toEqual({provider,model:'codex/gpt-6-luna',reasoningEffort:'high'})
 expect(choosePolicyRoute(provider,'bounded','higher',cat,'xhigh',{model:'claude/claude-sonnet-5-5'})).toMatchObject({provider,model:'claude/claude-sonnet-5-5',reasoningEffort:'high'})
 expect(()=>choosePolicyRoute(provider,'bounded','baseline',cat,'xhigh')).toThrow('unsupported')
 expect(()=>choosePolicyRoute(provider,'bounded','baseline',{...cat,childAllowlist:{status:'enabled',allowedModels:gateway.map(m=>({...m,provider:provider==='dsh-magpie'?'dsh-magpie-connect':'dsh-magpie'}))}},'xhigh',{},'codex')).toThrow('允许列表')
 expect(()=>choosePolicyRoute(provider,'bounded','baseline',{...cat,models:gateway.map(m=>({...m,reasoningEfforts:['high']}))},'xhigh',{model:'claude/claude-sonnet-5-5',reasoningEffort:'medium'})).toThrow('effort')
})
it.each(['dsh-magpie-connect','dsh-magpie'] as const)('other %s models require explicit model and verified default or explicit effort',(provider)=>{
 const m={provider,model:'opencode-go/kimi-k3',name:'Kimi',reasoningEfforts:['low','high'],defaultEffort:'high'}
 const cat:RoutingCatalog={models:[m],childAllowlist:{status:'enabled',allowedModels:[m]}}
 expect(choosePolicyRoute(provider,'bounded','baseline',cat,'xhigh',{model:m.model})).toMatchObject({model:m.model,reasoningEffort:'high'})
 expect(()=>choosePolicyRoute(provider,'bounded','baseline',{...cat,models:[{...m,defaultEffort:undefined}] as never},'xhigh',{model:m.model})).toThrow()
 expect(choosePolicyRoute(provider,'bounded','baseline',{...cat,models:[{...m,defaultEffort:undefined}] as never},'xhigh',{model:m.model,reasoningEffort:'low'})).toMatchObject({reasoningEffort:'low'})
 expect(()=>choosePolicyRoute(provider,'bounded','baseline',cat,'xhigh',{model:'../kimi-k3',reasoningEffort:'low'})).toThrow()
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
