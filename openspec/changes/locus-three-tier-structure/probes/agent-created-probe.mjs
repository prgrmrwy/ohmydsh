// Isolated probe: stock DSH 0.2.0-rc.2 packages, fake LLM, temp session root. No Host, no ~/.dsh.
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const graph = process.argv[2]
const req = createRequire(join(graph, 'package.json'))
const load = n => import(pathToFileURL(req.resolve(`@deepseek-ai/${n}`)).href)
const ver = n => JSON.parse(readFileSync(req.resolve(`@deepseek-ai/${n}/package.json`), 'utf8')).version
const names = ['cordis', 'dsh-session', 'dsh-session-persistence-jsonl', 'dsh-agent', 'dsh-llm', 'dsh-system-prompt', 'dsh-tools', 'dsh-session-projection', 'dsh-agent-loop', 'dsh-subagent', 'dsh-subagent-spawn-in-process', 'dsh-session-query']
const M = Object.fromEntries(await Promise.all(names.map(async n => { const m = await load(n); return [n, m.default && !m.apply ? m : { ...m, default: m.default ?? m }] })))
console.log('versions', names.slice(1).map(n => `${n}@${ver(n)}`).join(' '))
const t0 = Date.now()
const ev = line => console.log(`+${Date.now() - t0}ms ${line}`)
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function run(mode) {
  const ctx = new M.cordis.Context()
  const root = mkdtempSync(join(tmpdir(), 'locus-probe-'))
  await ctx.plugin(M['dsh-session'].default)
  await ctx.plugin(M['dsh-session-persistence-jsonl'].default, { root })
  await ctx.plugin(M['dsh-session-query'].default)
  for (const n of ['dsh-agent', 'dsh-llm', 'dsh-system-prompt', 'dsh-tools', 'dsh-session-projection']) await ctx.plugin(M[n].default)
  class Fake extends M['dsh-llm'].LlmAdapter {
    async *stream() {
      const block = { type: 'text', text: 'ok' }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'ok' }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['fake'], new Fake())
  await ctx.plugin(M['dsh-agent-loop'].default, { agents: [], maxParallelToolCalls: 1 })
  await ctx.plugin(M['dsh-subagent'].default)
  await ctx.plugin(M['dsh-subagent-spawn-in-process'].default)
  let childId
  let createdSeen = 0
  ctx.on('agent/created', ({ agent, source }) => {
    const who = childId !== undefined && agent.id === childId ? 'child' : agent.session?.header?.origin === 'subagent' ? 'child(pre-id)' : 'root'
    ev(`[${mode}] agent/created source=${source} who=${who} id=${String(agent.id).slice(0, 8)}`)
    if (who !== 'root') createdSeen++
    if (mode === 'veto-resume' && source === 'resume' && who !== 'root') throw new Error('probe veto on resume')
    if (mode === 'veto-create' && source !== 'resume' && who !== 'root') throw new Error('probe veto on create')
  })
  ctx.on('agent/inbox/claimed', e => ev(`[${mode}] inbox/claimed agent=${String(e.agent?.id ?? '?').slice(0, 8)} turn=${e.turn}`))
  const parent = await ctx.agentLoop.create('probe-parent', { provider: 'fake', model: 'test' })
  const signal = new AbortController().signal
  try {
    const start = await ctx.subagents.startContinuable({ provider: 'spawn', label: 'probe', request: { prompt: [{ type: 'text', text: 'first prompt' }], parent }, signal })
    childId = start.childId
    ev(`[${mode}] startContinuable returned child=${String(childId).slice(0, 8)}`)
  } catch (e) { ev(`[${mode}] startContinuable rejected: ${e?.message}`); return }
  for (let i = 0; i < 400 && ctx.agents.get(childId); i++) await sleep(25)
  ev(`[${mode}] child resident after idle wait: ${!!ctx.agents.get(childId)}`)
  try {
    await ctx.subagents.sendMessage(parent, childId, [{ type: 'text', text: 'second' }], { signal })
    ev(`[${mode}] sendMessage accepted`)
    await sleep(1500)
  } catch (e) { ev(`[${mode}] sendMessage rejected: ${e?.message}`) }
  ev(`[${mode}] child resident at end: ${!!ctx.agents.get(childId)}; child agent/created count=${createdSeen}`)
}
for (const mode of ['observe', 'veto-resume', 'veto-create']) {
  try { await run(mode) } catch (e) { ev(`[${mode}] FAILED ${e?.stack?.split('\n').slice(0, 4).join(' | ')}`) }
}
process.exit(0)
