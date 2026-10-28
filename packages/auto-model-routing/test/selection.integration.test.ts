import { afterEach, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { Context } from '@deepseek-ai/cordis'
import Agents, { installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import Sessions from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Llm, { LlmAdapter, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import Loop from '@deepseek-ai/dsh-agent-loop'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as plugin from '../src/index.js'
import { fakeJev, json } from './fake-jev.js'

const stops: (() => Promise<void>)[] = []
afterEach(async () => { while (stops.length) await stops.pop()!() })

// Real plugin + real AgentLoop. `current` mirrors the live session controller's selectionFor():
// with no pending pick it falls back to the last persisted request header.
async function harness() {
 const ctx = new Context()
 const jev = await fakeJev(json(200, { answers: { depth: { choice: 'higher' } } }))
 ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: { OPENROUTER_API_KEY: 'sk-or-test' } }]) as never)
 for (const p of [Projections, Sessions, Agents, Prompt, Tools, Llm]) await ctx.plugin(p)
 await ctx.plugin(Loop, { agents: [] })
 const calls: GenerateOptions[] = []
 class Adapter extends LlmAdapter {
  async resolveModel(provider: string, model: string) { return { provider, id: model, name: model, reasoning: { efforts: ['low', 'medium', 'high', 'xhigh', 'max'].map(id => ({ id: ReasoningEffortId(id), name: id })) } } }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> { calls.push(options); yield { type: 'finish', reason: { kind: 'stop' } } }
 }
 ctx.llm.registerAdapter(['test'], new Adapter())
 const routes = new Map<string, { fetch: (r: Request) => Promise<Response> }>()
 let picked: ModelSelectionRef['current'] = { provider: 'test', model: 'claude-opus-5-5', reasoningEffort: ReasoningEffortId('medium') }
 let current: unknown
 ctx.provide('connection', { fetch: { register(route: { path: string; fetch: (r: Request) => Promise<Response> }) { routes.set(route.path, route); return async () => { routes.delete(route.path) } } } } as never)
 // Like the official controller: selectModel replaces the pending pick used by the next assembly.
 ctx.provide('sessionController', {
  resolveAgent: async () => ({ agent: current }),
  selectModel: async (request: { provider: string; model: string; reasoningEffort?: string }) => {
   selections.push(request)
   picked = { provider: request.provider, model: request.model, ...(request.reasoningEffort ? { reasoningEffort: ReasoningEffortId(request.reasoningEffort) } : {}) }
   return { selected: picked }
  },
 } as never)
 const home = mkdtempSync(`${tmpdir()}/router-sel-`)
 mkdirSync(`${home}/plugins/dsh-auto-model-routing`,{recursive:true})
 writeFileSync(`${home}/plugins/dsh-auto-model-routing/config.json`,'{}')
 const selections: unknown[] = []
 const fork = await ctx.plugin(plugin, { home, jevBase: jev.base })
 let agentRef: { session: { requestHeader(): { config: { provider: string; model: string; reasoningEffort?: string } } | undefined } } | undefined
 const selection: ModelSelectionRef = {
  get current() {
   if (picked) return picked
   const logged = agentRef?.session.requestHeader()?.config
   return logged && { provider: logged.provider, model: logged.model, ...(logged.reasoningEffort ? { reasoningEffort: ReasoningEffortId(logged.reasoningEffort) } : {}) }
  },
  set current(next) { picked = next },
  assembled: undefined,
 }
 const handle = await ctx.agents.create({ sessionId: SessionId(`route-${Math.random()}`), agentOptions: { provider: 'test', model: 'claude-opus-5-5' }, setup(agentCtx) { installModelSelection(agentCtx, selection) } })
 const agent = handle.agent
 agentRef = agent as never
 current = agent
 stops.push(async () => { await handle.dispose(); await fork.dispose(); await jev.close() })
 const call = async (op: string, body: unknown) => (await routes.get(`/api/auto-model-routing.${op}`)!.fetch(new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) }))).json()
 const run = async (text: string) => { agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })); await agent.whenIdle() }
 return { calls, run, jev, selections, sessionId: agent.id, setMode: (mode: 'AUTO' | 'MANUAL') => call('setMode', { sessionId: agent.id, mode }), consumePick: () => { picked = undefined }, pick: (effort: string) => { picked = { provider: 'test', model: 'claude-opus-5-5', reasoningEffort: ReasoningEffortId(effort) } } }
}

it('spec Scenario "AUTO 结果同步到官方选择"', async () => {
 const h = await harness()
 await h.setMode('AUTO')
 await h.run('排查多个模块')
 await h.run('继续排查')
 expect(h.calls.slice(-2).map(c => c.reasoningEffort)).toEqual(['high', 'high'])
 expect(h.selections).toEqual([{ sessionId: h.sessionId, provider: 'test', model: 'claude-opus-5-5', reasoningEffort: 'high' }])
})
it('spec Scenario "切回 MANUAL 不复原"', async () => {
 const h = await harness()
 await h.run('普通问题')
 h.consumePick() // the pick was used by the first request, as the controller's consume() does
 await h.setMode('AUTO')
 await h.run('排查多个模块')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('high')
 await h.setMode('MANUAL')
 await h.run('继续')
 await h.run('再继续')
 // No restore: the official selection keeps high and MANUAL passes it through.
 expect(h.calls.slice(-2).map(c => c.reasoningEffort)).toEqual(['high', 'high'])
 expect(h.jev.bodies).toHaveLength(1)
})
it('spec Scenario "AUTO 判档覆盖待生效手选"', async () => {
 const h = await harness()
 await h.setMode('AUTO')
 await h.run('排查多个模块')
 // A pick made during AUTO is replaced by the next AUTO decision (synced to the official selection).
 h.pick('medium')
 await h.run('排查多个模块')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('high')
 expect(h.selections.at(-1)).toMatchObject({ reasoningEffort: 'high' })
 await h.setMode('MANUAL')
 await h.run('继续')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('high')
})
