import { afterEach, expect, it, vi } from 'vitest'
import { routeSubagentTool, type ToolDeps } from '../src/subagent-tool.js'
import { DEFAULT_SETTINGS as CURRENT_DEFAULTS, type RoutingCatalog } from '../src/settings-contract.js'
import { JevClient } from '../src/jev.js'
import { RoutingState, type SessionState } from '../src/state.js'
import { fakeJev, json, type Reply } from './fake-jev.js'

const env = { get: (name: string) => name === 'OPENROUTER_API_KEY' ? { value: 'sk-or-test' } : undefined }
let close: (() => Promise<void>) | undefined
afterEach(async () => { await close?.(); close = undefined })

interface FakeAgent { id: string; session: { header: { origin?: 'subagent'; parentSession?: string } }; options: { provider: string; model: string; reasoningEffort?: string } }
const opus = { provider: 'claude', model: 'claude-opus-5-5', reasoningEffort: 'medium' }
const session = (id: string, parent?: string, options: FakeAgent['options'] = opus): FakeAgent => ({ id, session: { header: parent ? { origin: 'subagent', parentSession: parent } : {} }, options })
const haiku = { provider: 'claude', model: 'claude-haiku-5-5', name: 'Haiku', reasoningEfforts: ['low', 'medium', 'high', 'xhigh'] }
const haikuCatalog: RoutingCatalog = { models: [haiku], childAllowlist: { status: 'enabled', allowedModels: [haiku] } }
const both = (capability = 'bounded', depth = 'baseline') => json(200, { answers: { capability: { choice: capability }, depth: { choice: depth } } })

async function tool(reply: Reply, modes: Record<string, 'AUTO' | 'MANUAL'> = { S1: 'AUTO' }, live: FakeAgent[] = [session('S1')], options: Partial<Pick<ToolDeps, 'readSettings' | 'catalog'>> = {}) {
 const server = await fakeJev(reply); close = server.close
 const disk = new Map<string, SessionState>()
 const state = new RoutingState({ get: id => disk.get(id), set: (id, v) => { disk.set(id, v) } })
 for (const [id, mode] of Object.entries(modes)) state.setMode(id, mode)
 const agents = new Map(live.map(agent => [agent.id, agent]))
 const def = routeSubagentTool(new JevClient(env, server.base, 300), { readSettings: () => CURRENT_DEFAULTS, catalog: () => haikuCatalog, ...options, agents: { get: (id: string) => agents.get(id) as never }, state })
 return { server, def, state, disk }
}
const exec = (agent: FakeAgent | undefined = session('S1'), signal = new AbortController().signal) => ({ signal, agent }) as never

