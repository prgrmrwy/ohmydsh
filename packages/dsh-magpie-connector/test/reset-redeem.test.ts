import { describe, expect, it } from 'vitest'
import { CardsController } from '../src/host/cards.js'
import { ResetController, RESET_TICKET_TTL_MS, resetOutcomeOf, resetPrep, usableCredits } from '../src/host/reset.js'
import { MagpieRuntime } from '../src/host/runtime.js'

const now = Date.parse('2026-11-04T00:00:00Z')
const future = (ms: number) => new Date(now + ms).toISOString()
const DAY = 86_400_000
const weekly = (used: number, resetsAt = future(3 * DAY)) => ({ name: '7 days', used, resetsAt })
const codexCard = (used: number, extra: Record<string, unknown> = {}) => ({
  provider: 'codex', user: 'u@example.com', windows: [weekly(used)],
  resets: { count: 2, each: [{ id: 'r1', until: future(2 * DAY) }, { id: 'r2', until: future(30 * DAY) }] }, ...extra,
})
/** Gateway answer to GET cards / POST refresh. */
const reply = (cards: unknown[]) => Response.json({ data: cards, debug: { authorization: 'secret' } })
const json = (body: unknown, status = 200) => Response.json(body, { status })

interface SetupOptions { cards?: unknown[]; reset?: () => Promise<Response> | Response; refresh?: () => Promise<Response> | Response }
async function setup(options: SetupOptions = {}) {
  const gen = { id: 1, baseUrl: 'http://mock/v1', catalog: [], bgAbort: new AbortController() }
  const calls: { method: string; path: string; init?: unknown }[] = []
  const request = async (_connection: unknown, method: string, path: string, init?: unknown) => {
    calls.push({ method, path, init })
    if (path.startsWith('/magpie/quotas/codex-reset')) return (options.reset ?? (() => json({ code: 'reset', windows: 2 })))()
    if (method === 'POST') return (options.refresh ?? (() => reply(options.cards ?? [codexCard(85)])))()
    return reply(options.cards ?? [codexCard(85)])
  }
  const runtime = {
    formatErrorBody: MagpieRuntime.prototype.formatErrorBody, current: gen,
    beginOperation: async () => ({ gen: runtime.current, baseUrl: runtime.current.baseUrl, key: 'secret', release: () => {} }),
    isCurrent: (g: unknown) => g === runtime.current,
    redact: (s: string) => s.replaceAll('secret', '[redacted]'),
    transport: { request },
  }
  const cards = new CardsController(runtime as unknown as MagpieRuntime)
  let ticketSeq = 0
  const reset = new ResetController(runtime as unknown as MagpieRuntime, cards, { now: () => now, ticketId: () => `t${++ticketSeq}` })
  await cards.get()
  calls.length = 0
  const body = async (response: Response) => ({ status: response.status, body: await response.json() as Record<string, unknown> })
  const prepare = () => reset.handle({ action: 'prepare', provider: 'codex', user: 'u@example.com' }).then(body)
  const consume = (ticket: string) => reset.handle({ action: 'consume', ticket }).then(body)
  const resetCalls = () => calls.filter(call => call.path.includes('codex-reset'))
  const readCalls = () => calls.filter(call => call.path.includes('/magpie/quotas/refresh'))
  return { reset, cards, prepare, consume, resetCalls, readCalls, calls, body }
}

