// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test } from 'vitest'
import { MagpieSettings } from '../src/client/SettingsPage.js'
import { buttonByText, expandLine, fakeApi, flush, inputValue, ok, settingsView, type Call } from './client-support/fake-api.js'
import type { ApiResponse } from '../src/client/api.js'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const savedLine = (id: string, baseUrl: string, overrides: Record<string, unknown> = {}) => ({
  id, baseUrl, accessMode: 'direct', complete: true,
  key: { configured: true, writable: true },
  access: { clientId: { configured: false, writable: true }, clientSecret: { configured: false, writable: true } },
  ...overrides,
})
const twoLines = {
  lines: [savedLine('a1b2c3d4', 'http://lan.test:3425/v1'), savedLine('9f0e7d6c', 'https://public.test/v1')],
  activeLineId: '9f0e7d6c',
}

interface Mounted { host: HTMLElement; root: ReturnType<typeof createRoot>; calls: Call[] }
async function mount(view: Record<string, unknown>, handlers: Parameters<typeof fakeApi>[0] = {}): Promise<Mounted> {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const fake = fakeApi({
    'GET settings': () => ok(settingsView(view)),
    'GET cards': () => ok({ status: 'ok', cards: [] }),
    'GET latency': () => ok({ lines: [] }),
    ...handlers,
  })
  await act(async () => root.render(h(MagpieSettings, { api: fake.api }))); await flush()
  return { host, root, calls: fake.calls }
}
const cleanup = (mounted: Mounted) => { act(() => mounted.root.unmount()); mounted.host.remove() }
const row = (host: HTMLElement, id: string) => host.querySelector(`[data-line-id="${id}"]`)!
const draftRow = (host: HTMLElement) => host.querySelector('[data-draft]') as HTMLElement
const response = (view: Record<string, unknown>, status = 200): ApiResponse => ({ status, body: status === 200 ? settingsView(view) : { error: 'rejected' } })

test('test_line_active_ui_01 spec Scenario "默认收起已配置的线路"', async () => {
  const mounted = await mount(twoLines)
  try {
    const line2 = row(mounted.host, '9f0e7d6c')
    const line1 = row(mounted.host, 'a1b2c3d4')
    expect(line2.getAttribute('data-expanded')).toBe('false')
    expect(line1.getAttribute('data-expanded')).toBe('false')
    expect(mounted.host.querySelector('.dmg-line-body')).toBeNull()
    const marker = line2.querySelector('[data-active-line="9f0e7d6c"]')!
    expect(marker.getAttribute('aria-label')).toBe('当前线路')
    expect(marker.className).toContain('dmg-active')
    expect(line1.querySelector('[data-active-line]')).toBeNull()
    expect(mounted.host.querySelectorAll('[role="alert"]').length).toBe(0)
  } finally { cleanup(mounted) }
})

test('test_line_active_ui_02 spec Scenario "无 active 时不显示方块"', async () => {
  const mounted = await mount({ lines: [savedLine('a1b2c3d4', '', { complete: false, key: { configured: false, writable: true } })], activeLineId: null })
  try {
    expect(row(mounted.host, 'a1b2c3d4').getAttribute('data-expanded')).toBe('false')
    expect(mounted.host.querySelector('[data-active-line]')).toBeNull()
  } finally { cleanup(mounted) }
})

test('test_line_expand_install spec Scenario "首次安装空态与添加第一条线路后展开"', async () => {
  const mounted = await mount({ lines: [], activeLineId: null })
  try {
    expect(mounted.host.textContent).toContain('添加线路')
    act(() => buttonByText(mounted.host, '添加线路')!.click())
    const draft = draftRow(mounted.host)
    expect(draft.getAttribute('data-expanded')).toBe('true')
    expect(draft.querySelector('input:not([type=password])')).not.toBeNull()
  } finally { cleanup(mounted) }
})

test('test_line_expand_add spec Scenario "新增备用线路只展开新行"', async () => {
  const mounted = await mount(twoLines)
  try {
    act(() => buttonByText(mounted.host, '添加备用线路')!.click())
    const draft = draftRow(mounted.host)
    expect(draft.getAttribute('data-expanded')).toBe('true')
    expect(row(mounted.host, 'a1b2c3d4').getAttribute('data-expanded')).toBe('false')
    expect(row(mounted.host, '9f0e7d6c').getAttribute('data-expanded')).toBe('false')
  } finally { cleanup(mounted) }
})

test('test_line_expand_toggle spec Scenario "点击切换控件切换展开且图标操作不触发展开"', async () => {
  const mounted = await mount(twoLines)
  try {
    act(() => (row(mounted.host, '9f0e7d6c').querySelector('[data-toggle]') as HTMLElement).click())
    expect(row(mounted.host, '9f0e7d6c').getAttribute('data-expanded')).toBe('true')
    const toggle = row(mounted.host, '9f0e7d6c').querySelector('[data-toggle]') as HTMLElement
    expect(toggle.tagName).toBe('BUTTON')
    expect(toggle.getAttribute('type')).toBe('button')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    act(() => (row(mounted.host, '9f0e7d6c').querySelector('[data-action="上移"]') as HTMLElement).click())
    expect(row(mounted.host, '9f0e7d6c').getAttribute('data-expanded')).toBe('true')
    expect(Array.from(mounted.host.querySelectorAll('[data-line-id]')).map(element => element.getAttribute('data-line-id'))).toEqual(['9f0e7d6c', 'a1b2c3d4'])
    act(() => (row(mounted.host, '9f0e7d6c').querySelector('[data-toggle]') as HTMLElement).click())
    expect(row(mounted.host, '9f0e7d6c').getAttribute('data-expanded')).toBe('false')
    const disabledMove = row(mounted.host, '9f0e7d6c').querySelector('[data-action="上移"]') as HTMLButtonElement
    expect(disabledMove.disabled).toBe(true)
    expect(disabledMove.getAttribute('aria-label')).toContain('已是第一条')
    act(() => disabledMove.click())
    expect(mounted.host.querySelectorAll('[data-expanded="true"]')).toHaveLength(0)
    expect(mounted.host.querySelectorAll('[data-action="删除"]')).toHaveLength(2)
  } finally { cleanup(mounted) }
})

