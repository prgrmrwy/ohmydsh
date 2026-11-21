// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SidebarUsage } from '../src/client/SidebarUsage.js'
import { resetSidebarCardsCache } from '../src/client/sidebar-api.js'
import { resetSidebarPreference } from '../src/client/sidebar-preference.js'
import { flush, ok, settingsView, fakeApi } from './client-support/fake-api.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); resetSidebarPreference(); resetSidebarCardsCache() })
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); resetSidebarPreference(); resetSidebarCardsCache()
  for (const node of document.querySelectorAll('[data-dmg-sidebar-popover]')) node.remove()
  vi.restoreAllMocks()
})

const R = '2026-11-20T08:00:00Z'
async function render(cards: unknown[], windows: string[] = ['weekly'], wide = true) {
  const fake = fakeApi({
    'GET settings': () => ok(settingsView({ sidebarUsage: true, sidebarWindows: windows })),
    'GET cards': () => ok({ status: 'ok', cards }),
    'POST cards': () => ok({ status: 'ok', cards }),
  })
  await act(async () => root.render(h(SidebarUsage, { api: fake.api, wide } as never)))
  await flush()
}
const expand = async () => { await act(async () => { (host.querySelector('[data-dmg-sidebar-toggle]') as HTMLElement).click() }); await flush() }
const text = (el: Element | null | undefined) => el?.textContent ?? ''
const groupTitles = (root: ParentNode) => [...root.querySelectorAll('[data-dmg-sidebar-group-title]')].map(text)
const accounts = (root: ParentNode) => [...root.querySelectorAll('[data-dmg-sidebar-account]')].map(text)

const codexA = { provider: 'codex', name: 'Codex', user: 'a@example.com', plan: 'prolite', readAt: R, windows: [{ name: '7 days', used: 3, resetsAt: '2026-11-25T09:17:00Z' }] }
const claude = { provider: 'claude', name: 'Claude Code', readAt: R, windows: [{ name: '7 days', used: 20 }] }
const codexB = { provider: 'codex', name: 'Codex', user: 'b@example.com', plan: 'free', readAt: R, windows: [{ name: '30 days', used: 0, resetsAt: '2026-12-20T08:04:00Z' }] }

test('test_sidebar_accounts_01 spec Scenario "同一上游多账号分段"', async () => {
  await render([codexA, claude, codexB])
  const group = host.querySelector('[data-dmg-sidebar-group="codex"]')!
  expect(group).not.toBeNull()
  expect(groupTitles(host)).toEqual(['Codex2 个账号'])
  expect(accounts(group)).toEqual(['a@example.com', 'b@example.com'])
  const rows = [...group.querySelectorAll('[data-dmg-sidebar-row]')]
  expect(text(rows[0])).toContain('prolite'); expect(text(rows[0])).toContain('7 days'); expect(text(rows[0])).toContain('3%')
  expect(text(rows[1])).toContain('free'); expect(text(rows[1])).toContain('30 days'); expect(text(rows[1])).toContain('0%')
  for (const row of rows) expect(row.querySelector('.dmg-sidebar-bar')).not.toBeNull()
  const single = host.querySelector('[data-dmg-sidebar-row="claude"]')!
  expect(single.closest('[data-dmg-sidebar-group]')).toBeNull()
  expect(single.querySelector('[data-dmg-sidebar-account]')).toBeNull()
  expect(text(single)).toContain('Claude Code')
  await expand()
  const detail = host.querySelector('[data-dmg-sidebar-expanded]')!
  expect(groupTitles(detail)).toEqual(['Codex2 个账号'])
  expect(accounts(detail)).toEqual(['a@example.com', 'b@example.com'])
  expect([...detail.querySelectorAll('.dmg-sidebar-prov-head strong')].map(text)).toEqual(['a@example.com', 'b@example.com', 'Claude Code'])
})

