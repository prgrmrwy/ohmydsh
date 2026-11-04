// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SidebarUsage } from '../src/client/SidebarUsage.js'
import { resetSidebarCardsCache } from '../src/client/sidebar-api.js'
import { resetSidebarPreference } from '../src/client/sidebar-preference.js'
import type { ApiResponse } from '../src/client/api.js'
import { flush, ok, settingsView } from './client-support/fake-api.js'
import { fakeApi } from './client-support/fake-api.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); resetSidebarPreference(); resetSidebarCardsCache() })
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  resetSidebarPreference(); resetSidebarCardsCache()
  // The rail popover portals into body; unmount removes it, but drop any leftover node defensively.
  for (const node of document.querySelectorAll('[data-dmg-sidebar-popover]')) node.remove()
})

const cardsOk = (cards: unknown[]): ApiResponse => ok({ status: 'ok', cards })
const weekly = (provider: string, used: number, extra: Record<string, unknown> = {}) => ({
  provider, name: provider, readAt: '2026-11-03T16:14:01Z', ...extra,
  windows: [{ name: '7 days', used, resetsAt: '2026-11-10T11:00:00Z' }],
})
const six = () => [
  weekly('claude', 8),
  weekly('codex', 91),
  { provider: 'opencode-go', name: 'OpenCode Go', error: 'HTTP 502', readAt: '2026-11-03T16:14:01Z' },
  weekly('deepseek', 78),
  weekly('kimi-code', 12),
  weekly('glm-coding', 46),
]

async function render(options: { enabled?: boolean; wide?: boolean; cards?: () => ApiResponse | Promise<ApiResponse>; settings?: Record<string, unknown> } = {}) {
  const enabled = options.enabled ?? true
  const fake = fakeApi({
    'GET settings': () => ok(settingsView({ sidebarUsage: enabled, ...options.settings })),
    'GET cards': options.cards ?? (() => cardsOk(six())),
    'POST cards': (request) => cardsOk(six()).status === 200 ? cardsOk(six()) : cardsOk([]),
  })
  await act(async () => root.render(h(SidebarUsage, { api: fake.api, wide: options.wide ?? true } as never)))
  await flush()
  return fake
}

const rows = () => Array.from(host.querySelectorAll('[data-dmg-sidebar-row]'))
const rowOf = (provider: string) => host.querySelector(`[data-dmg-sidebar-row="${provider}"]`)

describe('偏好', () => {
  it('关闭时不渲染任何额度 UI，也不请求卡片', async () => {
    const fake = await render({ enabled: false })
    expect(host.innerHTML).toBe('')
    expect(fake.calls.filter(call => call.path === 'cards')).toHaveLength(0)
  })

  it('打开时渲染常驻卡并读一次卡片', async () => {
    const fake = await render()
    expect(host.querySelector('[data-dmg-sidebar]')).not.toBeNull()
    expect(fake.calls.filter(call => call.path === 'cards' && call.method === 'GET')).toHaveLength(1)
  })
})

describe('常驻卡', () => {
  it('每个上游只显示周窗口', async () => {
    const fake = await render({
      cards: () => cardsOk([
        { provider: 'claude', name: 'Claude', readAt: 'T1', windows: [{ name: '5 hours', used: 90 }, { name: '7 days', used: 8 }] },
      ]),
    })
    expect(fake).toBeDefined()
    const row = rowOf('claude')!
    expect(row.textContent).toContain('7 days')
    expect(row.textContent).not.toContain('5 hours')
    expect(row.textContent).toContain('8%')
  })

  it('收起行把窗口名放进括号，并显示到期时间与百分比', async () => {
    const resetsAt = new Date(2026, 10, 20, 11, 0).toISOString()
    await render({
      cards: () => cardsOk([
        { provider: 'claude', name: 'Claude', readAt: 'T1', windows: [{ name: '7 days', used: 20, resetsAt }] },
      ]),
    })
    const row = rowOf('claude')!
    expect(row.querySelector('.dmg-sidebar-window')!.textContent).toBe('(7 days)')
    const expiry = row.querySelector('[data-dmg-sidebar-expiry]') as HTMLElement
    expect(expiry).not.toBeNull()
    expect(expiry.textContent).toContain('11/20 11:00')
    expect(expiry.title).toContain('重置于')
    expect(row.querySelector('[data-reading]')!.textContent).toBe('20%')
  })

  it('没有到期时间时不显示占位', async () => {
    await render({ cards: () => cardsOk([{ provider: 'claude', name: 'Claude', readAt: 'T1', windows: [{ name: '7 days', used: 20 }] }]) })
    expect(rowOf('claude')!.querySelector('[data-dmg-sidebar-expiry]')).toBeNull()
  })

  it('最多 5 行：超出的行靠卡内滚动，并出现双箭头', async () => {
    await render()
    expect(rows()).toHaveLength(6)
    expect(host.querySelector('.dmg-sidebar-body')?.className).toContain('is-scroll')
    expect(host.querySelector('[data-dmg-sidebar-more]')).not.toBeNull()
    const { settingsCss } = await import('../src/client/styles.js')
    expect(settingsCss).toContain('.dmg-sidebar-body{max-height:145px')
  })

  it('没有溢出时不渲染双箭头', async () => {
    await render({ cards: () => cardsOk([weekly('claude', 8)]) })
    expect(host.querySelector('[data-dmg-sidebar-more]')).toBeNull()
  })

  it('读取失败的行显示失败文案且没有进度条', async () => {
    await render()
    const row = rowOf('opencode-go')!
    expect(row.textContent).toContain('读取失败')
    expect(row.querySelector('.dmg-sidebar-bar')).toBeNull()
  })

  it('只有一个刷新入口，点击发出一次全量刷新', async () => {
    const fake = await render()
    const refresh = host.querySelectorAll('[data-dmg-sidebar-refresh]')
    expect(refresh).toHaveLength(1)
    await act(async () => { (refresh[0] as HTMLButtonElement).click() })
    await flush()
    const posts = fake.calls.filter(call => call.path === 'cards' && call.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0]!.body).toEqual({ all: true })
  })

  it('页面重新可见时补读，但 60 秒 TTL 内不重复请求', async () => {
    const fake = await render()
    const calls = () => fake.calls.filter(call => call.path === 'cards' && call.method === 'GET').length
    expect(calls()).toBe(1)
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await flush()
    expect(calls()).toBe(1)
  })

  it('没有额度的上游只显示余额，不显示横线', async () => {
    await render({ cards: () => cardsOk([{ provider: 'deepseek', name: 'DeepSeek', readAt: 'T1', balance: '¥42.50' }]) })
    const row = rowOf('deepseek')!
    expect(row.textContent).toContain('¥42.50')
    expect(row.textContent).not.toContain('—')
  })

  it('空数据时显示状态行', async () => {
    await render({ cards: () => cardsOk([]) })
    expect(host.textContent).toContain('未返回可见用量')
  })
})

