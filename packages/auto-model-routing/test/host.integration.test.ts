import { afterEach, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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

async function harness(reply: Reply, options: { reject?: () => boolean; selectFails?: boolean; answer?: () => string } = {}) {
 const selections: unknown[] = []
 const home = mkdtempSync(join(tmpdir(), 'router-host-'))
 const jev = await fakeJev(reply)
 const ctx = new Context()
 const calls: GenerateOptions[] = []
 const routes = new Map<string, { fetch: (r: Request) => Promise<Response> }>()
 let agent: Awaited<ReturnType<typeof ctx.agents.create>>['agent'] | undefined
 class Adapter extends LlmAdapter {
  async resolveModel(provider: string, model: string) { return { provider, id: model, name: model, reasoning: { efforts: ['low', 'medium', 'high', 'xhigh', 'max'].map(id => ({ id: ReasoningEffortId(id), name: id })) } } }
  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
   calls.push(request)
   const text = options.answer?.()
   if (text) {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
   }
   yield { type: 'finish', reason: { kind: 'stop' } }
  }
 }
 ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: { OPENROUTER_API_KEY: SECRET } }]) as never)
 const forks: { dispose(): unknown }[] = []
 for (const p of [Projections, Sessions, Agents, Prompt, Tools, Llm]) forks.push(await ctx.plugin(p))
 forks.push(await ctx.plugin(Loop, { agents: [] }))
 ctx.llm.registerAdapter(['test'], new Adapter())
 ctx.provide('connection', { fetch: { register(route: { path: string; fetch: (r: Request) => Promise<Response> }) { routes.set(route.path, route); return async () => { routes.delete(route.path) } } } } as never)
 ctx.provide('sessionController', {
  resolveAgent: async (id: string) => agent?.id === id ? { agent } : { error: new Error('unknown') },
  selectModel: async (request: unknown) => { selections.push(request); if (options.selectFails) throw new Error('model unavailable'); return { selected: request } },
 } as never)
 let routing = await ctx.plugin(plugin, { home, jevBase: jev.base, jevTimeoutMs: 300 })
 await expect.poll(() => routes.size).toBe(3)
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
 cleanup = async () => { await handle.dispose(); await routing.dispose(); for (const f of forks.reverse()) await f.dispose(); await jev.close() }
 // Simulate a Host restart for this plugin: all its memory is dropped, only the state directory remains.
 const restart = async () => { await routing.dispose(); routing = await ctx.plugin(plugin, { home, jevBase: jev.base, jevTimeoutMs: 300 }); await expect.poll(() => routes.size).toBe(3) }
 const toast = (on: boolean) => { const dir = join(home, 'plugins/dsh-auto-model-routing'); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'config.json'), JSON.stringify({ decisionToast: on })) }
 return { ctx, jev, calls, agent, selection, invoke, routes, run, home, toast, selections, restart, setMode: (mode: string) => invoke('setMode', { sessionId: agent!.id, mode }) }
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
 expect(h.calls.at(-1)).toMatchObject({ model: 'claude-opus-5-5', reasoningEffort: 'high' })
 expect(h.jev.bodies).toHaveLength(1)
 expect(await h.invoke('state', { sessionId: h.agent.id })).toMatchObject({ mode: 'AUTO', reason: 'jev', effort: 'high' })
})