it('spec Scenario "AUTO 下返回推荐且保留显式维度"', async () => {
 const { def, server } = await tool(both())
 expect(await def.execute({ task: 'synthetic', provider: 'claude' }, exec())).toMatchObject({ status: 'recommended', model: haiku.model, reasoning_effort: 'medium' })
 expect(await def.execute({ task: 'synthetic', provider: 'claude', model: haiku.model, reasoning_effort: 'high' }, exec())).toMatchObject({ status: 'recommended', reasoning_effort: 'high' })
 expect(await def.execute({ task: 'synthetic', provider: 'claude', path: 'fork' }, exec())).toMatchObject({ status: 'unsupported' })
 expect(server.bodies).toHaveLength(1)
})
it('spec Scenario "MANUAL 与不可用路由"', async () => {
 const live = [session('S1'), session('S2')]
 const { def, server, state } = await tool(both(), { S1: 'MANUAL', S2: 'AUTO' }, live, { catalog: () => ({ models: [haiku], childAllowlist: { status: 'enabled', allowedModels: [] } }) })
 const result = await def.execute({ task: 'x', provider: 'codex' }, exec(live[0]))
 expect(result).toEqual({ routed: false, reason: 'manual' })
 expect(server.bodies).toHaveLength(0)
 // The caller's chosen model must survive MANUAL: the hint may not tell the agent to drop it.
 expect(def.output!.render({} as never, result as never)[0]).toMatchObject({ text: expect.stringContaining('只传用户或 lead 指定的值') })
 const s2 = session('S2', undefined, { provider: 'codex', model: 'gpt-6.1-sol', reasoningEffort: 'max' })
 const fallback = await def.execute({ task: 'x', provider: 'codex' }, exec(s2))
 expect(fallback).toEqual({ routed: false, status: 'fallback', reason: 'no-usable-route' })
 expect(fallback).not.toHaveProperty('model')
 expect(state.read('S1')).toEqual({ mode: 'MANUAL' }); expect(state.read('S2')).toEqual({ mode: 'AUTO' })
})
it.each(['dsh-magpie-connect', 'dsh-magpie-connector'] as const)('%s preview uses the exact provider and family model', async provider => {
 const model = { provider, model: 'codex/gpt-6-luna', name: 'Luna', reasoningEfforts: ['low', 'medium', 'high', 'xhigh'] }
 const caller = session('S1', undefined, { provider, model: 'codex/gpt-6.1-sol', reasoningEffort: 'medium' })
 const { def } = await tool(both(), undefined, [caller], { catalog: () => ({ models: [model], childAllowlist: { status: 'enabled', allowedModels: [model] } }) })
 expect(await def.execute({ task: 'synthetic', provider }, exec(caller))).toMatchObject({ provider, model: 'codex/gpt-6-luna', reasoning_effort: 'high', status: 'recommended' })
})
it.each(['dsh-magpie-connect', 'dsh-magpie-connector'] as const)('%s MANUAL root skips routing without reads or writes', async provider => {
 const readSettings = vi.fn(() => CURRENT_DEFAULTS)
 const catalog = vi.fn((): RoutingCatalog => haikuCatalog)
 const { def, server, state, disk } = await tool(both(), { S1: 'MANUAL' }, undefined, { readSettings, catalog })
 const before = structuredClone([...disk])
 const write = vi.spyOn(disk, 'set')
 expect(await def.execute({ task: 'synthetic', provider }, exec())).toEqual({ routed: false, reason: 'manual' })
 expect(server.bodies).toHaveLength(0)
 expect(readSettings).not.toHaveBeenCalled(); expect(catalog).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled()
 expect([...disk]).toEqual(before)
 expect(state.read('S1')).toEqual({ mode: 'MANUAL' })
})
it('nested_child_follows_root_mode', async () => {
 const live = [session('S1'), session('C1', 'S1'), session('C2', 'C1')]
 const { def, server } = await tool(both(), { S1: 'AUTO' }, live)
 expect(await def.execute({ task: 'x', provider: 'claude' }, exec(live[2]))).toMatchObject({ status: 'recommended', model: haiku.model })
 expect(server.bodies).toHaveLength(1)
 expect(await def.execute({ task: 'x', provider: 'claude' }, exec(session('C9', 'gone')))).toEqual({ routed: false, reason: 'manual' })
})
it('tool_failure_reports_without_state_change', async () => {
 const { def, disk } = await tool(json(402, {}))
 const before = structuredClone(disk.get('S1'))
 expect(await def.execute({ task: 'x', provider: 'claude' }, exec())).toEqual({ routed: false, status: 'fallback', reason: 'jev-insufficient-credits' })
 expect(disk.get('S1')).toEqual(before)
 await close?.(); close = undefined
 const controller = new AbortController(); controller.abort()
 const held = await tool(() => {})
 const error = await held.def.execute({ task: 'x', provider: 'claude' }, exec(session('S1'), controller.signal)).catch((e: Error) => e)
 expect(String(error)).toMatch(/取消/)
 expect(String(error)).not.toMatch(/余额|凭据|OPENROUTER/)
})
it('explicit model judges only depth and never substitutes', async () => {
 const astra = { provider: 'codex', model: 'gpt-6-astra', name: 'Astra', reasoningEfforts: ['low', 'medium', 'high', 'xhigh'] }
 let catalog: RoutingCatalog = { models: [astra], childAllowlist: { status: 'enabled', allowedModels: [astra] } }
 const { def, server, state } = await tool(json(200, { answers: { depth: { choice: 'higher' } } }), undefined, undefined, { catalog: () => catalog })
 expect(await def.execute({ task: 'x', provider: 'codex', model: 'gpt-6-astra' }, exec())).toMatchObject({ model: 'gpt-6-astra', reasoning_effort: 'medium' })
 expect((server.bodies[0] as { questions: object }).questions).not.toHaveProperty('capability')
 catalog = { ...catalog, childAllowlist: { status: 'enabled', allowedModels: [] } }
 expect(await def.execute({ task: 'x', provider: 'codex', model: 'gpt-6-astra' }, exec())).toEqual({ routed: false, status: 'fallback', reason: 'explicit-unavailable' })
 expect(state.read('S1')).toEqual({ mode: 'AUTO' })
})
it('description and output carry no version or policy names', async () => {
 const { def } = await tool(both())
 const text = JSON.stringify({ description: def.description, parameters: def.parameters })
 for (const word of ['policy-v2', 'legacy', '原策略', '旧策略', '回滚']) expect(text).not.toContain(word)
 expect(def.description).toMatch(/recommendation only/)
 expect(def.description).toMatch(/fresh creation tool/)
 expect(def.description).toMatch(/decision service/)
})
it('spec Scenario "预览失败与取消的区分"', async () => {
 const { def, disk, server } = await tool(json(200, { answers: { capability: { choice: 'insufficient_context' }, depth: { choice: 'baseline' } } }))
 const before = structuredClone([...disk])
 expect(await def.execute({ task: 'x', provider: 'claude' }, exec())).toMatchObject({ routed: false, status: 'needs-context' })
 server.set(json(402, {}))
 expect(await def.execute({ task: 'x', provider: 'claude' }, exec())).toEqual({ routed: false, status: 'fallback', reason: 'jev-insufficient-credits' })
 const controller = new AbortController(); controller.abort()
 await expect(def.execute({ task: 'x', provider: 'claude' }, exec(session('S1'), controller.signal))).rejects.toThrow(/已取消/)
 expect([...disk]).toEqual(before)
})
it('spec Scenario "未登记的 provider 不被枚举拒绝"', async () => {
 const sol = { provider: 'traex', model: 'GPT-5.6-Sol', name: 'Sol', reasoningEfforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' }
 const caller = session('S1', undefined, { provider: 'traex', model: 'GPT-5.6-Sol', reasoningEffort: 'medium' })
 const { def } = await tool(both('bounded', 'higher'), undefined, [caller], { catalog: () => ({ models: [sol], childAllowlist: { status: 'enabled', allowedModels: [sol] } }) })
 expect(JSON.stringify(def.parameters)).not.toContain('dsh-magpie-connect')
 expect(await def.execute({ task: 'x', provider: 'traex' }, exec(caller))).toMatchObject({ status: 'recommended', provider: 'traex', model: 'GPT-5.6-Sol', reasoning_effort: 'high' })
})
it.each(['dsh-magpie-connect','dsh-magpie-connector'] as const)('spec Scenario "未注册家族的 Magpie 模型需显式模型与可验证 effort" (%s)', async provider => {
 const m={provider,model:'opencode-go/kimi-k3',name:'Kimi',reasoningEfforts:['low','high'],defaultEffort:'high'}
 let catalog:RoutingCatalog={models:[m],childAllowlist:{status:'enabled',allowedModels:[m]}}
 const {def,server}=await tool(json(200,{answers:{depth:{choice:'baseline'}}}),undefined,undefined,{catalog:async()=>catalog})
 expect(await def.execute({task:'t',provider,model:m.model},exec())).toMatchObject({model:m.model,reasoning_effort:'high'})
 const {defaultEffort:_,...noDefault}=m
 catalog={models:[noDefault],childAllowlist:{status:'enabled',allowedModels:[noDefault]}}
 expect(await def.execute({task:'t',provider,model:m.model},exec())).toMatchObject({routed:false,status:'fallback'})
 expect(await def.execute({task:'t',provider,model:m.model,reasoning_effort:'low'},exec())).toMatchObject({model:m.model,reasoning_effort:'low'})
 expect(await def.execute({task:'t',provider,model:'../kimi-k3',reasoning_effort:'low'},exec())).toMatchObject({routed:false,status:'fallback'})
 expect(server.bodies).toHaveLength(2)
})
