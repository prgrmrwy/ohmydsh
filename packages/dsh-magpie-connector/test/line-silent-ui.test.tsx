// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { MagpieSettings } from '../src/client/SettingsPage.js'
import { fakeApi, flush, ok, settingsView } from './client-support/fake-api.js'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { vi.restoreAllMocks() })

async function mount(view: Record<string, unknown>) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const fake = fakeApi({ 'GET settings': () => ok(settingsView(view)), 'GET cards': () => ok({ status: 'ok', cards: [] }) })
  await act(async () => root.render(h(MagpieSettings, { api: fake.api }))); await flush()
  return { host, root }
}
const line = (id: string, active: string | null) => ({
  lines: [{ id, baseUrl: `http://${id}.test:3425/v1`, accessMode: 'direct', complete: true, key: { configured: true, writable: true } }],
  activeLineId: active,
})

test('test_line_silent_ui_01 spec Scenario "切换线路静默无提示"', async () => {
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
  const confirm = vi.spyOn(window, 'confirm').mockImplementation(() => true)
  const first = await mount(line('a1b2c3d4', 'a1b2c3d4'))
  act(() => first.root.unmount()); first.host.remove()
  const second = await mount(line('9f0e7d6c', '9f0e7d6c'))
  try {
    expect(alert).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled()
    expect(second.host.querySelector('[role="alert"]')).toBeNull()
    expect(second.host.querySelector('[aria-live]')).toBeNull()
    expect(second.host.textContent).not.toContain('线路已切换')
    const marker = second.host.querySelector('[data-active-line="9f0e7d6c"]')!
    expect(marker).not.toBeNull()
  } finally { act(() => second.root.unmount()); second.host.remove() }
})

test('test_line_silent_ui_02 spec Scenario "info 图标说明优先级"', async () => {
  const { host, root } = await mount(line('a1b2c3d4', 'a1b2c3d4'))
  try {
    const info = host.querySelector('.dmg-info') as HTMLElement
    expect(info).not.toBeNull()
    expect(info.getAttribute('tabindex')).toBe('0')
    for (const attribute of ['title', 'aria-label']) {
      const text = info.getAttribute(attribute) ?? ''
      expect(text).toContain('按序号')
      expect(text).toContain('自动')
      expect(text).toContain('绿色方块')
      expect(text).toContain('同一个 Magpie 网关')
      expect(text).toContain('TCP 建连耗时（含 DNS 解析）')
    }
  } finally { act(() => root.unmount()); host.remove() }
})