describe('展开', () => {
  it('标题行开关展开明细，5 行摘要让位、卡片在流内变高', async () => {
    await render()
    await act(async () => { (host.querySelector('[data-dmg-sidebar-toggle]') as HTMLElement).click() })
    await flush()
    const expanded = host.querySelector('[data-dmg-sidebar-expanded]')
    expect(expanded).not.toBeNull()
    expect(expanded!.querySelectorAll('[data-provider]')).toHaveLength(6)
    // 流内手风琴：不再保留隐藏的常驻卡，也不再渲染 5 行摘要。
    expect(host.querySelector('[data-dmg-sidebar-row]')).toBeNull()
    expect(host.querySelector('[data-dmg-sidebar-more]')).toBeNull()
    const card = host.querySelector('.dmg-sidebar-card') as HTMLElement
    expect(card.style.visibility).toBe('')
    expect(card.getAttribute('aria-hidden')).toBeNull()
    expect(host.querySelector('[data-dmg-sidebar]')!.getAttribute('data-open')).toBe('true')
  })

  it('点击正文与双箭头不触发展开，只有标题行可以切换', async () => {
    await render()
    await act(async () => { (host.querySelector('.dmg-sidebar-body') as HTMLElement).click() })
    await act(async () => { (host.querySelector('[data-dmg-sidebar-more]') as HTMLElement).click() })
    await flush()
    expect(host.querySelector('[data-dmg-sidebar-expanded]')).toBeNull()
    expect(host.querySelector('[data-dmg-sidebar-more]')!.getAttribute('role')).toBeNull()
  })

  it('title 上的开关同时负责展开与收起', async () => {
    await render()
    const toggle = host.querySelector('[data-dmg-sidebar-toggle]') as HTMLElement
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await act(async () => { toggle.click() })
    await flush()
    const expanded = host.querySelector('[data-dmg-sidebar-expanded]')
    expect(expanded).not.toBeNull()
    expect(host.querySelector('[data-dmg-sidebar-toggle]')!.getAttribute('aria-expanded')).toBe('true')
    await act(async () => { (host.querySelector('[data-dmg-sidebar-toggle]') as HTMLElement).click() })
    await flush()
    expect(host.querySelector('[data-dmg-sidebar-expanded]')).toBeNull()
    expect(host.querySelectorAll('[data-dmg-sidebar-row]')).toHaveLength(6)
  })
})

describe('自动刷新', () => {
  const reads = (fake: ReturnType<typeof fakeApi>) => fake.calls.filter(call => call.path === 'cards' && call.method === 'GET').length
  const setVisibility = (value: 'visible' | 'hidden') => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value })

  it('默认 5 分钟后静默重新读取，且不发送全量刷新', async () => {
    vi.useFakeTimers()
    try {
      const fake = await render()
      expect(reads(fake)).toBe(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000) })
      await flush()
      expect(reads(fake)).toBe(2)
      expect(fake.calls.filter(call => call.method === 'POST')).toHaveLength(0)
    } finally { vi.useRealTimers(); setVisibility('visible') }
  })

  it('间隔设为 0 时不再自动读取', async () => {
    vi.useFakeTimers()
    try {
      const fake = await render({ settings: { sidebarRefreshMinutes: 0 } })
      await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60_000) })
      expect(reads(fake)).toBe(1)
    } finally { vi.useRealTimers(); setVisibility('visible') }
  })

  it('页面隐藏时到期不读取', async () => {
    vi.useFakeTimers()
    try {
      const fake = await render()
      setVisibility('hidden')
      await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000) })
      expect(reads(fake)).toBe(1)
    } finally { vi.useRealTimers(); setVisibility('visible') }
  })
})

describe('侧栏收起', () => {
  it('只渲染 icon，点击后在浮层里显示完整卡片', async () => {
    await render({ wide: false })
    expect(host.querySelector('[data-dmg-sidebar]')).toBeNull()
    const rail = host.querySelector('[data-dmg-sidebar-rail]') as HTMLButtonElement
    expect(rail).not.toBeNull()
    expect(rail.getAttribute('aria-label')).toBe('Magpie 额度')
    expect(rail.title).toBe('Magpie 额度')
    await act(async () => { rail.click() })
    await flush()
    const popover = document.querySelector('[data-dmg-sidebar-popover]')
    expect(popover).not.toBeNull()
    expect(popover!.querySelectorAll('[data-provider]')).toHaveLength(6)
  })
})
