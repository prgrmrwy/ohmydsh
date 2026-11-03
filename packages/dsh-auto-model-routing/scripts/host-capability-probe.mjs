// Run against a separately installed, pinned official host; never the active GUI.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const home = process.argv[2]
assert(home, 'Usage: node host-capability-probe.mjs <isolated npm prefix>')
const requireHost = createRequire(join(resolve(home), 'package.json'))
const load = name => import(pathToFileURL(requireHost.resolve(`@deepseek-ai/${name}`)).href)
const names = ['cordis', 'dsh-agent', 'dsh-agent-loop', 'dsh-session', 'dsh-session-projection',
  'dsh-system-prompt', 'dsh-tools', 'dsh-llm', 'dsh-session-persistence-jsonl', 'dsh-subagent',
  'dsh-subagent-spawn-in-process', 'dsh-subagent-fork-in-process', 'dsh-experimental-agent-team', 'dsh-session-query-sqlite']
for (const name of names) {
  const pkg = JSON.parse(await readFile(requireHost.resolve(`@deepseek-ai/${name}/package.json`), 'utf8'))
  assert.equal(pkg.version, name === 'cordis' ? '4.0.4' : '0.2.0-rc.2', `Unexpected version: ${name}`)
}
const [ { Context }, Agents, Loop, Sessions, Projections, Prompt, Tools, Llm, Persistence,
  Subagents, Spawn, Fork, Team, Query ] = await Promise.all(names.map(load))
