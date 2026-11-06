/** Real AgentLoop Host harness for child routing (test-only; shared by policy-host and preset tests). */
import { expect, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Agents from '@deepseek-ai/dsh-agent'
import Loop from '@deepseek-ai/dsh-agent-loop'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import Llm, { LlmAdapter, ReasoningEffortId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import * as Plugin from '../src/index.js'
import { fakeJev, json } from './fake-jev.js'
import { PolicyStore } from '../src/policy-store.js'
import { BUILTIN_STRATEGIES, createRegistry, type FamilyStrategy } from '../src/strategies/index.js'
// Test the installed SDK's real fold, not a local reimplementation of picker semantics.
const controllerEntry = pathToFileURL(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-api-session-controller'))
const { installModelSelectionProjection } = await import(new URL('./types/model-selection-projection.js', controllerEntry).href)
const { SessionCommandController } = await import(new URL('./types/commands.js', controllerEntry).href)
const { ApiSessionAgentController } = await import(new URL('./types/agent.js', controllerEntry).href)
let close: (() => Promise<void>) | undefined
/** Disposes the harness created last; call from `afterEach`. */
export async function closePolicyHarness() { await close?.(); close = undefined }
export async function harness(magpie: false | 'dsh-magpie-connect' | 'dsh-magpie-connector' = false, pendingPick = false, family: 'claude' | 'codex' | 'deepseek' = 'claude', selectFails: boolean | 'missing' = false, main: { provider?: string; model?: string; efforts?: string[]; defaultEffort?: string } = {}, strategies?: readonly FamilyStrategy[], extra: { gatedCredentials?: boolean } = {}) {
  const provider = magpie || (family === 'deepseek' ? 'opencode-go' : family)
  const modelId = (id: string) => magpie ? `${family}/${id}` : id
  const modelIds = family === 'claude' ? ['claude-opus-5-5','claude-haiku-5-5','claude-sonnet-5-5'] : family === 'deepseek' ? ['deepseek-v5'] : ['gpt-6.1-sol','gpt-6-luna']
  const mainProvider = main.provider ?? provider
  const mainModel = main.model ?? modelId(modelIds[0]!)
  /** Only an explicit override changes metadata; plain harness use keeps the original fixtures. */
  const overridden = main.provider !== undefined || main.efforts !== undefined || main.defaultEffort !== undefined
  const overrideEfforts = () => main.efforts ?? ['low','medium','high','xhigh']
  const home = mkdtempSync(join(tmpdir(), 'policy-host-'))
  const config = join(home, 'plugins/dsh-auto-model-routing/config.json')
  mkdirSync(join(home, 'plugins/dsh-auto-model-routing'), { recursive: true })
  const configure = (value: Record<string, unknown> = {}) => writeFileSync(config, JSON.stringify(value))
  configure()
  const jev = await fakeJev(json(200, { answers: { capability: { choice: 'bounded' }, depth: { choice: 'baseline' } } }))
  const ctx = new Context(), forks: { dispose(): unknown }[] = [], handles: Awaited<ReturnType<typeof ctx.agents.create>>[] = []
  const calls: GenerateOptions[] = [], timeline: string[] = []
  let answer: string | undefined
  class Adapter extends LlmAdapter {
    private described(provider: string) { return overridden && provider === mainProvider }
    async listModels(provider: string) { return (this.described(provider) ? [mainModel] : modelIds.map(modelId)).map(id => ({ provider, id, name: id })) }
    async resolveModel(provider: string, id: string) {
      const override = this.described(provider)
      const efforts = override ? overrideEfforts() : ['low','medium','high','xhigh']
      return { provider, id, name: id, reasoning: {
        efforts: efforts.map(effort => ({ id: ReasoningEffortId(effort), name: effort })),
        ...(override && main.defaultEffort ? { defaultEffort: ReasoningEffortId(main.defaultEffort) } : {}),
      } }
    }
    async *stream(r: GenerateOptions): AsyncIterable<StreamChunk> {
      calls.push(r); timeline.push('adapter')
      if (answer) { yield { type: 'block-start', index: 0, blockType: 'text' }; yield { type: 'text-delta', index: 0, text: answer }; yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  for (const p of [Projections,Sessions,Agents,Prompt,Tools,Llm]) forks.push(await ctx.plugin(p))
  installModelSelectionProjection(ctx)
  forks.push(await ctx.plugin(Loop,{ agents: [] }))
  for (const transport of new Set([provider, mainProvider])) ctx.llm.registerAdapter([transport], new Adapter())
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: { OPENROUTER_API_KEY: 'synthetic-key' } }]) as never)
  // Optional test seam: credential resolution can be held to observe settings changes mid-judgement.
  let credentialGate: Promise<void> | undefined
  if (extra.gatedCredentials) ctx.provide('credentials', {
    describe: async () => ({ configured: true, source: 'file', writable: true }),
    resolve: async () => { if (credentialGate) { reachedGate?.(); reachedGate = undefined } await credentialGate; return { value: 'synthetic-key', source: 'file' } },
    set: async () => {}, unset: async () => {},
  } as never)
  let reachedGate: (() => void) | undefined
  /** Holds credential resolution; `reached` resolves once a judgement is waiting on it. */
  const holdCredentials = () => { let release!: () => void; const reached = new Promise<void>(done => { reachedGate = done }); credentialGate = new Promise<void>(done => { release = () => { credentialGate = undefined; done() } }); return Object.assign(() => release(), { reached }) }
  ctx.provide('subagentModelSelection' as never, { current: () => ({ enabled: true, allowedModels: modelIds.map(model => ({ provider, model: modelId(model) })) }) } as never)
  const selections: unknown[] = [], defaults: unknown[] = []
  // A metadata override describes a model whose effort set may not contain the fixture default.
  const keepEffort = main.provider === undefined && main.efforts === undefined && main.defaultEffort === undefined
  const picked = main.provider
    ? { provider: mainProvider, model: mainModel }
    : { provider, model: modelId(modelIds[0]!), ...(keepEffort ? { reasoningEffort: ReasoningEffortId('medium') } : {}) }
  ctx.provide('agentDefaultModel' as never, {
    currentSelection: () => defaults.at(-1) ?? picked,
    saveSelection: async (selection: unknown) => { defaults.push(selection); timeline.push('defaults') },
  } as never)
  // Real official selection/cache/consume methods; only live-agent lookup and defaults storage are inert ports.
  const owner = Object.assign(Object.create(ApiSessionAgentController.prototype), {
    ctx, selections: new WeakMap(), imageAdmissionChains: new WeakMap(),
    resolveAgent: async (id: string) => ({ agent: ctx.agents.get(SessionId(id))! }),
  })
  const commands = new SessionCommandController(ctx, owner, home)
  const warnings = vi.spyOn(ctx.logger, 'warn')
  if (selectFails !== 'missing') ctx.provide('sessionController', {
    resolveAgent: async (id: string) => { const agent = ctx.agents.get(SessionId(id)); return agent ? { agent } : { error: new Error('unknown session') } },
    selectModel: async (request: unknown) => {
      selections.push(request)
      if (selectFails) throw new Error('synthetic selection rejection')
      const result = await commands.selectModel(request)
      timeline.push('selected')
      return result
    },
  } as never)
  const routes = new Map<string, { fetch: (request: Request) => Promise<Response> }>()
  ctx.provide('connection', { fetch: { register(route: { path: string; fetch: (request: Request) => Promise<Response> }) { routes.set(route.path, route); return async () => { routes.delete(route.path) } } } } as never)
  ctx.on('session/event', (session, event) => {
    if (event.type === 'request/header') {
      const config = session.requestHeader()!.config
      const agent = ctx.agents.get(session.id)
      if (agent) owner.consumeSelection(agent, config.provider, config.model, config.reasoningEffort)
    }
  })
  let pluginConfig: Plugin.Config = { home, jevBase: jev.base, ...(strategies ? { strategies } : {}) }
  let plugin = await ctx.plugin(Plugin, pluginConfig)
  // The Host routes need both the connection and the session controller; the "missing controller" case mounts neither.
  if (selectFails !== 'missing') await expect.poll(() => routes.size).toBe(9)
  const parent = await ctx.agents.create({ sessionId: SessionId('parent'), agentOptions: picked }); handles.push(parent)
  if (pendingPick) owner.selectForNextRequest(parent.agent, picked)
  else owner.selectionFor(parent.agent)
  const pickMain = (nextProvider: string, nextModel: string) => owner.selectForNextRequest(parent.agent, { provider: nextProvider, model: nextModel })
  const callEndpoint = async (operation: string, body: unknown) => (await routes.get(`/api/auto-model-routing.${operation}`)!.fetch(new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(body) }))).json()
  const run = async (agent: typeof parent.agent, text: string) => { agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })); await agent.whenIdle() }
  let n = 0
  let beforeChildRun: (() => unknown) | undefined
  let childTask = 'Apply the exact supplied mechanical transformation'
  ctx.tools.register(defineTool({ name: 'subagent', description: 'Test official tool-dispatch boundary; not a real provider test', output: { schema: { type: 'object', additionalProperties: false, properties: { childId: { type: 'string' } } }, render: (_args, value) => [{ type: 'text', text: value.childId ?? '' }] }, parameters: { model: { type: 'string' }, reasoning_effort: { type: 'string' } }, execute: async (args, exec) => {
    const child = await ctx.agents.create({ sessionId: SessionId(`child-${++n}`), parentAgent: exec.agent!, meta: { origin: 'subagent', parentSession: parent.agent.id }, agentOptions: { provider, model: args.model ?? modelId(modelIds[0]!) } }); handles.push(child)
    await beforeChildRun?.()
    await run(child.agent, childTask)
    return { childId: child.agent.id }
  } }))
  const invoke = (args = {}) => ctx.tools.execute({ name: 'subagent', arguments: args, agent: parent.agent, callId: `call-${++n}` as never, signal: new AbortController().signal })
  const store = new PolicyStore(join(home, 'state/auto-model-routing/policy-v2'), strategies ? createRegistry(strategies) : undefined)
  // Set the mode through the same persisted store used by production (no controller dependency).
  const { FileStateStore } = await import('../src/state.js')
  const modes = new FileStateStore(join(home, 'state/auto-model-routing/sessions'))
  modes.set(parent.agent.id, { mode: 'AUTO' })
  close = async () => { for (const h of handles.reverse()) await h.dispose(); await plugin.dispose(); for (const f of forks.reverse()) await f.dispose(); await jev.close() }
  return { ctx, parent: parent.agent, handles, calls, invoke, callEndpoint, pickMain, store, modes, run, jev, configure, home, selections, defaults, timeline, warnings,
    tools: () => ctx.tools, setAnswer: (text: string) => { answer = text }, holdCredentials,
    beforeChildRun: (fn: (() => unknown) | undefined) => { beforeChildRun = fn }, setChildTask: (text: string) => { childTask = text },
    restart: async (next?: readonly FamilyStrategy[]) => { await plugin.dispose(); if (next) pluginConfig = { home, jevBase: jev.base, strategies: next }; plugin = await ctx.plugin(Plugin, pluginConfig) } }
}