describe('resetPrep', () => {
  const credits = [{ id: 'r1', until: future(2 * DAY) }, { id: 'r2', until: future(30 * DAY) }]
  const card = (used: number, extra: Record<string, unknown> = {}) => ({ provider: 'codex', user: 'u', windows: [weekly(used)], ...extra }) as never

  it('门槛：周用量不足 80% 时拒绝', () => {
    expect(resetPrep(card(79.9), credits, now)).toEqual({ ok: false, reason: 'below-min' })
    expect(resetPrep(card(80), credits, now)).toMatchObject({ ok: true, weeklyUsedPercent: 80 })
  })

  it('门槛：缺窗口、窗口已过重置时刻、卡片带错误都不允许', () => {
    expect(resetPrep(card(90, { windows: [{ name: '5 hours', used: 90, resetsAt: future(DAY) }] }), credits, now)).toEqual({ ok: false, reason: 'no-weekly' })
    expect(resetPrep(card(90, { windows: [weekly(90, new Date(now - 1000).toISOString())] }), credits, now)).toEqual({ ok: false, reason: 'window-over' })
    expect(resetPrep(card(90, { error: 'token expired' }), credits, now)).toEqual({ ok: false, reason: 'error' })
    expect(resetPrep(undefined, credits, now)).toEqual({ ok: false, reason: 'no-card' })
  })

  it('只用最早到期的那张，且跳过已过期与没 id 的', () => {
    const mixed = [{ id: 'late', until: future(30 * DAY) }, { id: '', until: future(DAY) }, { id: 'expired', until: new Date(now - 1000).toISOString() }, { id: 'soon', until: future(DAY) }]
    expect(resetPrep(card(90), mixed, now)).toMatchObject({ ok: true, credit: { id: 'soon' } })
    expect(usableCredits(mixed, now).map(credit => credit.id)).toEqual(['soon', 'late'])
    // 没有到期时间的排最后
    expect(usableCredits([{ id: 'forever' }, { id: 'soon', until: future(DAY) }], now)[0]?.id).toBe('soon')
    expect(resetPrep(card(90), [{ id: 'gone', until: new Date(now - 1).toISOString() }], now)).toEqual({ ok: false, reason: 'no-credit' })
  })

  it('网关的 code 映射到页面语义', () => {
    expect(resetOutcomeOf('reset')).toBe('reset')
    expect(resetOutcomeOf('nothing_to_reset')).toBe('kept')
    expect(resetOutcomeOf('no_credit')).toBe('no-credit')
    expect(resetOutcomeOf('already_redeemed')).toBe('already')
    expect(resetOutcomeOf('something_new')).toBe('unknown')
  })
})

