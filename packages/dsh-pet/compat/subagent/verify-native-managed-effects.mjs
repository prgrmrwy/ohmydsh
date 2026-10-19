#!/usr/bin/env node
// Read-only verifier for the exact compiled launcher graph. It mounts only
// upstream native tool plugins and inert provider/engine ports; no real effects.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const PATCH = '645f55d882c346310f473437ef57950a27eb6dad1d2ccf670b8e2e453ecbad61'
const VERSION = '0.2.0-rc.2-locus-managed-effects.1'
const specs = [
  ['@deepseek-ai/dsh-tool-subagent', 'delegation', 'arbitrary_delegate_alias'],
  ['@deepseek-ai/dsh-tool-subagent-control', 'communication', null],
  ['@deepseek-ai/dsh-tool-workflow', 'delegation', 'arbitrary_workflow_alias'],
  ['@deepseek-ai/dsh-tool-ralph', 'delegation', 'ralph'],
]
const args = process.argv.slice(2)
const graph = args[1]
if (args.length !== 2 || args[0] !== '--graph' || !isAbsolute(graph)) {
  console.error('Usage: node verify-native-managed-effects.mjs --graph /absolute/path/to/launcher')
  process.exit(2)
}
const requireGraph = createRequire(join(graph, 'package.json'))
const load = async name => import(pathToFileURL(requireGraph.resolve(name)).href)
const [Cordis, Sessions, Agents, Llm, Tools, Prompt, Projections] = await Promise.all([
  ...['@deepseek-ai/cordis', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-session-projection'].map(load),
])
const packageData = new Map()
const hostToolsEntry = realpathSync(requireGraph.resolve('@deepseek-ai/dsh-tools'))
for (const [name] of specs) {
  const manifest = requireGraph.resolve(`${name}/package.json`)
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
  assert.equal(pkg.version, VERSION, `${name} must be the patched build`)
  assert.equal(pkg.dsh_compat?.upstreamBase, '639ed015397290b3745d163aafe02ffee4aa3f84', `${name} upstream provenance`)
  assert.equal(pkg.dsh_compat?.patchSha256, PATCH, `${name} patch provenance`)
  const physical = realpathSync(requireGraph.resolve(name))
  assert.equal(physical, realpathSync(join(dirname(manifest), pkg.main)), `${name} entry resolves to its own package`)
  const packageRequire = createRequire(manifest)
  assert.equal(realpathSync(packageRequire.resolve('@deepseek-ai/dsh-tools')), hostToolsEntry, `${name} resolves the same physical tools package as the host`)
  packageData.set(name, { manifest, pkg, physical })
}
const symbols = Symbol.for('dsh.tool.managed-effect')
let checks = 0
const ctx = new Cordis.Context()
try {
  for (const plugin of [Sessions.default, Agents.default, Llm.default, Prompt.default, Tools.default, Projections.default]) await ctx.plugin(plugin)
  const providerStarts = { start: 0, sendMessage: 0, interrupt: 0, workflow: 0, ralph: 0 }
  const subagents = {
    resolveMaxDepth(configured) { return configured === 'provider-managed' ? undefined : configured },
    getProvider(name) { return { name, description: 'inert verifier fixture', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, start: async () => { providerStarts.start++; throw Error('unexpected start') } } },
    listProviders() { return [{ name: 'fake', description: 'inert verifier fixture', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true } }] },
    sendMessage: async () => { providerStarts.sendMessage++; throw Error('unexpected sendMessage') },
    interrupt: async () => { providerStarts.interrupt++; throw Error('unexpected interrupt') },
  }
  ctx.provide('subagents', subagents)
  const toolSubagent = await load(specs[0][0]); const toolControl = await load(specs[1][0])
  const workflow = await load(specs[2][0]); const ralph = await load(specs[3][0])
  // Configured names deliberately prove ownership survives arbitrary aliases.
  const fakeEngine = { start: async () => { providerStarts.workflow++; throw Error('unexpected workflow') } }
  ctx.provide('workflowEngine', fakeEngine)
  await ctx.plugin(toolSubagent, { toolName: specs[0][2], provider: 'fake', maxDepth: 'provider-managed' })
  await ctx.plugin(toolControl)
  await ctx.plugin(workflow, { toolName: specs[2][2] })
  await ctx.plugin(ralph, { provider: 'fake' })
  const owned = [
    [specs[0][2], 'delegation'], ['send_message', 'communication'],
    ['interrupt_agent', 'communication'], [specs[2][2], 'delegation'], ['ralph', 'delegation'],
  ]
  for (const [name, effect] of owned) {
    const def = ctx.tools.get(name)
    assert.ok(def, `actual native plugin mounted ${name}`)
    assert.equal(def.execute[symbols], effect, `${name} retains native owner annotation`)
    checks++
  }
  assert.equal(ctx.tools.supportsFinalToolGuardRecheck, true, 'patched tools final guard marker is active')
  let allowedCalls = 0
  ctx.tools.register(Tools.defineTool({ name: 'verifier_ordinary', description: 'safe test probe', parameters: {}, output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }, execute: async () => { allowedCalls++; return 'OK' } }))
  class Fake extends Llm.LlmAdapter { async *stream() { throw Error('unexpected LLM request') } }
  const fake = new Fake()
  ctx.llm.registerAdapter(['verifier-fake'], fake)
  const Loop = await load('@deepseek-ai/dsh-agent-loop')
  await ctx.plugin(Loop.default, { agents: [], maxParallelToolCalls: 1 })
  assert.equal(ctx.agentLoop.supportsIsolatedQueuedTurnClaim, true, 'patched isolated loop marker is active')
  const agent = await ctx.agentLoop.create('native-managed-effects-verifier', { provider: 'verifier-fake', model: 'fixture' })
  let guardHits = 0
  agent.ctx.tools.guard(exec => { if (exec.name !== 'verifier_ordinary' && agent.ctx.tools.get(exec.name, exec.agent)?.execute[symbols]) { guardHits++; return `native-owner test guard denied ${exec.name}` } })
  const validArguments = {
    [specs[0][2]]: { prompt: 'safe verifier probe', description: 'safe verifier probe' },
    send_message: { agent_id: 'verifier-only', message: 'safe verifier probe' },
    interrupt_agent: { agent_id: 'verifier-only' },
    [specs[2][2]]: { script: 'return null', meta: { name: 'verifier-only', description: 'verifier-only' } },
    ralph: { prompt: 'safe verifier probe' },
  }
  const invoke = name => agent.ctx.tools.execute({ name, arguments: validArguments[name] ?? {}, agent, callId: Llm.ToolCallId(`verify-${name}`), signal: new AbortController().signal })
  for (const [name] of owned) {
    const result = await invoke(name)
    assert.equal(result.isError, true, `${name} rejected by final native-owner guard`)
    assert.ok(JSON.stringify(result).includes('native-owner test guard denied'), `${name} reached guard rather than schema/error path`)
    checks++
  }
  const ordinary = await invoke('verifier_ordinary')
  assert.equal(ordinary.isError, false); assert.equal(allowedCalls, 1)
  assert.equal(guardHits, owned.length)
  assert.deepEqual(providerStarts, { start: 0, sendMessage: 0, interrupt: 0, workflow: 0, ralph: 0 })
  console.log(JSON.stringify({ ok: true, graph: realpathSync(graph), checks, nativeOwnedDefinitions: owned.length, guardDenials: guardHits, ordinaryAllowed: true, effectsInvoked: false, scope: 'actual mounted native ownership annotations plus final tool-guard interaction; not Pet policy validation' }, null, 2))
} finally { await ctx.fiber.dispose() }
