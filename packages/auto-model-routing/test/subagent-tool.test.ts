import { afterEach, expect, it } from 'vitest'
import { routeSubagentTool } from '../src/subagent-tool.js'
import { JevClient } from '../src/jev.js'
import { tiers } from '../src/effort.js'
import { RoutingState, type SessionState } from '../src/state.js'
import { fakeJev, json, tier, type Reply } from './fake-jev.js'

const env = { get: (name: string) => name === 'OPENROUTER_API_KEY' ? { value: 'sk-or-test' } : undefined }
let close: (() => Promise<void>) | undefined
afterEach(async () => { await close?.(); close = undefined })

interface FakeAgent { id: string; session: { header: { origin?: 'subagent'; parentSession?: string } } }
const session = (id: string, parent?: string): FakeAgent => ({ id, session: { header: parent ? { origin: 'subagent', parentSession: parent } : {} } })

async function tool(reply: Reply, modes: Record<string, 'AUTO' | 'MANUAL'> = { S1: 'AUTO' }, live: FakeAgent[] = [session('S1')]) {
 const server = await fakeJev(reply); close = server.close
 const disk = new Map<string, SessionState>()
 const state = new RoutingState({ get: id => disk.get(id), set: (id, v) => { disk.set(id, v) } })
 for (const [id, mode] of Object.entries(modes)) state.setMode(id, mode)
 const registry = new Map(live.map(agent => [agent.id, agent]))
 const judged: unknown[] = []
 const def = routeSubagentTool(new JevClient(env, server.base, 300), { agents: { get: (id: string) => registry.get(id) as never }, state, judged: (id, value) => judged.push({ id, ...value }) })
 return { server, def, state, disk, judged }
}
const exec = (agent: FakeAgent | undefined = session('S1'), signal = new AbortController().signal) => ({ signal, agent }) as never

it('tool_returns_table_entry', async () => {
 const { def, server } = await tool(tier('simple'))
 expect(def.name).toBe('route_subagent')
 expect(def.description).toMatch(/OpenRouter/)
 const expected = {
  claude: [['claude-haiku-5-5', 'low'], ['claude-sonnet-5-5', 'medium'], ['claude-opus-5-5', 'high'], ['claude-opus-5-5', 'xhigh']],
  codex: [['gpt-6-luna', 'medium'], ['gpt-6.1-sol', 'medium'], ['gpt-6.1-sol', 'high'], ['gpt-6.1-sol', 'xhigh']],
 }
 for (const provider of ['claude', 'codex'] as const) {
  for (const [i, t] of tiers.entries()) {
   server.set(tier(t))
   const [model, reasoning_effort] = expected[provider][i]!
   expect(await def.execute({ task: '排查多个模块', provider }, exec())).toEqual({ tier: t, provider, model, reasoning_effort })
  }
 }
 // The task is redacted before it leaves.
 await def.execute({ task: 'deploy with token=abc123def456', provider: 'claude' }, exec())
 const sent = server.bodies.at(-1) as { state: string }
 expect(sent.state).toBe('Previous user-turn tier: none\nUser message:\ndeploy with token=<redacted>')
})

it('child_model_not_capped_by_caller', async () => {
 const { def, server } = await tool(tier('escalated'))
 expect(await def.execute({ task: '证明并发正确性', provider: 'claude' }, exec())).toEqual({ tier: 'escalated', provider: 'claude', model: 'claude-opus-5-5', reasoning_effort: 'xhigh' })
 const seen: string[] = []
 for (const provider of ['claude', 'codex'] as const) for (const t of tiers) {
  server.set(tier(t))
  const result = await def.execute({ task: 'x', provider }, exec()) as { model: string; reasoning_effort: string }
  seen.push(result.model, result.reasoning_effort)
 }
 expect(seen).not.toContain('claude-fable-5-1')
 expect(seen).not.toContain('gpt-6-astra')
 expect(seen).not.toContain('max')
})

it('manual_root_skips_jev', async () => {
 const manual = { routed: false, reason: 'manual' }
 // S1 set MANUAL by the user, C1 its child; C2's parent S2 is AUTO but not in the live registry.
 const { def, server, state, judged } = await tool(tier('complex'), { S1: 'MANUAL', S2: 'AUTO' }, [session('S1'), session('C1', 'S1'), session('C2', 'S2')])
 for (const caller of ['S1', 'C1', 'C2']) {
  const result = await def.execute({ task: 'x', provider: 'claude' }, exec(caller === 'S1' ? session('S1') : session(caller, caller === 'C1' ? 'S1' : 'S2')))
  expect(result, caller).toEqual(manual)
  expect(def.output!.render({} as never, result as never)[0]).toMatchObject({ text: expect.stringContaining('按官方默认委派') })
 }
 // Disabled by a Jev failure counts as MANUAL too.
 state.setMode('S1', 'AUTO'); state.disable('S1', 'insufficient-credits')
 expect(await def.execute({ task: 'x', provider: 'claude' }, exec(session('S1')))).toEqual(manual)
 expect(server.bodies).toHaveLength(0)
 expect(judged).toHaveLength(0)
})

it('nested_child_follows_root_mode', async () => {
 const live = [session('S1'), session('C1', 'S1'), session('C2', 'C1')]
 const { def, server, judged } = await tool(tier('standard'), { S1: 'AUTO' }, live)
 expect(await def.execute({ task: 'x', provider: 'claude' }, exec(live[2]))).toEqual({ tier: 'standard', provider: 'claude', model: 'claude-sonnet-5-5', reasoning_effort: 'medium' })
 expect(server.bodies).toHaveLength(1)
 // A child caller has no chip: nothing is recorded for S1.
 expect(judged).toHaveLength(0)
})

it('tool_failure_reports_without_state_change', async () => {
 const { def, disk } = await tool(json(402, {}))
 const before = structuredClone(disk.get('S1'))
 await expect(def.execute({ task: 'x', provider: 'claude' }, exec())).rejects.toThrow(/余额不足.*暂停委派并询问用户/)
 expect(disk.get('S1')).toEqual(before)
 expect(disk.get('S1')).toEqual({ mode: 'AUTO' })
 await close?.(); close = undefined
 const controller = new AbortController(); controller.abort()
 const held = await tool(() => {})
 const error = await held.def.execute({ task: 'x', provider: 'claude' }, exec(session('S1'), controller.signal)).catch((e: Error) => e)
 expect(String(error)).toMatch(/已取消/)
 expect(String(error)).not.toMatch(/余额|凭据|OPENROUTER/)
})