describe('ResetController', () => {
  it('spec Scenario "周用量未达门槛"', async () => {
    const { prepare, resetCalls, readCalls } = await setup({ cards: [codexCard(49)] })
    const result = await prepare()
    expect(result.status).toBe(409)
    expect(result.body.error).toBe('MAGPIE_RESET_GUARD')
    // 准备阶段已经重新读过卡片，但没有提交重置
    expect(readCalls()).toHaveLength(1)
    expect(resetCalls()).toHaveLength(0)
  })

  it('spec Scenario "完整两段确认并成功"', async () => {
    const { prepare, consume, resetCalls } = await setup()
    const prepared = await prepare()
    expect(prepared.status).toBe(200)
    expect(prepared.body).toMatchObject({ ticket: 't1', weeklyUsedPercent: 85, creditExpiresAt: future(2 * DAY) })
    expect(JSON.stringify(prepared.body)).not.toContain('id"') // 票据里不带 credit id
    expect(resetCalls()).toHaveLength(0)
    const done = await consume(prepared.body.ticket as string)
    expect(done.status).toBe(200)
    expect(done.body).toMatchObject({ outcome: 'reset', code: 'reset', windows: 2 })
    expect(Array.isArray(done.body.cards)).toBe(true)
    expect(resetCalls()).toHaveLength(1)
    expect(resetCalls()[0]!.path).toBe('/magpie/quotas/codex-reset?user=u%40example.com&credit=r1')
    // 浏览器拿到的任何内容里都没有重置 id
    expect(JSON.stringify(done.body)).not.toContain('r1')
    expect(JSON.stringify(done.body)).not.toContain('r2')
  })

  it('spec Scenario "票据一次性且 60 秒过期"', async () => {
    const first = await setup()
    const prepared = await first.prepare()
    expect((await first.consume(prepared.body.ticket as string)).body.outcome).toBe('reset')
    const replay = await first.consume(prepared.body.ticket as string)
    expect(replay.status).toBe(409); expect(replay.body.error).toBe('MAGPIE_RESET_TICKET_INVALID')
    expect(first.resetCalls()).toHaveLength(1)

    // 超过 60 秒的票据被拒绝
    let clock = now
    const gen = { id: 1, baseUrl: 'http://mock/v1', catalog: [], bgAbort: new AbortController() }
    const calls: string[] = []
    const runtime = {
      formatErrorBody: MagpieRuntime.prototype.formatErrorBody, current: gen,
      beginOperation: async () => ({ gen, baseUrl: gen.baseUrl, key: 'k', release: () => {} }), isCurrent: () => true,
      redact: (s: string) => s, transport: { request: async (_c: unknown, _m: string, path: string) => { calls.push(path); return path.includes('codex-reset') ? json({ code: 'reset', windows: 1 }) : reply([codexCard(85)]) } },
    }
    const cards = new CardsController(runtime as unknown as MagpieRuntime)
    await cards.get()
    const reset = new ResetController(runtime as unknown as MagpieRuntime, cards, { now: () => clock, ticketId: () => 'tx' })
    const prepared2 = await (await reset.handle({ action: 'prepare', provider: 'codex', user: 'u@example.com' })).json() as { ticket: string }
    clock = now + RESET_TICKET_TTL_MS + 1
    const expired = await reset.handle({ action: 'consume', ticket: prepared2.ticket })
    expect(expired.status).toBe(409); expect((await expired.json() as { error: string }).error).toBe('MAGPIE_RESET_TICKET_EXPIRED')
    expect(calls.filter(path => path.includes('codex-reset'))).toHaveLength(0)
  })

  it('spec Scenario "所选重置卡已不在"', async () => {
    let cards = [codexCard(85)]
    const { prepare, consume, resetCalls } = await setup({ cards, refresh: () => reply(cards) })
    const prepared = await prepare()
    // 消费前的重读已经换成另一张卡：r1 没了
    cards = [{ provider: 'codex', user: 'u@example.com', windows: [weekly(85)], resets: { count: 1, each: [{ id: 'r2', until: future(30 * DAY) }] } }]
    const result = await consume(prepared.body.ticket as string)
    expect(result.status).toBe(409); expect(result.body.error).toBe('MAGPIE_RESET_CREDIT_GONE')
    expect(resetCalls()).toHaveLength(0)
  })

  it('spec Scenario "不同账号也不能同时使用"', async () => {
    // 让消费前的重读挂起：期间任何账号的准备请求都会被 busy 挡掉
    let release!: (response: Response) => void
    const gate = new Promise<Response>(resolve => { release = resolve })
    const gen = { id: 1, baseUrl: 'http://mock/v1', catalog: [], bgAbort: new AbortController() }
    const paths: string[] = []
    let reads = 0
    const runtime = {
      formatErrorBody: MagpieRuntime.prototype.formatErrorBody, current: gen,
      beginOperation: async () => ({ gen, baseUrl: gen.baseUrl, key: 'k', release: () => {} }), isCurrent: () => true, redact: (s: string) => s,
      transport: { request: async (_c: unknown, method: string, path: string) => {
        paths.push(`${method} ${path}`)
        if (path.includes('codex-reset')) return json({ code: 'reset', windows: 1 })
        if (method === 'POST') { reads += 1; if (reads === 2) return gate; return reply([codexCard(85)]) }
        return reply([codexCard(85), { provider: 'codex', user: 'b@example.com', windows: [weekly(90)], resets: { count: 1, each: [{ id: 'rb', until: future(DAY) }] } }])
      } },
    }
    const controllers = new CardsController(runtime as unknown as MagpieRuntime)
    await controllers.get()
    const controller = new ResetController(runtime as unknown as MagpieRuntime, controllers, { now: () => now })
    const prepared = await (await controller.handle({ action: 'prepare', provider: 'codex', user: 'u@example.com' })).json() as { ticket: string }
    const spending = controller.handle({ action: 'consume', ticket: prepared.ticket })
    await new Promise(resolve => setTimeout(resolve, 0))
    const second = await controller.handle({ action: 'prepare', provider: 'codex', user: 'b@example.com' })
    expect(second.status).toBe(409); expect((await second.json() as { error: string }).error).toBe('MAGPIE_RESET_BUSY')
    release(reply([codexCard(80)]))
    expect((await spending).status).toBe(200)
    expect(paths.filter(path => path.includes('codex-reset'))).toHaveLength(1)
  })

  it('spec Scenario "结果不确定时锁定"', async () => {
    const { prepare, consume, resetCalls } = await setup({ reset: () => json({ code: 'reset', windows: 1 }, 502) })
    const prepared = await prepare()
    const first = await consume(prepared.body.ticket as string)
    expect(first.status).toBe(502); expect(first.body.outcome).toBe('uncertain')
    expect(resetCalls()).toHaveLength(1)
    const blocked = await prepare()
    expect(blocked.status).toBe(409); expect(blocked.body.error).toBe('MAGPIE_RESET_UNCERTAIN')
    expect(resetCalls()).toHaveLength(1)
  })

  it('transport 抛错时也锁定', async () => {
    const { prepare, consume } = await setup({ reset: () => { throw new Error('socket hang up') } })
    const prepared = await prepare()
    const result = await consume(prepared.body.ticket as string)
    expect(result.status).toBe(502); expect(result.body.outcome).toBe('uncertain')
    expect(JSON.stringify(result.body)).not.toContain('secret')
  })

  it('spec Scenario "网关明确拒绝时不锁定"', async () => {
    const { prepare, consume, resetCalls } = await setup({ reset: () => json({ code: 'denied' }, 401) })
    const prepared = await prepare()
    const first = await consume(prepared.body.ticket as string)
    expect(first.status).toBe(200); expect(first.body.outcome).toBe('unconsumed')
    expect(String(first.body.error)).toContain('401')
    // 4xx 说明没花掉，可以重新开始
    const again = await prepare()
    expect(again.status).toBe(200)
    expect(resetCalls()).toHaveLength(1)
  })

  it('spec Scenario "未消耗的结果"', async () => {
    const { prepare, consume } = await setup({ reset: () => json({ code: 'nothing_to_reset', windows: 0 }) })
    const prepared = await prepare()
    const result = await consume(prepared.body.ticket as string)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ outcome: 'kept', code: 'nothing_to_reset', windows: 0 })
    // 未消耗不锁定
    expect((await prepare()).status).toBe(200)
  })

  it('未知 code 原样返回，仍算已决结果', async () => {
    const { prepare, consume } = await setup({ reset: () => json({ code: 'surprise', windows: 3 }) })
    const prepared = await prepare()
    const result = await consume(prepared.body.ticket as string)
    expect(result.body).toMatchObject({ outcome: 'unknown', code: 'surprise', windows: 3 })
    expect((await prepare()).status).toBe(200)
  })

  it('卡片读取失败时拒绝，且不提交', async () => {
    const { prepare, resetCalls } = await setup({ cards: [codexCard(85)], refresh: () => new Response('bad', { status: 502 }) })
    const result = await prepare()
    expect(result.status).toBe(502)
    expect(String(result.body.error)).toContain('MAGPIE_RESET_READ_FAILED')
    expect(resetCalls()).toHaveLength(0)
  })

  it('请求形状非法时返回 400', async () => {
    const { reset } = await setup()
    for (const body of [undefined, null, [], {}, { action: 'nope' }, { action: 'prepare' }, { action: 'prepare', provider: 'claude', user: 'u' },
      { action: 'prepare', provider: 'codex', user: '' }, { action: 'prepare', provider: 'codex', user: 'u', credit: 'r1' },
      { action: 'consume' }, { action: 'consume', ticket: '' }, { action: 'consume', ticket: 't', extra: 1 }]) {
      expect((await reset.handle(body)).status).toBe(400)
    }
  })

  it('新的准备会作废此前未用的票据', async () => {
    const { prepare, consume, resetCalls } = await setup()
    const first = await prepare()
    const second = await prepare()
    expect(second.body.ticket).not.toBe(first.body.ticket)
    expect((await consume(first.body.ticket as string)).body.error).toBe('MAGPIE_RESET_TICKET_INVALID')
    expect((await consume(second.body.ticket as string)).body.outcome).toBe('reset')
    expect(resetCalls()).toHaveLength(1)
  })
})