const { LlmAdapter, createUserMessage } = Llm
// Only fake adapters are registered. Catch accidental fetches as an additional guard.
globalThis.fetch = () => { throw new Error('Network forbidden in capability probe') }
const data = await mkdtemp(join(tmpdir(), 'dsh-routing-evidence-'))
const decisionFile = join(data, 'probe-decisions.json')
const signal = AbortSignal.timeout(30_000)
const content = text => [{ type: 'text', text }]
const user = text => createUserMessage({ content: content(text), source: { kind: 'user' } })
const textOf = messages => messages.flatMap(m => m.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n')
const baseline = { provider: 'probe', model: 'parent', reasoningEffort: 'medium' }
const cases = { 'probe-light': { provider: 'probe', model: 'small', reasoningEffort: 'high' },
  'probe-deep': { provider: 'probe-other', model: 'large', reasoningEffort: 'low' } }
const results = []

async function host({ replay = true } = {}) {
  const ctx = new Context()
  const plugins = [], handles = [], calls = [], entered = [], seen = new Map()
  let decisions = new Map()
  try { decisions = new Map(JSON.parse(await readFile(decisionFile, 'utf8'))) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  class Adapter extends LlmAdapter {
    constructor(provider) { super(); this.provider = provider }
    async listModels(provider) { return ['parent', 'small', 'large'].map(id => ({ provider, id, name: id })) }
    async resolveModel(provider, model) { return { provider, id: model, name: model,
      reasoning: { efforts: ['low', 'medium', 'high'].map(id => ({ id, name: id })) } } }
    async *stream(request) {
      calls.push({ ...request, provider: this.provider })
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'probe-ok' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'probe-ok' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  for (const p of [Projections, Sessions, Agents, Prompt, Tools, Llm]) plugins.push(await ctx.plugin(p.default))
  plugins.push(await ctx.plugin(Persistence.default, { root: join(data, 'sessions'), compression: 'none' }))
  plugins.push(await ctx.plugin(Query.default, { path: ':memory:', openAt: 'never' }))
  plugins.push(await ctx.plugin(Loop.default, { agents: [] }))
  for (const provider of ['probe', 'probe-other']) ctx.llm.registerAdapter([provider], new Adapter(provider))
  plugins.push(await ctx.plugin(Subagents.default))
  plugins.push(await ctx.plugin(Spawn, { providerName: 'spawn' }))
  plugins.push(await ctx.plugin(Fork, { providerName: 'fork' }))
  plugins.push(await ctx.plugin(Team.default))
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const { agent } = payload
    seen.set(agent.id, agent)
    entered.push({ id: agent.id, parent: agent.session.header.parentSession, text: textOf(decision.messages) })
    if (agent.session.header.origin === 'subagent' && !decisions.has(agent.id)) {
      // Synthetic labels are a test oracle, not a production decision-to-child binding scheme.
      const label = Object.keys(cases).find(key => textOf(decision.messages).includes(key))
      if (label) decisions.set(agent.id, cases[label])
    }
    return decision
  })
  ctx.on('agent/request', async ({ agent }, next) => {
    const config = await next()
    return replay && decisions.has(agent.id) ? { ...config, ...decisions.get(agent.id) } : config
  }, { prepend: true })
  const run = async (agent, text) => { agent.followup(user(text)); await agent.whenIdle() }
  const settle = async id => {
    const agent = ctx.agents.get(id) ?? seen.get(id)
    assert(agent, `Child never observed: ${id}`)
    await agent.whenIdle()
    return agent
  }
  const check = (agent, expected) => {
    const actual = agent.session.requestHeader().config
    for (const key of ['provider', 'model', 'reasoningEffort']) assert.equal(actual[key], expected[key], `${agent.id}: ${key}`)
    const actualCall = calls.findLast(c => c.sessionId === agent.id)
    assert(actualCall, 'Adapter never received this child identity')
    for (const key of ['provider', 'model', 'reasoningEffort']) assert.equal(actualCall[key], expected[key], `Adapter ${agent.id}: ${key}`)
  }
  return { ctx, calls, entered, decisions, run, settle, check,
    async parent(resumeSessionId) {
      const handle = await (resumeSessionId ? ctx.agents.resume({ resumeSessionId, agentOptions: baseline }) : ctx.agents.create({ sessionId: randomUUID(), agentOptions: baseline, meta: { cwd: data } }))
      handles.push(handle)
      return handle.agent
    },
    async close() {
      await writeFile(decisionFile, JSON.stringify([...decisions]))
      for (const h of handles.reverse()) await h.dispose()
      for (const p of plugins.reverse()) await p.dispose()
    }
  }
}

let h = await host()
let parentId, spawnId, teamId
try {
  const parent = await h.parent(); parentId = parent.id
  await h.run(parent, 'parent-history-marker')
  h.check(parent, baseline)
  for (const provider of ['spawn', 'fork']) {
    const run = await h.ctx.subagents.start(provider, { parent, prompt: content('probe-deep'), signal })
    try {
      const result = await run.result
      assert.notEqual(result.stopReason, 'error')
      h.check(run.localAgent, cases['probe-deep'])
      assert.equal(run.localAgent.session.header.parentSession, parent.id)
      assert(h.entered.some(e => e.id === run.id && e.text.includes('probe-deep')))
    } finally { await run.dispose() }
    results.push(`PASS one-shot ${provider}: exact child and actual adapter request`)
  }
  const children = await Promise.all(['probe-light', 'probe-deep'].map(text => h.ctx.subagents.startContinuable({
    provider: 'spawn', label: text, request: { parent, prompt: content(text) }, signal,
  })))
  spawnId = children[0].childId
  for (let i = 0; i < children.length; i++) {
    const agent = await h.settle(children[i].childId)
    h.check(agent, cases[i === 0 ? 'probe-light' : 'probe-deep'])
    assert.equal(agent.session.header.parentSession, parent.id)
    assert(h.entered.some(e => e.id === agent.id && e.text.includes(i === 0 ? 'probe-light' : 'probe-deep')))
  }
  h.check(parent, baseline)
  results.push('PASS spawn: concurrent identities, task visibility, actual model+effort, parent unchanged')
  const fork = await h.ctx.subagents.startContinuable({ provider: 'fork', label: 'fork', request: { parent, prompt: content('probe-deep') }, signal })
  const forkAgent = await h.settle(fork.childId)
  h.check(forkAgent, cases['probe-deep'])
  assert.equal(forkAgent.session.header.parentSession, parent.id)
  assert(h.entered.some(e => e.id === fork.childId && e.text.includes('probe-deep') && !e.text.includes('parent-history-marker')))
  assert(textOf(forkAgent.session.deriveMessages()).includes('parent-history-marker'))
  results.push('PASS fork: inherited text history retained, cross-fake-provider request applied')
  const team = await h.ctx.agentTeams.spawnTeammate(parent, { name: 'probe-member', description: 'offline probe', context: 'fresh', provider: 'spawn', prompt: content('probe-light'), signal })
  teamId = team.member.id
  const member = await h.settle(teamId)
  h.check(member, cases['probe-light'])
  assert.equal(member.session.header.parentSession, parent.id)
  assert(h.entered.some(e => e.id === teamId && e.text.includes('probe-light')))
  const beforeFollowup = h.calls.filter(c => c.sessionId === teamId).length
  await h.ctx.agentTeams.sendMessage(parent, { target: 'probe-member', content: content('probe-deep follow-up must not reselect'), signal })
  h.check(await h.settle(teamId), cases['probe-light'])
  assert(h.calls.filter(c => c.sessionId === teamId).length > beforeFollowup)
  assert(h.entered.some(e => e.id === teamId && e.text.includes('follow-up must not reselect')))
  await h.run(parent, 'parent-after-children')
  h.check(parent, baseline)
  results.push('PASS teammate: official service creation and subsequent message retain initial route')
} finally { await h.close() }

h = await host({ replay: false })
try {
  const parent = await h.parent(parentId)
  await h.ctx.subagents.sendMessage(parent, spawnId, content('resume-without-replay'), { signal })
  h.check(await h.settle(spawnId), baseline)
  results.push('PASS negative control: cold child resume without decision replay restores descriptor baseline')
} finally { await h.close() }

h = await host()
try {
  const parent = await h.parent(parentId)
  await h.ctx.subagents.sendMessage(parent, spawnId, content('resume-with-replay'), { signal })
  h.check(await h.settle(spawnId), cases['probe-light'])
  await h.ctx.agentTeams.sendMessage(parent, { target: 'probe-member', content: content('cold-team-follow-up'), signal })
  h.check(await h.settle(teamId), cases['probe-light'])
  results.push('PASS cold resume: plugin-owned persisted identity decisions restore spawn and teammate routes')
} finally { await h.close() }
console.log(results.join('\n'))
console.log('LIMIT: service-level fake-adapter probe, not deployed tool schemas, real provider compatibility, or production AUTO')
console.log(`Synthetic evidence directory: ${data}`)
