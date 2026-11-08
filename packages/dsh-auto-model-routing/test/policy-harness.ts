/** Real AgentLoop Host harness for child routing (test-only; shared by policy-host and preset tests). */
import { expect, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Agents from '@deepseek-ai/dsh-agent'
import Loop from '@deepseek-ai/dsh-agent-loop'
import * as NativeExecutor from '@deepseek-ai/dsh-tool-executor-native'
// Real subagent stack (extra.real): official runtime, spawn provider, `subagent` tool and jsonl persistence; only the adapter and Jev are fakes.
import Storage from '@deepseek-ai/dsh-storage'
import * as Sqlite from '@deepseek-ai/dsh-storage-sqlite'
import * as Domain from '@deepseek-ai/dsh-storage-domain'
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQuery from '@deepseek-ai/dsh-session-query'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SpawnProvider from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as ToolSubagent from '@deepseek-ai/dsh-tool-subagent'
import { realpathSync } from 'node:fs'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import Llm, { LlmAdapter, ReasoningEffortId, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
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
// Test the installed SDK's real selectModel (DSH 0.2.2: it records through agent.model.select; the projection is registered by the agent loop).
const controllerEntry = pathToFileURL(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-api-session-controller'))
const { SessionCommandController } = await import(new URL('./types/commands.js', controllerEntry).href)
const { ApiSessionAgentController } = await import(new URL('./types/agent.js', controllerEntry).href)
/** 0.2.2: tools.execute takes a raw call batch; this returns the single settled outcome (the shape the former single-call API returned). */
export async function callTool(ctx: Context, agent: Parameters<Context['tools']['execute']>[0]['agent'], name: string, args: unknown = {}, signal: AbortSignal = new AbortController().signal) {
  return (await ctx.tools.execute({ calls: [{ type: 'tool-call', id: ToolCallId(`call-${Math.random()}`), name, arguments: JSON.stringify(args) }], ...(agent ? { agent } : {}), signal })).results[0]!.result
}
let close: (() => Promise<void>) | undefined
/** Disposes the harness created last; call from `afterEach`. */
export async function closePolicyHarness() { await close?.(); close = undefined }
export async function harness(magpie: false | 'dsh-magpie-connect' | 'dsh-magpie-connector' = false, pendingPick = false, family: 'claude' | 'codex' | 'deepseek' = 'claude', selectFails: boolean | 'missing' = false, main: { provider?: string; model?: string; efforts?: string[]; defaultEffort?: string } = {}, strategies?: readonly FamilyStrategy[], extra: { gatedCredentials?: boolean; real?: boolean; adapter?: (request: GenerateOptions, attempt: number) => AsyncIterable<StreamChunk> | undefined } = {}) {
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
      const scripted = extra.adapter?.(r, calls.length)
      if (scripted) { yield* scripted; return }
      if (answer) { yield { type: 'block-start', index: 0, blockType: 'text' }; yield { type: 'text-delta', index: 0, text: answer }; yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  if (extra.real) {
    forks.push(await ctx.plugin(Storage)); forks.push(await ctx.plugin(Sqlite, { path: ':memory:' })); forks.push(await ctx.plugin(Domain, { backend: 'sqlite' }))
    forks.push(await ctx.plugin(Persistence, { root: mkdtempSync(join(realpathSync(tmpdir()), 'policy-real-')), compression: 'zstd' }))
  }
  for (const p of [Projections,Sessions,Agents,Prompt,Tools,Llm]) forks.push(await ctx.plugin(p))
  forks.push(await ctx.plugin(NativeExecutor)) // 0.2.2: the loop needs a tool executor in the composition
  forks.push(await ctx.plugin(Loop,{ agents: [] }))
  if (extra.real) {
    forks.push(await ctx.plugin(FsLocal, { cwd: realpathSync(tmpdir()) })); forks.push(await ctx.plugin(WorkingDirectory, { defaultDirectory: realpathSync(tmpdir()) }))
    forks.push(await (ctx.plugin as unknown as (plugin: unknown) => PromiseLike<{ dispose(): unknown }>)(SessionQuery)) // its config type is mandatory in this composition; the default config applies
    forks.push(await ctx.plugin(SubagentRuntime)); forks.push(await ctx.plugin(SpawnProvider, { providerName: 'spawn' }))
    forks.push(await ctx.plugin(ToolSubagent, { provider: 'spawn', modelSelection: true }))
  }
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
  // Real official selectModel; only live-agent lookup and defaults storage are inert ports.
  const owner = Object.assign(Object.create(ApiSessionAgentController.prototype), {
    ctx, imageAdmissionChains: new WeakMap(),
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
  let pluginConfig: Plugin.Config = { home, jevBase: jev.base, ...(strategies ? { strategies } : {}) }
  let plugin = await ctx.plugin(Plugin, pluginConfig)
  // The Host routes need both the connection and the session controller; the "missing controller" case mounts neither.
  if (selectFails !== 'missing') await expect.poll(() => routes.size).toBe(9)
  const parent = await ctx.agents.create({ sessionId: SessionId('parent'), agentOptions: picked }); handles.push(parent)
  // 0.2.2: the official selection is the agent's own `model` (no controller-side pending pick / consume).
  if (pendingPick) parent.agent.model.select(picked)
  const pickMain = (nextProvider: string, nextModel: string) => parent.agent.model.select({ provider: nextProvider, model: nextModel })
  const callEndpoint = async (operation: string, body: unknown) => (await routes.get(`/api/auto-model-routing.${operation}`)!.fetch(new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(body) }))).json()
  const run = async (agent: typeof parent.agent, text: string) => { agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })); await agent.whenIdle() }
  let n = 0
  let beforeChildRun: (() => unknown) | undefined
  let childTask = 'Apply the exact supplied mechanical transformation'
  if (!extra.real) ctx.tools.register(defineTool({ name: 'subagent', description: 'Test official tool-dispatch boundary; not a real provider test', output: { schema: { type: 'object', additionalProperties: false, properties: { childId: { type: 'string' } } }, render: (_args, value) => [{ type: 'text', text: value.childId ?? '' }] }, parameters: { prompt: { type: 'string' }, model: { type: 'string' }, reasoning_effort: { type: 'string' } }, execute: async (args, exec) => {
    const child = await ctx.agents.create({ sessionId: SessionId(`child-${++n}`), parentAgent: exec.agent!, meta: { origin: 'subagent', parentSession: parent.agent.id }, agentOptions: { provider, model: args.model ?? modelId(modelIds[0]!) } }); handles.push(child)
    await beforeChildRun?.()
    await run(child.agent, typeof args.prompt === 'string' ? args.prompt : childTask)
    return { childId: child.agent.id }
  } }))
  // 0.2.2: tools.execute takes a raw call batch; return the single settled outcome (same shape the old single-call API returned).
  // The official tool's task text is its `prompt` argument (the child's first user message), as in the real `subagent` tool.
  const invoke = (args: Record<string, unknown> = {}, signal?: AbortSignal) => callTool(ctx, parent.agent, 'subagent', { ...(extra.real ? { description: 'task' } : {}), prompt: childTask, ...args }, signal)
  /** Real stack only: the live managed child (the official runtime owns its lifetime) and its settled state. */
  const liveChild = () => ctx.agents.list().find(agent => agent.session.header.origin === 'subagent')
  const settle = async () => { await expect.poll(() => liveChild()).toBeDefined(); await liveChild()!.whenIdle() }
  const store = new PolicyStore(join(home, 'state/auto-model-routing/policy-v2'), strategies ? createRegistry(strategies) : undefined)
  // Set the mode through the same persisted store used by production (no controller dependency).
  const { FileStateStore } = await import('../src/state.js')
  const modes = new FileStateStore(join(home, 'state/auto-model-routing/sessions'))
  modes.set(parent.agent.id, { mode: 'AUTO' })
  close = async () => { for (const h of handles.reverse()) await h.dispose(); await plugin.dispose(); for (const f of forks.reverse()) await f.dispose(); await jev.close() }
  return { ctx, parent: parent.agent, handles, calls, invoke, liveChild, settle, callEndpoint, pickMain, store, modes, run, jev, configure, home, selections, defaults, timeline, warnings,
    tools: () => ctx.tools, setAnswer: (text: string) => { answer = text }, holdCredentials,
    beforeChildRun: (fn: (() => unknown) | undefined) => { beforeChildRun = fn }, setChildTask: (text: string) => { childTask = text },
    restart: async (next?: readonly FamilyStrategy[]) => { await plugin.dispose(); if (next) pluginConfig = { home, jevBase: jev.base, strategies: next }; plugin = await ctx.plugin(Plugin, pluginConfig) } }
}
