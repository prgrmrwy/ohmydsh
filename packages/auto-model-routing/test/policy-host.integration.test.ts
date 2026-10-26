import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Agents from '@deepseek-ai/dsh-agent'
import Loop from '@deepseek-ai/dsh-agent-loop'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import Llm, { LlmAdapter, ReasoningEffortId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import * as Plugin from '../src/index.js'
import { fakeJev, json } from './fake-jev.js'
import { PolicyStore } from '../src/policy-store.js'
// Test the installed SDK's real fold, not a local reimplementation of picker semantics.
const controllerEntry = pathToFileURL(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-api-session-controller'))
const { installModelSelectionProjection } = await import(new URL('./types/model-selection-projection.js', controllerEntry).href)
const { SessionCommandController } = await import(new URL('./types/commands.js', controllerEntry).href)
const { ApiSessionAgentController } = await import(new URL('./types/agent.js', controllerEntry).href)
let close: (() => Promise<void>) | undefined
afterEach(async () => { await close?.(); close = undefined })
async function harness(magpie: false | 'dsh-magpie-connect' | 'dsh-magpie' = false, pendingPick = false, family: 'claude' | 'codex' = 'claude', selectFails: boolean | 'missing' = false) {
  const provider = magpie || family
  const modelId = (id: string) => magpie ? `${family}/${id}` : id
  const modelIds = family === 'claude' ? ['claude-opus-5-5','claude-haiku-5-5','claude-sonnet-5-5'] : ['gpt-6.1-sol','gpt-6-luna']
  const home = mkdtempSync(join(tmpdir(), 'policy-host-'))
  const config = join(home, 'plugins/dsh-auto-model-routing/config.json')
  mkdirSync(join(home, 'plugins/dsh-auto-model-routing'), { recursive: true })
  const configure = (policy = 'policy-v2') => writeFileSync(config, JSON.stringify({ policy }))
  configure()
  const jev = await fakeJev(json(200, { answers: { capability: { choice: 'bounded' }, depth: { choice: 'baseline' } } }))
  const ctx = new Context(), forks: { dispose(): unknown }[] = [], handles: Awaited<ReturnType<typeof ctx.agents.create>>[] = []
  const calls: GenerateOptions[] = [], timeline: string[] = []
  class Adapter extends LlmAdapter {
    async listModels(provider: string) { return modelIds.map(id => ({ provider, id: modelId(id), name: id })) }
    async resolveModel(provider: string, id: string) { return { provider, id, name: id, reasoning: { efforts: ['low','medium','high','xhigh'].map(id => ({ id: ReasoningEffortId(id), name: id })) } } }
    async *stream(r: GenerateOptions): AsyncIterable<StreamChunk> { calls.push(r); timeline.push('adapter'); yield { type: 'finish', reason: { kind: 'stop' } } }
  }
  for (const p of [Projections,Sessions,Agents,Prompt,Tools,Llm]) forks.push(await ctx.plugin(p))
  installModelSelectionProjection(ctx)
  forks.push(await ctx.plugin(Loop,{ agents: [] }))
  ctx.llm.registerAdapter([provider], new Adapter())
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: { OPENROUTER_API_KEY: 'synthetic-key' } }]) as never)
  ctx.provide('subagentModelSelection' as never, { current: () => ({ enabled: true, allowedModels: modelIds.map(model => ({ provider, model: modelId(model) })) }) } as never)
  const selections: unknown[] = [], defaults: unknown[] = []
  const picked = { provider, model: modelId(modelIds[0]!), reasoningEffort: ReasoningEffortId('medium') }
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
  if (selectFails !== 'missing') ctx.provide('sessionController', { selectModel: async (request: unknown) => {
    selections.push(request)
    if (selectFails) throw new Error('synthetic selection rejection')
    const result = await commands.selectModel(request)
    timeline.push('selected')
    return result
  } } as never)
  ctx.on('session/event', (session, event) => {
    if (event.type === 'request/header') {
      const config = session.requestHeader()!.config
      const agent = ctx.agents.get(session.id)
      if (agent) owner.consumeSelection(agent, config.provider, config.model, config.reasoningEffort)
    }
  })
  let plugin = await ctx.plugin(Plugin, { home, jevBase: jev.base })
  const parent = await ctx.agents.create({ sessionId: SessionId('parent'), agentOptions: picked }); handles.push(parent)
  if (pendingPick) owner.selectForNextRequest(parent.agent, picked)
  else owner.selectionFor(parent.agent)
  const run = async (agent: typeof parent.agent, text: string) => { agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })); await agent.whenIdle() }
  let n = 0
  ctx.tools.register(defineTool({ name: 'subagent', description: 'Test official tool-dispatch boundary; not a real provider test', output: { schema: { type: 'object', additionalProperties: false, properties: { childId: { type: 'string' } } }, render: (_args, value) => [{ type: 'text', text: value.childId ?? '' }] }, parameters: { model: { type: 'string' }, reasoning_effort: { type: 'string' } }, execute: async (args, exec) => {
    const child = await ctx.agents.create({ sessionId: SessionId(`child-${++n}`), parentAgent: exec.agent!, meta: { origin: 'subagent', parentSession: parent.agent.id }, agentOptions: { provider, model: args.model ?? modelId(modelIds[0]!) } }); handles.push(child)
    await run(child.agent, 'Apply the exact supplied mechanical transformation')
    return { childId: child.agent.id }
  } }))
  const invoke = (args = {}) => ctx.tools.execute({ name: 'subagent', arguments: args, agent: parent.agent, callId: `call-${++n}` as never, signal: new AbortController().signal })
  const store = new PolicyStore(join(home, 'state/auto-model-routing/policy-v2'))
  // Set the mode through the same persisted store used by production (no controller dependency).
  const { FileStateStore } = await import('../src/state.js')
  const modes = new FileStateStore(join(home, 'state/auto-model-routing/sessions'))
  modes.set(parent.agent.id, { mode: 'AUTO' })
  close = async () => { for (const h of handles.reverse()) await h.dispose(); await plugin.dispose(); for (const f of forks.reverse()) await f.dispose(); await jev.close() }
  return { ctx, parent: parent.agent, handles, calls, invoke, store, modes, run, jev, configure, home, selections, defaults, timeline, warnings,
    restart: async () => { await plugin.dispose(); plugin = await ctx.plugin(Plugin,{ home, jevBase: jev.base }) } }
}
it('child decision persists separate confidences and actual application without task text',async()=>{
 const h=await harness('dsh-magpie-connect')
 h.jev.set(json(200,{answers:{capability:{choice:'bounded',confidence:.71,probabilities:{bounded:.8,analytical:.2}},depth:{choice:'baseline',confidence:.94}}}))
 await h.invoke()
 const child=h.handles[1]!.agent
 const record=h.store.get(child.id)
 expect(record?.decision).toMatchObject({capability:'bounded',depth:'baseline',confidence:.94,capabilityConfidence:.71,decisionProvider:'openrouter',status:'applied',model:'claude/claude-haiku-5-5'})
 expect(JSON.stringify(record)).not.toContain('mechanical transformation')
 await h.restart();expect(h.store.get(child.id)?.decision?.capabilityConfidence).toBe(.71)
})
it.each(['dsh-magpie-connect','dsh-magpie'] as const)('%s children retain exact transport routes across mode changes and plugin reload',async(provider)=>{
 const h=await harness(provider)
 expect((await h.invoke()).isError).not.toBe(true)
 const child=h.handles[1]!.agent
 expect(h.store.get(child.id)).toMatchObject({status:'applied',family:'claude',route:{provider,model:'claude/claude-haiku-5-5',reasoningEffort:'medium'}})
 await h.restart();h.configure('legacy');h.modes.set(h.parent.id,{mode:'MANUAL'})
 await h.run(child,'later task')
 expect(h.calls.at(-1)).toMatchObject({model:'claude/claude-haiku-5-5',reasoningEffort:'medium'})
 expect(h.jev.bodies).toHaveLength(1)
})
it.each(['dsh-magpie-connect','dsh-magpie'] as const)('%s main keeps transport and model unchanged',async(provider)=>{
 const h=await harness(provider)
 h.jev.set(json(200,{answers:{depth:{choice:'higher'}}}))
 await h.run(h.parent,'main task')
 expect(h.calls.at(-1)).toMatchObject({provider,model:'claude/claude-opus-5-5',reasoningEffort:'high'})
 expect(h.parent.session.requestHeader()?.config).toMatchObject({provider,model:'claude/claude-opus-5-5',reasoningEffort:'high'})
})
it.each([false,'dsh-magpie-connect','dsh-magpie'] as const)('%s AUTO synchronizes the same request, official selection and global defaults',async(provider)=>{
 const h=await harness(provider,true)
 h.jev.set(json(200,{answers:{depth:{choice:'higher'}}}))
 await h.run(h.parent,'Main task with an explicit medium pick')
 const route={provider:provider||'claude',model:provider?'claude/claude-opus-5-5':'claude-opus-5-5',reasoningEffort:'high'}
 expect(h.calls).toHaveLength(1)
 expect(h.calls[0]).toMatchObject(route)
 expect(h.parent.session.requestHeader()?.config).toMatchObject(route)
 expect(h.selections).toEqual([{sessionId:h.parent.id,...route}])
 expect(h.defaults).toEqual([route])
 expect(h.timeline).toEqual(['defaults','selected','adapter'])
 expect(h.ctx.sessionProjections.snapshot(h.parent.session,['modelSelection']).values.modelSelection).toEqual({lastUsed:route,next:route})
 await h.run(h.parent,'Same effort in the next AUTO turn')
 expect(h.calls).toHaveLength(2)
 expect(h.selections).toHaveLength(1)
 h.modes.set(h.parent.id,{mode:'MANUAL'})
 await h.run(h.parent,'MANUAL keeps the official high selection')
 expect(h.calls.at(-1)).toMatchObject(route)
 expect(h.selections).toHaveLength(1)
})
it.each([true,'missing'] as const)('selection sync failure %s keeps the official effort and logs the failure',async(selectFails)=>{
 const h=await harness(false,true,'claude',selectFails)
 h.jev.set(json(200,{answers:{depth:{choice:'higher'}}}))
 await h.run(h.parent,'Keep one consistent effort if synchronization cannot complete')
 expect(h.calls).toHaveLength(1)
 expect(h.calls[0]).toMatchObject({provider:'claude',model:'claude-opus-5-5',reasoningEffort:'medium'})
 expect(h.parent.session.requestHeader()?.config.reasoningEffort).toBe('medium')
 expect(h.selections).toHaveLength(selectFails === 'missing' ? 0 : 1)
 expect(h.defaults).toEqual([])
 expect(h.warnings).toHaveBeenCalledWith(expect.stringContaining('could not sync the model selection'))
 expect(h.modes.get(h.parent.id)?.mode).toBe('AUTO')
})
it('same effort and MANUAL do not sync',async()=>{
 const h=await harness(false,true)
 await h.run(h.parent,'Baseline uses the existing medium choice')
 h.modes.set(h.parent.id,{mode:'MANUAL'})
 await h.run(h.parent,'Manual request')
 expect(h.calls.map(c=>c.reasoningEffort)).toEqual(['medium','medium'])
 expect(h.selections).toEqual([]);expect(h.defaults).toEqual([])
})
it.each(['dsh-magpie-connect','dsh-magpie'] as const)('%s GPT main and child use supported efforts on the same transport',async(provider)=>{
 const h=await harness(provider,true,'codex')
 h.jev.set(json(200,{answers:{capability:{choice:'bounded'},depth:{choice:'higher'}}}))
 await h.run(h.parent,'GPT main task')
 expect(h.calls.at(-1)).toMatchObject({provider,model:'codex/gpt-6.1-sol',reasoningEffort:'high'})
 expect((await h.invoke()).isError).not.toBe(true)
 const child=h.handles[1]!.agent
 expect(h.store.get(child.id)).toMatchObject({status:'applied',family:'codex',route:{provider,model:'codex/gpt-6-luna',reasoningEffort:'xhigh'}})
 await h.restart();h.configure('legacy');h.modes.set(h.parent.id,{mode:'MANUAL'})
 await h.run(child,'Restore GPT child')
 expect(h.calls.at(-1)).toMatchObject({provider,model:'codex/gpt-6-luna',reasoningEffort:'xhigh'})
 expect(h.selections).toEqual([{sessionId:h.parent.id,provider,model:'codex/gpt-6.1-sol',reasoningEffort:'high'}])
 expect(h.defaults).toEqual([{provider,model:'codex/gpt-6.1-sol',reasoningEffort:'high'}])
 expect(h.jev.bodies).toHaveLength(2)
})
it('binds concurrent tool-created identities, records actual requests, and restores plugin decisions', async () => {
  const h = await harness()
  const results = await Promise.all([h.invoke(),h.invoke({ model: 'claude-sonnet-5-5', reasoning_effort: 'high' })])
  expect(results.every(r => !r.isError)).toBe(true)
  const records = h.handles.slice(1).map(c => h.store.get(c.agent.id)!)
  expect(records).toHaveLength(2)
  expect(records.map(r => r.status)).toEqual(['applied','applied'])
  expect(records.map(r => r.route?.model).sort()).toEqual(['claude-haiku-5-5','claude-sonnet-5-5'])
  expect(h.jev.bodies).toHaveLength(1)
  await h.restart()
  h.modes.set(h.parent.id,{ mode: 'MANUAL' })
  const child = h.handles[1]!.agent
  await h.run(child,'New unrelated work must not reselect')
  expect(h.calls.at(-1)?.model).toBe(h.store.get(child.id)?.route?.model)
  expect(h.jev.bodies).toHaveLength(1)
})
it('keeps legacy and manual creation free from policy decisions', async () => {
  const h = await harness(); h.modes.set(h.parent.id,{ mode: 'MANUAL' })
  await h.invoke()
  expect(h.jev.bodies).toHaveLength(0)
  expect(h.store.get(h.handles[1]!.agent.id)).toBeUndefined()
  h.configure('legacy'); h.modes.set(h.parent.id,{ mode: 'AUTO' })
  await h.invoke()
  expect(h.jev.bodies).toHaveLength(0)
})
it('child judgment excludes injected non-user instructions before truncation', async () => {
  const h = await harness()
  h.ctx.on('agent/pre-step',async(payload,next)=>{
    const decision=await next()
    if(payload.agent.session.header.origin!=='subagent'||decision.kind!=='enter')return decision
    return {...decision,messages:[createUserMessage({source:{kind:'runtime-context'} as never,content:[{type:'text',text:'PRIVATE_RUNTIME_CONTEXT '.repeat(600)}]}),...decision.messages]}
  })
  await h.invoke()
  const body=h.jev.bodies[0] as {state:string}
  expect(body.state).toContain('Apply the exact supplied mechanical transformation')
  expect(body.state).not.toContain('PRIVATE_RUNTIME_CONTEXT')
})
it('main uses depth only without changing model', async () => {
  const h = await harness()
  h.jev.set(json(200,{ answers: { depth: { choice: 'higher' } } }))
  await h.run(h.parent,'Reason carefully about the constraint conflict')
  expect(h.calls.at(-1)).toMatchObject({ model: 'claude-opus-5-5', reasoningEffort: 'high' })
  expect((h.jev.bodies[0] as { questions: unknown }).questions).not.toHaveProperty('capability')
})
it('main request rechecks MANUAL after asynchronous model resolution', async () => {
  const h=await harness()
  const resolve=h.ctx.llm.resolveModelInfo.bind(h.ctx.llm)
  h.ctx.llm.resolveModelInfo=async(...args)=>{const info=await resolve(...args);h.modes.set(h.parent.id,{mode:'MANUAL'});return info}
  h.jev.set(json(200,{answers:{depth:{choice:'higher'}}}))
  await h.run(h.parent,'Task with asynchronous model lookup')
  expect(h.calls.at(-1)?.reasoningEffort).toBe('medium')
  expect(h.selections).toEqual([]);expect(h.defaults).toEqual([])
})
it('missing routed-child record fails closed in MANUAL and legacy, without rejudging', async () => {
  const h=await harness();await h.invoke()
  const child=h.handles[1]!.agent
  const directory=join(h.home,'state/auto-model-routing/policy-v2')
  const file=join(directory,readdirSync(directory).find(name=>name.endsWith('.json'))!)
  // Exact observed file in this test-owned temporary directory.
  expect(file.startsWith(directory+'/')).toBe(true);unlinkSync(file)
  await h.restart();h.configure('legacy');h.modes.set(h.parent.id,{mode:'MANUAL'})
  const before=h.calls.length
  await h.run(child,'Resume without route record')
  expect(h.calls).toHaveLength(before)
  expect(h.jev.bodies).toHaveLength(1)
})
it('missing context stops the child request without changing root AUTO', async () => {
  const h = await harness()
  h.jev.set(json(200,{ answers: { capability: { choice: 'insufficient_context' }, depth: { choice: 'baseline' } } }))
  await h.invoke()
  const child = h.handles[1]!.agent
  expect(h.calls.filter(c => c.sessionId === child.id)).toHaveLength(0)
  expect(h.store.get(child.id)?.status).toBe('needs-context')
  expect(h.modes.get(h.parent.id)?.mode).toBe('AUTO')
})
it('Jev failure stops child execution and preserves the failure across later messages', async () => {
  const h = await harness(); h.jev.set(json(402,{}))
  await h.invoke()
  const child = h.handles[1]!.agent
  expect(h.store.get(child.id)?.status).toBe('failed')
  expect(h.calls.filter(c => c.sessionId === child.id)).toHaveLength(0)
  h.jev.set(json(200,{ answers: { capability: { choice: 'bounded' }, depth: { choice: 'baseline' } } }))
  await h.run(child,'Try again without a new resource decision')
  expect(h.jev.bodies).toHaveLength(1)
})
it.each([false,'dsh-magpie-connect','dsh-magpie'] as const)('does not broaden the %s parent captured allowlist with a newer global catalog', async (magpie) => {
  const h = await harness(magpie)
  ;(h.parent.session.append as unknown as (type:string,data:unknown)=>unknown)('subagent/model-selection-policy',{ allowedModels: [{provider:magpie||'claude',model:magpie?'claude/claude-opus-5-5':'claude-opus-5-5'}] })
  await h.invoke()
  const child = h.handles[1]!.agent
  expect(h.calls.filter(c=>c.sessionId===child.id)).toHaveLength(0)
  expect(h.store.get(child.id)?.status).toBe('failed')
})
it('actual request mismatch is recorded as failed rather than applied', async () => {
  const h = await harness()
  h.ctx.on('agent/request', async (payload,next) => {
    const config = await next()
    return payload.agent.session.header.origin === 'subagent' ? { ...config, model: 'claude-opus-5-5' } : config
  },{prepend:true})
  await h.invoke()
  expect(h.store.get(h.handles[1]!.agent.id)?.status).toBe('failed')
})
it('unsupported fork is denied before its tool body runs', async () => {
  const h = await harness(); let ran = false
  h.ctx.tools.register(defineTool({ name: 'subagent_fork', description: 'offline fork boundary', parameters: {}, output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] }, execute: async () => { ran = true; return {} } }))
  const result = await h.ctx.tools.execute({ name: 'subagent_fork', arguments: {}, agent: h.parent, callId: 'fork' as never, signal: new AbortController().signal })
  expect(result.isError).toBe(true); expect(ran).toBe(false); expect(h.jev.bodies).toHaveLength(0)
})