it('state_carries_previous_turn', async () => {
 const replies = ['我先看了登录代码。要我开始实施吗？', '好的']
 const h = await harness(tier('standard'), { answer: () => replies.shift() ?? '' })
 await h.setMode('AUTO')
 await h.run('修一下登录')
 const first = h.jev.bodies[0] as { state: string }
 expect(first.state).toBe('Previous user-turn tier: none\nUser message:\n修一下登录')
 await h.run('继续')
 const body = h.jev.bodies[1] as { model: string; state: string }
 expect(Object.keys(body).sort()).toEqual(['model', 'questions', 'state'])
 expect(body.model).toBe('typesafe/jev-1.13')
 const lines = body.state.split('\n')
 expect(lines[0]).toBe('Previous user-turn tier: standard (one tier above: complex)')
 const at = (needle: string) => body.state.indexOf(needle)
 expect(at('修一下登录')).toBeGreaterThan(0)
 expect(at('要我开始实施吗？')).toBeGreaterThan(at('修一下登录'))
 expect(body.state.endsWith('New user message:\n继续')).toBe(true)
 expect(body.state).not.toContain(h.agent.id)
 expect(h.jev.headers[1]!.authorization).toBe(`Bearer ${SECRET}`)
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
 expect(h.calls.at(-1)?.reasoningEffort).toBe('high')
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

it('failure_disables_without_rewrite', async () => {
 const h = await harness(tier('complex'))
 await h.setMode('AUTO')
 await h.run('排查多个模块')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('high')
 h.jev.set(json(402, {}))
 await h.run('下一个任务')
 // No rewrite after the failure: the request carries whatever the official selection assembled.
 expect(h.calls.at(-1)?.reasoningEffort).toBe('medium')
 const state = await h.invoke('state', { sessionId: h.agent.id })
 expect(state).toMatchObject({ mode: 'MANUAL', disabled: { category: 'insufficient-credits' } })
 expect(state).not.toHaveProperty('restore')
 expect(state.history.at(-1)).toEqual({ reason: 'jev-failed', category: 'insufficient-credits' })
 expect(state.history.map((row: { reason: string }) => row.reason)).not.toContain('manual-restore')
 const sent = h.jev.bodies.length
 await h.run('再下一个')
 expect(h.jev.bodies.length).toBe(sent)
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

it('main_and_tool_share_questions', async () => {
 const h = await harness(tier('standard'))
 await h.setMode('AUTO')
 await h.run('修复分页')
 const def = h.ctx.tools.get('route_subagent')
 expect(def).toBeTruthy()
 await def!.execute({ task: '给子会话的任务', provider: 'claude' }, { signal: new AbortController().signal, agent: h.agent } as never)
 const [main, child] = h.jev.bodies as { model: string; questions: unknown; state: string }[]
 expect(child!.model).toBe(main!.model)
 expect(child!.questions).toEqual(main!.questions)
 expect(child!.state).not.toBe(main!.state)
})

it('main_decision_toast', async () => {
 const h = await harness(tier('complex', 0.92, { simple: 0.01, standard: 0.04, complex: 0.92, escalated: 0.03 }))
 h.toast(true)
 await h.setMode('AUTO')
 await h.run('排查多个模块')
 const state = await h.invoke('state', { sessionId: h.agent.id })
 expect(state.decision).toEqual({ id: expect.any(Number), source: 'main', tier: 'complex', effort: 'high', confidence: 0.92, probabilities: { simple: 0.01, standard: 0.04, complex: 0.92, escalated: 0.03 }, ms: expect.any(Number) })
 const first = state.decision.id
 await h.run('继续排查')
 expect((await h.invoke('state', { sessionId: h.agent.id })).decision.id).toBeGreaterThan(first)
})

it('subagent_decision_toast', async () => {
 const h = await harness(tier('complex', 0.8))
 h.toast(true)
 // MANUAL: the tool does not judge, so no hint appears.
 const manual = await h.ctx.tools.get('route_subagent')!.execute({ task: '给子会话的任务', provider: 'claude' }, { signal: new AbortController().signal, agent: h.agent } as never)
 expect(manual).toEqual({ routed: false, reason: 'manual' })
 expect((await h.invoke('state', { sessionId: h.agent.id })).decision).toBeUndefined()
 await h.setMode('AUTO')
 const def = h.ctx.tools.get('route_subagent')!
 await def.execute({ task: '给子会话的任务', provider: 'claude' }, { signal: new AbortController().signal, agent: h.agent } as never)
 const state = await h.invoke('state', { sessionId: h.agent.id })
 expect(state.mode).toBe('AUTO')
 expect(state.decision).toEqual({ id: expect.any(Number), source: 'subagent', tier: 'complex', model: 'claude-opus-5-5', effort: 'high', confidence: 0.8, ms: expect.any(Number) })
})

it('toast_switch_default_on_only_false_is_off', async () => {
 const h = await harness(tier('complex', 0.9))
 await h.setMode('AUTO')
 await h.run('排查多个模块')
 // Missing file: on by default.
 expect(await h.invoke('state', { sessionId: h.agent.id })).toMatchObject({ decisionToast: true, decision: { source: 'main', confidence: 0.9 } })
 const dir = join(h.home, 'plugins/dsh-auto-model-routing'); mkdirSync(dir, { recursive: true })
 for (const body of ['{not json', JSON.stringify({ decisionToast: 'no' }), JSON.stringify(null), '{}']) {
  writeFileSync(join(dir, 'config.json'), body)
  expect((await h.invoke('state', { sessionId: h.agent.id })).decisionToast).toBe(true)
 }
 h.toast(false)
 expect(await h.invoke('state', { sessionId: h.agent.id })).not.toHaveProperty('decisionToast')
})

it('toast_off_or_failure_silent', async () => {
 const h = await harness(tier('complex', 0.9))
 await h.setMode('AUTO')
 await h.run('排查多个模块')
 // Switch off: the latest decision is still returned (for the hover panel) but no hint is requested.
 h.toast(false)
 const off = await h.invoke('state', { sessionId: h.agent.id })
 expect(off.decision).toMatchObject({ source: 'main', tier: 'complex' })
 expect(off).not.toHaveProperty('decisionToast')
 h.toast(true)
 expect((await h.invoke('state', { sessionId: h.agent.id })).decisionToast).toBe(true)
 const before = (await h.invoke('state', { sessionId: h.agent.id })).decision.id
 h.jev.set(json(402, {}))
 await h.run('下一个任务')
 expect((await h.invoke('state', { sessionId: h.agent.id })).decision.id).toBe(before)
})

it('auto_syncs_official_selection', async () => {
 const h = await harness(tier('complex'))
 await h.setMode('AUTO')
 await h.run('排查多个模块')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('high')
 expect(h.selections).toEqual([{ sessionId: h.agent.id, provider: 'test', model: 'claude-opus-5-5', reasoningEffort: 'high' }])
 // The same value is not pushed again; the official selection now carries it.
 h.selection.current = { provider: 'test', model: 'claude-opus-5-5', reasoningEffort: ReasoningEffortId('high') }
 await h.run('继续排查')
 expect(h.selections).toHaveLength(1)
 // MANUAL never writes the selection.
 await h.setMode('MANUAL'); await h.run('再继续')
 expect(h.selections).toHaveLength(1)
})

it('selection_sync_failure_does_not_block_request', async () => {
 const h = await harness(tier('complex'), { selectFails: true })
 await h.setMode('AUTO')
 await h.run('排查多个模块')
 expect(h.selections).toHaveLength(1)
 expect(h.calls.at(-1)?.reasoningEffort).toBe('high')
 expect((await h.invoke('state', { sessionId: h.agent.id })).mode).toBe('AUTO')
})

it('previous_tier_survives_restart', async () => {
 const h = await harness(tier('complex'))
 await h.setMode('AUTO')
 await h.run('排查多个模块')
 await h.restart()
 h.jev.set(tier('complex'))
 await h.run('继续')
 const sent = h.jev.bodies.at(-1) as { state: string }
 expect(sent.state.split('\n')[0]).toBe('Previous user-turn tier: complex (one tier above: escalated)')
 const dir = join(h.home, 'state/auto-model-routing/sessions')
 const disk = readdirSync(dir).map(f => readFileSync(join(dir, f), 'utf8')).join('\n')
 expect(disk).toContain('"previous":"complex"')
 expect(disk).not.toContain('排查')
})

const judgementLines = (home: string) => {
 try { return readFileSync(join(home, 'state/auto-model-routing/judgements.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) } catch { return [] }
}
const lastAssistantId = (h: { agent: { session: { deriveMessages(): readonly { role: string; id: string }[] } } }) => h.agent.session.deriveMessages().findLast(m => m.role === 'assistant')!.id

it('judgement_line_appended_without_text', async () => {
 const h = await harness(tier('complex'), { answer: () => '回复' })
 await h.setMode('AUTO')
 await h.run('修复 SECRET-TEXT 相关问题')
 await h.run('排查多个模块')
 const lines = judgementLines(h.home)
 expect(lines).toHaveLength(2)
 const { rubricVersion } = await import('../src/jev.js')
 expect(lines[0]).toEqual({ sessionId: h.agent.id, turn: 1, tier: 'complex', effort: 'high', model: 'claude-opus-5-5', rubricVersion })
 expect(lines[1]).toMatchObject({ turn: 2 })
 expect(readFileSync(join(h.home, 'state/auto-model-routing/judgements.jsonl'), 'utf8')).not.toContain('SECRET-TEXT')
})

it('no_judgement_line_for_failure_cancel_child_continued', async () => {
 const h = await harness(json(402, {}))
 await h.setMode('AUTO')
 await h.run('任务')
 // Cancel.
 h.jev.set(() => { /* hold */ })
 await h.setMode('AUTO')
 const running = h.run('排查多个模块')
 await expect.poll(() => h.jev.bodies.length).toBe(2)
 h.agent.cancel({ kind: 'user' })
 await running
 // Discarded: mode switched while judging.
 let release!: () => void
 const gate = new Promise<void>(done => { release = done })
 h.jev.set((req, res, body) => { void gate.then(() => tier('complex')(req, res, body)) })
 const discarded = h.run('再试')
 await expect.poll(() => h.jev.bodies.length).toBe(3)
 await h.setMode('MANUAL'); release(); await discarded
 // A successful route_subagent does not write a judgement line.
 h.jev.set(tier('complex'))
 await h.setMode('AUTO')
 await h.ctx.tools.get('route_subagent')!.execute({ task: 'x', provider: 'claude' }, { signal: new AbortController().signal, agent: h.agent } as never)
 expect(judgementLines(h.home)).toEqual([])
 // A continued (non-user) turn after a judged turn adds nothing beyond the judged turn's line.
 await h.run('排查多个模块')
 h.agent.followup(createUserMessage({ content: [{ type: 'text', text: '子会话完成' }], source: { kind: 'plugin' } as never })); await h.agent.whenIdle()
 expect(judgementLines(h.home)).toHaveLength(1)
})

it('judgement_write_failure_is_harmless', async () => {
 const h = await harness(tier('standard'))
 // A directory where the file should be makes every append fail.
 mkdirSync(join(h.home, 'state/auto-model-routing/judgements.jsonl'), { recursive: true })
 await h.setMode('AUTO')
 await h.run('修复分页')
 expect(h.calls.at(-1)?.reasoningEffort).toBe('medium')
 const state = await h.invoke('state', { sessionId: h.agent.id })
 expect(state.mode).toBe('AUTO')
 expect(state.disabled).toBeUndefined()
})

it('label_query_and_append_by_message', async () => {
 const h = await harness(tier('complex'), { answer: () => '回复' })
 const label = (messageId: unknown, value?: string) => h.invoke('label', { sessionId: h.agent.id, messageId, ...(value ? { label: value } : {}) })
 await h.setMode('AUTO')
 await h.run('排查多个模块')
 const m1 = lastAssistantId(h)
 // A continued turn's reply maps to the latest user turn.
 h.agent.followup(createUserMessage({ content: [{ type: 'text', text: '子会话完成' }], source: { kind: 'plugin' } as never })); await h.agent.whenIdle()
 const m3 = lastAssistantId(h)
 expect(m3).not.toBe(m1)
 expect(await label(m1)).toEqual({ tier: 'complex', effort: 'high' })
 expect(await label(m3, 'standard')).toEqual({ tier: 'complex', effort: 'high', label: 'standard' })
 expect(judgementLines(h.home).at(-1)).toEqual({ sessionId: h.agent.id, turn: 1, label: 'standard' })
 expect(await label(m1)).toEqual({ tier: 'complex', effort: 'high', label: 'standard' })
 // A MANUAL user turn has no judgement: its continued turn's reply maps to nothing.
 await h.setMode('MANUAL')
 await h.run('手动回合')
 h.agent.followup(createUserMessage({ content: [{ type: 'text', text: '子会话完成' }], source: { kind: 'plugin' } as never })); await h.agent.whenIdle()
 expect(await label(lastAssistantId(h))).toEqual({})
})

it('label_append_failure_returns_5xx', async () => {
 const h = await harness(tier('complex'), { answer: () => '回复' })
 await h.setMode('AUTO')
 await h.run('排查多个模块')
 const file = join(h.home, 'state/auto-model-routing/judgements.jsonl')
 const { rmSync } = await import('node:fs')
 rmSync(file); mkdirSync(file)
 const response = await h.routes.get('/api/auto-model-routing.label')!.fetch(new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ sessionId: h.agent.id, messageId: lastAssistantId(h), label: 'simple' }) }))
 expect(response.status).toBeGreaterThanOrEqual(500)
 expect(await response.json()).not.toHaveProperty('label')
 expect((await h.invoke('state', { sessionId: h.agent.id })).mode).toBe('AUTO')
})
