#!/usr/bin/env node
// Test-only verifier for an exact compiled runtime graph; no provider, home, or real tools.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { realpathSync, readFileSync } from 'node:fs'
import { resolve, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--graph' || !isAbsolute(args[1])) {
  console.error('Usage: node verify-isolated-loop.mjs --graph /absolute/path/to/launcher')
  process.exit(2)
}
const graph = resolve(args[1])
const req = createRequire(`${graph}/package.json`)
const load = async name => import(pathToFileURL(req.resolve(`@deepseek-ai/${name}`)).href)
const [Cordis, Agents, Sessions, Llm, Tools, Prompt, Projections, Loop] = await Promise.all([
  load('cordis'), load('dsh-agent'), load('dsh-session'), load('dsh-llm'),
  load('dsh-tools'), load('dsh-system-prompt'), load('dsh-session-projection'), load('dsh-agent-loop'),
])
const subagentRequire = createRequire(req.resolve('@deepseek-ai/dsh-subagent/package.json'))
const loopEntry = realpathSync(req.resolve('@deepseek-ai/dsh-agent-loop'))
const subagentLoopEntry = realpathSync(subagentRequire.resolve('@deepseek-ai/dsh-agent-loop'))
assert.equal(subagentLoopEntry, loopEntry, 'Subagent and launcher must resolve the same physical loop entry')
console.log(`GRAPH ${realpathSync(graph)} LOOP ${JSON.parse(readFileSync(req.resolve('@deepseek-ai/dsh-agent-loop/package.json'), 'utf8')).version}`)

async function run(kind) {
  const ctx = new Cordis.Context()
  try {
    for (const plugin of [Sessions.default, Agents.default, Llm.default, Prompt.default, Tools.default, Projections.default]) await ctx.plugin(plugin)
    let calls = 0
    class Fake extends Llm.LlmAdapter {
      async *stream() {
        calls++
        const block = { type: 'text', text: 'done' }
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'done' }
        yield { type: 'block-end', index: 0, block }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    ctx.llm.registerAdapter(['fake'], new Fake())
    await ctx.plugin(Loop.default, { agents: [], maxParallelToolCalls: 1 })
    assert.equal(ctx.agentLoop.supportsIsolatedQueuedTurnClaim, true, 'Capability marker must be on the live loop service instance')
    assert.equal(ctx.tools.supportsFinalToolGuardRecheck, true, 'Capability marker must be on the live tools service instance')
    const agent = await ctx.agentLoop.create('verify-isolated-loop', { provider: 'fake', model: 'test' })
    const claims = []
    ctx.on('agent/inbox/claimed', event => claims.push({ id: event.message.id, turn: event.turn }))
    const gui = Llm.createUserMessage({ content: [{ type: 'text', text: 'GUI before' }], source: { kind: 'user' } })
    const question = Llm.createUserMessage({ content: [{ type: 'text', text: 'tag question memory' }], source: { kind } })
    agent.send(gui, 'next-step', false)
    agent.followup(question)
    await agent.whenIdle()
    const turn = id => claims.find(claim => claim.id === id)?.turn
    assert.equal(turn(question.id), 1, `${kind} must claim the queued head on turn 1`)
    assert.equal(turn(gui.id), kind === 'user' ? 1 : 2, 'Ordinary GUI next-step behavior must remain intact')
    assert.equal(calls, kind === 'user' ? 1 : 2)
    assert.equal(agent.inbox.nextStep.length, 0)
    if (typeof ctx.agentLoop.probeIsolatedQueuedTurnClaim === 'function') {
      const probe = ctx.agentLoop.probeIsolatedQueuedTurnClaim({ nextStepId: 'probe-gui', nextTurnId: 'probe-inquiry' })
      assert.deepEqual(probe.claimedMessageIds, ['probe-inquiry'])
      assert.deepEqual(probe.pendingNextStepIds, ['probe-gui'])
      console.log('PASS live service isolated queued-turn probe claims only inquiry and preserves GUI')
    } else {
      throw new Error('Live service is missing probeIsolatedQueuedTurnClaim')
    }
    console.log(`PASS ${kind} queued-head claim and GUI next-step behavior`)
  } finally {
    await ctx.fiber.dispose()
  }
}

async function runToolGuard() {
  const ctx = new Cordis.Context()
  try {
    for (const plugin of [Sessions.default, Agents.default, Llm.default, Prompt.default, Tools.default, Projections.default]) await ctx.plugin(plugin)
    class Fake extends Llm.LlmAdapter { async *stream() {} }
    ctx.llm.registerAdapter(['fake'], new Fake())
    let effects = 0
    const probe = {
      description: 'Verifier-only side-effect probe',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => { effects++; return 'ran' },
    }
    ctx.tools.register({ name: 'guard_probe', ...probe })
    ctx.tools.register({ name: 'guard_probe_alias', ...probe })
    let active = true
    let release
    let entered
    const reached = new Promise(resolve => { entered = resolve })
    const barrier = new Promise(resolve => { release = resolve })
    ctx.tools.guard(exec => active ? undefined : `revoked:${exec.name}`)
    ctx.on('tools/execute', async (_exec, next) => { entered(); await barrier; return next() })
    await ctx.plugin(Loop.default, { agents: [], maxParallelToolCalls: 1 })
    assert.equal(ctx.tools.supportsFinalToolGuardRecheck, true, 'Capability marker must be on the live tools service instance')
    const agent = await ctx.agentLoop.create('verify-tool-guard', { provider: 'fake', model: 'test' })
    const invoke = name => ctx.tools.execute({ name, arguments: {}, agent, callId: Llm.ToolCallId(`probe-${name}`), signal: new AbortController().signal })
    const revoked = invoke('guard_probe')
    await reached
    active = false
    release()
    const denied = await revoked
    assert.equal(denied.isError, true, 'Revoked execution must return canonical error result')
    assert.equal(effects, 0, 'Revocation during awaited tools/execute wrapper must prevent tool body effects')
    console.log('PASS final tool guard recheck blocks revoked dispatch after awaited wrapper')

    active = true
    const allowed = await invoke('guard_probe')
    assert.equal(allowed.isError, false)
    assert.equal(effects, 1)
    active = false
    const aliasDenied = await invoke('guard_probe_alias')
    assert.equal(aliasDenied.isError, true, 'Alias must be denied while the final guard is inactive')
    assert.equal(effects, 1, 'Denied alias must not invoke its shared body')
    console.log('PASS ordinary allowed dispatch and alias denial maintain side-effect count')
  } finally {
    await ctx.fiber.dispose()
  }
}

for (const kind of ['user', 'pet-inquiry', 'pet-inquiry-result']) await run(kind)
await runToolGuard()
