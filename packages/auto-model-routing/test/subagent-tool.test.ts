import { afterEach, expect, it } from 'vitest'
import { routeSubagentTool, type ToolDeps } from '../src/subagent-tool.js'
import { DEFAULT_SETTINGS, type Settings, type RoutingCatalog } from '../src/settings-contract.js'
import { JevClient } from '../src/jev.js'
import { tiers } from '../src/effort.js'
import { RoutingState, type SessionState } from '../src/state.js'
import { fakeJev, json, tier, type Reply } from './fake-jev.js'

const env = { get: (name: string) => name === 'OPENROUTER_API_KEY' ? { value: 'sk-or-test' } : undefined }
let close: (() => Promise<void>) | undefined
afterEach(async () => { await close?.(); close = undefined })

interface FakeAgent { id: string; session: { header: { origin?: 'subagent'; parentSession?: string } } }
const session = (id: string, parent?: string): FakeAgent => ({ id, session: { header: parent ? { origin: 'subagent', parentSession: parent } : {} } })

async function tool(reply: Reply, modes: Record<string, 'AUTO' | 'MANUAL'> = { S1: 'AUTO' }, live: FakeAgent[] = [session('S1')], options: Pick<ToolDeps, 'readSettings' | 'catalog'> = {}) {
 const server = await fakeJev(reply); close = server.close
 const disk = new Map<string, SessionState>()
 const state = new RoutingState({ get: id => disk.get(id), set: (id, v) => { disk.set(id, v) } })
 for (const [id, mode] of Object.entries(modes)) state.setMode(id, mode)
 const registry = new Map(live.map(agent => [agent.id, agent]))
 const judged: unknown[] = []
 const def = routeSubagentTool(new JevClient(env, server.base, 300), { ...options, agents: { get: (id: string) => registry.get(id) as never }, state, judged: (id, value) => judged.push({ id, ...value }) })
 return { server, def, state, disk, judged }
}
const exec = (agent: FakeAgent | undefined = session('S1'), signal = new AbortController().signal) => ({ signal, agent }) as never

it('tool_returns_table_entry', async () => {
 const { def, server } = await tool(tier('simple'))
 expect(def.name).toBe('route_subagent')
 expect(def.description).toMatch(/OpenRouter/)
 // Always visible to the agent: says to call it before every delegation and to pass all three values.
 expect(def.description).toMatch(/Call before every sub-agent delegation/)
 expect(def.description).toMatch(/pass provider, model and reasoning_effort explicitly/)
 const expected = {
  claude: [['claude-haiku-5-5', 'low'], ['claude-sonnet-5-5', 'medium'], ['claude-opus-5-5', 'high'], ['claude-opus-5-5', 'xhigh']],
  codex: [['gpt-6-luna', 'medium'], ['gpt-6.1-sol', 'medium'], ['gpt-6.1-sol', 'high'], ['gpt-6.1-sol', 'xhigh']],
 }
 for (const provider of ['claude', 'codex'] as const) {
  for (const [i, t] of tiers.entries()) {
   server.set(tier(t))
   const [model, reasoning_effort] = expected[provider][i]!
   expect(await def.execute({ task: '排查多个模块', provider }, exec())).toEqual({ tier: t, provider, model, reasoning_effort })
  }
 }
 // The task is redacted before it leaves.
 await def.execute({ task: 'deploy with token=abc123def456', provider: 'claude' }, exec())
 const sent = server.bodies.at(-1) as { state: string }
 expect(sent.state).toBe('Previous user-turn tier: none\nUser message:\ndeploy with token=<redacted>')
})

