import { beforeEach, describe, expect, it } from 'vitest'
import { loadCards, refreshCards, resetSidebarCardsCache, SIDEBAR_TTL_MS } from '../src/client/sidebar-api.js'
import { fakeApi, ok } from './client-support/fake-api.js'

const cardsOk = (providers: string[]) => ok({ status: 'ok', cards: providers.map(provider => ({ provider, readAt: 'T1' })) })
let clock = 0
const now = () => clock
beforeEach(() => { clock = 0; resetSidebarCardsCache() })

const reads = (fake: ReturnType<typeof fakeApi>) => fake.calls.filter(call => call.path === 'cards' && call.method === 'GET')
const writes = (fake: ReturnType<typeof fakeApi>) => fake.calls.filter(call => call.path === 'cards' && call.method === 'POST')

describe('loadCards', () => {
  it('在同一次 TTL 内复用读数，过期后才再请求', async () => {
    const fake = fakeApi({ 'GET cards': () => cardsOk(['claude']) })
    await loadCards(fake.api, { now })
    clock = SIDEBAR_TTL_MS - 1
    await loadCards(fake.api, { now })
    expect(reads(fake)).toHaveLength(1)
    clock = SIDEBAR_TTL_MS
    const view = await loadCards(fake.api, { now })
    expect(reads(fake)).toHaveLength(2)
    expect(view.cards.map(card => card.provider)).toEqual(['claude'])
  })

  it('force 绕过 TTL', async () => {
    const fake = fakeApi({ 'GET cards': () => cardsOk(['claude']) })
    await loadCards(fake.api, { now })
    await loadCards(fake.api, { now, force: true })
    expect(reads(fake)).toHaveLength(2)
  })

  it('并发读取只发一次请求', async () => {
    const fake = fakeApi({ 'GET cards': () => cardsOk(['claude']) })
    const [a, b] = await Promise.all([loadCards(fake.api, { now }), loadCards(fake.api, { now })])
    expect(reads(fake)).toHaveLength(1)
    expect(a).toEqual(b)
  })

  it('失败不写缓存，下一次调用会重试', async () => {
    let fail = true
    const fake = fakeApi({
      'GET cards': () => {
        if (fail) { fail = false; return { status: 500, body: { error: 'boom' } } }
        return cardsOk(['claude'])
      },
    })
    const first = await loadCards(fake.api, { now })
    expect(first.status).toBe('error')
    expect(first.error).toBe('boom')
    const second = await loadCards(fake.api, { now })
    expect(reads(fake)).toHaveLength(2)
    expect(second.status).toBe('ok')
  })
})

describe('refreshCards', () => {
  it('发一次全量刷新并采用新读数', async () => {
    const fake = fakeApi({
      'GET cards': () => cardsOk(['claude']),
      'POST cards': () => cardsOk(['claude', 'codex']),
    })
    await loadCards(fake.api, { now })
    const result = await refreshCards(fake.api, { now })
    expect(writes(fake)).toHaveLength(1)
    expect(writes(fake)[0]!.body).toEqual({ all: true })
    expect(result).toMatchObject({ ok: true, status: 200 })
    // 刷新结果进入缓存，TTL 内不再补读。
    expect((await loadCards(fake.api, { now })).cards).toHaveLength(2)
    expect(reads(fake)).toHaveLength(1)
  })

  it('刷新失败时保留旧缓存并返回原因', async () => {
    const fake = fakeApi({
      'GET cards': () => cardsOk(['claude']),
      'POST cards': () => ({ status: 502, body: { error: 'gateway down' } }),
    })
    await loadCards(fake.api, { now })
    const result = await refreshCards(fake.api, { now })
    expect(result).toEqual({ ok: false, status: 502, error: 'gateway down' })
    expect((await loadCards(fake.api, { now })).cards.map(card => card.provider)).toEqual(['claude'])
    expect(reads(fake)).toHaveLength(1)
  })

  it('没有 error 字段时仍给出可读原因', async () => {
    const fake = fakeApi({ 'POST cards': () => ({ status: 500, body: {} }) })
    expect(await refreshCards(fake.api, { now })).toEqual({ ok: false, status: 500, error: 'HTTP 500' })
  })

  it('403 作为可见状态返回而不是异常', async () => {
    const fake = fakeApi({ 'POST cards': () => ({ status: 403, body: { status: 'forbidden' } }) })
    const result = await refreshCards(fake.api, { now })
    expect(result).toMatchObject({ ok: true, status: 403 })
    if (result.ok) expect(result.view.status).toBe('forbidden')
  })
})
