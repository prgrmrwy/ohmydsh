import { afterEach, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Agents, { installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import Sessions from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Llm, { LlmAdapter, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import Loop from '@deepseek-ai/dsh-agent-loop'
import * as plugin from '../src/index.js'
import { fakeJev, json, tier, type Reply } from './fake-jev.js'

const SECRET = 'sk-or-test-SECRET'
let cleanup: (() => Promise<void>) | undefined
afterEach(async () => { await cleanup?.(); cleanup = undefined })

async function harness(reply: Reply, options: { reject?: () => boolean } = {}) {
 const home = mkdtempSync(join(tmpdir(), 'router-host-'))
 const jev = await fakeJev(reply)
 const ctx = new Context()
 const calls: GenerateOptions[] = []
 const routes = new Map<string, { fetch: (r: Request) => Promise<Response> }>()
 let agent: Awaited<ReturnType<typeof ctx.agents.create>>['agent'] | undefined
 class Adapter extends LlmAdapter {
  async resolveModel(provider: string, model: string) { return { provider, id: model, name: model, reasoning: { efforts: ['low', 'medium', 'xhigh', 'max'].map(id => ({ id: ReasoningEffortId(id), name: id })) } } }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> { calls.push(options); yield { type: 'finish', reason: { kind: 'stop' } } }
 }
 ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: { OPENROUTER_API_KEY: SECRET } }]) as never)
 const forks: { dispose(): unknown }[] = []
 for (const p of [Projections, Sessions, Agents, Prompt, Tools, Llm]) forks.push(await ctx.plugin(p))
 forks.push(await ctx.plugin(Loop, { agents: [] }))
 ctx.llm.registerAdapter(['test'], new Adapter())
 ctx.provide('connection', { fetch: { register(route: { path: string; fetch: (r: Request) => Promise<Response> }) { routes.set(route.path, route); return async () => { routes.delete(route.path) } } } } as never)
 ctx.provide('sessionController', { resolveAgent: async (id: string) => agent?.id === id ? { agent } : { error: new Error('unknown') } } as never)
 forks.push(await ctx.plugin(plugin, { home, jevBase: jev.base, jevTimeoutMs: 300 }))
 await expect.poll(() => routes.size).toBe(2)
 const selection: ModelSelectionRef = { current: { provider: 'test', model: 'claude-opus-5-5', reasoningEffort: ReasoningEffortId('medium') }, assembled: undefined }
 const handle = await ctx.agents.create({
  sessionId: SessionId(`host-${Math.random()}`), agentOptions: { provider: 'test', model: 'claude-opus-5-5' },
  setup(c) {
   installModelSelection(c, selection)
   if (options.reject) c.on('agent/pre-step', async (_p, next) => options.reject!() ? { kind: 'reject' } : next())
  },
 })
 agent = handle.agent
 const invoke = async (op: string, body: unknown) => (await routes.get(`/api/auto-model-routing.${op}`)!.fetch(new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(body) }))).json()
 const run = async (text: string) => { agent!.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })); await agent!.whenIdle() }
 cleanup = async () => { await handle.dispose(); for (const f of forks.reverse()) await f.dispose(); await jev.close() }
 return { ctx, jev, calls, agent, selection, invoke, run, home, setMode: (mode: string) => invoke('setMode', { sessionId: agent!.id, mode }) }
}

it('host_routes_and_rpc_envelope', async () => {
 const h = await harness(tier('simple'))
 const rpc = await h.invoke('state', { type: 'client-request', rpcId: 'probe-1', method: 'auto-model-routing.state', payload: { sessionId: h.agent.id } })
 expect(rpc).toMatchObject({ type: 'server-response', rpcId: 'probe-1', result: { ok: true } })
})

it('jev_tier_drives_effort', async () => {
 const h = await harness(tier('complex'))
 await h.setMode('AUTO')
 await h.run('排查多个模块')
 expect(h.calls.at(-1)).toMatchObject({ model: 'claude-opus-5-5', reasoningEffort: 'xhigh' })
 expect(h.jev.bodies).toHaveLength(1)
 expect(await h.invoke('state', { sessionId: h.agent.id })).toMatchObject({ mode: 'AUTO', reason: 'jev', effort: 'xhigh' })
})

