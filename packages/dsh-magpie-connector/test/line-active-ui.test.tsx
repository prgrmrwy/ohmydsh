// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test } from 'vitest'
import { MagpieSettings } from '../src/client/SettingsPage.js'
import { fakeApi, flush, ok, settingsView } from './client-support/fake-api.js'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const twoLines = {
  lines: [
    { id: 'a1b2c3d4', baseUrl: 'http://lan.test:3425/v1', accessMode: 'direct', complete: true, key: { configured: true, writable: true } },
    { id: '9f0e7d6c', baseUrl: 'https://public.test/v1', accessMode: 'cloudflare', complete: true, key: { configured: true, writable: true }, access: { clientId: { configured: true, writable: true }, clientSecret: { configured: true, writable: true } } },
  ],
  activeLineId: '9f0e7d6c',
}
const render = async (view: Record<string, unknown>) => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const fake = fakeApi({ 'GET settings': () => ok(settingsView(view)), 'GET cards': () => ok({ status: 'ok', cards: [] }) })
  await act(async () => root.render(h(MagpieSettings, { api: fake.api }))); await flush()
  return { host, root }
}

test('test_line_active_ui_01 spec Scenario "默认只展开 active 并显示 4×4 绿方块"', async () => {
  const { host, root } = await render(twoLines)
  try {
    const line2 = host.querySelector('[data-line-id="9f0e7d6c"]')!
    const line1 = host.querySelector('[data-line-id="a1b2c3d4"]')!
    expect(line2.getAttribute('data-expanded')).toBe('true')
    expect(line1.getAttribute('data-expanded')).toBe('false')
    const marker = line2.querySelector('[data-active-line="9f0e7d6c"]')!
    expect(marker.getAttribute('aria-label')).toBe('当前线路')
    expect(marker.className).toContain('dmg-active')
    expect(line1.querySelector('[data-active-line]')).toBeNull()
    expect(host.querySelectorAll('[role="alert"]').length).toBe(0)
  } finally { act(() => root.unmount()); host.remove() }
})

test('test_line_active_ui_02 spec Scenario "无 active 时不显示方块"', async () => {
  const view = { lines: [{ id: 'a1b2c3d4', baseUrl: '', accessMode: 'direct', complete: false, key: { configured: false, writable: true } }], activeLineId: null }
  const { host, root } = await render(view)
  try {
    expect(host.querySelector('[data-line-id="a1b2c3d4"]')).not.toBeNull()
    expect(host.querySelector('[data-active-line]')).toBeNull()
  } finally { act(() => root.unmount()); host.remove() }
})

test('test_line_active_ui_03 spec Scenario "已保存但未完整的线路标记为未配置"', async () => {
  const view = {
    lines: [
      { id: 'a1b2c3d4', baseUrl: 'http://lan.test:3425/v1', accessMode: 'direct', complete: true, key: { configured: true, writable: true } },
      { id: '9f0e7d6c', baseUrl: 'https://public.test/v1', accessMode: 'direct', complete: false, key: { configured: false, writable: true } },
    ],
    activeLineId: 'a1b2c3d4',
  }
  const { host, root } = await render(view)
  try {
    const active = host.querySelector('[data-line-id="a1b2c3d4"]') as HTMLElement
    const incomplete = host.querySelector('[data-line-id="9f0e7d6c"]') as HTMLElement
    expect(active.querySelector('[data-line-incomplete]')).toBeNull()
    expect(active.textContent).not.toContain('未配置')
    const marker = incomplete.querySelector('[data-line-incomplete]')!
    expect(marker).not.toBeNull()
    expect(marker.textContent).toBe('未配置')
    expect(incomplete.querySelector('[data-active-line]')).toBeNull()
    // The marker reflects the saved state only: this line is saved (no "未保存" tag), it just is
    // not complete. A brand-new draft gets the "未保存" tag instead, never "未配置".
    expect(incomplete.textContent).not.toContain('（未保存）')
    const add = Array.from(host.querySelectorAll('button')).find(node => node.textContent === '添加备用线路')!
    act(() => add.click())
    const draft = Array.from(host.querySelectorAll('.dmg-line')).at(-1) as HTMLElement
    expect(draft.textContent).toContain('（未保存）')
    expect(draft.querySelector('[data-line-incomplete]')).toBeNull()
  } finally { act(() => root.unmount()); host.remove() }
})
