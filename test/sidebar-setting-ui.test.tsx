// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MagpieSettings } from '../src/client/SettingsPage.js'
import { resetSidebarPreference } from '../src/client/sidebar-preference.js'
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
