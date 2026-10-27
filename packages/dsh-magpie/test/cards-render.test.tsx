// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MagpieSettings } from '../src/client/SettingsPage.js'
import { buttonByText, deferred, fakeApi, flush, inputValue, ok, settingsView, text } from './client-support/fake-api.js'
import type { ApiResponse } from '../src/client/api.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

const cardsOk = (cards: unknown[]) => ok({ status: 'ok', cards })
async function render(cards: () => ApiResponse | Promise<ApiResponse>, extra: Parameters<typeof fakeApi>[0] = {}) {
  const fake = fakeApi({ 'GET settings': () => ok(settingsView()), 'GET cards': cards, ...extra })
  await act(async () => root.render(h(MagpieSettings, { api: fake.api })))
  await flush()
  return fake
}
const group = (provider: string) => host.querySelector(`[data-provider="${provider}"]`)
const usage = () => host.querySelector('[data-usage-state]')
const noFabrication = () => {
  for (const bad of ['Invalid Date', 'undefined', 'null', 'NaN']) expect(host.textContent).not.toContain(bad)
}

describe('用量条颜色', () => {
  it.each([[70, 'normal'], [70.5, 'warn'], [71, 'warn'], [89, 'warn'], [89.9, 'warn'], [90, 'high'], [100, 'high'], [0, 'normal']] as const)('used %s%% → %s', async (used, level) => {
    await render(() => cardsOk([{ provider: 'codex', windows: [{ name: '5h', used }] }]))
    expect(group('codex')!.querySelector('.dmg-fill')?.getAttribute('data-level')).toBe(level)
  })
})

