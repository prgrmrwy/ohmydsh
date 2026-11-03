// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
  it('点击卡片原地长高：常驻卡保留占位、展开层显示全部窗口', async () => {
    await render()
    await act(async () => { (host.querySelector('.dmg-sidebar-body') as HTMLElement).click() })
    await flush()
    const expanded = host.querySelector('[data-dmg-sidebar-expanded]')
    expect(expanded).not.toBeNull()
    expect(expanded!.querySelectorAll('[data-provider]')).toHaveLength(6)
    const card = host.querySelector('.dmg-sidebar-card') as HTMLElement
    expect(card.style.visibility).toBe('hidden')
    expect(card.getAttribute('aria-hidden')).toBe('true')
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
    await act(async () => { (expanded!.querySelector('[data-dmg-sidebar-toggle]') as HTMLElement).click() })
    await flush()
    expect(host.querySelector('[data-dmg-sidebar-expanded]')).toBeNull()
    expect((host.querySelector('.dmg-sidebar-card') as HTMLElement).style.visibility).toBe('')
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
