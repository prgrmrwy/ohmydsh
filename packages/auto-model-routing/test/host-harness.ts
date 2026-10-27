/** Real AgentLoop Host harness for the plugin (test-only; shared by host and settings tests). */
import { expect } from 'vitest'
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
import { fakeJev, type Reply } from './fake-jev.js'

export const SECRET = 'sk-or-test-SECRET'
export let cleanup: (() => Promise<void>) | undefined
export async function closeHarness() { await cleanup?.(); cleanup = undefined }

export async function harness(reply: Reply, options: { reject?: () => boolean; selectFails?: boolean; answer?: () => string; defaultAuto?: boolean; storedKey?: string; seed?: []; config?: Record<string, unknown> } = {}) {
 const selections: unknown[] = []
 const home = mkdtempSync(join(tmpdir(), 'router-host-'))
 mkdirSync(join(home, 'plugins/dsh-auto-model-routing'), { recursive: true }); writeFileSync(join(home, 'plugins/dsh-auto-model-routing/config.json'), JSON.stringify(options.config ?? (options.defaultAuto ? { defaultMode: 'AUTO' } : {})))
 const jev = await fakeJev(reply)
 const ctx = new Context()
 const calls: GenerateOptions[] = []
 const routes = new Map<string, { fetch: (r: Request) => Promise<Response> }>()
 let agent: Awaited<ReturnType<typeof ctx.agents.create>>['agent'] | undefined
 class Adapter extends LlmAdapter {
  async listModels(provider: string) { return (provider === 'codex' ? ['gpt-6-luna','gpt-6.1-sol'] : ['claude-haiku-5-5','claude-sonnet-5-5','claude-opus-5-5']).map(id => ({ provider, id, name: id })) }
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
 ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: options.storedKey === undefined ? { OPENROUTER_API_KEY: SECRET } : {} }]) as never)
 let storedKey = options.storedKey
 if (options.storedKey !== undefined) ctx.provide('credentials', {
  describe: async () => ({ configured: Boolean(storedKey), source: 'file', writable: true }),
  resolve: async () => storedKey ? { value: storedKey, source: 'file' } : undefined,
  set: async (_ref: unknown, value: string) => { storedKey = value },
  unset: async () => { storedKey = undefined },
 } as never)
 const forks: { dispose(): unknown }[] = []
 for (const p of [Projections, Sessions, Agents, Prompt, Tools, Llm]) forks.push(await ctx.plugin(p))
 forks.push(await ctx.plugin(Loop, { agents: [] }))
 ctx.llm.registerAdapter(['test','claude','codex'], new Adapter())
 ctx.provide('subagentModelSelection' as never, { current: () => ({ enabled: true, allowedModels: [
  { provider: 'claude', model: 'claude-haiku-5-5' }, { provider: 'claude', model: 'claude-sonnet-5-5' }, { provider: 'claude', model: 'claude-opus-5-5' },
  { provider: 'codex', model: 'gpt-6-luna' }, { provider: 'codex', model: 'gpt-6.1-sol' },
 ] }) } as never)
 ctx.provide('connection', { fetch: { register(route: { path: string; fetch: (r: Request) => Promise<Response> }) { routes.set(route.path, route); return async () => { routes.delete(route.path) } } } } as never)
 ctx.provide('sessionController', {
  resolveAgent: async (id: string) => agent?.id === id ? { agent } : { error: new Error('unknown') },
  selectModel: async (request: unknown) => { selections.push(request); if (options.selectFails) throw new Error('model unavailable'); return { selected: request } },
 } as never)
 let routing = await ctx.plugin(plugin, { home, jevBase: jev.base, jevTimeoutMs: 300 })
 await expect.poll(() => routes.size).toBe(9)
 const selection: ModelSelectionRef = { current: { provider: 'test', model: 'claude-opus-5-5', reasoningEffort: ReasoningEffortId('medium') }, assembled: undefined }
 const handle = await ctx.agents.create({
  ...(options.seed ? { seed: options.seed } : {}),
  sessionId: SessionId(`host-${Math.random()}`), agentOptions: { provider: 'test', model: 'claude-opus-5-5' },
  setup(c) {
   installModelSelection(c, selection)
   if (options.reject) c.on('agent/pre-step', async (_p, next) => options.reject!() ? { kind: 'reject' } : next())
  },
 })
 agent = handle.agent
 const invoke = async (op: string, body: unknown) => (await routes.get(`/api/auto-model-routing.${op}`)!.fetch(new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(body) }))).json()
 const configure = (value: unknown) => writeFileSync(join(home, 'plugins/dsh-auto-model-routing/config.json'), typeof value === 'string' ? value : JSON.stringify(value))
 const run = async (text: string) => { agent!.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })); await agent!.whenIdle() }
 cleanup = async () => { await handle.dispose(); await routing.dispose(); for (const f of forks.reverse()) await f.dispose(); await jev.close() }
 // Simulate a Host restart for this plugin: all its memory is dropped, only the state directory remains.
 const restart = async () => { await routing.dispose(); routing = await ctx.plugin(plugin, { home, jevBase: jev.base, jevTimeoutMs: 300 }); await expect.poll(() => routes.size).toBe(9) }
 const toast = (on: boolean) => { const dir = join(home, 'plugins/dsh-auto-model-routing'); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'config.json'), JSON.stringify({ decisionToast: on })) }
 return { ctx, jev, calls, agent, selection, invoke, routes, run, home, toast, selections, restart, configure, setMode: (mode: string) => invoke('setMode', { sessionId: agent!.id, mode }) }
}

export const lastAssistantId = (h: { agent: { session: { deriveMessages(): readonly { role: string; id: string }[] } } }) => h.agent.session.deriveMessages().findLast(m => m.role === 'assistant')!.id
export const depth = (choice: string, extra: Record<string, unknown> = {}) => (_req: unknown, res: { writeHead(status: number, headers: Record<string, string>): void; end(body: string): void }) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ answers: { depth: { choice, ...extra } } })) }