describe('只读用量卡片', () => {
  it('spec Scenario "渲染卡片字段"', async () => {
    await render(() => cardsOk([
      { provider: 'claude', plan: 'max', windows: [
        { name: '7 days', used: 83, resetsAt: '2026-10-27T11:00:00+08:00' },
        { name: 'Chat', unlimited: true, display: 'Unlimited' },
      ] },
      { provider: 'codex', resets: { count: 1, until: '2026-11-06T23:30:34Z' } },
    ]))
    const claude = group('claude')!
    expect(claude).not.toBeNull()
    expect(text(claude.querySelector('[data-field="plan"]'))).toContain('max')
    const windows = Array.from(claude.querySelectorAll('[data-window]'))
    expect(windows.map(w => text(w.querySelector('[data-reading]')))).toEqual(['83%', '无限'])
    expect(text(windows[0]!.querySelector('[data-window-name]'))).toBe('7 days')
    expect(text(windows[0])).toContain('7 days 83%')
    expect(windows[0]!.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-27T11:00:00+08:00')
    expect(text(windows[1])).not.toContain('0%')
    const codex = group('codex')!
    const resets = codex.querySelector('[data-field="resets"]')!
    expect(text(resets.querySelector('[data-reset-count]'))).toBe('1')
    expect(resets.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-06T23:30:34Z')
    const cardButtons = Array.from(codex.querySelectorAll('[data-card] button')).map(b => b.textContent)
    expect(cardButtons).toEqual(['刷新'])
    expect(cardButtons.some(label => /重置/.test(label ?? ''))).toBe(false)
    noFabrication()
  })

  it('spec Scenario "缺失字段不伪造"', async () => {
    await render(() => cardsOk([{ provider: 'codex', resets: { count: 2 } }]))
    const codex = group('codex')!
    const resets = codex.querySelector('[data-field="resets"]')!
    expect(text(resets.querySelector('[data-reset-count]'))).toBe('2')
    expect(resets.querySelector('time')).toBeNull()
    expect(codex.querySelector('[data-field="plan"]')).toBeNull()
    for (const field of ['user', 'until', 'renew', 'balance', 'readAt', 'error']) expect(codex.querySelector(`[data-field="${field}"]`)).toBeNull()
    noFabrication()
  })

  it.each([
    { readAt: '2026-10-25T10:00:00Z', asOf: undefined, stale: false },
    { readAt: undefined, asOf: '2026-10-25T09:00:00Z', stale: true },
    { readAt: '2026-10-25T10:00:00Z', asOf: '2026-10-25T09:00:00Z', stale: true },
  ])('读取时间优先 readAt，asOf 存在即标旧读数（$readAt / $asOf）', async ({ readAt, asOf, stale }) => {
    await render(() => cardsOk([{ provider: 'codex', readAt, asOf }]))
    const reading = group('codex')!.querySelector('[data-field="readAt"]')!
    expect(reading.querySelector('time')?.getAttribute('datetime')).toBe(readAt ?? asOf)
    expect(text(reading).includes('旧读数')).toBe(stale)
  })

  it('spec Scenario "带错误的卡片仍显示"', async () => {
    await render(() => cardsOk([{ provider: 'codex', error: 'token expired' }]))
    expect(text(group('codex')!.querySelector('[data-field="error"]'))).toContain('token expired')
  })

  it('spec Scenario "无权读取用量"', async () => {
    await render(() => ok({ status: 'forbidden', error: 'key lacks Quotas', cards: [] }))
    expect(usage()?.getAttribute('data-usage-state')).toBe('forbidden')
    expect(text(usage())).toContain('key lacks Quotas')
    expect(host.querySelectorAll('[data-card]')).toHaveLength(0)
    // the model list is not affected
    expect(text(group('claude'))).toContain('Claude Opus 5.5')
    expect(text(group('codex'))).toContain('GPT 6.1 Sol')
  })

  it('spec Scenario "冷启动空集合"', async () => {
    const fake = await render(() => cardsOk([]))
    expect(usage()?.getAttribute('data-usage-state')).toBe('empty')
    expect(text(usage())).toContain('Magpie 未返回可见用量')
    expect(buttonByText(usage()!, '获取模型与用量')).toBeDefined()
    expect(host.querySelector('[aria-label="连接"] [data-usage-state]')).toBe(usage())
    await flush()
    expect(fake.calls.filter(c => c.path === 'cards').map(c => c.method)).toEqual(['GET'])
  })

  it('spec Scenario "卡片字符串按字面渲染"', async () => {
    await render(() => cardsOk([{ provider: 'codex', name: '<img src=x onerror=alert(1)>', error: '<script>x</script>' }]))
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(host.textContent).toContain('<script>x</script>')
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('script')).toBeNull()
    const inline = Array.from(host.querySelectorAll('*')).flatMap(el => Array.from(el.attributes).map(a => a.name)).filter(n => n.startsWith('on'))
    expect(inline).toEqual([])
  })

  it('卡片 provider 不在目录中时单独成组，同 provider 多张按 user 分别显示', async () => {
    await render(() => cardsOk([{ provider: 'copilot', user: 'a@x' }, { provider: 'copilot', user: 'b@x' }]))
    const copilot = group('copilot')!
    expect(copilot).not.toBeNull()
    expect(Array.from(copilot.querySelectorAll('[data-field="user"] [data-value]')).map(text)).toEqual(['a@x', 'b@x'])
  })
})

describe('手动刷新用量（UI 侧）', () => {
  const card = { provider: 'codex', user: 'u@example.com', readAt: '2026-10-25T10:00:00Z' }

  it('UI 侧：刷新单张卡片', async () => {
    const pending = deferred<ApiResponse>()
    const fake = await render(() => cardsOk([card]), { 'POST cards': () => pending.promise })
    await act(async () => buttonByText(group('codex')!, '刷新')!.click())
    expect(fake.calls.filter(c => c.method === 'POST')).toEqual([{ method: 'POST', path: 'cards', body: { provider: 'codex', user: 'u@example.com' } }])
    expect(buttonByText(group('codex')!, '刷新')?.disabled).toBe(true)
    expect(usage()).toBeNull()
    await act(async () => pending.resolve(cardsOk([{ ...card, readAt: '2026-10-25T11:00:00Z' }])))
    await flush()
    expect(group('codex')!.querySelector('[data-field="readAt"] time')?.getAttribute('datetime')).toBe('2026-10-25T11:00:00Z')
    expect(buttonByText(group('codex')!, '刷新')?.disabled).toBe(false)
    expect(host.textContent).not.toContain('未重新读取')
  })

  it('UI 侧：冷启动时获取模型与用量（先同步目录再全量刷新）', async () => {
    const fake = await render(() => cardsOk([]), { 'POST settings': () => ok(settingsView()), 'POST cards': () => cardsOk([{ provider: 'codex', user: 'a' }, { provider: 'claude', user: 'b' }]) })
    await act(async () => buttonByText(host, '获取模型与用量')!.click())
    await flush()
    expect(fake.calls.filter(c => c.method === 'POST')).toEqual([{ method: 'POST', path: 'settings', body: { resync: true } }, { method: 'POST', path: 'cards', body: { all: true } }])
    expect(host.querySelectorAll('[data-card]')).toHaveLength(2)
    expect(usage()).toBeNull()
    expect(buttonByText(host, '获取模型与用量')).toBeUndefined()
  })

  it('有卡片时没有整体刷新栏目，只有每张卡片自己的刷新', async () => {
    await render(() => cardsOk([card]))
    expect(usage()).toBeNull()
    expect(buttonByText(host, '刷新全部')).toBeUndefined()
    expect(buttonByText(host, '获取模型与用量')).toBeUndefined()
    expect(Array.from(host.querySelectorAll('button')).filter(b => b.textContent === '刷新')).toHaveLength(1)
  })

  it('目录同步失败时不发全量刷新并给出原因', async () => {
    const fake = await render(() => cardsOk([]), { 'POST settings': () => ({ status: 502, body: { error: 'SYNC_DOWN' } }) })
    await act(async () => buttonByText(host, '获取模型与用量')!.click())
    await flush()
    expect(fake.calls.filter(c => c.path === 'cards' && c.method === 'POST')).toHaveLength(0)
    expect(text(host.querySelector('[data-usage-alert]'))).toContain('SYNC_DOWN')
  })

  it('UI 侧：节流期内返回旧读数', async () => {
    await render(() => cardsOk([card]), { 'POST cards': () => cardsOk([card]) })
    await act(async () => buttonByText(group('codex')!, '刷新')!.click())
    await flush()
    expect(group('codex')!.querySelector('[data-field="readAt"] time')?.getAttribute('datetime')).toBe(card.readAt)
    expect(host.textContent).toContain('Magpie 未重新读取（可能处于节流间隔内）')
  })

  it('UI 侧：受限 key 冷启动刷新全部仍为空', async () => {
    await render(() => cardsOk([]), { 'POST settings': () => ok(settingsView()), 'POST cards': () => cardsOk([]) })
    expect(text(usage())).not.toContain('管理员')
    await act(async () => buttonByText(host, '获取模型与用量')!.click())
    await flush()
    expect(usage()?.getAttribute('data-usage-state')).toBe('empty')
    expect(text(usage())).toContain('Magpie 未返回可见用量')
    expect(text(usage())).toContain('需要 Magpie 管理员先在 Magpie 中读取一次')
    expect(text(usage())).not.toMatch(/打开共享|增加权限/)
  })

  it('UI 侧：刷新失败保留原卡片', async () => {
    await render(() => cardsOk([{ ...card, plan: 'pro' }]), { 'POST cards': () => ({ status: 502, body: { error: 'bad gateway' } }) })
    const before = text(group('codex')!.querySelector('[data-card]'))
    await act(async () => buttonByText(group('codex')!, '刷新')!.click())
    await flush()
    expect(text(group('codex')!.querySelector('[data-card]'))).toBe(before)
    expect(text(group('codex')!.querySelector('[data-usage-alert]'))).toContain('502')
  })
})

describe('连接身份与设置写入竞态（延迟请求 DOM 回归）', () => {
  const oldCard = { provider: 'codex', user: 'old@example.test', plan: 'OLD_IDENTITY', readAt: '2026-10-25T10:00:00Z' }
  const newCard = { provider: 'codex', user: 'new@example.test', plan: 'NEW_IDENTITY', readAt: '2026-10-25T11:00:00Z' }
  const connection = () => host.querySelector('[aria-label="连接"]')!
  const settingsPosts = (fake: Awaited<ReturnType<typeof render>>) => fake.calls.filter(c => c.method === 'POST' && c.path === 'settings')
  const check = (provider: string) => group(provider)!.querySelector('input[type=checkbox]') as HTMLInputElement
  async function saveAddress() {
    await act(async () => inputValue(connection().querySelector('input')!, 'http://new-gateway.test/v1'))
    await act(async () => buttonByText(connection(), '保存')!.click())
  }

  it('换地址提交即隐藏旧卡片和 notice；成功只 GET 新身份缓存', async () => {
    const save = deferred<ApiResponse>()
    const newRead = deferred<ApiResponse>()
    let reads = 0
    const fake = await render(() => ++reads === 1 ? cardsOk([oldCard]) : newRead.promise, {
      'POST settings': () => save.promise,
      'POST cards': () => cardsOk([oldCard]),
    })
    await act(async () => buttonByText(group('codex')!, '刷新')!.click())
    expect(host.textContent).toContain('未重新读取')
    await saveAddress()
    expect(host.querySelectorAll('[data-card]')).toHaveLength(0)
    expect(host.textContent).not.toContain('未重新读取')
    expect(fake.calls.filter(c => c.path === 'cards')).toHaveLength(2)
    await act(async () => save.resolve(ok(settingsView({ baseUrl: 'http://new-gateway.test/v1' }))))
    expect(fake.calls.filter(c => c.path === 'cards').map(c => c.method)).toEqual(['GET', 'POST', 'GET'])
    await act(async () => newRead.resolve(cardsOk([newCard])))
    expect(host.textContent).toContain('NEW_IDENTITY')
    expect(host.textContent).not.toContain('OLD_IDENTITY')
  })

  it.each(['success', 'failure'] as const)('旧 refresh %s 及 finally 不得影响新代的卡片/notice/loading', async outcome => {
    const save = deferred<ApiResponse>()
    const oldRefresh = deferred<ApiResponse>()
    const newRefresh = deferred<ApiResponse>()
    let reads = 0
    let refreshes = 0
    const fake = await render(() => cardsOk([++reads === 1 ? oldCard : newCard]), {
      'POST settings': () => save.promise,
      'POST cards': () => ++refreshes === 1 ? oldRefresh.promise : newRefresh.promise,
    })
    await act(async () => buttonByText(group('codex')!, '刷新')!.click())
    await saveAddress()
    expect(host.textContent).not.toContain('OLD_IDENTITY')
    await act(async () => save.resolve(ok(settingsView({ baseUrl: 'http://new-gateway.test/v1' }))))
    expect(reads).toBe(2)
    expect(host.textContent).toContain('NEW_IDENTITY')
    await act(async () => buttonByText(group('codex')!, '刷新')!.click())
    expect(fake.calls.filter(c => c.method === 'POST' && c.path === 'cards')).toHaveLength(2)
    await act(async () => oldRefresh.resolve(outcome === 'success' ? cardsOk([oldCard]) : { status: 502, body: { error: 'OLD_REFRESH_ERROR' } }))
    expect(host.textContent).not.toContain('OLD_IDENTITY')
    expect(host.textContent).not.toContain('OLD_REFRESH_ERROR')
    expect(host.textContent).not.toContain('未重新读取')
    expect(buttonByText(group('codex')!, '刷新')?.disabled).toBe(true)
    await act(async () => newRefresh.resolve(cardsOk([{ ...newCard, readAt: '2026-10-25T12:00:00Z' }])))
    expect(buttonByText(group('codex')!, '刷新')?.disabled).toBe(false)
  })

  it('保存与旧刷新点击发生在同一 tick，不得把旧身份刷新归入新 epoch', async () => {
    const save = deferred<ApiResponse>()
    const fake = await render(() => cardsOk([oldCard]), { 'POST settings': () => save.promise, 'POST cards': () => cardsOk([oldCard]) })
    await act(async () => inputValue(connection().querySelector('input')!, 'http://new-gateway.test/v1'))
    const staleRefreshButton = buttonByText(group('codex')!, '刷新')!
    await act(async () => { buttonByText(connection(), '保存')!.click(); staleRefreshButton.click() })
    expect(fake.calls.filter(c => c.path === 'cards' && c.method === 'POST')).toHaveLength(0)
    expect(host.textContent).not.toContain('OLD_IDENTITY')
    await act(async () => save.resolve({ status: 503, body: { error: 'SAVE_FAILED' } }))
    expect(host.textContent).not.toContain('OLD_IDENTITY')
  })

  it('初始 GET 晚于换 key 后的新 GET 返回，不得覆盖新卡片', async () => {
    const initialRead = deferred<ApiResponse>()
    const newRead = deferred<ApiResponse>()
    const save = deferred<ApiResponse>()
    let reads = 0
    const fake = await render(() => ++reads === 1 ? initialRead.promise : newRead.promise, { 'POST settings': () => save.promise })
    await act(async () => inputValue(connection().querySelector('input[type=password]')!, 'replacement-test-key'))
    await act(async () => buttonByText(connection(), '保存')!.click())
    await act(async () => save.resolve(ok(settingsView())))
    expect(reads).toBe(2)
    await act(async () => newRead.resolve(cardsOk([newCard])))
    await act(async () => initialRead.resolve(cardsOk([oldCard])))
    expect(host.textContent).toContain('NEW_IDENTITY')
    expect(host.textContent).not.toContain('OLD_IDENTITY')
    expect(fake.calls.filter(c => c.path === 'cards').map(c => c.method)).toEqual(['GET', 'GET'])
  })

  it('清 key 后显示 unconfigured，旧初始 GET 不得恢复卡片', async () => {
    const initialRead = deferred<ApiResponse>()
    const save = deferred<ApiResponse>()
    let reads = 0
    await render(() => ++reads === 1 ? initialRead.promise : ok({ status: 'unconfigured', cards: [] }), { 'POST settings': () => save.promise })
    await act(async () => buttonByText(connection(), '清除 key')!.click())
    await act(async () => save.resolve(ok(settingsView({ key: { configured: false, writable: true }, groups: [] }))))
    expect(reads).toBe(2)
    await act(async () => initialRead.resolve(cardsOk([oldCard])))
    expect(usage()?.getAttribute('data-usage-state')).toBe('unconfigured')
    expect(host.querySelectorAll('[data-card]')).toHaveLength(0)
    expect(buttonByText(host, '获取模型与用量')).toBeUndefined()
  })

  it('连接保存失败也不泄露旧卡片，旧请求不能补回且不自动读卡或 refresh', async () => {
    const save = deferred<ApiResponse>()
    const oldRefresh = deferred<ApiResponse>()
    const fake = await render(() => cardsOk([oldCard]), { 'POST settings': () => save.promise, 'POST cards': () => oldRefresh.promise })
    await act(async () => buttonByText(group('codex')!, '刷新')!.click())
    await saveAddress()
    await act(async () => save.resolve({ status: 503, body: { error: 'SAVE_FAILED' } }))
    await act(async () => oldRefresh.resolve(cardsOk([oldCard])))
    expect(host.textContent).toContain('SAVE_FAILED')
    expect(host.textContent).not.toContain('OLD_IDENTITY')
    expect(host.querySelectorAll('[data-card]')).toHaveLength(0)
    expect(fake.calls.filter(c => c.path === 'cards').map(c => c.method)).toEqual(['GET', 'POST'])
  })

  it('全页共享锁禁用所有设置写控件，B 在 A 响应后用最新 visibleModels，普通保存不读卡', async () => {
    const first = deferred<ApiResponse>()
    let view = settingsView()
    let posts = 0
    const applyVisible = (body: unknown) => {
      const visibleModels = (body as { visibleModels: Record<string, string[]> }).visibleModels
      view = { ...view, visibleModels, groups: view.groups.map(g => ({ ...g, models: g.models.map(m => ({ ...m, visible: !Object.hasOwn(visibleModels, g.provider) || visibleModels[g.provider]!.includes(m.id) })) })) }
      return ok(view)
    }
    const fake = await render(() => cardsOk([oldCard]), {
      'GET settings': () => ok(view),
      'POST settings': request => ++posts === 1 ? first.promise : applyVisible(request.body),
    })
    await act(async () => check('claude').click())
    const settingsControls = [
      ...connection().querySelectorAll('input, button'),
      ...host.querySelectorAll('[data-model] input, [data-model] select'),
    ] as (HTMLButtonElement | HTMLInputElement | HTMLSelectElement)[]
    expect(settingsControls.every(el => el.disabled)).toBe(true)
    await act(async () => check('codex').click())
    expect(settingsPosts(fake)).toHaveLength(1)
    await act(async () => first.resolve(applyVisible(settingsPosts(fake)[0]!.body)))
    expect(check('claude').checked).toBe(false)
    await act(async () => check('codex').click())
    expect(settingsPosts(fake).map(c => c.body)).toEqual([
      { visibleModels: { claude: [] } },
      { visibleModels: { claude: [], codex: [] } },
    ])
    expect(check('claude').checked).toBe(false)
    expect(check('codex').checked).toBe(false)
    expect(fake.calls.filter(c => c.path === 'cards').map(c => c.method)).toEqual(['GET'])
  })

  it('同一 tick 跨 provider 的写事件仅首个取得锁，失败后解锁 effort/连接控件', async () => {
    const pending = deferred<ApiResponse>()
    const fake = await render(() => cardsOk([]), { 'POST settings': () => pending.promise })
    await act(async () => { check('claude').click(); check('codex').click() })
    expect(settingsPosts(fake)).toHaveLength(1)
    await act(async () => pending.resolve({ status: 502, body: { error: 'TRY_AGAIN' } }))
    expect(check('claude').disabled).toBe(false)
    expect(check('codex').disabled).toBe(false)
    expect((connection().querySelector('input') as HTMLInputElement).disabled).toBe(false)
    expect((host.querySelector('[data-model] select') as HTMLSelectElement).disabled).toBe(false)
  })

  it.each(['effort', 'follow', 'resync'] as const)('%s 同样持有全页写锁，落定后恢复且不重读卡片', async action => {
    const pending = deferred<ApiResponse>()
    const view = settingsView({ visibleModels: { claude: [], codex: [] } })
    const fake = await render(() => cardsOk([oldCard]), { 'GET settings': () => ok(view), 'POST settings': () => pending.promise })
    await act(async () => {
      if (action === 'effort') {
        const select = group('codex')!.querySelector('select')!
        select.value = 'high'
        select.dispatchEvent(new Event('change', { bubbles: true }))
      } else if (action === 'follow') buttonByText(group('codex')!, '跟随网关模型列表')!.click()
      else buttonByText(connection(), '刷新模型列表')!.click()
    })
    const controls = host.querySelectorAll('[aria-label="连接"] input, [aria-label="连接"] button, [data-model] input, [data-model] select, [data-provider] .dmg-head button')
    expect(Array.from(controls).every(el => (el as HTMLInputElement).disabled)).toBe(true)
    expect(settingsPosts(fake)[0]!.body).toEqual(action === 'effort' ? { defaultEffort: { model: 'codex/gpt-6.1-sol', effort: 'high' } }
      : action === 'follow' ? { visibleModels: { claude: [] } } : { resync: true })
    await act(async () => pending.resolve(ok(view)))
    expect((group('claude')!.querySelector('select') as HTMLSelectElement).disabled).toBe(false)
    expect(buttonByText(group('claude')!, '跟随网关模型列表')?.disabled).toBe(false)
    expect(fake.calls.filter(c => c.path === 'cards').map(c => c.method)).toEqual(['GET'])
  })

  it('换 api 后晚到的 settings 响应不能回写当前页面', async () => {
    const stale = deferred<ApiResponse>()
    await render(() => cardsOk([]), { 'POST settings': () => stale.promise })
    await act(async () => buttonByText(connection(), '刷新模型列表')!.click())
    const next = fakeApi({
      'GET settings': () => ok(settingsView({ baseUrl: 'http://current.test/v1', groups: [{ provider: 'current', models: [] }] })),
      'GET cards': () => cardsOk([]),
    })
    await act(async () => root.render(h(MagpieSettings, { api: next.api })))
    expect(group('current')).not.toBeNull()
    await act(async () => stale.resolve(ok(settingsView({ groups: [{ provider: 'STALE_SETTINGS', models: [] }] }))))
    expect(group('STALE_SETTINGS')).toBeNull()
    expect(group('current')).not.toBeNull()
  })
})
