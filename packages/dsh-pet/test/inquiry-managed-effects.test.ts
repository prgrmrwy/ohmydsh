import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Agents, { type Agent } from '@deepseek-ai/dsh-agent'
import Sessions from '@deepseek-ai/dsh-session'
import Llm, { type ToolCallId } from '@deepseek-ai/dsh-llm'
import Tools, { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Projections from '@deepseek-ai/dsh-session-projection'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { createInquiryManagedEffects, ManagedEffectDeniedError, MANAGED_EFFECT_ANNOTATION } from '../src/host/inquiry/managed-effects.js'

const scope = { kind: 'main', sessionId: 'agent-1' } as const
const runtimeScope = { kind: 'main', sessionId: 'managed-runtime-test' } as const
const proofFor = (agentId: string, phase: string, extra: Record<string, unknown> = {}) => ({ sessionId: agentId, turn: 7, scope: agentId === 'agent-1' ? scope : runtimeScope, signal: new AbortController().signal, active: true, inquirySegment: { phase, inquiryId: 'inq-1' }, ...extra }) as any
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
async function runtimeHarness() {
  const ctx = new Context()
  for (const plugin of [Sessions, Agents, Llm, Prompt, Tools, Projections]) await ctx.plugin(plugin)
  await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
  expect(ctx.tools.supportsFinalToolGuardRecheck).toBe(true)
  expect(ctx.agentLoop.supportsIsolatedQueuedTurnClaim).toBe(true)
  const agent = await ctx.agentLoop.create('managed-runtime-test', { provider: 'unused', model: 'unused' })
  expect(agent.ctx.tools.supportsFinalToolGuardRecheck).toBe(true)
  return { ctx, agent }
}
function realTool(name: string, body: () => unknown) {
  return defineTool({ name, description: name, parameters: {}, output: { schema: { type: 'boolean' }, render: () => [] }, async execute() { return body() } })
}
async function execute(ctx: Context, agent: Agent, name: string, arguments_: Record<string, unknown> = {}) {
  return ctx.tools.execute({ name, agent, callId: `managed-${name}` as ToolCallId, arguments: arguments_, signal: new AbortController().signal })
}
function definition(name: string, execute: ToolDefinition['execute'] = async () => ({ ok: true })): ToolDefinition {
  return { name, description: name, parameters: { type: 'object', properties: {} }, output: { schema: { type: 'object' }, render: () => [] }, execute } as ToolDefinition
}
const primitiveExecution = (agent: Agent, name: string, token: string, parent?: string) => ({ agent, name, token, parent }) as any
function primitiveAgent(tools: ToolDefinition[]) {
  const listeners = new Map<string, (...args: any[]) => any>()
  const guards: Array<(execution: any) => string | undefined> = []
  const value = { id: 'agent-1', ctx: { on(event: string, listener: (...args: any[]) => any) { listeners.set(event, listener); return () => listeners.delete(event) }, tools: { get(name: string) { return tools.find(tool => tool.name === name) }, guard(guard: (execution: any) => string | undefined) { guards.push(guard); return () => { const i = guards.indexOf(guard); if (i >= 0) guards.splice(i, 1) } } } } } as unknown as Agent
  return { value, listeners, guards }
}

describe('inquiry managed effects identity primitive', () => {
  it('denies a registered definition and same-body aliases resolved from the live catalog', () => {
    const registry = createInquiryManagedEffects(); const body = vi.fn(async () => ({})); const native = definition('native_send', body); const alias = definition('friendly_alias', body); const host = primitiveAgent([native, alias])
    registry.register(native, 'delivery'); registry.install(host.value, () => proofFor('agent-1', 'target'), () => scope)
    expect(() => registry.assertEntry(primitiveExecution(host.value, native.name, 'a'))).toThrow(ManagedEffectDeniedError)
    expect(() => registry.assertEntry(primitiveExecution(host.value, alias.name, 'b'))).toThrow(ManagedEffectDeniedError)
    body.mockClear(); const late = definition('late_alias', body); (host.value.ctx as any).tools.get = (name: string) => name === late.name ? late : [native, alias].find((tool: ToolDefinition) => tool.name === name)
    expect(() => registry.assertEntry(primitiveExecution(host.value, late.name, 'c'))).toThrow(ManagedEffectDeniedError)
    expect(body).not.toHaveBeenCalled()
  })
  it('does not infer managed status from names and leaves unrelated tools alone', () => {
    const registry = createInquiryManagedEffects(); const hostTool = definition('bash'); const host = primitiveAgent([hostTool]); registry.install(host.value, () => proofFor('agent-1', 'target'), () => scope)
    expect(() => registry.assertEntry(primitiveExecution(host.value, 'bash', 't'))).not.toThrow()
  })
  it('allows marked effects in ordinary work', () => {
    const registry = createInquiryManagedEffects(); const tool = definition('native_send'); const host = primitiveAgent([tool]); registry.register(tool, 'communication'); registry.install(host.value, () => proofFor('agent-1', 'ordinary'), () => scope)
    expect(() => registry.assertEntry(primitiveExecution(host.value, tool.name, 't'))).not.toThrow()
  })
  it('retains target provenance if a later lookup is missing, revoked, inactive, or changed generation', async () => {
    const registry = createInquiryManagedEffects(); const body = vi.fn(async () => ({})); const tool = definition('native_send', body); const host = primitiveAgent([tool]); let current: any = proofFor('agent-1', 'target'); let lookup = true
    registry.register(tool, 'delivery'); registry.install(host.value, () => lookup ? current : undefined, () => ({ ...scope, kind: 'child', locusId: 'l', generation: 4 }) as any)
    const exec = primitiveExecution(host.value, tool.name, 't'); await host.listeners.get('tools/pre-execute')!(exec, async () => undefined)
    current = proofFor('agent-1', 'target', { active: false }); lookup = false
    expect(() => registry.assertEntry(exec)).toThrow(ManagedEffectDeniedError); expect(body).not.toHaveBeenCalled()
  })
  it('fails closed for marked entry when actor or execution agent is missing', () => {
    const registry = createInquiryManagedEffects(); const tool = definition('native_send'); const host = primitiveAgent([tool]); registry.register(tool, 'delivery')
    expect(() => registry.assertEntry({ name: tool.name, token: 't' } as any)).toThrow(ManagedEffectDeniedError)
    registry.install(host.value, () => undefined, () => scope); expect(() => registry.assertEntry({ name: tool.name, token: 't' } as any)).toThrow(ManagedEffectDeniedError)
  })
  it('exposes mount state, rejects duplicate actor ids and releases guard/capture state on disposal', () => {
    const registry = createInquiryManagedEffects(); const tool = definition('native_send'); const host = primitiveAgent([tool]); const dispose = registry.install(host.value, () => proofFor('agent-1', 'ordinary'), () => scope)
    expect(registry.installed('agent-1')).toBe(true); expect(() => registry.install(host.value, () => proofFor('agent-1', 'ordinary'), () => scope)).toThrow(); expect(host.guards).toHaveLength(1)
    dispose(); expect(registry.installed('agent-1')).toBe(false); expect(host.guards).toHaveLength(0)
  })
})

describe('inquiry managed effects through real ToolRuntime', () => {
  it('denies marked native definitions and same-body aliases after live catalog registration; ordinary execution succeeds', async () => {
    const h = await runtimeHarness(); const registry = createInquiryManagedEffects(); const body = vi.fn(() => true); const native = realTool('managed_native_send', body); const alias = { ...native, name: 'managed_friendly_alias' }
     expect(alias.execute).toBe(native.execute)
    try {
      h.ctx.tools.register(native); registry.register(native, 'delivery'); h.ctx.tools.register(alias)
      const disposeTarget = registry.install(h.agent, (id) => proofFor(id, 'target'), () => runtimeScope)
      const deniedNative = await execute(h.ctx, h.agent, native.name); const deniedAlias = await execute(h.ctx, h.agent, alias.name)
      expect(deniedNative.isError).toBe(true); expect(deniedAlias.isError).toBe(true); expect(body).not.toHaveBeenCalled()
      const ordinary = { ...native, name: 'managed_ordinary_send' }; h.ctx.tools.register(ordinary)
      disposeTarget()
      registry.register(ordinary, 'delivery')
      const dispose = registry.install(h.agent, (id) => proofFor(id, 'ordinary'), () => runtimeScope)
      const ordinaryResult = await execute(h.ctx, h.agent, ordinary.name); expect(ordinaryResult.isError).toBe(false); expect(body).toHaveBeenCalledTimes(1); dispose()
    } finally { await h.ctx.fiber.dispose() }
  })
  it('consumes the native execute-function annotation independently of tool names and preserves ordinary work', async () => {
    const h = await runtimeHarness(); const registry = createInquiryManagedEffects(); const body = vi.fn(() => true)
    const executeBody = async () => body()
    Object.defineProperty(executeBody, MANAGED_EFFECT_ANNOTATION, { value: 'communication', enumerable: false })
    const tool = realTool('arbitrary_tool_name', body); (tool as any).execute = executeBody
    h.ctx.tools.register(tool)
    try {
      registry.install(h.agent, (id) => proofFor(id, 'target'), () => runtimeScope)
      const denied = await execute(h.ctx, h.agent, tool.name)
      expect(denied.isError).toBe(true); expect(body).not.toHaveBeenCalled()
      expect(JSON.stringify(tool)).not.toContain('dsh.tool.managed-effect')
    } finally { await h.ctx.fiber.dispose() }
  })
  it('recognizes execute aliases from intrinsic annotations without registry registration', async () => {
    const h = await runtimeHarness(); const registry = createInquiryManagedEffects(); const body = vi.fn(() => true)
    const executeBody = async () => body()
    Object.defineProperty(executeBody, MANAGED_EFFECT_ANNOTATION, { value: 'delegation', enumerable: false })
    const original = realTool('native_owner_name', body); (original as any).execute = executeBody
    const alias = { ...original, name: 'renamed_alias' }; h.ctx.tools.register(original); h.ctx.tools.register(alias)
    try {
      registry.install(h.agent, (id) => proofFor(id, 'target'), () => runtimeScope)
      const first = await execute(h.ctx, h.agent, original.name); const second = await execute(h.ctx, h.agent, alias.name)
      expect(first.isError).toBe(true); expect(second.isError).toBe(true); expect(body).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })
  it('allows intrinsically annotated tools in ordinary work', async () => {
    const h = await runtimeHarness(); const registry = createInquiryManagedEffects(); const body = vi.fn(() => true)
    const executeBody = async () => body()
    Object.defineProperty(executeBody, MANAGED_EFFECT_ANNOTATION, { value: 'communication', enumerable: false })
    const tool = realTool('arbitrary_ordinary_name', body); (tool as any).execute = executeBody; h.ctx.tools.register(tool)
    try {
      registry.install(h.agent, (id) => proofFor(id, 'ordinary'), () => runtimeScope)
      const result = await execute(h.ctx, h.agent, tool.name); expect(result.isError).toBe(false); expect(body).toHaveBeenCalledTimes(1)
    } finally { await h.ctx.fiber.dispose() }
  })
  it('denies the actual mounted native owner plugins through Pet policy before effects run', async () => {
    const h = await runtimeHarness(); const registry = createInquiryManagedEffects(); const calls = { start: 0, sendMessage: 0, interrupt: 0, workflow: 0, ralph: 0 }
    const rootRequire = createRequire(resolve(process.env.PET_INQUIRY_LAUNCHER!, 'package.json'))
    const loadNative = (name: string) => import(pathToFileURL(rootRequire.resolve(name)).href)
    const specs = [
      ['@deepseek-ai/dsh-tool-subagent', 'delegation', 'arbitrary_delegate_alias'],
      ['@deepseek-ai/dsh-tool-subagent-control', 'communication', null],
      ['@deepseek-ai/dsh-tool-workflow', 'delegation', 'arbitrary_workflow_alias'],
      ['@deepseek-ai/dsh-tool-ralph', 'delegation', 'ralph'],
    ] as const
    const names = ['arbitrary_delegate_alias', 'send_message', 'interrupt_agent', 'arbitrary_workflow_alias', 'ralph']
    const args: Record<string, Record<string, unknown>> = {
      arbitrary_delegate_alias: { prompt: 'safe verifier probe', description: 'safe verifier probe' },
      send_message: { agent_id: 'verifier-only', message: 'safe verifier probe' },
      interrupt_agent: { agent_id: 'verifier-only' },
      arbitrary_workflow_alias: { script: 'return null', meta: { name: 'verifier-only', description: 'verifier-only' } },
      ralph: { prompt: 'safe verifier probe' },
    }
    try {
      const subagents = {
        resolveMaxDepth(configured: unknown) { return configured === 'provider-managed' ? undefined : configured },
        getProvider(name: string) { return { name, description: 'inert test fixture', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, start: async () => { calls.start++; throw Error('unexpected start') } } },
        listProviders() { return [{ name: 'fake', description: 'inert test fixture', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true } }] },
        async sendMessage() { calls.sendMessage++; throw Error('unexpected sendMessage') },
        async interrupt() { calls.interrupt++; throw Error('unexpected interrupt') },
      }
      h.ctx.provide('subagents', subagents)
      h.ctx.provide('workflowEngine', { async start() { calls.workflow++; throw Error('unexpected workflow') } })
      const [subagent, control, workflow, ralph] = await Promise.all(specs.map(([name]) => loadNative(name)))
      for (const [name] of specs) {
        const manifest = rootRequire.resolve(`${name}/package.json`); const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
        expect(pkg.version, `${name} patched version`).toBe('0.2.0-rc.2-locus-managed-effects.1')
        expect(pkg.dsh_compat?.patchSha256, `${name} patch provenance`).toBe('645f55d882c346310f473437ef57950a27eb6dad1d2ccf670b8e2e453ecbad61')
      }
      await h.ctx.plugin(subagent, { toolName: specs[0][2], provider: 'fake', maxDepth: 'provider-managed' })
      await h.ctx.plugin(control)
      await h.ctx.plugin(workflow, { toolName: specs[2][2] })
      await h.ctx.plugin(ralph, { provider: 'fake' })
      const expected = ['delegation', 'communication', 'communication', 'delegation', 'delegation']
      for (let i = 0; i < names.length; i++) expect(h.ctx.tools.get(names[i])?.execute[Symbol.for('dsh.tool.managed-effect')], names[i]).toBe(expected[i])
      const dispose = registry.install(h.agent, id => proofFor(id, 'target'), () => runtimeScope)
      const results = await Promise.all(names.map(name => execute(h.ctx, h.agent, name, args[name])))
      for (const result of results) { expect(result.isError).toBe(true); expect(JSON.stringify(result)).toContain('Managed effect denied') }
      const late = { ...h.ctx.tools.get('send_message')!, name: 'post_mount_native_alias' }; h.ctx.tools.register(late)
      const lateResult = await execute(h.ctx, h.agent, late.name, args.send_message)
      expect(lateResult.isError).toBe(true); expect(JSON.stringify(lateResult)).toContain('Managed effect denied')
      expect(calls).toEqual({ start: 0, sendMessage: 0, interrupt: 0, workflow: 0, ralph: 0 })
      dispose()
    } finally { await h.ctx.fiber.dispose() }
  })
  it('does not blanket-block an unmarked bash tool during target work', async () => {
    const h = await runtimeHarness(); const registry = createInquiryManagedEffects(); const body = vi.fn(() => true); h.ctx.tools.register(realTool('bash', body))
    try { registry.install(h.agent, (id) => proofFor(id, 'target'), () => runtimeScope); const result = await execute(h.ctx, h.agent, 'bash'); expect(result.isError).toBe(false); expect(body).toHaveBeenCalledTimes(1) }
    finally { await h.ctx.fiber.dispose() }
  })
  it('preserves captured target proof through async wrapper even if owner marks the looked-up tool later', async () => {
    const h = await runtimeHarness(); const registry = createInquiryManagedEffects(); const body = vi.fn(() => true); const tool = realTool('managed_late_mark', body); h.ctx.tools.register(tool)
    let current: any = proofFor(h.agent.id, 'target')
    const entered = deferred(); const paused = deferred()
    h.agent.ctx.on('tools/execute', async (_execution, next) => { entered.resolve(); await paused.promise; return next() })
    try {
      registry.install(h.agent, () => current, () => runtimeScope)
      const pending = execute(h.ctx, h.agent, tool.name)
      await Promise.race([entered.promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for execute wrapper entry')), 7_000))])
      registry.register(tool, 'delivery'); current = undefined; paused.resolve()
      const result = await pending; expect(result.isError).toBe(true); expect(body).not.toHaveBeenCalled()
    } finally { paused.resolve(); await h.ctx.fiber.dispose() }
  })
  it('releases actual actor guard and owner registration through the actor context fiber', async () => {
    const h = await runtimeHarness(); const registry = createInquiryManagedEffects(); const body = vi.fn(() => true); const tool = realTool('managed_disposed', body); h.ctx.tools.register(tool)
    let disposeRegistration!: () => void
    try {
      await h.agent.ctx.effect(() => { disposeRegistration = registry.register(tool, 'delivery'); const uninstall = registry.install(h.agent, () => proofFor(h.agent.id, 'ordinary'), () => runtimeScope); return () => { uninstall(); disposeRegistration() } })
      expect(registry.installed(h.agent.id)).toBe(true)
      await h.ctx.fiber.dispose()
      expect(registry.installed(h.agent.id)).toBe(false)
      expect(body).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })
})
