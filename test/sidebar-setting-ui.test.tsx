// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MagpieSettings } from '../src/client/SettingsPage.js'
import { readSidebarPreference, resetSidebarPreference } from '../src/client/sidebar-preference.js'
import { flush, ok, settingsView } from './client-support/fake-api.js'
import { fakeApi } from './client-support/fake-api.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
beforeEach(() => { resetSidebarPreference(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); resetSidebarPreference() })

it('设置页提供侧边栏开关，写入 sidebarUsage', async () => {
  const fake = fakeApi({
    'GET settings': () => ok(settingsView({ sidebarUsage: false })),
    'GET cards': () => ok({ status: 'ok', cards: [] }),
    'GET latency': () => ok({}),
    'POST settings': () => ok(settingsView({ sidebarUsage: true })),
  })
  await act(async () => root.render(h(MagpieSettings, { api: fake.api } as never)))
  await flush()
  const toggle = host.querySelector('[data-sidebar-usage-switch]') as HTMLButtonElement
  expect(toggle).not.toBeNull()
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  await act(async () => { toggle.click() })
  await flush()
  const post = fake.calls.find(call => call.method === 'POST' && call.path === 'settings')
  expect(post?.body).toEqual({ sidebarUsage: true })
})

it('设置页提供分钟级自动刷新输入，提交后写入 sidebarRefreshMinutes', async () => {
  const fake = fakeApi({
    'GET settings': () => ok(settingsView({ sidebarUsage: true, sidebarRefreshMinutes: 5 })),
    'GET cards': () => ok({ status: 'ok', cards: [] }),
    'GET latency': () => ok({}),
    'POST settings': () => ok(settingsView({ sidebarUsage: true, sidebarRefreshMinutes: 10 })),
  })
  await act(async () => root.render(h(MagpieSettings, { api: fake.api } as never)))
  await flush()
  const input = host.querySelector('[data-sidebar-refresh]') as HTMLInputElement
  expect(input).not.toBeNull()
  expect(input.value).toBe('5')
  expect(input.getAttribute('min')).toBe('0')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '10')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('focusout', { bubbles: true }))
  })
  await flush()
  const post = fake.calls.find(call => call.method === 'POST' && call.path === 'settings')
  expect(post?.body).toEqual({ sidebarRefreshMinutes: 10 })
})

it('设置页用多选 checkbox 配置窗口档位，提交后写入 sidebarWindows', async () => {
  const fake = fakeApi({
    'GET settings': () => ok(settingsView({ sidebarUsage: true, sidebarWindows: ['weekly'] })),
    'GET cards': () => ok({ status: 'ok', cards: [] }),
    'GET latency': () => ok({}),
    'POST settings': () => ok(settingsView({ sidebarUsage: true, sidebarWindows: ['fiveHour', 'weekly'] })),
  })
  await act(async () => root.render(h(MagpieSettings, { api: fake.api } as never)))
  await flush()
  const weekly = host.querySelector('[data-sidebar-window="weekly"]') as HTMLInputElement
  const five = host.querySelector('[data-sidebar-window="fiveHour"]') as HTMLInputElement
  expect(weekly).not.toBeNull()
  expect(weekly.type).toBe('checkbox')
  expect(weekly.checked).toBe(true)
  expect(five.checked).toBe(false)
  await act(async () => { five.click() })
  await flush()
  const post = fake.calls.find(call => call.method === 'POST' && call.path === 'settings')
  expect(post?.body).toEqual({ sidebarWindows: ['fiveHour', 'weekly'] })
  expect(readSidebarPreference()?.windows).toEqual(['fiveHour', 'weekly'])
})

it('取消最后一个档位被拒绝并提示', async () => {
  const fake = fakeApi({
    'GET settings': () => ok(settingsView({ sidebarUsage: true, sidebarWindows: ['weekly'] })),
    'GET cards': () => ok({ status: 'ok', cards: [] }),
    'GET latency': () => ok({}),
    'POST settings': () => ok(settingsView({ sidebarUsage: true })),
  })
  await act(async () => root.render(h(MagpieSettings, { api: fake.api } as never)))
  await flush()
  await act(async () => { (host.querySelector('[data-sidebar-window="weekly"]') as HTMLInputElement).click() })
  await flush()
  expect(fake.calls.filter(call => call.method === 'POST' && call.path === 'settings')).toHaveLength(0)
  expect(host.textContent).toContain('至少保留一个档位')
})
