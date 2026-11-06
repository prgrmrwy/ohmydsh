import { afterEach, expect, it } from 'vitest'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { resolvePreset } from '../src/presets/index.js'
import { closeHarness, depth, harness as mainHarness, lastAssistantId } from './host-harness.js'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { callTool, closePolicyHarness, harness as childHarness } from './policy-harness.js'

afterEach(async () => { await closeHarness(); await closePolicyHarness() })

const EAV = resolvePreset('effort-as-verification').rubric
const RD = resolvePreset('reasoning-depth').rubric
const MAIN_LINE = 'Execution: main conversation.'
const CHILD_LINE = 'Execution: delegated subtask; the result returns to an orchestrating agent.'
type Body = { state: string; questions: Record<string, unknown> }
const bodies = (h: { jev: { bodies: unknown[] } }) => h.jev.bodies as Body[]
const preview = (h: Awaited<ReturnType<typeof childHarness>>, task: string) =>
  callTool(h.ctx, h.parent, 'route_subagent', { task, provider: 'claude' })

it('spec Scenario "启用 execution 的预设加入固定行"', async () => {
  const m = await mainHarness(depth('baseline'), { config: { preset: 'effort-as-verification' } })
  await m.setMode('AUTO')
  await m.run('看下这个报错')
  expect(bodies(m)[0]!.state).toBe(`Previous user-turn tier: none\n${MAIN_LINE}\nUser message:\n看下这个报错`)
  expect(bodies(m)[0]!.questions).toEqual({ depth: EAV.depth })
  await closeHarness()

  const c = await childHarness()
  c.configure({ preset: 'effort-as-verification' })
  c.setChildTask('整理日志')
  await c.invoke()
  await preview(c, '整理日志')
  const sent = bodies(c)
  expect(sent).toHaveLength(2)
  for (const b of sent) {
    expect(b.state).toBe(`Previous user-turn tier: none\n${CHILD_LINE}\nUser message:\n整理日志`)
    expect(b.questions).toEqual(EAV)
  }
  expect(RD).not.toEqual(EAV)
})

it('spec Scenario "自主主任务不被断言为逐条复核"', async () => {
  const m = await mainHarness(depth('baseline'), { config: { preset: 'effort-as-verification' } })
  await m.setMode('AUTO')
  await m.run('自主完成迁移，过程中不需要我复核')
  const state = bodies(m)[0]!.state
  expect(state.split('\n')[1]).toBe(MAIN_LINE)
  expect(state).not.toContain('a user reads and steers each reply')
  expect(state).not.toContain('no user in the loop')
  expect(state).toContain('User message:\n自主完成迁移，过程中不需要我复核')
})

it('spec Scenario "设置中的未知预设回落到缺省预设"', async () => {
  const m = await mainHarness(depth('baseline'), { config: { preset: 'does-not-exist' } })
  await m.setMode('AUTO')
  await m.run('看下这个报错')
  expect(bodies(m)[0]!.questions).toEqual({ depth: RD.depth })
  expect(bodies(m)[0]!.state).not.toContain('Execution:')
  await m.run('再看一个')
  expect(bodies(m)).toHaveLength(2) // still AUTO: a second user turn is judged again
})

it('spec Scenario "主判断进行中切换预设"', async () => {
  let release!: () => void
  const held = new Promise<void>(done => { release = done })
  const m = await mainHarness(async (req, res) => { await held; depth('higher')(req as never, res as never) }, { answer: () => '好的' })
  await m.setMode('AUTO')
  const turn = m.run('排查偶发缓存失效')
  await expect.poll(() => m.jev.bodies.length).toBe(1)
  m.configure({ preset: 'effort-as-verification' })
  release()
  await turn
  expect(bodies(m)[0]!.questions).toEqual({ depth: RD.depth })
  expect(bodies(m)[0]!.state).not.toContain('Execution:')
  expect(bodies(m)).toHaveLength(1)
  const bound = await m.invoke('label', { sessionId: m.agent.id, messageId: lastAssistantId(m) }) as { snapshot?: { preset?: string } }
  expect(bound.snapshot?.preset).toBe('reasoning-depth')
  m.jev.set(depth('baseline'))
  await m.run('下一个问题')
  expect(bodies(m)[1]!.questions).toEqual({ depth: EAV.depth })
  expect(bodies(m)[1]!.state).toContain(MAIN_LINE)
})