it('explicit_child_routes_and_current_catalog_are_validated_without_changing_state', async () => {
 let settings: Settings = {...DEFAULT_SETTINGS, effortCap:'high', childRoutes:{claude:{escalated:{model:'claude-fable-5-1',reasoningEffort:'high'}}}, mainEfforts:{claude:{escalated:'low'}}}
 let catalog: RoutingCatalog = {models:[{provider:'claude',model:'claude-fable-5-1',name:'Fable',reasoningEfforts:['low','high']}],childAllowlist:{status:'enabled',allowedModels:[{provider:'claude',model:'claude-fable-5-1'}]}}
 const {def,state,judged} = await tool(tier('escalated'),undefined,undefined,{readSettings:()=>settings,catalog:async()=>catalog})
 expect(await def.execute({task:'x',provider:'claude'},exec())).toMatchObject({model:'claude-fable-5-1',reasoning_effort:'high'})
 catalog = {...catalog,childAllowlist:{status:'enabled',allowedModels:[]}}
 await expect(def.execute({task:'x',provider:'claude'},exec())).rejects.toThrow(/路由设置无效.*暂停委派并询问用户/)
 catalog = {...catalog,childAllowlist:{status:'enabled',allowedModels:[{provider:'claude',model:'claude-fable-5-1'}]}}
 settings = {...settings,effortCap:'medium'}
 await expect(def.execute({task:'x',provider:'claude'},exec())).rejects.toThrow(/路由设置无效/)
 expect(state.read('S1')).toEqual({mode:'AUTO'})
 expect(judged).toHaveLength(1)
})
it('default_child_effort_obeys_cap_support_and_no_route_substitution', async () => {
 let catalog: RoutingCatalog = {models:[{provider:'codex',model:'gpt-6-luna',name:'Luna',reasoningEfforts:['low','high']}],childAllowlist:{status:'enabled',allowedModels:[{provider:'codex',model:'gpt-6-luna'}]}}
 const {def} = await tool(tier('simple'),undefined,undefined,{readSettings:()=>({...DEFAULT_SETTINGS,effortCap:'medium'}),catalog:()=>catalog})
 expect(await def.execute({task:'x',provider:'codex'},exec())).toMatchObject({model:'gpt-6-luna',reasoning_effort:'low'})
 catalog = {...catalog,models:[{...catalog.models[0]!,reasoningEfforts:['high']}]}
 await expect(def.execute({task:'x',provider:'codex'},exec())).rejects.toThrow(/路由设置无效/)
})
it('child_model_not_capped_by_caller', async () => {
 const { def, server } = await tool(tier('escalated'))
 expect(await def.execute({ task: '证明并发正确性', provider: 'claude' }, exec())).toEqual({ tier: 'escalated', provider: 'claude', model: 'claude-opus-5-5', reasoning_effort: 'xhigh' })
 const seen: string[] = []
 for (const provider of ['claude', 'codex'] as const) for (const t of tiers) {
  server.set(tier(t))
  const result = await def.execute({ task: 'x', provider }, exec()) as { model: string; reasoning_effort: string }
  seen.push(result.model, result.reasoning_effort)
 }
 expect(seen).not.toContain('claude-fable-5-1')
 expect(seen).not.toContain('gpt-6-astra')
 expect(seen).not.toContain('max')
})

it('manual_root_skips_jev', async () => {
 const manual = { routed: false, reason: 'manual' }
 // S1 set MANUAL by the user, C1 its child; C2's parent S2 is AUTO but not in the live registry.
 const { def, server, state, judged } = await tool(tier('complex'), { S1: 'MANUAL', S2: 'AUTO' }, [session('S1'), session('C1', 'S1'), session('C2', 'S2')])
 for (const caller of ['S1', 'C1', 'C2']) {
  const result = await def.execute({ task: 'x', provider: 'claude' }, exec(caller === 'S1' ? session('S1') : session(caller, caller === 'C1' ? 'S1' : 'S2')))
  expect(result, caller).toEqual(manual)
  expect(def.output!.render({} as never, result as never)[0]).toMatchObject({ text: expect.stringContaining('按官方默认委派') })
 }
 // Disabled by a Jev failure counts as MANUAL too.
 state.setMode('S1', 'AUTO'); state.disable('S1', 'insufficient-credits')
 expect(await def.execute({ task: 'x', provider: 'claude' }, exec(session('S1')))).toEqual(manual)
 expect(server.bodies).toHaveLength(0)
 expect(judged).toHaveLength(0)
})