test('test_line_expand_first_save spec Scenario "新建线路首次保存后保持展开并换成新 id"', async () => {
  const created = { lines: [savedLine('feedface', 'http://new.test:3425/v1')], activeLineId: 'feedface' }
  const mounted = await mount({ lines: [], activeLineId: null }, { 'POST settings': () => ok(settingsView(created)) })
  try {
    act(() => buttonByText(mounted.host, '添加线路')!.click())
    const draft = draftRow(mounted.host)
    act(() => inputValue(draft.querySelector('input:not([type=password])') as HTMLInputElement, 'http://new.test:3425/v1'))
    act(() => inputValue(draft.querySelector('input[type=password]') as HTMLInputElement, 'K1'))
    await act(async () => buttonByText(mounted.host, '保存')!.click()); await flush()
    expect(row(mounted.host, 'feedface').getAttribute('data-expanded')).toBe('true')
    expect(mounted.host.querySelectorAll('[data-expanded="true"]')).toHaveLength(1)
  } finally { cleanup(mounted) }
})

test('test_line_expand_save_after_move spec Scenario "新增线路并上移后首次保存仍保持展开"', async () => {
  const created = {
    lines: [savedLine('a1b2c3d4', 'http://lan.test:3425/v1'), savedLine('feedface', 'http://new.test:3425/v1'), savedLine('9f0e7d6c', 'https://public.test/v1')],
    activeLineId: 'a1b2c3d4',
  }
  const mounted = await mount(twoLines, { 'POST settings': () => ok(settingsView(created)) })
  try {
    act(() => buttonByText(mounted.host, '添加备用线路')!.click())
    act(() => inputValue(draftRow(mounted.host).querySelector('input:not([type=password])') as HTMLInputElement, 'http://new.test:3425/v1'))
    act(() => inputValue(draftRow(mounted.host).querySelector('input[type=password]') as HTMLInputElement, 'K2'))
    act(() => (draftRow(mounted.host).querySelector('[data-action="上移"]') as HTMLElement).click())
    await act(async () => buttonByText(mounted.host, '保存')!.click()); await flush()
    expect(row(mounted.host, 'feedface').getAttribute('data-expanded')).toBe('true')
    expect(mounted.host.querySelectorAll('[data-expanded="true"]')).toHaveLength(1)
  } finally { cleanup(mounted) }
})

test('test_line_expand_save_keep spec Scenario "保存后不收起正在编辑的行"', async () => {
  const updated = { lines: [savedLine('a1b2c3d4', 'http://lan.test:3425/v1'), savedLine('9f0e7d6c', 'https://moved.test/v1')], activeLineId: '9f0e7d6c' }
  const mounted = await mount(twoLines, { 'POST settings': () => ok(settingsView(updated)) })
  try {
    act(() => expandLine(mounted.host, '9f0e7d6c'))
    const address = row(mounted.host, '9f0e7d6c').querySelector('input:not([type=password])') as HTMLInputElement
    act(() => inputValue(address, 'https://moved.test/v1'))
    await act(async () => buttonByText(mounted.host, '保存')!.click()); await flush()
    expect(row(mounted.host, '9f0e7d6c').getAttribute('data-expanded')).toBe('true')
    expect((row(mounted.host, '9f0e7d6c').querySelector('input:not([type=password])') as HTMLInputElement).value).toBe('https://moved.test/v1')
    expect(row(mounted.host, 'a1b2c3d4').getAttribute('data-expanded')).toBe('false')
  } finally { cleanup(mounted) }
})

test('test_line_expand_save_failure spec Scenario "保存失败时保持展开且不清空输入"', async () => {
  const mounted = await mount(twoLines, { 'POST settings': () => response({}, 409) })
  try {
    act(() => expandLine(mounted.host, '9f0e7d6c'))
    const before = mounted.calls.filter(call => call.path === 'latency').length
    const address = row(mounted.host, '9f0e7d6c').querySelector('input:not([type=password])') as HTMLInputElement
    act(() => inputValue(address, 'https://rejected.test/v1'))
    await act(async () => buttonByText(mounted.host, '保存')!.click()); await flush()
    expect(row(mounted.host, '9f0e7d6c').getAttribute('data-expanded')).toBe('true')
    expect((row(mounted.host, '9f0e7d6c').querySelector('input:not([type=password])') as HTMLInputElement).value).toBe('https://rejected.test/v1')
    expect(mounted.calls.filter(call => call.path === 'latency')).toHaveLength(before)
  } finally { cleanup(mounted) }
})