it('spec Scenario "子任务在创建后、首次判断前切换预设"', async () => {
  // DSH 0.2.2: the child's judgement runs in its `agent/created` (the credential gate holds it in flight); the preset is
  // captured when it starts. A change while it is in flight, and another after creation and before the first request, change nothing.
  const c = await childHarness(false, false, 'claude', false, {}, undefined, { gatedCredentials: true })
  c.configure({ preset: 'effort-as-verification' })
  const release = c.holdCredentials()
  void release.reached.then(() => { c.configure({ preset: 'reasoning-depth' }); release() })
  c.beforeChildRun(() => { c.configure({ preset: 'effort-as-verification' }) })
  await c.invoke()
  const sent = bodies(c)
  expect(sent).toHaveLength(1)
  expect(sent[0]!.questions).toEqual(EAV)
  expect(sent[0]!.state).toContain(CHILD_LINE)
  const child = c.handles[1]!.agent
  const route = c.store.get(child.id)!.route!
  expect(c.calls.at(-1)).toMatchObject({ provider: route.provider, model: route.model, reasoningEffort: route.reasoningEffort })
})

it('spec Scenario "预览进行中切换预设"', async () => {
  const c = await childHarness(false, false, 'claude', false, {}, undefined, { gatedCredentials: true })
  c.configure({ preset: 'reasoning-depth' })
  const release = c.holdCredentials()
  const first = preview(c, '整理日志')
  await release.reached
  c.configure({ preset: 'effort-as-verification' })
  release()
  await first
  expect(bodies(c)).toHaveLength(1)
  expect(bodies(c)[0]!.questions).toEqual(RD)
  expect(bodies(c)[0]!.state).not.toContain('Execution:')
  await preview(c, '整理日志')
  expect(bodies(c)[1]!.questions).toEqual(EAV)
  expect(bodies(c)[1]!.state).toContain(CHILD_LINE)
})

it('spec Scenario "预览与 fresh 子任务独立采样"', async () => {
  const c = await childHarness()
  c.configure({ preset: 'reasoning-depth' })
  c.setChildTask('整理日志')
  await preview(c, '整理日志')
  c.configure({ preset: 'effort-as-verification' })
  await c.invoke()
  expect(bodies(c)).toHaveLength(2)
  expect(bodies(c)[0]!.questions).toEqual(RD)
  expect(bodies(c)[1]!.questions).toEqual(EAV)
})

it('spec Scenario "新预设不改变引擎档位"', async () => {
  const m = await mainHarness(depth('lower'), { config: { preset: 'effort-as-verification' } })
  await m.setMode('AUTO')
  const efforts: string[] = []
  for (const [choice, text] of [['lower', '一'], ['baseline', '二'], ['higher', '三']] as const) {
    m.jev.set(depth(choice))
    m.selection.current = { provider: 'test', model: 'claude-opus-5-5', reasoningEffort: ReasoningEffortId('medium') }
    await m.run(text)
    efforts.push(String(m.calls.at(-1)?.reasoningEffort))
  }
  expect(efforts).toEqual(['low', 'medium', 'high'])
  expect(bodies(m).every(b => JSON.stringify(b.questions) === JSON.stringify({ depth: EAV.depth }))).toBe(true)
})