test('test_sidebar_accounts_02 spec Scenario "多账号且勾选多个档位"', async () => {
  const card = (user: string, extra = {}) => ({ provider: 'claude', name: 'Claude Code', user, readAt: R, ...extra, windows: [{ name: '5 hours', used: 10, resetsAt: '2026-11-20T10:00:00Z' }, { name: '7 days', used: 40, resetsAt: '2026-11-24T10:00:00Z' }] })
  await render([card('a@example.com', { plan: 'max' }), card('b@example.com')], ['fiveHour', 'weekly'])
  const group = host.querySelector('[data-dmg-sidebar-group="claude"]')!
  expect(groupTitles(host)).toEqual(['Claude Code2 个账号'])
  const rows = [...group.querySelectorAll('[data-dmg-sidebar-row]')]
  expect(rows).toHaveLength(2)
  expect(text(rows[0]!.querySelector('[data-dmg-sidebar-account]'))).toBe('a@example.com')
  expect(text(rows[0])).toContain('max')
  for (const row of rows) {
    const lines = [...row.querySelectorAll('.dmg-sidebar-win-row')].map(text)
    expect(lines.map(l => l.startsWith('5 hours') ? '5h' : l.startsWith('7 days') ? '7d' : l)).toEqual(['5h', '7d'])
    expect(row.querySelectorAll('.dmg-sidebar-bar')).toHaveLength(2)
  }
})

test('test_sidebar_accounts_03 spec Scenario "组内一个账号失败、一个只有余额"', async () => {
  await render([{ provider: 'deepseek', name: 'DeepSeek', user: 'a', error: 'HTTP 502', readAt: R }, { provider: 'deepseek', name: 'DeepSeek', user: 'b', balance: '¥42.50', readAt: R }])
  const group = host.querySelector('[data-dmg-sidebar-group="deepseek"]')!
  expect(groupTitles(host)).toEqual(['DeepSeek2 个账号'])
  const [a, b] = [...group.querySelectorAll('[data-dmg-sidebar-row]')]
  expect(text(a)).toContain('读取失败'); expect(text(a)).not.toContain('%'); expect(a!.querySelector('.dmg-sidebar-bar')).toBeNull()
  expect(text(b)).toContain('¥42.50'); expect(b!.querySelector('.dmg-sidebar-bar')).toBeNull()
  await expand()
  const detail = host.querySelector('[data-dmg-sidebar-expanded]')!
  expect(text(detail)).toContain('HTTP 502'); expect(text(detail)).toContain('¥42.50')
})

test('test_sidebar_accounts_04 spec Scenario "侧栏收起时浮层也分段"', async () => {
  await render([codexA, claude, codexB], ['weekly'], false)
  await act(async () => { (host.querySelector('[data-dmg-sidebar-rail]') as HTMLElement).click() }); await flush()
  const pop = document.querySelector('[data-dmg-sidebar-popover]')!
  expect(groupTitles(pop)).toEqual(['Codex2 个账号'])
  expect(accounts(pop)).toEqual(['a@example.com', 'b@example.com'])
})

test('test_sidebar_accounts_05 spec Scenario "多账号缺少 user"', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const card = (user?: string) => ({ provider: 'codex', name: 'Codex', ...(user === undefined ? {} : { user }), readAt: R, windows: [{ name: '7 days', used: 5 }] })
  await render([card(), card('  '), card('c@example.com')])
  expect(accounts(host)).toEqual(['账号 1', '账号 2', 'c@example.com'])
  expect(text(host)).not.toContain('undefined')
  expect(errors.mock.calls.some(call => String(call[0]).includes('same key'))).toBe(false)
})

test('test_sidebar_accounts_06 spec Scenario "账号标识过长时截断"', async () => {
  const long = 'x'.repeat(49) + '@example.co'
  expect(long).toHaveLength(60)
  await render([{ ...codexA, user: long }, codexB])
  const el = host.querySelector('[data-dmg-sidebar-account]')!
  expect(el.getAttribute('title')).toBe(long)
  expect(el.classList.contains('dmg-sidebar-account')).toBe(true)
  const { settingsCss: sidebarCss } = await import('../src/client/styles.js')
  const rule = sidebarCss.match(/\.dmg-sidebar-account\{[^}]*\}/)?.[0] ?? ''
  expect(rule).toContain('text-overflow:ellipsis'); expect(rule).toContain('min-width:0')
})

