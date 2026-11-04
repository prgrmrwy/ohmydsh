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

it('设置页提供窗口档位下拉，提交后写入 sidebarWindow', async () => {
  const fake = fakeApi({
    'GET settings': () => ok(settingsView({ sidebarUsage: true, sidebarWindow: 'weekly' })),
    'GET cards': () => ok({ status: 'ok', cards: [] }),
    'GET latency': () => ok({}),
    'POST settings': () => ok(settingsView({ sidebarUsage: true, sidebarWindow: 'fiveHour' })),
  })
  await act(async () => root.render(h(MagpieSettings, { api: fake.api } as never)))
  await flush()
  const select = host.querySelector('[data-sidebar-window]') as HTMLSelectElement
  expect(select).not.toBeNull()
  expect(select.value).toBe('weekly')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'fiveHour')
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await flush()
  const post = fake.calls.find(call => call.method === 'POST' && call.path === 'settings')
  expect(post?.body).toEqual({ sidebarWindow: 'fiveHour' })
  expect(readSidebarPreference()?.windowMode).toBe('fiveHour')
})