it('nested_child_follows_root_mode', async () => {
 const live = [session('S1'), session('C1', 'S1'), session('C2', 'C1')]
 const { def, server, judged } = await tool(tier('standard'), { S1: 'AUTO' }, live)
 expect(await def.execute({ task: 'x', provider: 'claude' }, exec(live[2]))).toEqual({ tier: 'standard', provider: 'claude', model: 'claude-sonnet-5-5', reasoning_effort: 'medium' })
 expect(server.bodies).toHaveLength(1)
 // A child caller has no chip: nothing is recorded for S1.
 expect(judged).toHaveLength(0)
})

it('tool_failure_reports_without_state_change', async () => {
 const { def, disk } = await tool(json(402, {}))
 const before = structuredClone(disk.get('S1'))
 await expect(def.execute({ task: 'x', provider: 'claude' }, exec())).rejects.toThrow(/余额不足.*暂停委派并询问用户/)
 expect(disk.get('S1')).toEqual(before)
 expect(disk.get('S1')).toEqual({ mode: 'AUTO' })
 await close?.(); close = undefined
 const controller = new AbortController(); controller.abort()
 const held = await tool(() => {})
 const error = await held.def.execute({ task: 'x', provider: 'claude' }, exec(session('S1'), controller.signal)).catch((e: Error) => e)
 expect(String(error)).toMatch(/已取消/)
 expect(String(error)).not.toMatch(/余额|凭据|OPENROUTER/)
})

const astraCatalog: RoutingCatalog = {models:[{provider:'codex',model:'gpt-6-astra',name:'Astra',reasoningEfforts:['low','medium','high','xhigh']}],childAllowlist:{status:'enabled',allowedModels:[{provider:'codex',model:'gpt-6-astra'}]}}
it('explicit_model_only_routes_effort', async () => {
 const settings: Settings = {...DEFAULT_SETTINGS, childRoutes:{codex:{complex:{model:'gpt-6-astra',reasoningEffort:'high'}}}}
 const {def,server,judged} = await tool(tier('simple'),undefined,undefined,{readSettings:()=>settings,catalog:()=>astraCatalog})
 const efforts: string[] = []
 for (const t of tiers) {
  server.set(tier(t))
  const result = await def.execute({task:'评审 openspec change',provider:'codex',model:'gpt-6-astra'},exec()) as {model:string;reasoning_effort:string}
  expect(result.model).toBe('gpt-6-astra')
  efforts.push(result.reasoning_effort)
 }
 // childRoutes' Astra/high is not used for a caller-chosen model.
 expect(efforts).toEqual(['low','low','medium','high'])
 expect(server.bodies).toHaveLength(4)
 expect(judged.at(-1)).toMatchObject({source:'subagent',model:'gpt-6-astra',effort:'high'})
})
it('explicit_model_unavailable_never_substitutes', async () => {
 let catalog: RoutingCatalog = {...astraCatalog,childAllowlist:{status:'enabled',allowedModels:[]}}
 const {def,state} = await tool(tier('complex'),undefined,undefined,{readSettings:()=>DEFAULT_SETTINGS,catalog:()=>catalog})
 await expect(def.execute({task:'x',provider:'codex',model:'gpt-6-astra'},exec())).rejects.toThrow(/路由设置无效.*暂停委派并询问用户/)
 catalog = astraCatalog
 await expect(def.execute({task:'x',provider:'claude',model:'gpt-6-astra'},exec())).rejects.toThrow(/路由设置无效/)
 await expect(def.execute({task:'x',provider:'claude',model:'claude-unknown'},exec())).rejects.toThrow(/路由设置无效/)
 expect(state.read('S1')).toEqual({mode:'AUTO'})
})
it('explicit_model_manual_skips_jev', async () => {
 const {def,server} = await tool(tier('complex'),{S1:'MANUAL'},undefined,{readSettings:()=>DEFAULT_SETTINGS,catalog:()=>astraCatalog})
 const result = await def.execute({task:'x',provider:'codex',model:'gpt-6-astra'},exec())
 expect(result).toEqual({routed:false,reason:'manual'})
 // The caller's chosen model must survive MANUAL: the hint may not tell the agent to drop it.
 expect(def.output!.render({} as never, result as never)[0]).toMatchObject({ text: expect.stringContaining('只传用户或 lead 指定的值') })
 expect(server.bodies).toHaveLength(0)
})
