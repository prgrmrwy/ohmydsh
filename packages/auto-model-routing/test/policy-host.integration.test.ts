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
afterEach(async () => { await close?.(); close = undefined })
async function harness(magpie: false | 'dsh-magpie-connect' | 'dsh-magpie-connector' = false, pendingPick = false, family: 'claude' | 'codex' | 'deepseek' = 'claude', selectFails: boolean | 'missing' = false, main: { provider?: string; model?: string; efforts?: string[]; defaultEffort?: string } = {}, strategies?: readonly FamilyStrategy[]) {
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
  ctx.tools.register(defineTool({ name: 'subagent', description: 'Test official tool-dispatch boundary; not a real provider test', output: { schema: { type: 'object', additionalProperties: false, properties: { childId: { type: 'string' } } }, render: (_args, value) => [{ type: 'text', text: value.childId ?? '' }] }, parameters: { model: { type: 'string' }, reasoning_effort: { type: 'string' } }, execute: async (args, exec) => {
    const child = await ctx.agents.create({ sessionId: SessionId(`child-${++n}`), parentAgent: exec.agent!, meta: { origin: 'subagent', parentSession: parent.agent.id }, agentOptions: { provider, model: args.model ?? modelId(modelIds[0]!) } }); handles.push(child)
    await run(child.agent, 'Apply the exact supplied mechanical transformation')
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
    tools: () => ctx.tools, setAnswer: (text: string) => { answer = text },
    restart: async (next?: readonly FamilyStrategy[]) => { await plugin.dispose(); if (next) pluginConfig = { home, jevBase: jev.base, strategies: next }; plugin = await ctx.plugin(Plugin, pluginConfig) } }
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
it.each(['dsh-magpie-connect','dsh-magpie-connector'] as const)('spec Scenario "新旧 Magpie 子实例保持精确身份并恢复" (%s)',async(provider)=>{
 const h=await harness(provider)
 expect((await h.invoke()).isError).not.toBe(true)
 const child=h.handles[1]!.agent
 expect(h.store.get(child.id)).toMatchObject({status:'applied',family:'claude',route:{provider,model:'claude/claude-haiku-5-5',reasoningEffort:'medium'}})
 await h.restart();h.modes.set(h.parent.id,{mode:'MANUAL'})
 await h.run(child,'later task')
 expect(h.calls.at(-1)).toMatchObject({model:'claude/claude-haiku-5-5',reasoningEffort:'medium'})
 expect(h.jev.bodies).toHaveLength(1)
})
it.each(['dsh-magpie-connect','dsh-magpie-connector'] as const)('%s main keeps transport and model unchanged',async(provider)=>{
 const h=await harness(provider)
 h.jev.set(json(200,{answers:{depth:{choice:'higher'}}}))
 await h.run(h.parent,'main task')
 expect(h.calls.at(-1)).toMatchObject({provider,model:'claude/claude-opus-5-5',reasoningEffort:'high'})
 expect(h.parent.session.requestHeader()?.config).toMatchObject({provider,model:'claude/claude-opus-5-5',reasoningEffort:'high'})
})
it.each([false,'dsh-magpie-connect','dsh-magpie-connector'] as const)('spec Scenario "同次主请求同步官方 effort 与 defaults" (%s)',async(provider)=>{
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
it.each([true,'missing'] as const)('spec Scenario "同步失败不丢本次请求" (%s)',async(selectFails)=>{
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
it('spec Scenario "手动与子请求不污染默认"',async()=>{
 const h=await harness(false,true)
 await h.run(h.parent,'Baseline uses the existing medium choice')
 h.modes.set(h.parent.id,{mode:'MANUAL'})
 await h.run(h.parent,'Manual request')
 expect(h.calls.map(c=>c.reasoningEffort)).toEqual(['medium','medium'])
 expect(h.selections).toEqual([]);expect(h.defaults).toEqual([])
})
it.each(['dsh-magpie-connect','dsh-magpie-connector'] as const)('spec Scenario "Magpie 自动子路由" (%s)',async(provider)=>{
 const h=await harness(provider,true,'codex')
 h.jev.set(json(200,{answers:{capability:{choice:'bounded'},depth:{choice:'higher'}}}))
 await h.run(h.parent,'GPT main task')
 expect(h.calls.at(-1)).toMatchObject({provider,model:'codex/gpt-6.1-sol',reasoningEffort:'high'})
 expect((await h.invoke()).isError).not.toBe(true)
 const child=h.handles[1]!.agent
 expect(h.store.get(child.id)).toMatchObject({status:'applied',family:'codex',route:{provider,model:'codex/gpt-6-luna',reasoningEffort:'xhigh'}})
 await h.restart();h.modes.set(h.parent.id,{mode:'MANUAL'})
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
it('keeps MANUAL creation free from routing decisions', async () => {
  const h = await harness(); h.modes.set(h.parent.id,{ mode: 'MANUAL' })
  await h.invoke()
  expect(h.jev.bodies).toHaveLength(0)
  expect(h.store.get(h.handles[1]!.agent.id)).toBeUndefined()
})
it('spec Scenario "子会话不走主会话判断"', async () => {
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
it('spec Scenario "异步解析期间切 MANUAL 不覆盖主请求"', async () => {
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
  await h.restart();h.modes.set(h.parent.id,{mode:'MANUAL'})
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
it.each([false,'dsh-magpie-connect','dsh-magpie-connector'] as const)('does not broaden the %s parent captured allowlist with a newer global catalog', async (magpie) => {
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
it('spec Scenario "不支持模型的请求不再导致整轮失败"', async () => {
  const h = await harness(false, false, 'claude', false, { provider: 'opencode-go', model: 'deepseek-v4.1-flash', efforts: ['low','high','max'], defaultEffort: 'max' })
  h.modes.set(h.parent.id, { mode: 'MANUAL' })
  await h.run(h.parent, 'manual baseline on an unsupported main model')
  const baseline = h.calls.at(-1)!
  h.modes.set(h.parent.id, { mode: 'AUTO' })
  await h.run(h.parent, 'AUTO must not touch an unsupported main model')
  const attempt = h.calls.at(-1)!
  expect({ provider: attempt.provider, model: attempt.model, reasoningEffort: attempt.reasoningEffort })
    .toEqual({ provider: baseline.provider, model: baseline.model, reasoningEffort: baseline.reasoningEffort })
  expect(attempt.provider).toBe('opencode-go')
  expect(attempt.model).toBe('deepseek-v4.1-flash')
  expect(h.jev.bodies).toHaveLength(0)
  expect(h.modes.get(h.parent.id)?.mode).toBe('MANUAL')
  const ends = h.parent.session.snapshotEvents().filter(event => event.type === 'turn/end')
  expect((ends.at(-1)!.data as { reason: { kind: string } }).reason.kind).toBe('completed')
})
it('spec Scenario "支持范围内映射不可得不阻断请求"', async () => {
  const h = await harness(false, false, 'claude', false, { efforts: ['max'], defaultEffort: 'max' })
  h.jev.set(json(200,{ answers: { depth: { choice: 'higher' } } }))
  h.modes.set(h.parent.id, { mode: 'MANUAL' })
  await h.run(h.parent, 'manual baseline with only max available')
  const baseline = h.calls.at(-1)!
  h.modes.set(h.parent.id, { mode: 'AUTO' })
  await h.run(h.parent, 'AUTO cannot map this supported model')
  const attempt = h.calls.at(-1)!
  expect({ provider: attempt.provider, model: attempt.model, reasoningEffort: attempt.reasoningEffort })
    .toEqual({ provider: baseline.provider, model: baseline.model, reasoningEffort: baseline.reasoningEffort })
  expect(h.selections).toHaveLength(0)
  expect(h.modes.get(h.parent.id)).toMatchObject({ mode: 'AUTO' })
  expect(h.modes.get(h.parent.id)?.disabled).toBeUndefined()
  const ends = h.parent.session.snapshotEvents().filter(event => event.type === 'turn/end')
  expect((ends.at(-1)!.data as { reason: { kind: string } }).reason.kind).toBe('completed')
})
it('spec Scenario "切回受支持模型后恢复可切换"', async () => {
  const h = await harness()
  h.pickMain('opencode-go', 'deepseek-v4.1-flash')
  expect(await h.callEndpoint('state', { sessionId: h.parent.id })).toMatchObject({
    mode: 'MANUAL',
    autoSupport: { supported: false, provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
  })
  expect(await h.callEndpoint('setMode', { sessionId: h.parent.id, mode: 'AUTO' })).toMatchObject({ mode: 'MANUAL', autoSupport: { supported: false } })
  h.pickMain('claude', 'claude-opus-5-5')
  const supported = await h.callEndpoint('state', { sessionId: h.parent.id })
  expect(supported).toMatchObject({ autoSupport: { supported: true, provider: 'claude', model: 'claude-opus-5-5' } })
  expect(supported.mode).toBe('MANUAL')
  expect(await h.callEndpoint('setMode', { sessionId: h.parent.id, mode: 'AUTO' })).toMatchObject({ mode: 'AUTO', autoSupport: { supported: true } })
})

const deepseek: FamilyStrategy = { id: 'deepseek', label: 'DeepSeek', modelPrefixes: ['deepseek-'], transports: { 'opencode-go': '' }, effortStarts: { 'deepseek-v5': 'medium' }, childModels: { bounded: 'deepseek-v5', analytical: 'deepseek-v5', frontier: 'deepseek-v5' } }
it('spec Scenario "新增家族只需新增策略"', async () => {
 const strategies = [...BUILTIN_STRATEGIES, deepseek]
 expect(() => createRegistry(strategies)).not.toThrow()
 const h = await harness(false, false, 'deepseek', false, {}, strategies)
 expect((await h.callEndpoint('state', { sessionId: h.parent.id })).autoSupport).toMatchObject({ supported: true })
 h.jev.set(json(200, { answers: { depth: { choice: 'higher' } } }))
 await h.run(h.parent, 'main task')
 expect(h.calls.at(-1)).toMatchObject({ provider: 'opencode-go', model: 'deepseek-v5', reasoningEffort: 'high' })
 h.jev.set(json(200, { answers: { capability: { choice: 'bounded' }, depth: { choice: 'baseline' } } }))
 expect((await h.invoke()).isError).not.toBe(true)
 const child = h.handles.at(-1)!.agent
 expect(h.store.get(child.id)).toMatchObject({ status: 'applied', family: 'deepseek', route: { provider: 'opencode-go', model: 'deepseek-v5', reasoningEffort: 'medium' } })
 const judged = h.jev.bodies.length
 await h.restart()
 await h.run(child, 'later message')
 expect(h.calls.at(-1)).toMatchObject({ provider: 'opencode-go', model: 'deepseek-v5', reasoningEffort: 'medium' })
 expect(h.jev.bodies).toHaveLength(judged)
 const tool = h.tools().get('route_subagent') as unknown as { parameters: { properties: { provider: { enum: string[] }; family: { enum: string[] } } } }
 expect(tool.parameters.properties.provider.enum).toContain('opencode-go')
 expect(tool.parameters.properties.family.enum).toContain('deepseek')
})
it('spec Scenario "记录中的家族已不在注册表"', async () => {
 const h = await harness(false, false, 'deepseek', false, {}, [...BUILTIN_STRATEGIES, deepseek])
 h.jev.set(json(200, { answers: { capability: { choice: 'bounded' }, depth: { choice: 'baseline' } } }))
 expect((await h.invoke()).isError).not.toBe(true)
 const child = h.handles.at(-1)!.agent
 const judged = h.jev.bodies.length, requests = h.calls.length
 await h.restart(BUILTIN_STRATEGIES)
 await h.run(child, 'later message')
 expect(h.calls).toHaveLength(requests)
 expect(h.jev.bodies).toHaveLength(judged)
})
const VERSION_KEYS = ['policy', 'policyVersion', 'mappingVersion', 'rubricVersion', 'pluginVersion', 'schema', 'version']
/** Every key at any depth of a JSON value. */
const keysOf = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(keysOf) : value && typeof value === 'object' ? Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]) : []
const noVersionKeys = (label: string, value: unknown) => { for (const key of VERSION_KEYS) expect(keysOf(value), `${label}: ${key}`).not.toContain(key) }
it('spec Scenario "新写入不含版本字段"', async () => {
 const h = await harness(); h.setAnswer('reply')
 const ledger = join(h.home, 'state/auto-model-routing/allocation-feedback.jsonl')
 const before = (() => { try { return readFileSync(ledger, 'utf8') } catch { return '' } })()
 await h.run(h.parent, 'main task')
 const reply = h.parent.session.deriveMessages().findLast(m => m.role === 'assistant')!.id
 expect((await h.invoke()).isError).not.toBe(true)
 const child = h.handles.at(-1)!.agent
 noVersionKeys('state', await h.callEndpoint('state', { sessionId: h.parent.id }))
 const label = await h.callEndpoint('label', { sessionId: h.parent.id, messageId: reply })
 expect(label).toHaveProperty('depth')
 noVersionKeys('label', label)
 const preview = await h.ctx.tools.execute({ name: 'route_subagent', arguments: { task: 'x', provider: 'claude' }, agent: h.parent, callId: 'preview' as never, signal: new AbortController().signal })
 noVersionKeys('route_subagent', preview)
 const dir = join(h.home, 'state/auto-model-routing/policy-v2')
 const record = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')))
 expect(record.length).toBeGreaterThan(0)
 noVersionKeys('child record', record)
 await h.callEndpoint('label', { sessionId: h.parent.id, messageId: reply, feedback: 'too-high' })
 await h.callEndpoint('label', { sessionId: h.parent.id, messageId: reply, feedback: null })
 await h.callEndpoint('observe', { sessionId: h.parent.id, messageId: reply })
 await h.callEndpoint('setMode', { sessionId: h.parent.id, mode: 'MANUAL' })
 const added = readFileSync(ledger, 'utf8').slice(before.length).trim().split('\n').map(l => JSON.parse(l))
 expect(added.map(r => r.type ?? 'binding')).toEqual(expect.arrayContaining(['binding', 'feedback', 'fact']))
 expect(added.filter(r => r.type === 'fact').map(r => r.fact).sort()).toEqual(['exposed', 'manual-switch'])
 noVersionKeys('ledger rows', added)
 expect(added.find(r => !r.type).snapshot).toMatchObject({ strategy: 'claude' })
 const { buildReport } = await import('../src/usage-report.js')
 noVersionKeys('usage report', buildReport(h.home))
 void child
})
const legacyRecord = (childId: string, parentId: string, extra: Record<string, unknown> = {}) => ({ version: 1, childId, parentId, rootId: parentId, policyVersion: 'policy-v2-0000aaaa', mappingVersion: 'capability-slots-1', status: 'applied', path: 'ordinary', family: 'claude', explicit: { provider: 'claude' }, route: { provider: 'claude', model: 'claude-haiku-5-5', reasoningEffort: 'medium' }, actual: { provider: 'claude', model: 'claude-haiku-5-5', reasoningEffort: 'medium' }, ...extra })
const childFile = (home: string, id: string) => join(home, 'state/auto-model-routing/policy-v2', `${createHash('sha256').update(id).digest('hex')}.json`)
async function legacyChild(h: Awaited<ReturnType<typeof harness>>, id: string, record: object | undefined, marker: string | undefined = id) {
 const dir = join(h.home, 'state/auto-model-routing/policy-v2'); mkdirSync(dir, { recursive: true })
 if (record) writeFileSync(childFile(h.home, id), JSON.stringify(record))
 if (marker !== undefined) writeFileSync(`${childFile(h.home, id)}.bound`, marker)
 const child = await h.ctx.agents.create({ sessionId: SessionId(id), parentAgent: h.parent, meta: { origin: 'subagent', parentSession: h.parent.id }, agentOptions: { provider: 'claude', model: 'claude-opus-5-5' } })
 h.handles.push(child)
 return child.agent
}
it('spec Scenario "旧子会话记录恢复不比较版本"', async () => {
 const h = await harness()
 await h.restart()
 const child = await legacyChild(h, 'old-child', legacyRecord('old-child', h.parent.id))
 const judged = h.jev.bodies.length, requests = h.calls.length
 await h.run(child, 'next request')
 expect(h.calls).toHaveLength(requests + 1)
 expect(h.calls.at(-1)).toMatchObject({ provider: 'claude', model: 'claude-haiku-5-5', reasoningEffort: 'medium' })
 expect(h.jev.bodies).toHaveLength(judged)
 const rewritten = JSON.parse(readFileSync(childFile(h.home, 'old-child'), 'utf8'))
 for (const key of ['version', 'policyVersion', 'mappingVersion']) expect(rewritten).not.toHaveProperty(key)
 expect(rewritten.route).toEqual({ provider: 'claude', model: 'claude-haiku-5-5', reasoningEffort: 'medium' })
})
it('spec Scenario "决策记录只容忍已知的历史键"', async () => {
 const h = await harness()
 const ok = await legacyChild(h, 'c-ok', legacyRecord('c-ok', h.parent.id))
 const bad = [
  await legacyChild(h, 'c-task', legacyRecord('c-task', h.parent.id, { task: 'raw task text' })),
  await legacyChild(h, 'c-rout', legacyRecord('c-rout', h.parent.id, { rout: {} })),
  await legacyChild(h, 'c-v2', legacyRecord('c-v2', h.parent.id, { version: 2 })),
  await legacyChild(h, 'c-id', legacyRecord('someone-else', h.parent.id)),
 ]
 await h.run(ok, 'restore')
 expect(h.calls.at(-1)).toMatchObject({ model: 'claude-haiku-5-5', reasoningEffort: 'medium' })
 const judged = h.jev.bodies.length, requests = h.calls.length
 for (const agent of bad) {
  await h.run(agent, 'restore')
 }
 expect(h.calls).toHaveLength(requests)
 expect(h.jev.bodies).toHaveLength(judged)
 for (const id of ['c-task', 'c-rout', 'c-v2', 'c-id']) expect(() => h.store.get(id), id).toThrow('无法恢复')
 const { task: _, ...valid } = legacyRecord('c-write', h.parent.id, { task: 'x' }) as Record<string, unknown>
 const { version: _v, policyVersion: _p, mappingVersion: _m, ...canonical } = valid
 expect(() => h.store.set({ ...canonical, task: 'raw' } as never)).toThrow()
 expect(() => h.store.set(valid as never)).toThrow()
 expect(() => h.store.set(canonical as never)).not.toThrow()
})
it('spec Scenario "绑定标记存在但记录缺失或损坏"', async () => {
 const h = await harness()
 const missing = await legacyChild(h, 'c-missing', undefined)
 const mismatched = await legacyChild(h, 'c-marker', legacyRecord('c-marker', h.parent.id), 'other-id')
 const judged = h.jev.bodies.length, requests = h.calls.length
 await h.run(missing, 'restore'); await h.run(mismatched, 'restore')
 expect(h.calls).toHaveLength(requests)
 expect(h.jev.bodies).toHaveLength(judged)
})
it('spec Scenario "主决策在请求前后的状态"', async () => {
 const h = await harness(false, false, 'claude', false, { efforts: ['max'], defaultEffort: 'max' })
 h.jev.set(json(200, { answers: { depth: { choice: 'higher' } } }))
 const states: unknown[] = []
 // Prepended: this listener runs outermost, so it reads the state after the plugin's pre-step judged.
 h.ctx.on('agent/pre-step', async (payload, next) => { const decision = await next(); if (payload.agent === h.parent && payload.step === 1) states.push(await h.callEndpoint('state', { sessionId: h.parent.id })); return decision }, { prepend: true })
 await h.run(h.parent, 'only max is available')
 expect(states[0]).toMatchObject({ decision: { source: 'main', tier: 'higher', depth: 'higher', effort: '待应用', status: 'recommended' } })
 expect(await h.callEndpoint('state', { sessionId: h.parent.id })).toMatchObject({ reason: 'no-effort-support', decision: { status: 'unsupported' } })
})
it('spec Scenario "完全显式的子任务决策可见"', async () => {
 const h = await harness()
 expect((await h.invoke({ model: 'claude-sonnet-5-5', reasoning_effort: 'low' })).isError).not.toBe(true)
 expect(h.jev.bodies).toHaveLength(0)
 expect((await h.callEndpoint('state', { sessionId: h.parent.id })).decision).toMatchObject({ source: 'subagent', decisionProvider: 'explicit', decisionModel: '未调用', ms: 0, status: 'applied' })
})
it('spec Scenario "切换到不支持的主模型自动锁定"', async () => {
 const h = await harness(false, false, 'claude', false, { provider: 'opencode-go', model: 'deepseek-v4.1-flash', efforts: ['low', 'high', 'max'], defaultEffort: 'max' })
 h.modes.set(h.parent.id, { mode: 'MANUAL' })
 await h.run(h.parent, 'manual baseline')
 const official = h.calls.at(-1)!
 h.modes.set(h.parent.id, { mode: 'AUTO' })
 expect(await h.callEndpoint('state', { sessionId: h.parent.id })).toMatchObject({ mode: 'MANUAL', autoSupport: { supported: false, provider: 'opencode-go', model: 'deepseek-v4.1-flash' } })
 expect(h.modes.get(h.parent.id)?.mode).toBe('MANUAL')
 h.modes.set(h.parent.id, { mode: 'AUTO' })
 await h.run(h.parent, 'next turn')
 expect(h.jev.bodies).toHaveLength(0)
 expect(h.modes.get(h.parent.id)?.mode).toBe('MANUAL')
 const attempt = h.calls.at(-1)!
 expect({ provider: attempt.provider, model: attempt.model, reasoningEffort: attempt.reasoningEffort }).toEqual({ provider: official.provider, model: official.model, reasoningEffort: official.reasoningEffort })
})
