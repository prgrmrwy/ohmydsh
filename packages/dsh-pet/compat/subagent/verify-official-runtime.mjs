#!/usr/bin/env node
// Probe the supplied compiled graph with inert providers; never contact a model or Host.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--graph' || !isAbsolute(args[1])) throw new Error('Usage: verify-official-runtime.mjs --graph /absolute/launcher')
const graph = args[1]
const requireGraph = createRequire(join(graph, 'package.json'))
const load = async name => import(pathToFileURL(requireGraph.resolve(name)).href)
const officialNames = ['subagent', 'agent-loop', 'tools', 'tool-subagent', 'tool-subagent-control', 'tool-workflow', 'tool-ralph'].map(name => `@deepseek-ai/dsh-${name}`)
const manifest = JSON.parse(readFileSync(join(graph, 'package.json'), 'utf8'))
const retained = ['team-membership'].flatMap(group => JSON.parse(readFileSync(new URL(`./${group}.package.template.json`, import.meta.url), 'utf8')).packages.map(spec => spec.name)).sort()
assert.deepEqual(Object.keys(manifest.overrides).filter(name => String(manifest.overrides[name]).startsWith('file:')).sort(), retained, 'only retained extension packages may be overlaid')
const entries = new Map()
for (const name of officialNames) {
  const file = requireGraph.resolve(`${name}/package.json`)
  const pkg = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(pkg.version, '0.2.0-rc.2', `${name} uses the official release`)
  assert.equal(pkg.dsh_compat, undefined, `${name} has no compatibility metadata`)
  assert.equal(manifest.overrides[name], undefined, `${name} is not overridden`)
  assert.equal(manifest.dependencies[name], undefined, `${name} is not a direct compatibility dependency`)
  const entry = realpathSync(requireGraph.resolve(name))
  assert.equal(entry, realpathSync(join(dirname(file), pkg.main)), `${name} resolves its own entry`)
  entries.set(name, entry)
}
// Check resolutions from the actual consumers, not just top-level npm metadata.
for (const name of [...officialNames, '@deepseek-ai/dsh']) {
  const consumer = createRequire(requireGraph.resolve(`${name}/package.json`))
  for (const dependency of ['subagent', 'agent-loop', 'tools'].map(name => `@deepseek-ai/dsh-${name}`)) {
    assert.equal(realpathSync(consumer.resolve(dependency)), entries.get(dependency), `${name} shares ${dependency}`)
  }
}

const [Cordis, Sessions, Agents, Llm, Tools, Prompt, Projections, Loop, Subagent] = await Promise.all([
  'cordis', 'dsh-session', 'dsh-agent', 'dsh-llm', 'dsh-tools', 'dsh-system-prompt', 'dsh-session-projection', 'dsh-agent-loop', 'dsh-subagent',
].map(name => load(`@deepseek-ai/${name}`)))
const ctx = new Cordis.Context()
const subagentContext = new Cordis.Context()
try {
  for (const plugin of [Sessions.default, Agents.default, Llm.default, Prompt.default, Tools.default, Projections.default]) await ctx.plugin(plugin)
  assert.equal(ctx.tools.supportsFinalToolGuardRecheck, undefined, 'official tools has no final guard capability marker')
  const service = new Subagent.default(subagentContext)
  for (const name of ['supportsSettlementNotice', 'supportsIdleContinuableCreate', 'supportsLiveContinuableChildSession', 'supportsIndependentContinuableCreate', 'supportsIndependentChildAgentPreset', 'createIdleContinuable', 'withLiveContinuableChildSession']) assert.equal(service[name], undefined, `retired subagent capability ${name}`)
  const descriptor = Subagent.snapshotSubagentDescriptor({ mode: 'continuable', provider: 'spawn', label: 'official-probe', toolFilter: { allow: ['read'] } })
  assert.equal(Subagent.SUBAGENT_DESCRIPTOR_VERSION, 3, 'reviewed official rc.2 descriptor version')
  assert.equal(descriptor.version, Subagent.SUBAGENT_DESCRIPTOR_VERSION)
  assert.deepEqual(descriptor.toolFilter, { allow: ['read'] }, 'official descriptor preserves tool filtering')

  let effects = 0
  const unexpected = async () => { effects++; throw Error('unexpected provider effect') }
  const provider = { name: 'fake', description: 'inert verifier', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, start: unexpected }
  ctx.provide('subagents', { resolveMaxDepth: value => value === 'provider-managed' ? undefined : value, getProvider: () => provider, listProviders: () => [provider], sendMessage: unexpected, interrupt: unexpected })
  ctx.provide('workflowEngine', { start: unexpected })
  await ctx.plugin(await load('@deepseek-ai/dsh-tool-subagent'), { toolName: 'verifier_delegate', provider: 'fake', maxDepth: 'provider-managed' })
  await ctx.plugin(await load('@deepseek-ai/dsh-tool-subagent-control'))
  await ctx.plugin(await load('@deepseek-ai/dsh-tool-workflow'), { toolName: 'verifier_workflow' })
  await ctx.plugin(await load('@deepseek-ai/dsh-tool-ralph'), { provider: 'fake' })
  const nativeNames = ['verifier_delegate', 'send_message', 'interrupt_agent', 'verifier_workflow', 'ralph']
  for (const name of nativeNames) {
    const tool = ctx.tools.get(name)
    assert.ok(tool, `official native plugin registers ${name}`)
    assert.equal(tool.execute[Symbol.for('dsh.tool.managed-effect')], undefined, `${name} has no retired owner annotation`)
  }
  let bodies = 0
  ctx.tools.register(Tools.defineTool({ name: 'verifier_read', description: 'inert read probe', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => { bodies++; return 'OK' } }))
  class Fake extends Llm.LlmAdapter { async *stream() { throw Error('unexpected model request') } }
  ctx.llm.registerAdapter(['verifier-fake'], new Fake())
  await ctx.plugin(Loop.default, { agents: [], maxParallelToolCalls: 1 })
  assert.equal(ctx.agentLoop.supportsIsolatedQueuedTurnClaim, undefined)
  const agent = await ctx.agentLoop.create('official-runtime-verifier', { provider: 'verifier-fake', model: 'fixture' })
  const invoke = () => agent.ctx.tools.execute({ name: 'verifier_read', arguments: {}, agent, callId: Llm.ToolCallId('official-read'), signal: new AbortController().signal })
  const removeGuard = agent.ctx.tools.guard(() => 'official scoped guard denied')
  const denied = await invoke()
  assert.equal(denied.isError, true)
  assert.ok(JSON.stringify(denied).includes('official scoped guard denied'))
  assert.equal(bodies, 0, 'ordinary scoped guard still blocks before the body')
  removeGuard()
  const allowed = await invoke()
  assert.equal(allowed.isError, false)
  assert.equal(bodies, 1, 'allowed control executes the actual registered body')
  assert.equal(effects, 0)
  console.log(JSON.stringify({ ok: true, graph: realpathSync(graph), officialPackages: Object.fromEntries(entries), retainedOverrides: retained, nativeDefinitions: nativeNames.length, scopedGuardDenial: true, allowedBody: true, effectsInvoked: false, scope: 'official graph and scoped guard; not final guard recheck equivalence or live Pet acceptance' }, null, 2))
} finally { await ctx.fiber.dispose(); await subagentContext.fiber.dispose() }