test('test_sidebar_accounts_07 spec Scenario "文字读数不画进度条"', async () => {
  await render([{ provider: 'codex', name: 'Codex', readAt: R, windows: [{ name: '7 days', used: 3 }, { name: 'Image generation', used: 0, display: 'Unknown' }] }])
  await expand()
  const wins = [...host.querySelectorAll('[data-dmg-sidebar-expanded] .dmg-sidebar-win')]
  // Text readings such as Image generation `Unknown` are left to the settings page.
  expect(wins).toHaveLength(1)
  expect(text(wins[0])).toContain('3%'); expect(wins[0]!.querySelector('.dmg-sidebar-bar')).not.toBeNull()
  expect(text(host)).not.toContain('Unknown')
})

test('test_sidebar_accounts_08 spec Scenario "档位窗口带 display 时仍是档位行"', async () => {
  await render([{ provider: 'codex', name: 'Codex', readAt: R, windows: [{ name: '7 days', used: 20, display: '约 20%' }] }])
  const row = host.querySelector('[data-dmg-sidebar-row="codex"]')!
  const label = row.querySelector('.dmg-sidebar-window')!
  expect(text(label)).toBe('(7 days)'); expect(label.getAttribute('title')).toBeNull()
  const reading = row.querySelector('[data-reading]')!
  expect(text(reading)).toBe('约 20%'); expect(reading.getAttribute('data-level')).toBeNull()
  expect(row.querySelector('.dmg-sidebar-bar')).toBeNull()
})

test('test_sidebar_accounts_09 spec Scenario "文字读数不参与回退选择"', async () => {
  await render([{ provider: 'codex', name: 'Codex', readAt: R, windows: [{ name: '30 days', used: 0 }, { name: 'Image generation', used: 50, display: 'Unknown' }] }])
  const row = host.querySelector('[data-dmg-sidebar-row="codex"]')!
  expect(text(row.querySelector('.dmg-sidebar-window'))).toBe('(30 days)')
  expect(text(row.querySelector('[data-reading]'))).toBe('0%')
})

test('test_sidebar_accounts_10 spec Scenario "同一上游卡片不相邻时归到首次出现处"', async () => {
  await render([codexA, claude, codexB])
  const order = [...host.querySelectorAll('[data-dmg-sidebar-row]')].map(el => text(el.querySelector('[data-dmg-sidebar-account]')) || el.getAttribute('data-dmg-sidebar-row'))
  expect(order).toEqual(['a@example.com', 'b@example.com', 'claude'])
})

test('regression: only the account shrinks; plan, expiry and reading keep full width', async () => {
  const { settingsCss } = await import('../src/client/styles.js')
  const rule = (name: string) => settingsCss.match(new RegExp(`\\.${name}\\{[^}]*\\}`))?.[0] ?? ''
  expect(rule('dmg-sidebar-plan')).toMatch(/flex:none/)
  expect(rule('dmg-sidebar-plan')).not.toContain('ellipsis')
  expect(rule('dmg-sidebar-expiry')).toMatch(/flex:none/)
  expect(rule('dmg-sidebar-pct')).toMatch(/flex:none/)
  expect(rule('dmg-sidebar-account')).toMatch(/flex:0 1 auto;min-width:0/)
  expect(rule('dmg-sidebar-label')).toContain('overflow:hidden')
})

test('spec Scenario "组内同一窗口时窗口名提到组标题"', async () => {
  const card = (user?: string) => ({ provider: 'codex', name: 'Codex', ...(user ? { user } : {}), plan: 'self_serve_business_prolite', readAt: R, windows: [{ name: '7 days', used: 3, resetsAt: '2026-11-25T09:17:00Z' }] })
  await render([card(), card(), card('c@example.com'), card('d@example.com')])
  const title = text(host.querySelector('[data-dmg-sidebar-group-title]'))
  expect(title).toContain('Codex'); expect(title).toContain('(7 days)'); expect(title).toContain('4 个账号')
  const rows = [...host.querySelectorAll('[data-dmg-sidebar-group="codex"] [data-dmg-sidebar-row]')]
  expect(rows).toHaveLength(4)
  for (const row of rows) {
    expect(text(row)).toContain('self_serve_business_prolite')
    expect(text(row)).not.toContain('7 days')
    expect(text(row)).toContain('3%')
    expect(row.querySelector('.dmg-sidebar-expiry')).not.toBeNull()
  }
})

