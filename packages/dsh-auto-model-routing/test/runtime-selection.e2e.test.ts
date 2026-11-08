/**
 * Runtime-pinned checks (change upgrade-dsh-0-2-2-runtime, spec「本步选择改写依赖运行体核验」).
 *
 * Real `@deepseek-ai/dsh-agent-loop` / `dsh-agent` / `dsh-llm` from the installed `dshVersion`; only the model adapter, the
 * Jev server and the official `sessionController` port are replaced. Re-run on every DSH upgrade: the main-session effort
 * rewrite depends on an implementation fact (the pre-step `modelSelection` is the object the step's request is prepared from),
 * not on a documented contract.
 */
import { afterEach, expect, it } from 'vitest'
import { closeHarness, depth, harness } from './host-harness.js'

afterEach(async () => { await closeHarness() })

type Event = { type: string; data: any }
const events = (h: Awaited<ReturnType<typeof harness>>) => h.agent.session.snapshotEvents() as unknown as Event[]
const headerEfforts = (h: Awaited<ReturnType<typeof harness>>) => events(h).filter(e => e.type === 'request/header').map(e => e.data.header.config.reasoningEffort as string | undefined)
const endReason = (h: Awaited<ReturnType<typeof harness>>) => events(h).filter(e => e.type === 'turn/end').at(-1)?.data.reason as { kind: string; error?: { message: string } } | undefined

/** The assertion the runtime-pinned test makes: step 1's request header must carry the judged effort. */
function expectStepOneEffort(h: Awaited<ReturnType<typeof harness>>, judged: string) {
  const actual = headerEfforts(h)[0]
  if (actual !== judged) throw new Error(`step 1 请求头 effort 与判断结果不一致: 判断为 ${judged}, 请求头为 ${String(actual)}`)
}

it('spec Scenario "目标运行体上 step 1 即用新 effort"', async () => {
  const h = await harness(depth('higher'))
  await h.setMode('AUTO')
  await h.run('排查多个模块')
  expect(endReason(h)).toEqual({ kind: 'completed' })
  expect(endReason(h)?.error?.message ?? '').not.toContain('use agent.model.select() before step preparation')
  // The session started at medium; the judged target is high, and step 1 of this very turn already carries it.
  expectStepOneEffort(h, 'high')
  expect(h.calls.map(c => c.reasoningEffort)).toEqual(['high'])
  expect(h.selections).toEqual([{ sessionId: h.agent.id, provider: 'test', model: 'claude-opus-5-5', reasoningEffort: 'high' }])
})

it('spec Scenario "选择对象被冻结时退回下一步生效"', async () => {
  let tools = 1
  const h = await harness(depth('higher'), { toolCalls: () => tools-- })
  await h.setMode('AUTO')
  // An outer listener freezes the object the loop pinned for the step (pre-step `modelSelection` is that same object).
  h.ctx.on('agent/pre-step', async (payload, next) => { Object.freeze(payload.modelSelection); return next() }, { prepend: true })
  const warnings: string[] = []
  const warn = h.ctx.logger.warn.bind(h.ctx.logger)
  h.ctx.logger.warn = ((message: unknown, ...rest: unknown[]) => { warnings.push(String(message)); return warn(message as never, ...rest as never[]) }) as typeof h.ctx.logger.warn
  await h.run('排查多个模块')
  expect(endReason(h)).toEqual({ kind: 'completed' })
  expect(warnings.some(message => message.includes('auto-model-routing') && /read-only|frozen|冻结|could not apply/i.test(message))).toBe(true)
  // Step 1 goes out with the original selection; the synced official selection takes effect from step 2.
  expect(h.calls.map(c => c.reasoningEffort)).toEqual(['medium', 'high'])
  expect(headerEfforts(h)).toEqual(['medium', 'high'])
  expect(h.selections).toHaveLength(1)
})

it('spec Scenario "运行体改为传递副本时测试失败"', async () => {
  const h = await harness(depth('higher'))
  await h.setMode('AUTO')
  // Simulated runtime: the listener chain receives a copy, not the object the step prepares its request from.
  h.ctx.on('agent/pre-step', async (payload, next) => { payload.modelSelection = { ...payload.modelSelection }; return next() }, { prepend: true })
  await h.run('排查多个模块')
  // The rewrite then cannot reach the step's request: this is exactly what the runtime-pinned assertion must catch.
  expect(() => expectStepOneEffort(h, 'high')).toThrow(/step 1 请求头 effort 与判断结果不一致/)
  expect(h.calls.map(c => c.reasoningEffort)).toEqual(['medium'])
})

it('retry of the same step reuses the step\'s applied effort and still dispatches agent/request', async () => {
  // agent/request is deprecated upstream; the child-route gate still hangs on it, so pin that the runtime dispatches it on a retry.
  const h = await harness(depth('higher'), { failRequest: index => index === 1 })
  await h.setMode('AUTO')
  const requests: string[] = []
  h.ctx.on('agent/request', async (payload, next) => { if (payload.agent === h.agent) requests.push(`${payload.turn}:${payload.step}`); return next() })
  h.ctx.on('agent/request-error', async (payload, next) => { await next(); return payload.agent === h.agent ? { kind: 'retry' as const } : { kind: 'fail' as const } as never })
  await h.run('排查多个模块')
  expect(endReason(h)).toEqual({ kind: 'completed' })
  expect(requests).toEqual(['1:1', '1:1'])
  expect(h.calls.map(c => c.reasoningEffort)).toEqual(['high', 'high'])
  expect(h.jev.bodies).toHaveLength(1)
  expect(h.selections).toHaveLength(1)
})