type Label = { decisionId?: number; snapshot?: { preset?: string; decidedAt?: number } }
const label = async (h: Awaited<ReturnType<typeof mainHarness>>, sessionId: string, messageId: string) => await h.invoke('label', { sessionId, messageId }) as Label
const pluginTurn = async (agent: Awaited<ReturnType<typeof mainHarness>>['agent'], text: string) => { agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin' } as never })); await agent.whenIdle() }

it('spec Scenario "快照记录作出决策时的预设"', async () => {
  let switchNow = false
  const m = await mainHarness(depth('higher'), { config: { preset: 'effort-as-verification' }, answer: () => { if (switchNow) m.configure({ preset: 'reasoning-depth' }); return '好的' } })
  const ledger = join(m.home, 'state/auto-model-routing/allocation-feedback.jsonl')
  mkdirSync(join(m.home, 'state/auto-model-routing'), { recursive: true })
  const old = JSON.stringify({ sessionId: m.agent.id, messageId: 'old-m', decisionId: 1, depth: 'baseline', model: 'claude-opus-5-5', effort: 'medium', snapshot: { decidedAt: 1, appliedAt: 2, strategy: 'claude', decisionProvider: 'openrouter', decisionModel: 'typesafe/jev-1.13', ms: 5, provider: 'test', requestSeq: 3 }, boundAt: 4 })
  appendFileSync(ledger, old + '\n')
  await m.restart()
  await m.setMode('AUTO')
  switchNow = true
  await m.run('排查偶发缓存失效')
  const fresh = await label(m, m.agent.id, lastAssistantId(m))
  expect(fresh.snapshot?.preset).toBe('effort-as-verification')
  const legacy = await label(m, m.agent.id, 'old-m')
  expect(legacy.snapshot).toBeDefined()
  expect(legacy.snapshot).not.toHaveProperty('preset')
  expect(readFileSync(ledger, 'utf8').split('\n')[0]).toBe(old)
  for (const key of ['version', 'policyVersion', 'mappingVersion', 'rubricVersion']) expect(JSON.stringify(fresh)).not.toContain(`"${key}"`)
})

it('spec Scenario "活跃决策跨越大量其它判断仍保留归属"', async () => {
  let gate: Promise<void> | undefined
  const m = await mainHarness(depth('higher'), { config: { preset: 'effort-as-verification' }, answer: () => '好的', streamGate: () => gate })
  await m.setMode('AUTO')
  await m.run('排查偶发缓存失效')
  const first = await label(m, m.agent.id, lastAssistantId(m))
  const d1 = first.decisionId!
  expect(first.snapshot?.preset).toBe('effort-as-verification')
  // A's delayed reply: its request is in flight (held) while B makes 201 judgements.
  let release!: () => void
  gate = new Promise<void>(done => { release = done })
  const callsBefore = m.calls.length
  const delayed = pluginTurn(m.agent, '子会话完成')
  await expect.poll(() => m.calls.length).toBe(callsBefore + 1)
  gate = undefined
  m.configure({ preset: 'reasoning-depth' })
  m.jev.set(depth('baseline'))
  const b = await m.createAgent('host-b')
  const jevBefore = m.jev.bodies.length
  for (let i = 0; i < 201; i++) await b.run(`b-${i}`)
  expect(m.jev.bodies.length - jevBefore).toBe(201)
  release()
  await delayed
  const late = await label(m, m.agent.id, lastAssistantId(m))
  await pluginTurn(m.agent, '另一个子会话完成')
  const later = await label(m, m.agent.id, lastAssistantId(m))
  for (const bound of [late, later]) {
    expect(bound.decisionId).toBe(d1)
    expect(bound.snapshot?.preset).toBe('effort-as-verification')
    expect(bound.snapshot?.decidedAt).toBe(first.snapshot?.decidedAt)
  }
  expect(m.jev.bodies.length - jevBefore).toBe(201) // A was not judged again
  await b.dispose()
}, 60_000)

it('spec Scenario "非用户回合不重判"', async () => {
  const m = await mainHarness(depth('higher'), { config: { preset: 'effort-as-verification' }, answer: () => '好的' })
  await m.setMode('AUTO')
  await m.run('排查偶发缓存失效')
  const first = await label(m, m.agent.id, lastAssistantId(m))
  const effort = m.calls.at(-1)?.reasoningEffort
  m.configure({ preset: 'reasoning-depth' })
  m.selection.current = { provider: 'test', model: 'claude-opus-5-5', reasoningEffort: ReasoningEffortId('medium') }
  await pluginTurn(m.agent, '子会话完成')
  expect(m.calls.at(-1)?.reasoningEffort).toBe(effort)
  expect(m.jev.bodies).toHaveLength(1)
  const bound = await label(m, m.agent.id, lastAssistantId(m))
  expect(bound.snapshot?.preset).toBe('effort-as-verification')
  expect(bound.decisionId).toBe(first.decisionId)
})

it('spec Scenario "切换预设不改变已绑定子任务与已作出的决定"', async () => {
  // Same turn: a preset change between two requests of one turn does not re-judge.
  let requests = 0
  const m = await mainHarness(depth('higher'), { toolCalls: () => { requests++; if (requests === 1) { m.configure({ preset: 'effort-as-verification' }); return 1 } return 0 } })
  await m.setMode('AUTO')
  await m.run('排查偶发缓存失效')
  expect(m.calls.length).toBeGreaterThanOrEqual(2)
  expect(new Set(m.calls.map(c => c.reasoningEffort))).toEqual(new Set(['high']))
  expect(m.jev.bodies).toHaveLength(1)
  await closeHarness()

  // A bound child keeps its route; the next user turn uses the new preset.
  const c = await childHarness()
  c.configure({ preset: 'reasoning-depth' })
  await c.run(c.parent, '主任务')
  await c.invoke()
  const child = c.handles.at(-1)!.agent
  const record = JSON.stringify(c.store.get(child.id))
  const route = c.store.get(child.id)?.route
  const judged = c.jev.bodies.length
  c.configure({ preset: 'effort-as-verification' })
  await c.run(child, 'later task')
  expect(c.jev.bodies.length).toBe(judged)
  expect(c.calls.at(-1)).toMatchObject({ model: route!.model, reasoningEffort: route!.reasoningEffort })
  expect(JSON.stringify(c.store.get(child.id))).toBe(record)
  await c.run(c.parent, '下一个主任务')
  expect((c.jev.bodies.at(-1) as Body).questions).toEqual({ depth: EAV.depth })
})

it('spec Scenario "决策提示标记所用判档预设"', async () => {
  const { toastText } = await import('../src/client/control.js')
  const m = await mainHarness(depth('higher', { confidence: 0.4 }), { config: { preset: 'effort-as-verification', decisionToast: true } })
  await m.setMode('AUTO'); await m.run('排查多个模块')
  const state = await m.invoke('state', { sessionId: m.agent.id }) as { decision: Parameters<typeof toastText>[0] & { preset?: string } }
  expect(state.decision.preset).toBe('effort-as-verification')
  const lines = toastText(state.decision)
  expect(lines[0]).toBe('主会话 · 已应用')
  expect(lines[1]).toBe('判档预设 Effort 管验证与边界情况')
  for (const key of ['version', 'policyVersion', 'mappingVersion', 'rubricVersion']) expect(JSON.stringify(state)).not.toContain(`"${key}"`)
  await closeHarness()

  // Judged subtask: attributed to the preset captured at its first judgement; the persisted record stays unchanged.
  const c = await childHarness()
  c.configure({ preset: 'reasoning-depth' })
  await c.invoke()
  const child = c.handles.at(-1)!.agent
  const root = await c.callEndpoint('state', { sessionId: c.parent.id }) as { decision?: { source: string; preset?: string } }
  expect(root.decision).toMatchObject({ source: 'subagent', preset: 'reasoning-depth' })
  expect(toastText(root.decision as never)[1]).toBe('判档预设 推理深度')
  expect(JSON.stringify(c.store.get(child.id))).not.toContain('preset')
  // Fully explicit subtask: no judgement, so no preset line.
  await c.invoke({ model: 'claude-haiku-5-5', reasoning_effort: 'low' })
  const explicit = await c.callEndpoint('state', { sessionId: c.parent.id }) as { decision?: { decisionProvider?: string; preset?: string } }
  expect(explicit.decision).toMatchObject({ decisionProvider: 'explicit' })
  expect(explicit.decision).not.toHaveProperty('preset')
  expect(toastText(explicit.decision as never).some(l => l.startsWith('判档预设'))).toBe(false)
})
