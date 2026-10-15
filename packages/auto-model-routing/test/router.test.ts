import { expect, it } from 'vitest'
import { Router } from '../src/router.js'
import { RoutingState, type SessionState } from '../src/state.js'

const config = { provider: 'claude', model: 'claude-opus-5-5', reasoningEffort: 'medium', temperature: 0.7 } as const
const supported = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const message = (text: string) => [{ source: { kind: 'user' }, content: [{ type: 'text', text }] }]
function fixture() {
 const disk = new Map<string, SessionState>()
 const state = new RoutingState({ get: id => disk.get(id), set: (id, value) => { disk.set(id, value) } })
 const agent = { id: 'S' }
 state.initialize(agent.id, config)
 return { state, agent, router: new Router(state) }
}
it('manual_and_restore_do_not_need_model_metadata',()=>{
 const {router,agent}=fixture()
 expect(router.needsModelInfo(agent)).toBe(false)
 router.setMode(agent,'AUTO');router.begin(agent,1,message('排查多个模块'))
 expect(router.needsModelInfo(agent)).toBe(true)
 router.setMode(agent,'MANUAL')
 expect(router.needsModelInfo(agent)).toBe(false)
})
it('manual_passthrough', () => {
 const {router,agent}=fixture(); router.begin(agent,1,message('用最高档'))
 expect(router.request(agent,1,config,supported)).toEqual(config)
})
it('auto_effort_only', () => {
 const {router,agent}=fixture(); router.setMode(agent,'AUTO'); router.begin(agent,1,message('排查多个模块的并发问题'))
 expect(router.request(agent,1,config,supported)).toEqual({...config, reasoningEffort:'xhigh'})
})
it('rapid_mode_toggle_invalidates_auto', () => {
 for(const restored of [true,false]) {
 const {router,agent}=fixture(); router.setMode(agent,'AUTO'); router.begin(agent,1,message('排查多个模块'))
 const auto=router.request(agent,1,config,supported)
 router.setMode(agent,'MANUAL')
 if(restored) expect(router.request(agent,1,auto,supported,auto).reasoningEffort).toBe('medium')
 router.setMode(agent,'AUTO')
 expect(router.request(agent,1,auto,supported,auto).reasoningEffort).toBe('medium')
 expect(router.request(agent,1,config,supported,config).reasoningEffort).toBe('medium')
 router.begin(agent,2,message('排查多个模块'))
 expect(router.request(agent,2,config,supported,config).reasoningEffort).toBe('xhigh')
 }
})
it('notification_turn_restores', () => {
 const {router,agent}=fixture(); router.setMode(agent,'AUTO'); router.begin(agent,1,message('排查多个模块'))
 const auto=router.request(agent,1,config,supported)
 router.setMode(agent,'MANUAL'); router.begin(agent,2,[])
 expect(router.request(agent,2,auto,supported,auto).reasoningEffort).toBe('medium')
 expect(router.status(agent).reason).toBe('manual-restore')
})
it('turn_retries_reuse_decision', () => {
 const {router,agent}=fixture(); router.setMode(agent,'AUTO'); router.begin(agent,1,message('排查多个模块'))
 for(let i=0;i<5;i++) expect(router.request(agent,1,config,supported).reasoningEffort).toBe('xhigh')
 expect(router.status(agent).history).toHaveLength(1)
})
it('nonuser_turn_reuses_level', () => {
 const {router,agent}=fixture(); router.setMode(agent,'AUTO'); router.begin(agent,1,message('排查多个模块'))
 router.request(agent,1,config,supported); router.begin(agent,2,[])
 expect(router.request(agent,2,config,supported).reasoningEffort).toBe('xhigh')
})
it('child_passthrough', () => {
 const {router,agent}=fixture(); router.setMode(agent,'AUTO')
 const child={id:'child',origin:'subagent'}; router.begin(child,1,message('用最高档'))
 expect(router.request(child,1,config,supported)).toEqual(config)
})
it('unsupported_and_unclassified_passthrough', () => {
 const {router,agent}=fixture(); router.setMode(agent,'AUTO'); router.begin(agent,1,message(''))
 expect(router.request(agent,1,config,supported)).toEqual(config)
 expect(router.status(agent).reason).toBe('unclassified')
 router.begin(agent,2,message('排查多个模块'))
 expect(router.request(agent,2,config,[])).toEqual(config)
 expect(router.status(agent).reason).toBe('no-effort-support')
})
it('new_model_same_turn_remaps_effort', () => {
 const {router,agent}=fixture(); router.setMode(agent,'AUTO'); router.begin(agent,1,message('排查多个模块'))
 expect(router.request(agent,1,config,supported).reasoningEffort).toBe('xhigh')
 const next={...config,model:'gpt-6-astra',provider:'codex',reasoningEffort:'low' as const}
 expect(router.request(agent,1,next,['low','medium','high']).reasoningEffort).toBe('medium')
})
it('restore_without_effort_removes_field_until_converged', () => {
 const {router,state,agent}=fixture()
 state.select(agent.id,{provider:config.provider,model:config.model})
 router.setMode(agent,'AUTO');router.begin(agent,1,message('排查多个模块'))
 const auto=router.request(agent,1,config,supported)
 router.setMode(agent,'MANUAL')
 const restored=router.request(agent,1,auto,supported,auto)
 expect(restored).not.toHaveProperty('reasoningEffort')
 expect(state.read(agent.id).restore).toBe(true)
 expect(router.request(agent,1,auto,supported,restored)).not.toHaveProperty('reasoningEffort')
 router.request(agent,1,restored,supported,restored)
 expect(state.read(agent.id).restore).toBe(false)
})
it('unfinished_restore_blocks_auto_for_entire_new_user_turn', () => {
 const {router,state,agent}=fixture()
 router.setMode(agent,'AUTO');router.begin(agent,1,message('排查多个模块'))
 const auto=router.request(agent,1,config,supported)
 router.setMode(agent,'MANUAL');router.setMode(agent,'AUTO')
 router.begin(agent,2,message('排查多个模块'))
 expect(router.request(agent,2,auto,supported,auto).reasoningEffort).toBe('medium')
 router.request(agent,2,config,supported,config)
 expect(state.read(agent.id).restore).toBe(false)
 expect(router.request(agent,2,config,supported,config).reasoningEffort).toBe('medium')
 router.begin(agent,3,message('排查多个模块'))
 expect(router.request(agent,3,config,supported,config).reasoningEffort).toBe('xhigh')
})
it('restore_waits_for_matching_model',()=>{
 const {router,state,agent}=fixture()
 router.setMode(agent,'AUTO');router.begin(agent,1,message('排查多个模块'))
 router.setMode(agent,'MANUAL')
 state.select(agent.id,{provider:'codex',model:'gpt-6-astra',reasoningEffort:'low'})
 expect(router.request(agent,1,config,supported)).toEqual(config)
 expect(state.read(agent.id).restore).toBe(true)
 const next={provider:'codex',model:'gpt-6-astra',reasoningEffort:'medium' as const}
 expect(router.request(agent,1,next,['low','medium']).reasoningEffort).toBe('low')
})
it('guard_failure_never_changes_model', () => {
 const {router,agent}=fixture(); router.setMode(agent,'AUTO'); router.begin(agent,1,message('排查多个模块'))
 const first=router.request(agent,1,config,supported)
 const retry=router.request(agent,1,config,supported)
 expect([first.provider,first.model]).toEqual([retry.provider,retry.model])
})