it('rejected_step_skips_jev', async () => {
 let reject = true
 const h = await harness(tier('complex'), { reject: () => reject })
 await h.setMode('AUTO')
 await h.run('排查多个模块')
 expect(h.jev.bodies).toHaveLength(0)
 reject = false
 await h.run('排查多个模块')
 expect(h.jev.bodies).toHaveLength(1)
 expect(h.calls.at(-1)?.reasoningEffort).toBe('xhigh')
})

it('mode_change_during_jev_discards_result', async () => {
 for (const answer of [tier('complex'), json(402, {})]) {
  let release!: () => void
  const gate = new Promise<void>(done => { release = done })
  const h = await harness((req, res, body) => { void gate.then(() => answer(req, res, body)) })
  await h.setMode('AUTO')
  const running = h.run('排查多个模块')
  await expect.poll(() => h.jev.bodies.length).toBe(1)
  await h.setMode('MANUAL')
  release()
  await running
  expect(h.calls.at(-1)?.reasoningEffort).toBe('medium')
  const state = await h.invoke('state', { sessionId: h.agent.id })
  expect(state.mode).toBe('MANUAL')
  expect(state.disabled).toBeUndefined()
  await cleanup?.(); cleanup = undefined
 }
})

it('failure_disables_and_restores', async () => {
 const h = await harness(tier('complex'))
 await h.setMode('AUTO')
 await h.run('排查多个模块')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('xhigh')
 h.jev.set(json(402, {}))
 await h.run('下一个任务')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('medium')
 const state = await h.invoke('state', { sessionId: h.agent.id })
 expect(state).toMatchObject({ mode: 'MANUAL', disabled: { category: 'insufficient-credits' } })
 expect(state.history.slice(-2)).toEqual([{ reason: 'jev-failed', category: 'insufficient-credits' }, { effort: 'medium', reason: 'manual-restore' }])
 const sent = h.jev.bodies.length
 await h.run('再下一个')
 expect(h.jev.bodies.length).toBe(sent)
 expect(h.calls.at(-1)?.reasoningEffort).toBe('medium')
 expect((await h.invoke('state', { sessionId: h.agent.id })).disabled?.category).toBe('insufficient-credits')
})

it('auto_clears_disabled', async () => {
 const h = await harness(json(504, {}))
 await h.setMode('AUTO')
 await h.run('任务')
 expect((await h.invoke('state', { sessionId: h.agent.id })).disabled?.category).toBe('unavailable')
 await h.run('完成复原')
 h.jev.set(tier('simple'))
 await h.setMode('AUTO')
 expect((await h.invoke('state', { sessionId: h.agent.id })).disabled).toBeUndefined()
 await h.run('小改动')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('low')
})

it('cancel_is_not_failure', async () => {
 const h = await harness(() => { /* hold */ })
 await h.setMode('AUTO')
 const running = h.run('排查多个模块')
 await expect.poll(() => h.jev.bodies.length).toBe(1)
 h.agent.cancel({ kind: 'user' })
 await running
 const state = await h.invoke('state', { sessionId: h.agent.id })
 expect(state.mode).toBe('AUTO')
 expect(state.disabled).toBeUndefined()
 h.jev.set(tier('standard'))
 await h.run('再试')
 expect(h.jev.bodies).toHaveLength(2)
})

it('no_secret_or_body_leak', async () => {
 const h = await harness(json(401, { error: { message: 'SECRET-BODY' } }))
 await h.setMode('AUTO')
 await h.run('任务')
 const text = JSON.stringify(await h.invoke('state', { sessionId: h.agent.id }))
 const dir = join(h.home, 'state/auto-model-routing/sessions')
 const disk = readdirSync(dir).map(f => readFileSync(join(dir, f), 'utf8')).join('\n')
 for (const blob of [text, disk]) { expect(blob).not.toContain(SECRET); expect(blob).not.toContain('SECRET-BODY') }
 expect(text).toContain('unauthorized')
})
