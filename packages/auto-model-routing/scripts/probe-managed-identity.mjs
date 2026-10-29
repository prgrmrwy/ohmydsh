// Official tools + fake adapter: test whether ALS/catalog identifies the tool target.
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve, join } from 'node:path'
import { mkdir } from 'node:fs/promises'
const root = resolve(process.argv[2])
const require = createRequire(join(root, 'package.json'))
const load = name => import(pathToFileURL(require.resolve(`@deepseek-ai/${name}`)))
const [Cordis, Agents, Loop, Sessions, Projections, Prompt, Tools, Llm, Subagents, Spawn, Teams, SubTool, TeamTools, Persistence, Query] = await Promise.all(['cordis','dsh-agent','dsh-agent-loop','dsh-session','dsh-session-projection','dsh-system-prompt','dsh-tools','dsh-llm','dsh-subagent','dsh-subagent-spawn-in-process','dsh-experimental-agent-team','dsh-tool-subagent','dsh-experimental-tool-agent-team','dsh-session-persistence-jsonl','dsh-session-query-sqlite'].map(load))
const output = join(root, `sessions-${Date.now()}`)
await mkdir(output, { recursive: true })
const ctx = new Cordis.Context(), plugins = [], window = new AsyncLocalStorage()
const events = [], created = new Map(), observed = [], calls = []
const originalFetch = globalThis.fetch
globalThis.fetch = () => { throw Error('Network forbidden in identity probe') }
class Adapter extends Llm.LlmAdapter {
 async listModels(provider) { return [{ provider, id: 'gpt-probe', name: 'probe' }] }
 async resolveModel(provider, id) { return { provider, id, name: id } }
 async *stream(request) { calls.push(request); yield { type: 'finish', reason: { kind: 'stop' } } }
}
try {
 for (const p of [Projections, Sessions, Agents, Prompt, Tools, Llm]) plugins.push(await ctx.plugin(p.default))
 plugins.push(await ctx.plugin(Persistence.default, { root: output, compression: 'none' }))
 plugins.push(await ctx.plugin(Query.default, { path: ':memory:', openAt: 'never' }))
 plugins.push(await ctx.plugin(Loop.default, { agents: [] }))
 ctx.llm.registerAdapter(['probe'], new Adapter())
 plugins.push(await ctx.plugin(Subagents.default))
 plugins.push(await ctx.plugin(Spawn, { providerName: 'spawn' }))
 plugins.push(await ctx.plugin(Teams.default))
 plugins.push(await ctx.plugin(SubTool, { provider: 'spawn', toolName: 'subagent', backgroundMode: 'continuable', modelSelectionSettings: false }))
 plugins.push(await ctx.plugin(TeamTools))
 ctx.on('agent/created', ({ agent, source }) => {
  if (agent.session.header.origin !== 'subagent') return
  created.set(agent.id, { source, parent: agent.session.header.parentSession })
  events.push({ type: 'created', id: agent.id })
 })
 ctx.on('session/event', (session, event) => {
  if (event.type !== 'subagent/catalog') return
  const candidate = created.get(event.data.childId), active = window.getStore()
  const matches = !!active && candidate?.source === 'startup' && candidate.parent === session.id && active.parent === session.id
  observed.push({ path: active?.path, id: event.data.childId, label: event.data.label, matches })
  events.push({ type: 'catalog', id: event.data.childId })
 })
 ctx.on('agent/pre-step', (decision, { agent }) => { events.push({ type: 'pre-step', id: agent.id }); return decision })
 ctx.on('tools/execute', (exec, next) => {
  if (!['subagent', 'spawn_teammate'].includes(exec.name)) return next()
  return window.run({ parent: exec.agent.id, path: exec.name }, async () => {
   // Normal service-created plugin branch. It publishes the same catalog as idle create.
   await ctx.subagents.startContinuable({ provider: 'spawn', label: 'plugin-service-branch', request: { parent: exec.agent, prompt: [{ type: 'text', text: 'Synthetic branch task' }] }, signal: exec.signal })
   return next()
  })
 })
 const parent = await ctx.agents.create({ sessionId: 'probe-parent', agentOptions: { provider: 'probe', model: 'gpt-probe' } })
 const signal = AbortSignal.timeout(15000)
 for (const [name, args] of [['subagent', { description: 'target', prompt: 'Synthetic tool target', run_in_background: true }], ['spawn_teammate', { name: 'probe-worker', description: 'target', prompt: 'Synthetic tool target', context: 'fresh' }]]) {
  const result = await ctx.tools.execute({ name, arguments: args, agent: parent.agent, callId: name, signal })
  if (result.isError) console.log(JSON.stringify({ tool: name, limitation: result.error }))
 }
 for (const id of created.keys()) { const live = ctx.agents.get(id); if (live) await live.whenIdle() }
 const branches = observed.filter(row => row.label === 'plugin-service-branch')
 assert.equal(branches.length, 2)
 assert(branches.every(row => row.matches), 'Expected counterexample must satisfy proposed gate')
 for (const row of observed) {
  const catalog = events.findIndex(e => e.type === 'catalog' && e.id === row.id)
  const step = events.findIndex(e => e.type === 'pre-step' && e.id === row.id)
  row.catalogBeforeStep = catalog >= 0 && step > catalog
 }
 console.log(JSON.stringify({ gate: 'FAIL_SOURCE_ISOLATION', branches, observed, calls: calls.length, events }, null, 2))
 await parent.dispose()
} finally {
 for (const plugin of plugins.reverse()) await plugin.dispose()
 window.disable()
 globalThis.fetch = originalFetch
}