test('two-line account rows: account alone, then plan/window/expiry/reading line', async () => {
  await render([codexA, claude, codexB])
  for (const row of host.querySelectorAll('[data-dmg-sidebar-group="codex"] [data-dmg-sidebar-row]')) {
    const top = row.querySelector('.dmg-sidebar-account-line')!
    expect(top.querySelector('[data-dmg-sidebar-account]')).not.toBeNull()
    expect(top.querySelector('.dmg-sidebar-plan')).toBeNull()
    const line = row.querySelector('.dmg-sidebar-row-line')!
    expect(line.querySelector('[data-dmg-sidebar-account]')).toBeNull()
    expect(line.querySelector('.dmg-sidebar-plan')).not.toBeNull()
    expect(line.querySelector('.dmg-sidebar-expiry')).not.toBeNull()
    expect(line.querySelector('[data-reading]')).not.toBeNull()
  }
})

test('sidebar copy says 用量; reset copy keeps 额度', async () => {
  const { zh } = await import('../src/client/locales.js')
  expect(zh.sidebarTitle).toBe('Magpie 用量'); expect(zh.sidebarPanelTitle).toBe('侧边栏用量'); expect(zh.sidebarToggle).toBe('在侧边栏常驻显示用量')
  expect(zh.resetUseAcknowledge).toContain('额度')
  await render([claude])
  expect(text(host.querySelector('.dmg-sidebar-title'))).toBe('Magpie 用量')
})

test('rail popover hides text readings but keeps unlimited windows', async () => {
  await render([{ provider: 'codex', name: 'Codex', readAt: R, windows: [{ name: '7 days', used: 3 }, { name: 'Image generation', used: 0, display: 'Unknown' }, { name: 'Chat', unlimited: true }] }], ['weekly'], false)
  await act(async () => { (host.querySelector('[data-dmg-sidebar-rail]') as HTMLElement).click() }); await flush()
  const pop = document.querySelector('[data-dmg-sidebar-popover]')!
  expect(text(pop)).not.toContain('Unknown'); expect(text(pop)).not.toContain('Image generation')
  expect(text(pop)).toContain('Chat'); expect(text(pop)).toContain('无限')
})

test('window name stays on rows when the group does not share one window', async () => {
  const ok = (user: string, windows: unknown[]) => ({ provider: 'codex', name: 'Codex', user, readAt: R, windows })
  await render([ok('a', [{ name: '7 days', used: 3 }]), { provider: 'codex', name: 'Codex', user: 'b', error: 'HTTP 502', readAt: R }])
  expect(text(host.querySelector('[data-dmg-sidebar-group-title]'))).not.toContain('7 days')
  expect(text(host.querySelector('[data-dmg-sidebar-group="codex"] [data-dmg-sidebar-row]'))).toContain('7 days')
  await act(async () => root.unmount()); root = createRoot(host); resetSidebarCardsCache(); resetSidebarPreference()
  await render([ok('a', [{ name: '5 hours', used: 1 }, { name: '7 days', used: 3 }]), ok('b', [{ name: '5 hours', used: 2 }, { name: '7 days', used: 4 }])], ['fiveHour', 'weekly'])
  const title = text(host.querySelector('[data-dmg-sidebar-group-title]'))
  expect(title).not.toContain('5 hours'); expect(title).not.toContain('7 days')
})

test('account second line wraps as a unit instead of truncating', async () => {
  const { settingsCss } = await import('../src/client/styles.js')
  expect(settingsCss).toMatch(/\.dmg-sidebar-row-line\.is-account\{[^}]*flex-wrap:wrap/)
  expect(settingsCss).toMatch(/\.dmg-sidebar-reading-group\{[^}]*flex:none/)
  await render([codexA, claude, codexB])
  for (const row of host.querySelectorAll('[data-dmg-sidebar-group="codex"] [data-dmg-sidebar-row]')) {
    const group = row.querySelector('.dmg-sidebar-row-line.is-account .dmg-sidebar-reading-group')!
    expect(group.querySelector('.dmg-sidebar-expiry')).not.toBeNull()
    expect(group.querySelector('[data-reading]')).not.toBeNull()
  }
})
