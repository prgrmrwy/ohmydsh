import { expect, it } from 'vitest'
import { Router } from '../src/router.js'
import type { Tier } from '../src/effort.js'
import { RoutingState, type SessionState } from '../src/state.js'

const config = { provider: 'claude', model: 'claude-opus-5-5', reasoningEffort: 'medium', temperature: 0.7 } as const
const supported = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const message = (text: string) => [{ source: { kind: 'user' }, content: [{ type: 'text', text }] }]
const start = (router: Router, agent: { id: string; origin?: string }, turn: number, text = '任务', tier: Tier = 'complex') => {
 if (router.begin(agent, turn, message(text))) router.resolve(agent, turn, tier)
}
function fixture() {
 const disk = new Map<string, SessionState>()
 const state = new RoutingState({ get: id => disk.get(id), set: (id, value) => { disk.set(id, value) } })
 const agent = { id: 'S' }
 return { state, agent, router: new Router(state) }
}
it('manual_does_not_need_model_metadata',()=>{
 const {router,agent}=fixture()
 expect(router.needsModelInfo(agent)).toBe(false)
 router.setMode(agent,'AUTO');start(router,agent,1,'排查多个模块')
 expect(router.needsModelInfo(agent)).toBe(true)
 router.setMode(agent,'MANUAL')
 expect(router.needsModelInfo(agent)).toBe(false)
})
it('manual_passthrough', () => {
 const {router,agent}=fixture(); start(router,agent,1,'用最高档')
 expect(router.request(agent,1,config,supported)).toEqual(config)
})
it('auto_effort_only', () => {
 const {router,agent}=fixture(); router.setMode(agent,'AUTO'); start(router,agent,1,'排查多个模块的并发问题')
 expect(router.request(agent,1,config,supported)).toEqual({...config, reasoningEffort:'xhigh'})
})
it('rapid_mode_toggle_invalidates_auto', () => {
 const {router,agent}=fixture(); router.setMode(agent,'AUTO'); start(router,agent,1,'排查多个模块')
 const auto=router.request(agent,1,config,supported)
 expect(auto.reasoningEffort).toBe('xhigh')
 router.setMode(agent,'MANUAL')
 // No restore: MANUAL passes the official config through, whatever effort it carries.
 expect(router.request(agent,1,auto,supported)).toEqual(auto)
 router.setMode(agent,'AUTO')
 expect(router.request(agent,1,config,supported)).toEqual(config)
 start(router,agent,2,'排查多个模块')
 expect(router.request(agent,2,config,supported).reasoningEffort).toBe('xhigh')
 expect(router.status(agent).history.map(h=>h.reason)).not.toContain('manual-restore')
})
it('turn_retries_reuse_decision', () => {
 const {router,agent}=fixture(); router.setMode(agent,'AUTO'); start(router,agent,1,'排查多个模块')
 for(let i=0;i<5;i++) expect(router.request(agent,1,config,supported).reasoningEffort).toBe('xhigh')
 expect(router.status(agent).history).toHaveLength(1)
})
it('nonuser_turn_reuses_level', () => {
 const {router,agent}=fixture(); router.setMode(agent,'AUTO'); start(router,agent,1,'排查多个模块')
 router.request(agent,1,config,supported); router.begin(agent,2,[])
 expect(router.request(agent,2,config,supported).reasoningEffort).toBe('xhigh')
})
it('child_passthrough', () => {
 const {router,agent}=fixture(); router.setMode(agent,'AUTO')
 const child={id:'child',origin:'subagent'}; start(router,child,1)
 expect(router.request(child,1,config,supported)).toEqual(config)
})
it('no_effort_support_passthrough', () => {
 const {router,agent}=fixture(); router.setMode(agent,'AUTO'); start(router,agent,1)
 expect(router.request(agent,1,config,[])).toEqual(config)
 expect(router.status(agent).reason).toBe('no-effort-support')
})
it('unresolved_turn_passthrough', () => {
 const {router,agent}=fixture(); router.setMode(agent,'AUTO'); router.begin(agent,1,message('任务'))
 expect(router.request(agent,1,config,supported)).toEqual(config)
 expect(router.status(agent).history).toHaveLength(0)
})
it('new_model_same_turn_remaps_effort', () => {
 const {router,agent}=fixture(); router.setMode(agent,'AUTO'); start(router,agent,1,'排查多个模块')
 expect(router.request(agent,1,config,supported).reasoningEffort).toBe('xhigh')
 const next={...config,model:'gpt-6-astra',provider:'codex',reasoningEffort:'low' as const}
 expect(router.request(agent,1,next,['low','medium','high']).reasoningEffort).toBe('medium')
})
it('guard_failure_never_changes_model', () => {
 const {router,agent}=fixture(); router.setMode(agent,'AUTO'); start(router,agent,1,'排查多个模块')
 const first=router.request(agent,1,config,supported)
 const retry=router.request(agent,1,config,supported)
 expect([first.provider,first.model]).toEqual([retry.provider,retry.model])
})
it('failure_disables_without_rewrite_and_records', () => {
 const {router,state,agent}=fixture(); router.setMode(agent,'AUTO'); start(router,agent,1)
 const auto=router.request(agent,1,config,supported)
 expect(auto.reasoningEffort).toBe('xhigh')
 expect(router.begin(agent,2,message('下一个'))).toBeDefined()
 router.fail(agent,2,'insufficient-credits')
 expect(state.read(agent.id)).toEqual({mode:'MANUAL',disabled:{category:'insufficient-credits',at:expect.any(Number)}})
 expect(router.request(agent,2,auto,supported)).toEqual(auto)
 expect(router.status(agent).history.at(-1)).toEqual({reason:'jev-failed',category:'insufficient-credits'})
})
it('failure_after_mode_change_is_discarded', () => {
 const {router,state,agent}=fixture(); router.setMode(agent,'AUTO')
 expect(router.begin(agent,1,message('x'))).toBeDefined()
 router.setMode(agent,'MANUAL')
 router.fail(agent,1,'timeout'); router.resolve(agent,1,'complex')
 expect(state.read(agent.id).disabled).toBeUndefined()
 expect(router.request(agent,1,config,supported)).toEqual(config)
})
it('decision_announced_once_per_jev_judgement', () => {
 const {router,agent}=fixture(); router.setMode(agent,'AUTO')
 router.begin(agent,1,message('排查多个模块')); router.resolve(agent,1,'complex',{confidence:0.9,ms:500})
 router.request(agent,1,config,supported)
 const first=router.judgement(agent.id)!
 expect(first).toMatchObject({source:'main',tier:'complex',effort:'xhigh',confidence:0.9,ms:500})
 // Same-turn model change remaps effort but is not a new judgement; a continued turn neither.
 router.request(agent,1,{...config,provider:'codex',model:'gpt-6-astra'},['low','medium'])
 router.begin(agent,2,[]); router.request(agent,2,config,supported)
 expect(router.judgement(agent.id)!.id).toBe(first.id)
})
it('decision_not_recorded_without_effort_or_after_discard', () => {
 const {router,agent}=fixture(); router.setMode(agent,'AUTO')
 // No effort support: nothing to announce.
 router.begin(agent,1,message('x')); router.resolve(agent,1,'complex',{ms:1})
 router.request(agent,1,config,[])
 expect(router.judgement(agent.id)).toBeUndefined()
 // Result arriving after a mode change is discarded and never recorded.
 router.begin(agent,2,message('y')); router.setMode(agent,'MANUAL'); router.resolve(agent,2,'complex',{ms:1})
 router.request(agent,2,config,supported)
 expect(router.judgement(agent.id)).toBeUndefined()
 // Cancelled turn: no record either.
 router.setMode(agent,'AUTO'); router.begin(agent,3,message('z')); router.cancel(agent,3)
 router.request(agent,3,config,supported)
 expect(router.judgement(agent.id)).toBeUndefined()
})
